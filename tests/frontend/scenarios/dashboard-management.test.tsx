/**
 * E2E Scenario: Dashboard Management
 *
 * Tests dashboard-level workflows: viewing loops grouped by workspace/status,
 * navigating between loops, empty state, settings modal, and status groups.
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { createMockApi } from "../helpers/mock-api";
import { createMockWebSocket } from "../helpers/mock-websocket";
import { renderWithUser, waitFor } from "../helpers/render";
import {
  createLoopWithStatus,
  createWorkspaceWithLoopCount,
  createModelInfo,
} from "../helpers/factories";
import { App } from "@/App";

const api = createMockApi();
const ws = createMockWebSocket();

const WORKSPACE_A = createWorkspaceWithLoopCount({
  id: "ws-a",
  name: "Project Alpha",
  directory: "/workspaces/alpha",
  loopCount: 0,
});

const WORKSPACE_B = createWorkspaceWithLoopCount({
  id: "ws-b",
  name: "Project Beta",
  directory: "/workspaces/beta",
  loopCount: 0,
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
  // LoopDetails endpoints (for navigation tests)
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

// ─── Dashboard management scenarios ──────────────────────────────────────────

describe("dashboard management scenario", () => {
  test("empty state shows 'No loops yet' message", async () => {
    setupBaseApi();
    api.get("/api/loops", () => []);
    api.get("/api/workspaces", () => [WORKSPACE_A]);

    const { getByText } = renderWithUser(<App />);

    await waitFor(() => {
      expect(getByText("No loops yet")).toBeTruthy();
    });
    expect(getByText(/Click "New Loop" to create your first Ralph Loop/)).toBeTruthy();
  });

  test("loops are grouped by workspace with status sections", async () => {
    setupBaseApi();

    const runningLoop = createLoopWithStatus("running", {
      config: { id: "loop-run-1", name: "Running Task", directory: "/workspaces/alpha", workspaceId: "ws-a" },
    });
    const completedLoop = createLoopWithStatus("completed", {
      config: { id: "loop-comp-1", name: "Done Task", directory: "/workspaces/alpha", workspaceId: "ws-a" },
    });
    const draftLoop = createLoopWithStatus("draft", {
      config: { id: "loop-draft-1", name: "Draft Task", directory: "/workspaces/beta", workspaceId: "ws-b" },
    });

    api.get("/api/loops", () => [runningLoop, completedLoop, draftLoop]);
    api.get("/api/workspaces", () => [WORKSPACE_A, WORKSPACE_B]);

    const { getByText } = renderWithUser(<App />);

    // Wait for dashboard to load
    await waitFor(() => {
      expect(getByText("Project Alpha")).toBeTruthy();
    });

    // Workspace names are shown
    expect(getByText("Project Beta")).toBeTruthy();

    // Loop names appear
    expect(getByText("Running Task")).toBeTruthy();
    expect(getByText("Done Task")).toBeTruthy();
    expect(getByText("Draft Task")).toBeTruthy();

    // Status group headers appear
    expect(getByText(/Active \(1\)/)).toBeTruthy();
    expect(getByText(/Completed \(1\)/)).toBeTruthy();
    expect(getByText(/Drafts \(1\)/)).toBeTruthy();
  });

  test("clicking a loop card navigates to loop details", async () => {
    setupBaseApi();

    const loop = createLoopWithStatus("running", {
      config: { id: "nav-loop-1", name: "Nav Target", directory: "/workspaces/alpha", workspaceId: "ws-a" },
    });

    api.get("/api/loops", () => [loop]);
    api.get("/api/loops/:id", () => loop);
    api.get("/api/workspaces", () => [WORKSPACE_A]);

    const { getByText, user } = renderWithUser(<App />);

    await waitFor(() => {
      expect(getByText("Nav Target")).toBeTruthy();
    });

    // Click on the loop card
    await user.click(getByText("Nav Target"));

    // Should navigate to loop details
    await waitFor(() => {
      expect(getByText("← Back")).toBeTruthy();
    });
    expect(getByText("Nav Target")).toBeTruthy();
  });

  test("navigating to loop details and back preserves dashboard", async () => {
    setupBaseApi();

    const loop = createLoopWithStatus("completed", {
      config: { id: "round-trip-1", name: "Round Trip", directory: "/workspaces/alpha", workspaceId: "ws-a" },
    });

    api.get("/api/loops", () => [loop]);
    api.get("/api/loops/:id", () => loop);
    api.get("/api/workspaces", () => [WORKSPACE_A]);

    const { getByText, user } = renderWithUser(<App />);

    // Dashboard loads
    await waitFor(() => {
      expect(getByText("Round Trip")).toBeTruthy();
    });

    // Navigate to details
    await user.click(getByText("Round Trip"));
    await waitFor(() => {
      expect(getByText("← Back")).toBeTruthy();
    });

    // Navigate back
    await user.click(getByText("← Back"));

    // Dashboard is back
    await waitFor(() => {
      expect(getByText("Ralpher")).toBeTruthy();
      expect(getByText("New Loop")).toBeTruthy();
      expect(getByText("Round Trip")).toBeTruthy();
    });
  });

  test("settings button opens App Settings modal", async () => {
    setupBaseApi();
    api.get("/api/loops", () => []);
    api.get("/api/workspaces", () => []);

    const { getByText, getByTitle, user } = renderWithUser(<App />);

    await waitFor(() => {
      expect(getByText("Ralpher")).toBeTruthy();
    });

    // Click the settings button (has title "App Settings")
    await user.click(getByTitle("App Settings"));

    // App Settings modal opens
    await waitFor(() => {
      expect(getByText("App Settings")).toBeTruthy();
    });
  });

  test("awaiting feedback status group shows loops with addressable review mode", async () => {
    setupBaseApi();

    const pushedLoop = createLoopWithStatus("pushed", {
      config: { id: "pushed-1", name: "Pushed Loop", directory: "/workspaces/alpha", workspaceId: "ws-a" },
      state: {
        reviewMode: {
          addressable: true,
          completionAction: "push",
          reviewCycles: 1,
          reviewBranches: [],
        },
      },
    });

    api.get("/api/loops", () => [pushedLoop]);
    api.get("/api/workspaces", () => [WORKSPACE_A]);

    const { getByText } = renderWithUser(<App />);

    await waitFor(() => {
      expect(getByText("Pushed Loop")).toBeTruthy();
    });

    // Should show in "Awaiting Feedback" section
    expect(getByText(/Awaiting Feedback \(1\)/)).toBeTruthy();

    // Should show Addressable badge
    expect(getByText("Addressable")).toBeTruthy();

    // Should show "Address Comments" button on card
    expect(getByText("Address Comments")).toBeTruthy();
  });

  test("version number is displayed in header", async () => {
    setupBaseApi();
    api.get("/api/loops", () => []);
    api.get("/api/workspaces", () => []);

    const { getByText } = renderWithUser(<App />);

    await waitFor(() => {
      expect(getByText("Ralpher")).toBeTruthy();
    });

    // Version is shown
    await waitFor(() => {
      expect(getByText("v1.0.0")).toBeTruthy();
    });
  });

  test("connection status indicator shows connected state", async () => {
    setupBaseApi();
    api.get("/api/loops", () => []);
    api.get("/api/workspaces", () => []);

    const { getByText } = renderWithUser(<App />);

    await waitFor(() => {
      expect(getByText("Ralpher")).toBeTruthy();
    });

    // WebSocket status text appears
    await waitFor(() => {
      expect(getByText("Connected")).toBeTruthy();
    });
  });

  test("empty workspaces section shows workspaces with no loops", async () => {
    setupBaseApi();

    const loopInA = createLoopWithStatus("running", {
      config: { id: "in-a", name: "In Alpha", directory: "/workspaces/alpha", workspaceId: "ws-a" },
    });

    api.get("/api/loops", () => [loopInA]);
    api.get("/api/workspaces", () => [WORKSPACE_A, WORKSPACE_B]);

    const { getByText } = renderWithUser(<App />);

    // Workspace B has no loops, should show in empty workspaces section
    await waitFor(() => {
      expect(getByText("Empty Workspaces")).toBeTruthy();
    });
  });
});
