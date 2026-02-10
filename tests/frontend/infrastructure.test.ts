/**
 * Smoke test to verify frontend test infrastructure works correctly.
 */

import { test, expect, describe } from "bun:test";
import { createLoop, createLoopWithStatus, createWorkspace, createModelInfo, createBranchInfo } from "./helpers/factories";
import { createMockApi, MockApiError } from "./helpers/mock-api";
import { createMockWebSocket } from "./helpers/mock-websocket";

describe("Frontend Test Infrastructure", () => {
  describe("Factories", () => {
    test("createLoop returns a valid loop with defaults", () => {
      const loop = createLoop();
      expect(loop.config.id).toBeTruthy();
      expect(loop.state.id).toBe(loop.config.id);
      expect(loop.config.name).toBe("Test Loop");
      expect(loop.state.status).toBe("idle");
      expect(loop.config.model.providerID).toBe("anthropic");
    });

    test("createLoop accepts overrides", () => {
      const loop = createLoop({
        config: { name: "Custom Loop", prompt: "Do stuff" },
        state: { status: "running", currentIteration: 5 },
      });
      expect(loop.config.name).toBe("Custom Loop");
      expect(loop.config.prompt).toBe("Do stuff");
      expect(loop.state.status).toBe("running");
      expect(loop.state.currentIteration).toBe(5);
    });

    test("createLoopWithStatus sets appropriate state", () => {
      const running = createLoopWithStatus("running");
      expect(running.state.status).toBe("running");
      expect(running.state.startedAt).toBeTruthy();
      expect(running.state.session).toBeTruthy();
      expect(running.state.git).toBeTruthy();

      const failed = createLoopWithStatus("failed");
      expect(failed.state.status).toBe("failed");
      expect(failed.state.error).toBeTruthy();

      const planning = createLoopWithStatus("planning");
      expect(planning.state.status).toBe("planning");
      expect(planning.state.planMode?.active).toBe(true);

      const pushed = createLoopWithStatus("pushed");
      expect(pushed.state.status).toBe("pushed");
      expect(pushed.state.reviewMode?.addressable).toBe(true);
    });

    test("createWorkspace returns valid workspace", () => {
      const ws = createWorkspace({ name: "My Workspace" });
      expect(ws.name).toBe("My Workspace");
      expect(ws.serverSettings.mode).toBe("spawn");
    });

    test("createModelInfo returns valid model info", () => {
      const model = createModelInfo({ connected: false });
      expect(model.providerID).toBe("anthropic");
      expect(model.connected).toBe(false);
    });

    test("createBranchInfo returns valid branch info", () => {
      const branch = createBranchInfo({ name: "feature/test", current: false });
      expect(branch.name).toBe("feature/test");
      expect(branch.current).toBe(false);
    });
  });

  describe("Mock API", () => {
    test("intercepts fetch calls and returns mock data", async () => {
      const api = createMockApi();
      api.get("/api/loops", () => [createLoop()]);
      api.install();

      try {
        const res = await fetch("/api/loops");
        const data = await res.json();
        expect(res.status).toBe(200);
        expect(Array.isArray(data)).toBe(true);
        expect(data.length).toBe(1);
      } finally {
        api.uninstall();
      }
    });

    test("matches route parameters", async () => {
      const api = createMockApi();
      api.get("/api/loops/:id", (req) => createLoop({ config: { id: req.params["id"] } }));
      api.install();

      try {
        const res = await fetch("/api/loops/test-123");
        const data = await res.json();
        expect(data.config.id).toBe("test-123");
      } finally {
        api.uninstall();
      }
    });

    test("tracks call history", async () => {
      const api = createMockApi();
      api.get("/api/loops", () => []);
      api.post("/api/loops", () => createLoop());
      api.install();

      try {
        await fetch("/api/loops");
        await fetch("/api/loops", { method: "POST", body: JSON.stringify({ prompt: "test" }) });

        expect(api.calls("/api/loops", "GET")).toHaveLength(1);
        expect(api.calls("/api/loops", "POST")).toHaveLength(1);
        expect(api.allCalls()).toHaveLength(2);
      } finally {
        api.uninstall();
      }
    });

    test("handles MockApiError for error responses", async () => {
      const api = createMockApi();
      api.post("/api/loops", () => {
        throw new MockApiError(409, { error: "uncommitted_changes", message: "Dirty" });
      });
      api.install();

      try {
        const res = await fetch("/api/loops", { method: "POST", body: JSON.stringify({}) });
        expect(res.status).toBe(409);
        const data = await res.json();
        expect(data.error).toBe("uncommitted_changes");
      } finally {
        api.uninstall();
      }
    });

    test("returns 404 for unregistered routes", async () => {
      const api = createMockApi();
      api.install();

      try {
        const res = await fetch("/api/unknown");
        expect(res.status).toBe(404);
      } finally {
        api.uninstall();
      }
    });
  });

  describe("Mock WebSocket", () => {
    test("creates WebSocket connections", () => {
      const ws = createMockWebSocket();
      ws.install();

      try {
        const socket = new WebSocket("ws://localhost/api/ws");
        expect(ws.connections()).toHaveLength(1);
        expect(ws.connections()[0]!.url).toBe("ws://localhost/api/ws");
        socket.close();
      } finally {
        ws.uninstall();
      }
    });

    test("parses query parameters", () => {
      const ws = createMockWebSocket();
      ws.install();

      try {
        new WebSocket("ws://localhost/api/ws?loopId=loop-123");
        const conn = ws.getLoopConnection("loop-123");
        expect(conn).toBeTruthy();
        expect(conn!.queryParams["loopId"]).toBe("loop-123");
      } finally {
        ws.uninstall();
      }
    });

    test("sends events to connected clients", async () => {
      const ws = createMockWebSocket();
      ws.install();

      try {
        const received: unknown[] = [];
        const socket = new WebSocket("ws://localhost/api/ws");
        socket.onmessage = (event) => {
          received.push(JSON.parse(event.data as string));
        };

        // Wait for connection to open (auto-open via queueMicrotask)
        await new Promise((resolve) => queueMicrotask(resolve));

        ws.sendEvent({ type: "loop.created", loopId: "test-1" });
        expect(received).toHaveLength(1);
        expect((received[0] as Record<string, unknown>)["type"]).toBe("loop.created");

        socket.close();
      } finally {
        ws.uninstall();
      }
    });

    test("distinguishes global and loop-specific connections", async () => {
      const ws = createMockWebSocket();
      ws.install();

      try {
        new WebSocket("ws://localhost/api/ws");
        new WebSocket("ws://localhost/api/ws?loopId=loop-1");

        // Wait for connections to open
        await new Promise((resolve) => queueMicrotask(resolve));

        expect(ws.connections()).toHaveLength(2);
        expect(ws.getGlobalConnection()).toBeTruthy();
        expect(ws.getLoopConnection("loop-1")).toBeTruthy();
        expect(ws.getLoopConnection("loop-2")).toBeUndefined();
      } finally {
        ws.uninstall();
      }
    });
  });

  describe("DOM Environment", () => {
    test("document is available", () => {
      expect(document).toBeDefined();
      expect(document.createElement).toBeFunction();
    });

    test("window is available", () => {
      expect(window).toBeDefined();
      expect(window.location).toBeDefined();
    });

    test("ResizeObserver is available", () => {
      expect(window.ResizeObserver).toBeDefined();
      const observer = new ResizeObserver(() => {});
      expect(observer.observe).toBeFunction();
      observer.disconnect();
    });

    test("matchMedia is available", () => {
      expect(window.matchMedia).toBeFunction();
      const mql = window.matchMedia("(min-width: 768px)");
      expect(mql.matches).toBe(false);
    });
  });
});
