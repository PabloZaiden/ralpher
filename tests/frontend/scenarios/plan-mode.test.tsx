/**
 * E2E Scenario: Plan Mode Workflow
 *
 * Tests the full plan mode flow: create loop with plan mode -> planning status ->
 * plan content appears -> user sends feedback -> plan updated -> user accepts plan ->
 * loop starts running. Also tests: discard plan.
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

const LOOP_ID = "plan-loop-1";

const WORKSPACE = createWorkspace({
  id: "ws-1",
  name: "My Project",
  directory: "/workspaces/my-project",
});

function planningLoop(isPlanReady: boolean, feedbackRounds = 0) {
  return createLoopWithStatus("planning", {
    config: { id: LOOP_ID, name: "Plan Loop", directory: "/workspaces/my-project", workspaceId: "ws-1" },
    state: {
      planMode: {
        active: true,
        feedbackRounds,
        planningFolderCleared: false,
        isPlanReady,
      },
    },
  });
}

function setupApi(loop: ReturnType<typeof createLoopWithStatus>, planContent = "") {
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
  api.get("/api/loops/:id/plan", () => ({
    exists: planContent.length > 0,
    content: planContent,
  }));
  api.get("/api/loops/:id/status-file", () => ({ exists: false, content: "" }));
  api.get("/api/loops/:id/comments", () => ({ success: true, comments: [] }));
  api.get("/api/preferences/markdown-rendering", () => ({ enabled: false }));
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

// ─── Plan mode scenarios ─────────────────────────────────────────────────────

describe("plan mode scenario", () => {
  test("planning loop shows PlanReviewPanel instead of tabs", async () => {
    const loop = planningLoop(false);
    setupApi(loop);

    window.location.hash = `/loop/${LOOP_ID}`;
    const { getByText, queryByText } = renderWithUser(<App />);

    await waitFor(() => {
      expect(getByText("Plan Loop")).toBeTruthy();
    });

    // PlanReviewPanel should be showing, not the normal tabs
    await waitFor(() => {
      // Plan tab header should exist (as part of PlanReviewPanel's own tabs)
      expect(getByText("Plan")).toBeTruthy();
      expect(getByText("Activity Log")).toBeTruthy();
    });

    // Normal detail tabs should NOT be present
    expect(queryByText("Prompt")).toBeNull();
    expect(queryByText("Actions")).toBeNull();
  });

  test("plan content appears when plan is ready", async () => {
    const loop = planningLoop(true);
    setupApi(loop, "## Step 1\nDo something\n\n## Step 2\nDo more");

    window.location.hash = `/loop/${LOOP_ID}`;
    const { getByText } = renderWithUser(<App />);

    await waitFor(() => {
      expect(getByText("Plan Loop")).toBeTruthy();
    });

    // Plan content should be visible (rendered as raw text since markdown rendering is disabled)
    await waitFor(() => {
      expect(getByText(/Step 1/)).toBeTruthy();
    });

    // Accept button should be enabled when isPlanReady is true
    const acceptBtn = Array.from(document.querySelectorAll("button")).find(
      (b) => b.textContent?.includes("Accept Plan"),
    );
    expect(acceptBtn).toBeTruthy();
    expect(acceptBtn!.disabled).toBe(false);
  });

  test("accept plan disabled while AI is still writing", async () => {
    const loop = planningLoop(false);
    setupApi(loop, "## Partial plan");

    window.location.hash = `/loop/${LOOP_ID}`;
    const { getByText } = renderWithUser(<App />);

    await waitFor(() => {
      expect(getByText("Plan Loop")).toBeTruthy();
    });

    // Wait for plan content to appear
    await waitFor(() => {
      expect(getByText(/Partial plan/)).toBeTruthy();
    });

    // Accept button should be disabled when isPlanReady is false
    const acceptBtn = Array.from(document.querySelectorAll("button")).find(
      (b) => b.textContent?.includes("Accept Plan"),
    );
    expect(acceptBtn).toBeTruthy();
    expect(acceptBtn!.disabled).toBe(true);
  });

  test("send feedback on plan", async () => {
    const loop = planningLoop(true, 0);
    setupApi(loop, "## Initial Plan\nDo X and Y");

    api.post("/api/loops/:id/plan/feedback", () => ({ success: true }));

    // After feedback, the loop refreshes with updated feedbackRounds
    const afterFeedbackLoop = planningLoop(false, 1);
    // Override the loops/:id endpoint after feedback
    api.get("/api/loops/:id", () => afterFeedbackLoop);

    window.location.hash = `/loop/${LOOP_ID}`;
    const { getByText, user } = renderWithUser(<App />);

    await waitFor(() => {
      expect(getByText("Plan Loop")).toBeTruthy();
    });

    // Wait for plan content to load
    await waitFor(() => {
      expect(getByText(/Initial Plan/)).toBeTruthy();
    });

    // Find and fill the feedback textarea
    const textarea = document.querySelector("textarea") as HTMLTextAreaElement;
    expect(textarea).toBeTruthy();
    await user.type(textarea, "X");

    // Click Send Feedback
    const feedbackBtn = Array.from(document.querySelectorAll("button")).find(
      (b) => b.textContent?.includes("Send Feedback"),
    );
    expect(feedbackBtn).toBeTruthy();
    await user.click(feedbackBtn!);

    // API should have been called
    await waitFor(() => {
      const calls = api.calls("/api/loops/:id/plan/feedback", "POST");
      expect(calls.length).toBeGreaterThan(0);
    });
  });

  test("accept plan triggers API and transitions loop", async () => {
    const loop = planningLoop(true);
    setupApi(loop, "## Final Plan\nAll steps defined");

    api.post("/api/loops/:id/plan/accept", () => ({ success: true }));

    window.location.hash = `/loop/${LOOP_ID}`;
    const { getByText, user } = renderWithUser(<App />);

    await waitFor(() => {
      expect(getByText("Plan Loop")).toBeTruthy();
    });

    await waitFor(() => {
      expect(getByText(/Final Plan/)).toBeTruthy();
    });

    // Click Accept Plan & Start Loop
    const acceptBtn = Array.from(document.querySelectorAll("button")).find(
      (b) => b.textContent?.includes("Accept Plan"),
    );
    expect(acceptBtn).toBeTruthy();
    await user.click(acceptBtn!);

    // API should have been called
    await waitFor(() => {
      const calls = api.calls("/api/loops/:id/plan/accept", "POST");
      expect(calls.length).toBeGreaterThan(0);
    });
  });

  test("discard plan shows confirmation and deletes loop", async () => {
    const loop = planningLoop(true);
    setupApi(loop, "## Plan to discard");

    api.post("/api/loops/:id/plan/discard", () => ({ success: true }));

    window.location.hash = `/loop/${LOOP_ID}`;
    const { getByText, user } = renderWithUser(<App />);

    await waitFor(() => {
      expect(getByText("Plan Loop")).toBeTruthy();
    });

    await waitFor(() => {
      expect(getByText(/Plan to discard/)).toBeTruthy();
    });

    // Click Discard Plan
    const discardBtn = Array.from(document.querySelectorAll("button")).find(
      (b) => b.textContent?.trim() === "Discard Plan",
    );
    expect(discardBtn).toBeTruthy();
    await user.click(discardBtn!);

    // Confirmation modal should appear
    await waitFor(() => {
      expect(getByText("Discard Plan?")).toBeTruthy();
    });

    // Confirm discard
    const confirmBtn = Array.from(document.querySelectorAll("button")).find(
      (b) => b.textContent?.trim() === "Discard",
    );
    expect(confirmBtn).toBeTruthy();
    await user.click(confirmBtn!);

    // API should have been called
    await waitFor(() => {
      const calls = api.calls("/api/loops/:id/plan/discard", "POST");
      expect(calls.length).toBeGreaterThan(0);
    });
  });

  test("feedback rounds counter is displayed", async () => {
    const loop = planningLoop(true, 3);
    setupApi(loop, "## Refined Plan");

    window.location.hash = `/loop/${LOOP_ID}`;
    const { getByText } = renderWithUser(<App />);

    await waitFor(() => {
      expect(getByText("Plan Loop")).toBeTruthy();
    });

    // Should show feedback rounds
    await waitFor(() => {
      expect(getByText(/Feedback rounds: 3/)).toBeTruthy();
    });
  });

  test("waiting for plan shows placeholder when no content yet", async () => {
    const loop = planningLoop(false);
    setupApi(loop, ""); // No plan content

    window.location.hash = `/loop/${LOOP_ID}`;
    const { getByText } = renderWithUser(<App />);

    await waitFor(() => {
      expect(getByText("Plan Loop")).toBeTruthy();
    });

    // Should show waiting message
    await waitFor(() => {
      expect(getByText(/Waiting for AI to generate plan/)).toBeTruthy();
    });
  });
});
