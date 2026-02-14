/**
 * Unit tests for validateRemoteDirectory timeout behavior.
 *
 * These tests verify that workspace validation does not hang indefinitely
 * when the remote server is unreachable or unresponsive.
 */

import { test, expect, describe, afterEach, beforeEach } from "bun:test";
import { createServer, type Server as NetServer, type Socket } from "net";
import { backendManager } from "../../src/core/backend-manager";
import { createMockBackend } from "../mocks/mock-backend";
import { TestCommandExecutor } from "../mocks/mock-executor";

/**
 * Short timeout for tests (ms). We override the production default (15s)
 * to keep the test suite fast while still exercising timeout/abort behavior.
 */
const TEST_TIMEOUT_MS = 1_000;

/**
 * Create a TCP server that accepts connections but never sends any data.
 * This simulates an unreachable/unresponsive HTTP server — the TCP handshake
 * succeeds but the server never sends a response, causing fetch() to hang.
 *
 * Returns the server, its port, and a list of accepted sockets for cleanup.
 */
function createHangingServer(): Promise<{ server: NetServer; port: number; sockets: Socket[] }> {
  return new Promise((resolve, reject) => {
    const sockets: Socket[] = [];
    const server = createServer((socket) => {
      // Accept the connection but never respond — this makes fetch() hang.
      // Track the socket so we can destroy it during cleanup.
      sockets.push(socket);
    });
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      if (addr && typeof addr === "object") {
        resolve({ server, port: addr.port, sockets });
      } else {
        reject(new Error("Failed to get server address"));
      }
    });
    server.on("error", reject);
  });
}

/**
 * Acquire an ephemeral port by binding to port 0, recording the assigned port,
 * then closing the server. The port is guaranteed to have been free at the time
 * of binding; after the server is closed, connecting to it will be refused.
 */
function acquireClosedPort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      if (addr && typeof addr === "object") {
        const port = addr.port;
        server.close((err) => {
          if (err) reject(err);
          else resolve(port);
        });
      } else {
        reject(new Error("Failed to get server address"));
      }
    });
    server.on("error", reject);
  });
}

describe("validateRemoteDirectory timeout", () => {
  let hangingServer: NetServer | null = null;
  let acceptedSockets: Socket[] = [];

  beforeEach(() => {
    // Reset backend manager to clear any test executor factory,
    // so we exercise the real connection + timeout code path.
    backendManager.resetForTesting();
    // Use a short timeout so tests don't take 15s each
    backendManager.setConnectionTimeoutForTesting(TEST_TIMEOUT_MS);
  });

  afterEach(async () => {
    // Destroy any accepted sockets first so server.close() resolves promptly
    for (const socket of acceptedSockets) {
      socket.destroy();
    }
    acceptedSockets = [];

    // Await server close to prevent leaked handles
    if (hangingServer) {
      await new Promise<void>((resolve) => {
        hangingServer!.close(() => resolve());
      });
      hangingServer = null;
    }

    // Restore test executor factory for other tests
    backendManager.setBackendForTesting(createMockBackend());
    backendManager.setExecutorFactoryForTesting(() => new TestCommandExecutor());
  });

  test("returns failure with timeout error when server never responds", async () => {
    const { server, port, sockets } = await createHangingServer();
    hangingServer = server;
    acceptedSockets = sockets;

    // Call validateRemoteDirectory pointing at the hanging server.
    // Without the timeout fix, this would hang indefinitely.
    const result = await backendManager.validateRemoteDirectory(
      {
        mode: "connect",
        hostname: "127.0.0.1",
        port,
        useHttps: false,
        allowInsecure: false,
      },
      "/some/directory",
    );

    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
    expect(result.error).toContain("timed out");
  }, 10_000); // Allow up to 10s for the test (timeout is 1s)

  test("returns failure for connection-refused port", async () => {
    // Acquire an ephemeral port that was just closed — deterministic "connection refused".
    const closedPort = await acquireClosedPort();

    const result = await backendManager.validateRemoteDirectory(
      {
        mode: "connect",
        hostname: "127.0.0.1",
        port: closedPort,
        useHttps: false,
        allowInsecure: false,
      },
      "/some/directory",
    );

    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
    // Should get a connection error (not a hang)
    expect(typeof result.error).toBe("string");
  }, 10_000);
});
