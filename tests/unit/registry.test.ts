/**
 * Unit tests for backend registry.
 */

import { test, expect, describe, beforeEach } from "bun:test";
import { backendRegistry, registerBackend, getBackend } from "../../src/backends/registry";
import type { AgentBackend, AgentEvent, BackendConnectionConfig, CreateSessionOptions, PromptInput } from "../../src/backends/types";
import { createEventStream, type EventStream } from "../../src/utils/event-stream";

// Mock backend for testing
class MockBackend implements AgentBackend {
  readonly name = "mock";
  private connected = false;

  async connect(_config: BackendConnectionConfig): Promise<void> {
    this.connected = true;
  }

  async disconnect(): Promise<void> {
    this.connected = false;
  }

  isConnected(): boolean {
    return this.connected;
  }

  async createSession(_options: CreateSessionOptions) {
    return { id: "mock-session", createdAt: new Date().toISOString() };
  }

  async getSession(_id: string) {
    return null;
  }

  async deleteSession(_id: string): Promise<void> {}

  async sendPrompt(_sessionId: string, _prompt: PromptInput) {
    return { id: "mock-response", content: "Mock response", parts: [] };
  }

  async sendPromptAsync(_sessionId: string, _prompt: PromptInput): Promise<void> {}

  async abortSession(_sessionId: string): Promise<void> {}

  async subscribeToEvents(_sessionId: string): Promise<EventStream<AgentEvent>> {
    const { stream, push, end } = createEventStream<AgentEvent>();
    push({ type: "message.complete" as const, content: "done" });
    end();
    return stream;
  }
}

describe("BackendRegistry", () => {
  beforeEach(async () => {
    await backendRegistry.clear();
  });

  test("register and get backend", () => {
    backendRegistry.register("mock", () => new MockBackend());

    const backend = backendRegistry.get("mock");
    expect(backend).toBeDefined();
    expect(backend!.name).toBe("mock");
  });

  test("get returns same instance", () => {
    backendRegistry.register("mock", () => new MockBackend());

    const backend1 = backendRegistry.get("mock");
    const backend2 = backendRegistry.get("mock");

    expect(backend1).toBe(backend2);
  });

  test("get returns undefined for unregistered backend", () => {
    const backend = backendRegistry.get("unknown");
    expect(backend).toBeUndefined();
  });

  test("list returns all registered backends", () => {
    backendRegistry.register("mock1", () => new MockBackend());
    backendRegistry.register("mock2", () => new MockBackend());

    const list = backendRegistry.list();
    expect(list).toContain("mock1");
    expect(list).toContain("mock2");
  });

  test("has checks registration", () => {
    backendRegistry.register("mock", () => new MockBackend());

    expect(backendRegistry.has("mock")).toBe(true);
    expect(backendRegistry.has("unknown")).toBe(false);
  });

  test("getBackend helper throws for unknown backend", () => {
    expect(() => getBackend("unknown")).toThrow();
  });

  test("registerBackend helper works", () => {
    registerBackend("helper-mock", () => new MockBackend());

    const backend = getBackend("helper-mock");
    expect(backend.name).toBe("mock");
  });
});
