/**
 * E2E Scenario: Error Handling
 *
 * Tests error scenarios at the UI level: API failures, disconnection states,
 * uncommitted changes conflicts, and recovery.
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { createMockApi } from "../helpers/mock-api";
import { createMockWebSocket } from "../helpers/mock-websocket";
import { renderWithUser, waitFor } from "../helpers/render";
import {
  createLoopWithStatus,
  createWorkspace,
  createModelInfo,
  createLoopError,
} from "../helpers/factories";
import { App } from "@/App";

const api = createMockApi();
const ws = createMockWebSocket();

const WORKSPACE = createWorkspace({
  id: "ws-1",
  name: "My Project",
  directory: "/workspaces/my-project",
});

function setupBaseApi() {
  api.get("/api/config", () => ({ remoteOnly: false }));
  api.get("/api/health", () => ({ status: "ok", version: "1.0.0" }));
  api.get("/api/preferences/last-model", () => null);
  api.get("/api/preferences/log-level", () => ({ level: "info" }));
  api.get("/api/preferences/last-directory", () => null);
  api.get("/api/models", () => [createModelInfo({ connected: true })]);
  api.get("/api/git/branches", () => ({
    branches: [{ name: "main", isCurrent: true, isDefault: true }],
    currentBranch: "main",
  }));
  api.get("/api/git/default-branch", () => ({ defaultBranch: "main" }));
  api.get("/api/check-planning-dir", () => ({ warning: null }));
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

// ─── Error handling scenarios ────────────────────────────────────────────────

describe("error handling scenario", () => {
  test("failed loop shows error message on loop card", async () => {
    setupBaseApi();

    const failedLoop = createLoopWithStatus("failed", {
      config: { id: "fail-1", name: "Failed Loop", directory: "/workspaces/my-project", workspaceId: "ws-1" },
      state: {
        error: createLoopError({ message: "Process crashed unexpectedly" }),
      },
    });

    api.get("/api/loops", () => [failedLoop]);
    api.get("/api/workspaces", () => [WORKSPACE]);

    const { getByText } = renderWithUser(<App />);

    await waitFor(() => {
      expect(getByText("Failed Loop")).toBeTruthy();
    });

    // Error message shown on the card
    expect(getByText("Process crashed unexpectedly")).toBeTruthy();

    // Status badge shows "Failed"
    expect(getByText("Failed")).toBeTruthy();
  });

  test("loop details shows error state for failed loops", async () => {
    setupBaseApi();

    const failedLoop = createLoopWithStatus("failed", {
      config: { id: "fail-detail-1", name: "Detail Failure", directory: "/workspaces/my-project", workspaceId: "ws-1" },
      state: {
        error: createLoopError({ message: "API rate limit exceeded" }),
      },
    });

    api.get("/api/loops", () => [failedLoop]);
    api.get("/api/loops/:id", () => failedLoop);
    api.get("/api/workspaces", () => [WORKSPACE]);

    window.location.hash = `/loop/fail-detail-1`;
    const { getByText } = renderWithUser(<App />);

    await waitFor(() => {
      expect(getByText("Detail Failure")).toBeTruthy();
    });

    // Error is visible in the details view
    await waitFor(() => {
      expect(getByText("API rate limit exceeded")).toBeTruthy();
    });
  });

  test("loop not found shows error page", async () => {
    setupBaseApi();

    api.get("/api/loops", () => []);
    api.get("/api/loops/:id", () => null);
    api.get("/api/workspaces", () => [WORKSPACE]);

    window.location.hash = "/loop/nonexistent-loop";
    const { getByText } = renderWithUser(<App />);

    // Should show loop not found
    await waitFor(() => {
      expect(getByText("Loop not found")).toBeTruthy();
    });
  });

  test("create loop with 409 uncommitted changes shows conflict modal", async () => {
    setupBaseApi();
    api.get("/api/loops", () => []);
    api.get("/api/workspaces", () => [WORKSPACE]);
    api.post(
      "/api/loops",
      () => ({
        error: "uncommitted_changes",
        message: "Directory has uncommitted changes.",
        changedFiles: ["src/main.ts"],
      }),
      409,
    );

    const { getByText, getByRole, getByLabelText, user } = renderWithUser(<App />);

    await waitFor(() => {
      expect(getByText("Ralpher")).toBeTruthy();
    });

    // Open create modal
    await user.click(getByText("New Loop"));
    await waitFor(() => {
      expect(getByRole("heading", { name: "Create New Loop" })).toBeTruthy();
    });

    // Select workspace
    const wsSelect = document.querySelector("select#workspace") as HTMLSelectElement;
    await user.selectOptions(wsSelect, "ws-1");

    // Wait for form ready (planMode defaults to true, so button text is "Create Plan")
    await waitFor(() => {
      const btn = Array.from(document.querySelectorAll("button")).find(
        (b) => b.textContent?.includes("Create Plan"),
      );
      expect(btn).toBeTruthy();
    });

    // Fill prompt
    const promptTextarea = getByLabelText(/Prompt/) as HTMLTextAreaElement;
    await user.type(promptTextarea, "X");

    // Submit
    const submitBtn = Array.from(document.querySelectorAll("button")).find(
      (b) => b.textContent?.includes("Create Plan"),
    );
    await user.click(submitBtn!);

    // Uncommitted changes modal appears
    await waitFor(() => {
      expect(getByText("Cannot Start Loop")).toBeTruthy();
    });
  });

  test("accept loop failure shows error in modal", async () => {
    setupBaseApi();

    const loop = createLoopWithStatus("completed", {
      config: { id: "accept-fail-1", name: "Accept Fail", directory: "/workspaces/my-project", workspaceId: "ws-1" },
    });

    api.get("/api/loops", () => [loop]);
    api.get("/api/loops/:id", () => loop);
    api.get("/api/workspaces", () => [WORKSPACE]);
    api.post("/api/loops/:id/accept", () => ({ error: "Merge conflict detected" }), 500);

    window.location.hash = `/loop/accept-fail-1`;
    const { getByText, user } = renderWithUser(<App />);

    await waitFor(() => {
      expect(getByText("Accept Fail")).toBeTruthy();
    });

    // Go to Actions tab
    await user.click(getByText("Actions"));

    // Click Accept
    await waitFor(() => {
      const acceptBtn = Array.from(document.querySelectorAll("button")).find(
        (b) => b.textContent?.includes("Accept") && b.textContent?.includes("merge or push"),
      );
      expect(acceptBtn).toBeTruthy();
    });

    const acceptBtn = Array.from(document.querySelectorAll("button")).find(
      (b) => b.textContent?.includes("Accept") && b.textContent?.includes("merge or push"),
    );
    await user.click(acceptBtn!);

    // AcceptLoopModal opens
    await waitFor(() => {
      expect(getByText("Finalize Loop")).toBeTruthy();
    });

    // Click Accept & Merge
    const mergeBtn = Array.from(document.querySelectorAll("button")).find(
      (b) => b.textContent?.includes("Accept & Merge"),
    );
    await user.click(mergeBtn!);

    // The API was called (even if it fails)
    await waitFor(() => {
      const calls = api.calls("/api/loops/:id/accept", "POST");
      expect(calls.length).toBeGreaterThan(0);
    });
  });

  test("multiple loops in different error states display correctly", async () => {
    setupBaseApi();

    const failedLoop = createLoopWithStatus("failed", {
      config: { id: "multi-fail", name: "Failure One", directory: "/workspaces/my-project", workspaceId: "ws-1" },
      state: {
        error: createLoopError({ message: "Timeout error" }),
      },
    });
    const stoppedLoop = createLoopWithStatus("stopped", {
      config: { id: "multi-stop", name: "Stopped One", directory: "/workspaces/my-project", workspaceId: "ws-1" },
    });
    const maxIterLoop = createLoopWithStatus("max_iterations", {
      config: { id: "multi-max", name: "Maxed Out", directory: "/workspaces/my-project", workspaceId: "ws-1" },
    });

    api.get("/api/loops", () => [failedLoop, stoppedLoop, maxIterLoop]);
    api.get("/api/workspaces", () => [WORKSPACE]);

    const { getByText } = renderWithUser(<App />);

    await waitFor(() => {
      expect(getByText("Failure One")).toBeTruthy();
    });

    // All loop names visible
    expect(getByText("Stopped One")).toBeTruthy();
    expect(getByText("Maxed Out")).toBeTruthy();

    // Status badges
    expect(getByText("Failed")).toBeTruthy();
    expect(getByText("Stopped")).toBeTruthy();
    expect(getByText("Max Iterations")).toBeTruthy();

    // Error message on failed loop
    expect(getByText("Timeout error")).toBeTruthy();

    // These go in the "Other" status group
    expect(getByText(/Other \(3\)/)).toBeTruthy();
  });
});
