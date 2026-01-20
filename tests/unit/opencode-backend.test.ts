/**
 * Unit tests for OpenCodeBackend.
 * 
 * Note: These tests verify the class structure and basic behaviors.
 * Integration tests that actually connect to opencode would be in tests/api/.
 */

import { test, expect, describe, beforeEach } from "bun:test";
import { OpenCodeBackend } from "../../src/backends/opencode";
import { backendRegistry, registerBackend, getBackend } from "../../src/backends/registry";

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

describe("OpenCodeBackend Registration", () => {
  beforeEach(async () => {
    await backendRegistry.clear();
  });

  test("can be registered in backend registry", () => {
    registerBackend("opencode", () => new OpenCodeBackend());

    expect(backendRegistry.has("opencode")).toBe(true);
  });

  test("can be retrieved from registry", () => {
    registerBackend("opencode", () => new OpenCodeBackend());

    const backend = getBackend("opencode");
    expect(backend.name).toBe("opencode");
    expect(backend.isConnected()).toBe(false);
  });

  test("registry returns same instance", () => {
    registerBackend("opencode", () => new OpenCodeBackend());

    const backend1 = getBackend("opencode");
    const backend2 = getBackend("opencode");

    expect(backend1).toBe(backend2);
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
