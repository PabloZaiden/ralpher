/**
 * E2E Scenario: Loop Lifecycle
 *
 * Tests the full lifecycle of a loop: running -> completed -> accept/push/discard.
 * Renders the App component and simulates user navigation and actions.
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { createMockApi } from "../helpers/mock-api";
import { createMockWebSocket } from "../helpers/mock-websocket";
import { renderWithUser, waitFor, act } from "../helpers/render";
import {
  createLoop,
  createLoopWithStatus,
  createWorkspaceWithLoopCount,
  createModelInfo,
} from "../helpers/factories";
import { App } from "@/App";

const api = createMockApi();
const ws = createMockWebSocket();

const LOOP_ID = "lifecycle-loop-1";

const WORKSPACE = createWorkspaceWithLoopCount({
  id: "ws-1",
  name: "My Project",
  directory: "/workspaces/my-project",
  loopCount: 1,
});

function setupApi(loop: ReturnType<typeof createLoop>) {
  api.get("/api/loops", () => [loop]);
  api.get("/api/loops/:id", () => loop);
  api.get("/api/workspaces", () => [WORKSPACE]);
  api.get("/api/config", () => ({ remoteOnly: false }));
  api.get("/api/health", () => ({ status: "ok", version: "1.0.0" }));
  api.get("/api/preferences/last-model", () => null);
  api.get("/api/preferences/log-level", () => ({ level: "info" }));
  api.get("/api/preferences/last-directory", () => null);
  api.get("/api/models", () => [createModelInfo({ connected: true })]);
  api.get("/api/loops/:id/diff", () => []);
  api.get("/api/loops/:id/plan", () => ({ exists: false, content: "" }));
  api.get("/api/loops/:id/status-file", () => ({ exists: false, content: "" }));
  api.get("/api/loops/:id/comments", () => ({ success: true, comments: [] }));
  api.get("/api/preferences/markdown-rendering", () => ({ enabled: true }));
}

beforeEach(() => {
  api.reset();
  api.install();
  ws.reset();
  ws.install();
  window.location.hash = "";
});

afterEach(() => {
  api.uninstall();
  ws.uninstall();
  window.location.hash = "";
});

// ─── Loop lifecycle scenarios ────────────────────────────────────────────────

describe("loop lifecycle scenario", () => {
  test("running loop appears on dashboard and user navigates to details", async () => {
    const loop = createLoopWithStatus("running", {
      config: { id: LOOP_ID, name: "Feature Loop", directory: "/workspaces/my-project" },
    });
    setupApi(loop);

    const { getByText, user } = renderWithUser(<App />);

    // Dashboard shows the running loop
    await waitFor(() => {
      expect(getByText("Feature Loop")).toBeTruthy();
    });
    expect(getByText("Running")).toBeTruthy();

    // Click on the loop card to navigate
    await user.click(getByText("Feature Loop"));

    // Should navigate to loop details
    await waitFor(() => {
      expect(getByText("← Back")).toBeTruthy();
    });
    expect(getByText("Feature Loop")).toBeTruthy();
  });

  test("completed loop shows accept and delete actions", async () => {
    const loop = createLoopWithStatus("completed", {
      config: { id: LOOP_ID, name: "Done Loop", directory: "/workspaces/my-project" },
    });
    setupApi(loop);

    // Navigate directly to loop details
    window.location.hash = `/loop/${LOOP_ID}`;

    const { getByText, user } = renderWithUser(<App />);

    // Wait for loop to load
    await waitFor(() => {
      expect(getByText("Done Loop")).toBeTruthy();
    });

    // Go to Actions tab
    await user.click(getByText("Actions"));

    // Should show accept and delete actions
    await waitFor(() => {
      const acceptBtn = Array.from(document.querySelectorAll("button")).find(
        (b) => b.textContent?.includes("Accept") && b.textContent?.includes("Merge"),
      );
      expect(acceptBtn).toBeTruthy();

      const deleteBtn = Array.from(document.querySelectorAll("button")).find(
        (b) => b.textContent?.includes("Delete"),
      );
      expect(deleteBtn).toBeTruthy();
    });
  });

  test("accept loop flow: click accept, confirm merge, loop status updates", async () => {
    const loop = createLoopWithStatus("completed", {
      config: { id: LOOP_ID, name: "Accept Loop", directory: "/workspaces/my-project" },
    });
    setupApi(loop);
    api.post("/api/loops/:id/accept", () => ({
      success: true,
      mergeCommit: "abc123def",
    }));
    // After accept, loop becomes merged
    const mergedLoop = createLoopWithStatus("merged", {
      config: { id: LOOP_ID, name: "Accept Loop", directory: "/workspaces/my-project" },
    });
    api.get("/api/loops/:id", () => mergedLoop);

    window.location.hash = `/loop/${LOOP_ID}`;
    const { getByText, user } = renderWithUser(<App />);

    await waitFor(() => {
      expect(getByText("Accept Loop")).toBeTruthy();
    });

    // Go to Actions tab
    await user.click(getByText("Actions"));

    // Click Accept
    await waitFor(() => {
      const acceptBtn = Array.from(document.querySelectorAll("button")).find(
        (b) => b.textContent?.includes("Accept") && b.textContent?.includes("Merge"),
      );
      expect(acceptBtn).toBeTruthy();
    });

    const acceptBtn = Array.from(document.querySelectorAll("button")).find(
      (b) => b.textContent?.includes("Accept") && b.textContent?.includes("Merge"),
    );
    await user.click(acceptBtn!);

    // AcceptLoopModal opens with "Finalize Loop" title
    await waitFor(() => {
      expect(getByText("Finalize Loop")).toBeTruthy();
    });

    // Click "Merge" in the modal
    const mergeBtn = Array.from(document.querySelectorAll("button")).find(
      (b) => b.textContent?.trim() === "Merge",
    );
    expect(mergeBtn).toBeTruthy();
    await user.click(mergeBtn!);

    // After merge, the API was called
    await waitFor(() => {
      const acceptCalls = api.calls("/api/loops/:id/accept", "POST");
      expect(acceptCalls.length).toBeGreaterThan(0);
    });
  });

  test("delete loop flow: click delete, confirm, navigates back to dashboard", async () => {
    const loop = createLoopWithStatus("running", {
      config: { id: LOOP_ID, name: "Delete Me Loop", directory: "/workspaces/my-project" },
    });
    setupApi(loop);
    api.delete("/api/loops/:id", () => ({ success: true }));
    // After delete, loops list is empty
    api.get("/api/loops", () => []);

    window.location.hash = `/loop/${LOOP_ID}`;
    const { getByText, user } = renderWithUser(<App />);

    await waitFor(() => {
      expect(getByText("Delete Me Loop")).toBeTruthy();
    });

    // Go to Actions tab
    await user.click(getByText("Actions"));

    // Click Delete
    await waitFor(() => {
      const deleteBtn = Array.from(document.querySelectorAll("button")).find(
        (b) => b.textContent?.includes("Delete") && b.textContent?.includes("Stop"),
      );
      expect(deleteBtn).toBeTruthy();
    });

    const deleteBtn = Array.from(document.querySelectorAll("button")).find(
      (b) => b.textContent?.includes("Delete") && b.textContent?.includes("Stop"),
    );
    await user.click(deleteBtn!);

    // Delete confirmation modal should appear
    await waitFor(() => {
      expect(getByText(/Are you sure/i)).toBeTruthy();
    });

    // Confirm delete
    const confirmBtn = Array.from(document.querySelectorAll("button")).find(
      (b) => b.textContent?.trim() === "Delete" || b.textContent?.trim() === "Delete Loop",
    );
    expect(confirmBtn).toBeTruthy();
    await user.click(confirmBtn!);

    // Should navigate back to dashboard
    await waitFor(() => {
      expect(getByText("Ralpher")).toBeTruthy();
      expect(getByText("New Loop")).toBeTruthy();
    });
  });

  test("push loop flow: click accept, push to remote", async () => {
    const loop = createLoopWithStatus("completed", {
      config: { id: LOOP_ID, name: "Push Loop", directory: "/workspaces/my-project" },
    });
    setupApi(loop);
    api.post("/api/loops/:id/push", () => ({
      success: true,
      remoteBranch: "ralph/push-loop",
    }));
    // After push, loop becomes pushed
    const pushedLoop = createLoopWithStatus("pushed", {
      config: { id: LOOP_ID, name: "Push Loop", directory: "/workspaces/my-project" },
    });
    api.get("/api/loops/:id", () => pushedLoop);

    window.location.hash = `/loop/${LOOP_ID}`;
    const { getByText, user } = renderWithUser(<App />);

    await waitFor(() => {
      expect(getByText("Push Loop")).toBeTruthy();
    });

    // Go to Actions tab
    await user.click(getByText("Actions"));

    // Click Accept button to open AcceptLoopModal
    await waitFor(() => {
      const acceptBtn = Array.from(document.querySelectorAll("button")).find(
        (b) => b.textContent?.includes("Accept") && b.textContent?.includes("Merge"),
      );
      expect(acceptBtn).toBeTruthy();
    });

    const acceptBtn = Array.from(document.querySelectorAll("button")).find(
      (b) => b.textContent?.includes("Accept") && b.textContent?.includes("Merge"),
    );
    await user.click(acceptBtn!);

    // AcceptLoopModal opens
    await waitFor(() => {
      expect(getByText("Finalize Loop")).toBeTruthy();
    });

    // Click "Push" in the modal
    const pushBtn = Array.from(document.querySelectorAll("button")).find(
      (b) => b.textContent?.trim() === "Push",
    );
    expect(pushBtn).toBeTruthy();
    await user.click(pushBtn!);

    // After push, the API was called
    await waitFor(() => {
      const pushCalls = api.calls("/api/loops/:id/push", "POST");
      expect(pushCalls.length).toBeGreaterThan(0);
    });
  });

  test("back button from loop details returns to dashboard", async () => {
    const loop = createLoopWithStatus("running", {
      config: { id: LOOP_ID, name: "Nav Loop", directory: "/workspaces/my-project" },
    });
    setupApi(loop);

    window.location.hash = `/loop/${LOOP_ID}`;
    const { getByText, user } = renderWithUser(<App />);

    await waitFor(() => {
      expect(getByText("Nav Loop")).toBeTruthy();
    });

    // Click back button
    await user.click(getByText("← Back"));

    // Should return to dashboard
    await waitFor(() => {
      expect(getByText("Ralpher")).toBeTruthy();
      expect(getByText("New Loop")).toBeTruthy();
    });
  });
});
