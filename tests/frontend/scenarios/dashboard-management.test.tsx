/**
 * E2E Scenario: Shell overview management
 *
 * Tests shell-level workflows: overview empty states, sidebar/detail navigation,
 * settings navigation, and workspace mapping in the shell-first UI.
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

const WORKSPACE_A = createWorkspace({
  id: "ws-a",
  name: "Project Alpha",
  directory: "/workspaces/alpha",
});

const WORKSPACE_B = createWorkspace({
  id: "ws-b",
  name: "Project Beta",
  directory: "/workspaces/beta",
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
  api.get("/api/loops/:id/port-forwards", () => []);
  api.get("/api/loops/:id/pull-request", () => ({
    enabled: false,
    destinationType: "disabled",
    disabledReason: "disabled",
  }));
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
  test("overview empty state explains how to populate the shell", async () => {
    setupBaseApi();
    api.get("/api/loops", () => []);
    api.get("/api/workspaces", () => [WORKSPACE_A]);

    const { getByText } = renderWithUser(<App />);

    await waitFor(() => {
      expect(getByText("Everything lives in one shell now")).toBeTruthy();
    });
    expect(getByText("Create a loop, chat, workspace, or SSH session from the sidebar to populate the shell.")).toBeTruthy();
  });

  test("overview shows recent loops and the workspace map", async () => {
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

    const { getAllByText, getByText } = renderWithUser(<App />);

    await waitFor(() => {
      expect(getAllByText("Project Alpha").length).toBeGreaterThan(0);
    });

    expect(getAllByText("Project Beta").length).toBeGreaterThan(0);
    expect(getByText("Workspace map")).toBeTruthy();
    expect(getAllByText("Running Task").length).toBeGreaterThan(0);
    expect(getAllByText("Done Task").length).toBeGreaterThan(0);
    expect(getAllByText("Draft Task").length).toBeGreaterThan(0);
  });

  test("clicking a loop card navigates to loop details", async () => {
    setupBaseApi();

    const loop = createLoopWithStatus("running", {
      config: { id: "nav-loop-1", name: "Nav Target", directory: "/workspaces/alpha", workspaceId: "ws-a" },
    });

    api.get("/api/loops", () => [loop]);
    api.get("/api/loops/:id", () => loop);
    api.get("/api/workspaces", () => [WORKSPACE_A]);

    const { getAllByText, user } = renderWithUser(<App />);

    await waitFor(() => {
      expect(getAllByText("Nav Target").length).toBeGreaterThan(0);
    });

    await user.click(getAllByText("Nav Target")[0]!);

    await waitFor(() => {
      expect(window.location.hash).toBe("#/loop/nav-loop-1");
    });
    expect(getAllByText("Nav Target").length).toBeGreaterThan(0);
  });

  test("navigating to loop details and back preserves the overview", async () => {
    setupBaseApi();

    const loop = createLoopWithStatus("completed", {
      config: { id: "round-trip-1", name: "Round Trip", directory: "/workspaces/alpha", workspaceId: "ws-a" },
    });

    api.get("/api/loops", () => [loop]);
    api.get("/api/loops/:id", () => loop);
    api.get("/api/workspaces", () => [WORKSPACE_A]);

    const { getAllByText, getByText, user } = renderWithUser(<App />);

    await waitFor(() => {
      expect(getAllByText("Round Trip").length).toBeGreaterThan(0);
    });

    await user.click(getAllByText("Round Trip")[0]!);
    await waitFor(() => {
      expect(window.location.hash).toBe("#/loop/round-trip-1");
    });

    await user.click(getByText("Ralpher"));

    await waitFor(() => {
      expect(getByText("Ralpher")).toBeTruthy();
      expect(getAllByText("New Loop").length).toBeGreaterThan(0);
      expect(getByText("Everything lives in one shell now")).toBeTruthy();
    });
  });

  test("settings button opens the shell settings view", async () => {
    setupBaseApi();
    api.get("/api/loops", () => []);
    api.get("/api/workspaces", () => []);

    const { getByLabelText, getByRole, getByText, user } = renderWithUser(<App />);

    await waitFor(() => {
      expect(getByText("Ralpher")).toBeTruthy();
    });

    await user.click(getByLabelText("Open settings"));

    await waitFor(() => {
      expect(window.location.hash).toBe("#/settings");
      expect(getByRole("heading", { name: "Settings" })).toBeTruthy();
    });
  });

  test("addressable review loops remain reachable from the shell", async () => {
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

    const { getAllByText } = renderWithUser(<App />);

    await waitFor(() => {
      expect(getAllByText("Pushed Loop").length).toBeGreaterThan(0);
    });
  });

  test("overview displays shell summary cards", async () => {
    setupBaseApi();
    api.get("/api/loops", () => [
      createLoopWithStatus("running", {
        config: { id: "summary-loop", name: "Summary Loop", directory: "/workspaces/alpha", workspaceId: "ws-a" },
      }),
    ]);
    api.get("/api/workspaces", () => [WORKSPACE_A, WORKSPACE_B]);

    const { getAllByText } = renderWithUser(<App />);

    await waitFor(() => {
      expect(getAllByText("Workspaces").length).toBeGreaterThan(0);
    });

    expect(getAllByText("Loops").length).toBeGreaterThan(0);
    expect(getAllByText("Chats").length).toBeGreaterThan(0);
    expect(getAllByText("SSH").length).toBeGreaterThan(0);
  });

  // Note: "connection status indicator shows connected state" test was removed because
  // the "Connected" text indicator was removed from the Dashboard in PR #118.
  // WebSocket connection status is no longer displayed as a text label.

  test("workspace map includes workspaces with no loops", async () => {
    setupBaseApi();

    const loopInA = createLoopWithStatus("running", {
      config: { id: "in-a", name: "In Alpha", directory: "/workspaces/alpha", workspaceId: "ws-a" },
    });

    api.get("/api/loops", () => [loopInA]);
    api.get("/api/workspaces", () => [WORKSPACE_A, WORKSPACE_B]);

    const { getAllByText, getByText } = renderWithUser(<App />);

    await waitFor(() => {
      expect(getByText("Workspace map")).toBeTruthy();
    });
    expect(getAllByText("Project Beta").length).toBeGreaterThan(0);
    expect(getByText("0 items")).toBeTruthy();
  });
});
