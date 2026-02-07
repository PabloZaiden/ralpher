/**
 * Tests for App component (routing).
 *
 * Tests hash-based routing between Dashboard and LoopDetails views,
 * LogLevelInitializer wrapping, and navigation handlers.
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { createMockApi } from "../helpers/mock-api";
import { createMockWebSocket } from "../helpers/mock-websocket";
import { renderWithUser, waitFor, act } from "../helpers/render";
import { createLoop, createWorkspace } from "../helpers/factories";
import { App } from "@/App";

const api = createMockApi();
const ws = createMockWebSocket();

/** Set up the default API routes that App's children require. */
function setupDefaultApi() {
  // Dashboard needs: loops, workspaces, config, health, last-model, preferences
  api.get("/api/loops", () => []);
  api.get("/api/workspaces", () => []);
  api.get("/api/config", () => ({ remoteOnly: false }));
  api.get("/api/health", () => ({ status: "ok", version: "1.0.0" }));
  api.get("/api/preferences/last-model", () => null);
  api.get("/api/preferences/log-level", () => ({ level: "info" }));
  // LoopDetails needs: individual loop fetch, models, comments
  api.get("/api/loops/:id", (req) =>
    createLoop({ config: { id: req.params["id"], name: `Loop ${req.params["id"]}` } }),
  );
  api.get("/api/models", () => []);
  api.get("/api/loops/:id/comments", () => ({ success: true, comments: [] }));
  api.get("/api/loops/:id/diff", () => []);
}

beforeEach(() => {
  api.reset();
  api.install();
  ws.reset();
  ws.install();
  window.location.hash = "";
  setupDefaultApi();
});

afterEach(() => {
  api.uninstall();
  ws.uninstall();
  window.location.hash = "";
});

// ─── Default route ──────────────────────────────────────────────────────────

describe("default route", () => {
  test("renders Dashboard by default when hash is empty", async () => {
    const { getByText } = renderWithUser(<App />);

    await waitFor(() => {
      expect(getByText("Ralpher")).toBeTruthy();
    });
    // Dashboard shows "New Loop" button
    expect(getByText("New Loop")).toBeTruthy();
  });

  test("renders Dashboard when hash is #/", async () => {
    window.location.hash = "/";

    const { getByText } = renderWithUser(<App />);

    await waitFor(() => {
      expect(getByText("Ralpher")).toBeTruthy();
    });
    expect(getByText("New Loop")).toBeTruthy();
  });
});

// ─── Loop details route ─────────────────────────────────────────────────────

describe("loop details route", () => {
  test("renders LoopDetails when hash is #/loop/:id", async () => {
    window.location.hash = "/loop/test-123";

    const { getByText } = renderWithUser(<App />);

    await waitFor(() => {
      // LoopDetails header has a Back button
      expect(getByText("← Back")).toBeTruthy();
    });
  });

  test("passes loopId from hash to LoopDetails", async () => {
    const loopId = "my-loop-id";
    api.get("/api/loops/:id", (req) =>
      createLoop({ config: { id: req.params["id"], name: "My Test Loop" } }),
    );

    window.location.hash = `/loop/${loopId}`;

    const { getByText } = renderWithUser(<App />);

    await waitFor(() => {
      expect(getByText("My Test Loop")).toBeTruthy();
    });
  });
});

// ─── Hash change navigation ─────────────────────────────────────────────────

describe("hash change navigation", () => {
  test("navigates from Dashboard to LoopDetails on hash change", async () => {
    const { getByText } = renderWithUser(<App />);

    // Starts on Dashboard
    await waitFor(() => {
      expect(getByText("Ralpher")).toBeTruthy();
    });

    // Change hash to loop details
    await act(async () => {
      window.location.hash = "/loop/test-456";
      window.dispatchEvent(new HashChangeEvent("hashchange"));
    });

    await waitFor(() => {
      expect(getByText("← Back")).toBeTruthy();
    });
  });

  test("navigates from LoopDetails back to Dashboard on hash change", async () => {
    window.location.hash = "/loop/test-789";

    const { getByText } = renderWithUser(<App />);

    // Starts on LoopDetails
    await waitFor(() => {
      expect(getByText("← Back")).toBeTruthy();
    });

    // Change hash to dashboard
    await act(async () => {
      window.location.hash = "/";
      window.dispatchEvent(new HashChangeEvent("hashchange"));
    });

    await waitFor(() => {
      expect(getByText("Ralpher")).toBeTruthy();
      expect(getByText("New Loop")).toBeTruthy();
    });
  });

  test("navigates back to Dashboard via Back button click", async () => {
    window.location.hash = "/loop/test-back";

    const { getByText, user } = renderWithUser(<App />);

    await waitFor(() => {
      expect(getByText("← Back")).toBeTruthy();
    });

    // Click back - this calls onBack which sets hash to "/"
    await user.click(getByText("← Back"));

    await waitFor(() => {
      expect(window.location.hash).toBe("#/");
    });
  });
});

// ─── Dashboard loop selection ───────────────────────────────────────────────

describe("dashboard loop selection", () => {
  test("navigates to loop details when a loop card is clicked", async () => {
    const loop = createLoop({
      config: { id: "click-loop", name: "Click Me Loop", workspaceId: "ws-1" },
      state: { status: "running", startedAt: new Date().toISOString(), currentIteration: 1 },
    });
    const workspace = createWorkspace({ id: "ws-1", name: "My Workspace" });
    api.get("/api/loops", () => [loop]);
    api.get("/api/workspaces", () => [workspace]);

    const { getByText, user } = renderWithUser(<App />);

    // Wait for loops to load
    await waitFor(() => {
      expect(getByText("Click Me Loop")).toBeTruthy();
    });

    // Click the loop card
    await user.click(getByText("Click Me Loop"));

    // Hash should have changed to loop details
    await waitFor(() => {
      expect(window.location.hash).toBe("#/loop/click-loop");
    });
  });
});

// ─── LogLevelInitializer ────────────────────────────────────────────────────

describe("LogLevelInitializer", () => {
  test("fetches log level preference on mount", async () => {
    renderWithUser(<App />);

    await waitFor(() => {
      const logLevelCalls = api.calls("/api/preferences/log-level");
      expect(logLevelCalls.length).toBeGreaterThan(0);
    });
  });

  test("renders children immediately without waiting for log level", async () => {
    // Even before log level fetch completes, Dashboard should render
    const { getByText } = renderWithUser(<App />);

    // Dashboard renders immediately
    await waitFor(() => {
      expect(getByText("Ralpher")).toBeTruthy();
    });
  });
});

// ─── Edge cases ─────────────────────────────────────────────────────────────

describe("edge cases", () => {
  test("renders Dashboard for unknown hash routes", async () => {
    window.location.hash = "/unknown/route";

    const { getByText } = renderWithUser(<App />);

    await waitFor(() => {
      expect(getByText("Ralpher")).toBeTruthy();
    });
    expect(getByText("New Loop")).toBeTruthy();
  });

  test("renders Dashboard when hash is #/loop/ with no ID", async () => {
    window.location.hash = "/loop/";

    const { getByText } = renderWithUser(<App />);

    await waitFor(() => {
      expect(getByText("Ralpher")).toBeTruthy();
    });
  });

  test("handles rapid hash changes", async () => {
    const { getByText } = renderWithUser(<App />);

    await waitFor(() => {
      expect(getByText("Ralpher")).toBeTruthy();
    });

    // Rapid hash changes
    await act(async () => {
      window.location.hash = "/loop/a";
      window.dispatchEvent(new HashChangeEvent("hashchange"));
      window.location.hash = "/loop/b";
      window.dispatchEvent(new HashChangeEvent("hashchange"));
      window.location.hash = "/";
      window.dispatchEvent(new HashChangeEvent("hashchange"));
    });

    // Should end up on Dashboard
    await waitFor(() => {
      expect(getByText("Ralpher")).toBeTruthy();
      expect(getByText("New Loop")).toBeTruthy();
    });
  });
});
