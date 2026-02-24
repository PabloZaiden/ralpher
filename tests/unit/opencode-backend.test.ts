/**
 * Unit tests for OpenCodeBackend.
 * 
 * Note: These tests verify the class structure and basic behaviors.
 * Integration tests that actually connect to opencode would be in tests/api/.
 */

import { test, expect, describe, beforeEach } from "bun:test";
import { OpenCodeBackend } from "../../src/backends/opencode";

describe("OpenCodeBackend", () => {
  let backend: OpenCodeBackend;

  beforeEach(() => {
    backend = new OpenCodeBackend();
  });

  test("has correct name", () => {
    expect(backend.name).toBe("opencode");
  });

  test("isConnected returns false initially", () => {
    expect(backend.isConnected()).toBe(false);
  });

  test("disconnect on unconnected backend does nothing", async () => {
    // Should not throw
    await backend.disconnect();
    expect(backend.isConnected()).toBe(false);
  });

  test("throws when createSession called before connect", async () => {
    await expect(
      backend.createSession({ directory: "/tmp" })
    ).rejects.toThrow("Not connected");
  });

  test("throws when getSession called before connect", async () => {
    await expect(backend.getSession("test-id")).rejects.toThrow("Not connected");
  });

  test("throws when deleteSession called before connect", async () => {
    await expect(backend.deleteSession("test-id")).rejects.toThrow("Not connected");
  });

  test("throws when sendPrompt called before connect", async () => {
    await expect(
      backend.sendPrompt("test-id", { parts: [{ type: "text", text: "test" }] })
    ).rejects.toThrow("Not connected");
  });

  test("throws when sendPromptAsync called before connect", async () => {
    await expect(
      backend.sendPromptAsync("test-id", { parts: [{ type: "text", text: "test" }] })
    ).rejects.toThrow("Not connected");
  });

  test("throws when abortSession called before connect", async () => {
    await expect(backend.abortSession("test-id")).rejects.toThrow("Not connected");
  });
});

describe("OpenCodeBackend Connection Config", () => {
  test("connect rejects when already connected", async () => {
    const backend = new OpenCodeBackend();
    
    // We can't actually connect without a server, but we can test the double-connect check
    // by mocking the internal state. For now, we test that connect with invalid config fails.
    // This is more of an integration test scenario.
    
    // Try to connect to a non-existent server (will fail, which is expected)
    const config = {
      mode: "connect" as const,
      hostname: "localhost",
      port: 59999, // Unlikely to be used
      directory: "/tmp",
    };

    // This should fail because no server is running
    await expect(backend.connect(config)).rejects.toThrow();
  });
});

describe("OpenCodeBackend abortAllSubscriptions", () => {
  test("abortAllSubscriptions works when no subscriptions exist", () => {
    const backend = new OpenCodeBackend();
    
    // Should not throw when called with no active subscriptions
    expect(() => backend.abortAllSubscriptions()).not.toThrow();
  });

  test("abortAllSubscriptions aborts all tracked subscriptions", () => {
    const backend = new OpenCodeBackend();
    
    // Access the private activeSubscriptions set via type assertion
    const b = backend as unknown as { activeSubscriptions: Set<AbortController> };
    
    // Create mock AbortControllers
    const controller1 = new AbortController();
    const controller2 = new AbortController();
    const controller3 = new AbortController();
    
    // Track abort calls by checking signal.aborted after calling abort
    b.activeSubscriptions.add(controller1);
    b.activeSubscriptions.add(controller2);
    b.activeSubscriptions.add(controller3);
    
    expect(b.activeSubscriptions.size).toBe(3);
    expect(controller1.signal.aborted).toBe(false);
    expect(controller2.signal.aborted).toBe(false);
    expect(controller3.signal.aborted).toBe(false);
    
    // Call abortAllSubscriptions
    backend.abortAllSubscriptions();
    
    // Verify all controllers were aborted
    expect(controller1.signal.aborted).toBe(true);
    expect(controller2.signal.aborted).toBe(true);
    expect(controller3.signal.aborted).toBe(true);
    
    // Verify the set was cleared
    expect(b.activeSubscriptions.size).toBe(0);
  });

  test("abortAllSubscriptions clears the subscription set", () => {
    const backend = new OpenCodeBackend();
    
    // Access the private activeSubscriptions set
    const b = backend as unknown as { activeSubscriptions: Set<AbortController> };
    
    // Add some controllers
    b.activeSubscriptions.add(new AbortController());
    b.activeSubscriptions.add(new AbortController());
    
    expect(b.activeSubscriptions.size).toBe(2);
    
    backend.abortAllSubscriptions();
    
    expect(b.activeSubscriptions.size).toBe(0);
  });
});

describe("OpenCodeBackend replyToPermission", () => {
  test("throws when replyToPermission called before connect", async () => {
    const backend = new OpenCodeBackend();
    
    await expect(
      backend.replyToPermission("request-123", "once")
    ).rejects.toThrow("Not connected");
  });

  test("throws when replyToPermission called with 'always' before connect", async () => {
    const backend = new OpenCodeBackend();
    
    await expect(
      backend.replyToPermission("request-456", "always")
    ).rejects.toThrow("Not connected");
  });

  test("throws when replyToPermission called with 'reject' before connect", async () => {
    const backend = new OpenCodeBackend();
    
    await expect(
      backend.replyToPermission("request-789", "reject")
    ).rejects.toThrow("Not connected");
  });
});

describe("OpenCodeBackend replyToQuestion", () => {
  test("throws when replyToQuestion called before connect", async () => {
    const backend = new OpenCodeBackend();
    
    await expect(
      backend.replyToQuestion("question-123", [["answer1"]])
    ).rejects.toThrow("Not connected");
  });

  test("throws when replyToQuestion called with multiple answers before connect", async () => {
    const backend = new OpenCodeBackend();
    
    await expect(
      backend.replyToQuestion("question-456", [["option1", "option2"], ["choice1"]])
    ).rejects.toThrow("Not connected");
  });

  test("throws when replyToQuestion called with empty answers before connect", async () => {
    const backend = new OpenCodeBackend();
    
    await expect(
      backend.replyToQuestion("question-789", [])
    ).rejects.toThrow("Not connected");
  });

  test("throws when replyToQuestion called with empty answer arrays before connect", async () => {
    const backend = new OpenCodeBackend();
    
    await expect(
      backend.replyToQuestion("question-101", [[], []])
    ).rejects.toThrow("Not connected");
  });
});

describe("OpenCodeBackend transport validation", () => {
  test("getConnectionInfo returns null when not connected", () => {
    const backend = new OpenCodeBackend();
    expect(backend.getConnectionInfo()).toBe(null);
  });

  test("connect mode is rejected by ACP runtime", async () => {
    const backend = new OpenCodeBackend();
    const config = {
      mode: "connect" as const,
      hostname: "test-server.example.com",
      port: 4096,
      directory: "/tmp",
    };

    await expect(backend.connect(config)).rejects.toThrow(
      "Connect mode is not supported by ACP runtime. Use stdio or ssh transport."
    );
    expect(backend.isConnected()).toBe(false);
  });

  test("connect mode with legacy HTTPS fields is still rejected", async () => {
    const backend = new OpenCodeBackend();
    const config = {
      mode: "connect" as const,
      hostname: "test-server.example.com",
      port: 8443,
      directory: "/tmp",
    };

    await expect(backend.connect(config)).rejects.toThrow(
      "Connect mode is not supported by ACP runtime. Use stdio or ssh transport."
    );
    expect(backend.isConnected()).toBe(false);
  });
});
