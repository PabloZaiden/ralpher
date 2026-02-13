/**
 * E2E Scenario: Review Comments Workflow
 *
 * Tests the review cycle: loop pushed -> address comments -> new cycle starts.
 * Covers the AddressCommentsModal flow from both Dashboard and LoopDetails.
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { createMockApi } from "../helpers/mock-api";
import { createMockWebSocket } from "../helpers/mock-websocket";
import { renderWithUser, waitFor } from "../helpers/render";
import {
  createLoopWithStatus,
  createWorkspace,
  createModelInfo,
} from "../helpers/factories";
import { App } from "@/App";

const api = createMockApi();
const ws = createMockWebSocket();

const LOOP_ID = "review-loop-1";

const WORKSPACE = createWorkspace({
  id: "ws-1",
  name: "My Project",
  directory: "/workspaces/my-project",
});

function pushedAddressableLoop(reviewCycles = 0) {
  return createLoopWithStatus("pushed", {
    config: { id: LOOP_ID, name: "Pushed Loop", directory: "/workspaces/my-project", workspaceId: "ws-1" },
    state: {
      reviewMode: {
        addressable: true,
        completionAction: "push",
        reviewCycles,
        reviewBranches: [],
      },
    },
  });
}

function mergedAddressableLoop(reviewCycles = 0) {
  return createLoopWithStatus("merged", {
    config: { id: LOOP_ID, name: "Merged Loop", directory: "/workspaces/my-project", workspaceId: "ws-1" },
    state: {
      reviewMode: {
        addressable: true,
        completionAction: "merge",
        reviewCycles,
        reviewBranches: [],
      },
    },
  });
}

function setupApi(loop: ReturnType<typeof createLoopWithStatus>) {
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

// ─── Review comments scenarios ───────────────────────────────────────────────

describe("review comments scenario", () => {
  test("pushed addressable loop shows Addressable badge on dashboard", async () => {
    const loop = pushedAddressableLoop(0);
    setupApi(loop);

    const { getByText } = renderWithUser(<App />);

    await waitFor(() => {
      expect(getByText("Pushed Loop")).toBeTruthy();
    });

    // Addressable badge should be visible on the dashboard row
    expect(getByText("Addressable")).toBeTruthy();
    // Note: Address Comments button was removed from dashboard cards/rows in PR #125.
    // Address comments is now only accessible from LoopDetails Actions tab.
  });

  test("address comments from dashboard: navigate to details then submit", async () => {
    const loop = pushedAddressableLoop(1);
    setupApi(loop);
    api.post("/api/loops/:id/address-comments", () => ({ success: true }));

    const { getByText, user } = renderWithUser(<App />);

    await waitFor(() => {
      expect(getByText("Pushed Loop")).toBeTruthy();
    });

    // Click on the loop row to navigate to LoopDetails
    await user.click(getByText("Pushed Loop"));

    // Wait for loop details
    await waitFor(() => {
      expect(getByText("← Back")).toBeTruthy();
    });

    // Go to Actions tab
    await user.click(getByText("Actions"));

    // Find and click Address Comments button in the Actions tab
    await waitFor(() => {
      const addressBtn = Array.from(document.querySelectorAll("button")).find(
        (b) => b.textContent?.includes("Address Comments") && b.textContent?.includes("Submit comments"),
      );
      expect(addressBtn).toBeTruthy();
    });

    const addressBtn = Array.from(document.querySelectorAll("button")).find(
      (b) => b.textContent?.includes("Address Comments") && b.textContent?.includes("Submit comments"),
    );
    await user.click(addressBtn!);

    // AddressCommentsModal opens
    await waitFor(() => {
      expect(getByText("Address Reviewer Comments")).toBeTruthy();
    });

    // Description shows loop name and review cycle
    const reviewCycleTexts = Array.from(document.querySelectorAll("*")).filter(
      (el) => el.textContent?.includes("Pushed Loop") && el.textContent?.includes("Review Cycle 2"),
    );
    expect(reviewCycleTexts.length).toBeGreaterThan(0);

    // Fill in comments
    const textarea = document.querySelector("#reviewer-comments") as HTMLTextAreaElement;
    expect(textarea).toBeTruthy();
    await user.type(textarea, "X");

    // Submit Comments button
    const submitBtn = Array.from(document.querySelectorAll("button")).find(
      (b) => b.textContent?.includes("Submit Comments"),
    );
    expect(submitBtn).toBeTruthy();
    await user.click(submitBtn!);

    // API should have been called
    await waitFor(() => {
      const calls = api.calls("/api/loops/:id/address-comments", "POST");
      expect(calls.length).toBeGreaterThan(0);
    });
  });

  test("address comments from loop details: navigate then address", async () => {
    const loop = pushedAddressableLoop(0);
    setupApi(loop);
    api.post("/api/loops/:id/address-comments", () => ({ success: true }));

    window.location.hash = `/loop/${LOOP_ID}`;
    const { getByText, user } = renderWithUser(<App />);

    // Wait for loop details
    await waitFor(() => {
      expect(getByText("Pushed Loop")).toBeTruthy();
      expect(getByText("← Back")).toBeTruthy();
    });

    // Go to Actions tab
    await user.click(getByText("Actions"));

    // Find and click Address Comments button
    await waitFor(() => {
      const addressBtn = Array.from(document.querySelectorAll("button")).find(
        (b) => b.textContent?.includes("Address Comments") && b.textContent?.includes("Submit comments"),
      );
      expect(addressBtn).toBeTruthy();
    });

    const addressBtn = Array.from(document.querySelectorAll("button")).find(
      (b) => b.textContent?.includes("Address Comments") && b.textContent?.includes("Submit comments"),
    );
    await user.click(addressBtn!);

    // AddressCommentsModal opens
    await waitFor(() => {
      expect(getByText("Address Reviewer Comments")).toBeTruthy();
    });

    // Fill in and submit
    const textarea = document.querySelector("#reviewer-comments") as HTMLTextAreaElement;
    await user.type(textarea, "Y");

    const submitBtn = Array.from(document.querySelectorAll("button")).find(
      (b) => b.textContent?.includes("Submit Comments"),
    );
    await user.click(submitBtn!);

    // API called
    await waitFor(() => {
      const calls = api.calls("/api/loops/:id/address-comments", "POST");
      expect(calls.length).toBeGreaterThan(0);
    });
  });

  test("merged addressable loop shows Addressable badge", async () => {
    const loop = mergedAddressableLoop(2);
    setupApi(loop);

    const { getByText } = renderWithUser(<App />);

    await waitFor(() => {
      expect(getByText("Merged Loop")).toBeTruthy();
    });

    // Should be in Awaiting Feedback section
    expect(getByText(/Awaiting Feedback \(1\)/)).toBeTruthy();
    expect(getByText("Addressable")).toBeTruthy();
    // Note: Address Comments button was removed from dashboard cards/rows in PR #125.
  });

  test("review cycle counter is shown on loop row", async () => {
    const loop = pushedAddressableLoop(3);
    setupApi(loop);

    const { getByText } = renderWithUser(<App />);

    await waitFor(() => {
      expect(getByText("Pushed Loop")).toBeTruthy();
    });

    // Review cycle displayed on the row (LoopRow uses "RC:{n}" format)
    expect(getByText(/RC:3/)).toBeTruthy();
  });

  test("submit comments is disabled when textarea is empty", async () => {
    const loop = pushedAddressableLoop(0);
    setupApi(loop);

    // Navigate directly to loop details
    window.location.hash = `/loop/${LOOP_ID}`;
    const { getByText, user } = renderWithUser(<App />);

    // Wait for loop details
    await waitFor(() => {
      expect(getByText("Pushed Loop")).toBeTruthy();
      expect(getByText("← Back")).toBeTruthy();
    });

    // Go to Actions tab
    await user.click(getByText("Actions"));

    // Find and click Address Comments button
    await waitFor(() => {
      const addressBtn = Array.from(document.querySelectorAll("button")).find(
        (b) => b.textContent?.includes("Address Comments") && b.textContent?.includes("Submit comments"),
      );
      expect(addressBtn).toBeTruthy();
    });

    const addressBtn = Array.from(document.querySelectorAll("button")).find(
      (b) => b.textContent?.includes("Address Comments") && b.textContent?.includes("Submit comments"),
    );
    await user.click(addressBtn!);

    // AddressCommentsModal opens
    await waitFor(() => {
      expect(getByText("Address Reviewer Comments")).toBeTruthy();
    });

    // Submit button should be disabled when empty
    const submitBtn = Array.from(document.querySelectorAll("button")).find(
      (b) => b.textContent?.includes("Submit Comments"),
    );
    expect(submitBtn).toBeTruthy();
    expect(submitBtn!.disabled).toBe(true);
  });
});
