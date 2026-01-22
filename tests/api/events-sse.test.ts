/**
 * API integration tests for WebSocket events endpoint.
 * Tests use actual WebSocket connections to a test server.
 */

import { test, expect, describe, beforeAll, afterAll } from "bun:test";
import { mkdtemp, rm } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { serve, type Server } from "bun";
import { apiRoutes } from "../../src/api";
import { websocketHandlers, type WebSocketData } from "../../src/api/websocket";
import { ensureDataDirectories } from "../../src/persistence/paths";
import { loopEventEmitter } from "../../src/core/event-emitter";

describe("Events WebSocket API Integration", () => {
  let testDataDir: string;
  let testWorkDir: string;
  let server: Server<WebSocketData>;
  let baseUrl: string;
  let wsUrl: string;

  beforeAll(async () => {
    // Create temp directories
    testDataDir = await mkdtemp(join(tmpdir(), "ralpher-api-events-test-data-"));
    testWorkDir = await mkdtemp(join(tmpdir(), "ralpher-api-events-test-work-"));

    // Set env var for persistence
    process.env["RALPHER_DATA_DIR"] = testDataDir;

    // Ensure directories exist
    await ensureDataDirectories();

    // Start test server on random port with WebSocket support
    server = serve<WebSocketData>({
      port: 0, // Random available port
      routes: {
        ...apiRoutes,
        "/api/ws": (req: Request, server: Server<WebSocketData>) => {
          const url = new URL(req.url);
          const loopId = url.searchParams.get("loopId") ?? undefined;

          const upgraded = server.upgrade(req, {
            data: { loopId } as WebSocketData,
          });

          if (upgraded) {
            return undefined;
          }

          return new Response("WebSocket upgrade failed", { status: 400 });
        },
      },
      websocket: websocketHandlers,
    });
    baseUrl = server.url.toString().replace(/\/$/, "");
    wsUrl = baseUrl.replace(/^http/, "ws");
  });

  afterAll(async () => {
    // Stop server
    server.stop();

    // Cleanup temp directories
    await rm(testDataDir, { recursive: true, force: true });
    await rm(testWorkDir, { recursive: true, force: true });

    // Clear env
    delete process.env["RALPHER_DATA_DIR"];
  });

  describe("WS /api/ws", () => {
    test("establishes WebSocket connection", async () => {
      const ws = new WebSocket(`${wsUrl}/api/ws`);

      const connected = await new Promise<boolean>((resolve) => {
        const timeout = setTimeout(() => {
          ws.close();
          resolve(false);
        }, 1000);

        ws.onopen = () => {
          clearTimeout(timeout);
          resolve(true);
        };

        ws.onerror = () => {
          clearTimeout(timeout);
          resolve(false);
        };
      });

      expect(connected).toBe(true);
      ws.close();
    });

    test("receives connection confirmation", async () => {
      const ws = new WebSocket(`${wsUrl}/api/ws`);

      const message = await new Promise<{ type: string; loopId: string | null } | null>((resolve) => {
        const timeout = setTimeout(() => {
          ws.close();
          resolve(null);
        }, 1000);

        ws.onmessage = (event) => {
          clearTimeout(timeout);
          try {
            resolve(JSON.parse(event.data));
          } catch {
            resolve(null);
          }
        };

        ws.onerror = () => {
          clearTimeout(timeout);
          resolve(null);
        };
      });

      expect(message).not.toBeNull();
      expect(message?.type).toBe("connected");
      expect(message?.loopId).toBeNull();
      ws.close();
    });

    test("receives events from emitter", async () => {
      const ws = new WebSocket(`${wsUrl}/api/ws`);

      // Wait for connection
      await new Promise<void>((resolve) => {
        ws.onopen = () => resolve();
      });

      // Skip connection message
      await new Promise<void>((resolve) => {
        ws.onmessage = () => resolve();
      });

      // Emit a test event
      const testEvent = {
        type: "loop.log" as const,
        loopId: "test-loop-id",
        id: "log-1",
        level: "info" as const,
        message: "Test log message",
        timestamp: new Date().toISOString(),
      };

      // Set up listener for next message
      const receivedEvent = new Promise<unknown>((resolve) => {
        const timeout = setTimeout(() => {
          resolve(null);
        }, 1000);

        ws.onmessage = (event) => {
          clearTimeout(timeout);
          try {
            resolve(JSON.parse(event.data));
          } catch {
            resolve(null);
          }
        };
      });

      // Emit the event
      loopEventEmitter.emit(testEvent);

      const received = await receivedEvent;
      expect(received).toEqual(testEvent);

      ws.close();
    });

    test("filters events by loopId when specified", async () => {
      const targetLoopId = "target-loop";
      const otherLoopId = "other-loop";

      const ws = new WebSocket(`${wsUrl}/api/ws?loopId=${targetLoopId}`);

      // Wait for connection
      await new Promise<void>((resolve) => {
        ws.onopen = () => resolve();
      });

      // Skip connection message (should have loopId set)
      const connMsg = await new Promise<{ loopId: string | null }>((resolve) => {
        ws.onmessage = (event) => {
          resolve(JSON.parse(event.data));
        };
      });
      expect(connMsg.loopId).toBe(targetLoopId);

      // Collect received events
      const receivedEvents: unknown[] = [];
      ws.onmessage = (event) => {
        receivedEvents.push(JSON.parse(event.data));
      };

      // Emit events for different loops
      loopEventEmitter.emit({
        type: "loop.log",
        loopId: otherLoopId,
        id: "log-other",
        level: "info",
        message: "Other loop message",
        timestamp: new Date().toISOString(),
      });

      loopEventEmitter.emit({
        type: "loop.log",
        loopId: targetLoopId,
        id: "log-target",
        level: "info",
        message: "Target loop message",
        timestamp: new Date().toISOString(),
      });

      // Wait a bit for events to arrive
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Should only receive the target loop event
      expect(receivedEvents.length).toBe(1);
      expect((receivedEvents[0] as { loopId: string }).loopId).toBe(targetLoopId);

      ws.close();
    });

    test("responds to ping with pong", async () => {
      const ws = new WebSocket(`${wsUrl}/api/ws`);

      // Wait for connection
      await new Promise<void>((resolve) => {
        ws.onopen = () => resolve();
      });

      // Skip connection message
      await new Promise<void>((resolve) => {
        ws.onmessage = () => resolve();
      });

      // Send ping
      ws.send(JSON.stringify({ type: "ping" }));

      // Expect pong
      const pong = await new Promise<{ type: string } | null>((resolve) => {
        const timeout = setTimeout(() => resolve(null), 1000);
        ws.onmessage = (event) => {
          clearTimeout(timeout);
          resolve(JSON.parse(event.data));
        };
      });

      expect(pong).not.toBeNull();
      expect(pong?.type).toBe("pong");

      ws.close();
    });
  });
});
