/**
 * Unit tests for validateRemoteDirectory timeout behavior.
 *
 * These tests verify that workspace validation does not hang indefinitely
 * when the remote server is unreachable or unresponsive.
 */

import { test, expect, describe, afterEach, beforeEach } from "bun:test";
import { createServer, type Server as NetServer } from "net";
import { backendManager } from "../../src/core/backend-manager";
import { createMockBackend } from "../mocks/mock-backend";
import { TestCommandExecutor } from "../mocks/mock-executor";

/**
 * Create a TCP server that accepts connections but never sends any data.
 * This simulates an unreachable/unresponsive HTTP server — the TCP handshake
 * succeeds but the server never sends a response, causing fetch() to hang.
 */
function createHangingServer(): Promise<{ server: NetServer; port: number }> {
  return new Promise((resolve, reject) => {
    const server = createServer((_socket) => {
      // Accept the connection but never respond — this makes fetch() hang
    });
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      if (addr && typeof addr === "object") {
        resolve({ server, port: addr.port });
      } else {
        reject(new Error("Failed to get server address"));
      }
    });
    server.on("error", reject);
  });
}

describe("validateRemoteDirectory timeout", () => {
  let hangingServer: NetServer | null = null;

  beforeEach(() => {
    // Reset backend manager to clear any test executor factory,
    // so we exercise the real connection + timeout code path.
    backendManager.resetForTesting();
  });

  afterEach(() => {
    if (hangingServer) {
      hangingServer.close();
      hangingServer = null;
    }
    // Restore test executor factory for other tests
    backendManager.setBackendForTesting(createMockBackend());
    backendManager.setExecutorFactoryForTesting(() => new TestCommandExecutor());
  });

  test("returns failure with timeout error when server never responds", async () => {
    const { server, port } = await createHangingServer();
    hangingServer = server;

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
  }, 30_000); // Allow up to 30s for the test (timeout is 15s)

  test("returns failure with timeout error for connection-refused port", async () => {
    // Use a port that is very likely not listening — the OS will refuse the TCP connection.
    // This should fail fast (not hang), but we verify the error is still returned cleanly.
    const result = await backendManager.validateRemoteDirectory(
      {
        mode: "connect",
        hostname: "127.0.0.1",
        port: 1, // Port 1 is almost certainly not listening
        useHttps: false,
        allowInsecure: false,
      },
      "/some/directory",
    );

    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
    // Should get a connection error (not a hang)
    expect(typeof result.error).toBe("string");
  }, 30_000);
});
