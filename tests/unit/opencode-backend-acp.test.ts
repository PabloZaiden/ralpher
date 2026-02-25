import { describe, expect, test } from "bun:test";

import { OpenCodeBackend } from "../../src/backends/opencode";

type PrivateBackend = {
  handleRpcMessage(message: unknown): void;
  parseModelsFromSessionResult(result: unknown): unknown;
  sessionSubscribers: Map<string, Set<(event: unknown) => void>>;
  pendingPermissionRequests: Map<string, { rpcId: number; options: Array<{ optionId: string; kind?: string }> }>;
  toolCallNames: Map<string, string>;
  sessionPromptSequences: Map<string, number>;
  connected: boolean;
  process: { stdin: { write: (line: string) => void } } | null;
  replyToPermission(requestId: string, response: string): Promise<void>;
  sendRpcRequest<T>(
    method: string,
    params: Record<string, unknown>,
    timeoutMs?: number,
  ): Promise<T>;
  sendPromptAsync(
    sessionId: string,
    prompt: { parts: Array<{ type: "text"; text: string }> },
  ): Promise<void>;
};

function getBackend(): PrivateBackend {
  return new OpenCodeBackend() as unknown as PrivateBackend;
}

function createDeferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (error: unknown) => void;
} {
  let resolveFn!: (value: T) => void;
  let rejectFn!: (error: unknown) => void;
  const promise = new Promise<T>((resolve, reject) => {
    resolveFn = resolve;
    rejectFn = reject;
  });

  return {
    promise,
    resolve: resolveFn,
    reject: rejectFn,
  };
}

describe("OpenCodeBackend ACP parsing", () => {
  test("handles session/request_permission JSON-RPC requests with id", () => {
    const backend = getBackend();
    const sessionId = "session-1";
    const events: Array<Record<string, unknown>> = [];

    backend.sessionSubscribers.set(
      sessionId,
      new Set([
        (event: unknown) => {
          events.push(event as Record<string, unknown>);
        },
      ]),
    );

    backend.handleRpcMessage({
      jsonrpc: "2.0",
      id: 0,
      method: "session/request_permission",
      params: {
        sessionId,
        toolCall: {
          toolCallId: "shell-permission",
          kind: "execute",
          rawInput: { command: "pwd", commands: ["pwd"] },
        },
        options: [
          { optionId: "allow_once", kind: "allow_once" },
          { optionId: "allow_always", kind: "allow_always" },
        ],
      },
    });

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      type: "permission.asked",
      sessionId,
      permission: "execute",
      patterns: ["pwd"],
    });

    const requestId = events[0]!["requestId"] as string;
    const pendingRequest = backend.pendingPermissionRequests.get(requestId);
    expect(pendingRequest).toEqual({
      rpcId: 0,
      options: [
        { optionId: "allow_once", kind: "allow_once" },
        { optionId: "allow_always", kind: "allow_always" },
      ],
    });
  });

  test("parses Copilot tool_call and tool_call_update payload shapes", () => {
    const backend = getBackend();
    const sessionId = "session-2";
    const events: Array<Record<string, unknown>> = [];

    backend.sessionSubscribers.set(
      sessionId,
      new Set([
        (event: unknown) => {
          events.push(event as Record<string, unknown>);
        },
      ]),
    );

    backend.handleRpcMessage({
      jsonrpc: "2.0",
      method: "session/update",
      params: {
        sessionId,
        update: {
          sessionUpdate: "tool_call",
          toolCallId: "call-1",
          kind: "execute",
          rawInput: { command: "pwd" },
        },
      },
    });

    backend.handleRpcMessage({
      jsonrpc: "2.0",
      method: "session/update",
      params: {
        sessionId,
        update: {
          sessionUpdate: "tool_call_update",
          toolCallId: "call-1",
          status: "completed",
          rawOutput: { content: "/tmp" },
        },
      },
    });

    expect(events).toHaveLength(2);
    expect(events[0]).toEqual({
      type: "tool.start",
      toolName: "execute",
      input: { command: "pwd" },
    });
    expect(events[1]).toEqual({
      type: "tool.complete",
      toolName: "execute",
      output: { content: "/tmp" },
    });
    expect(backend.toolCallNames.has("call-1")).toBe(false);
  });

  test("maps failed tool_call_update to tool.complete (non-fatal)", () => {
    const backend = getBackend();
    const sessionId = "session-2b";
    const events: Array<Record<string, unknown>> = [];

    backend.sessionSubscribers.set(
      sessionId,
      new Set([
        (event: unknown) => {
          events.push(event as Record<string, unknown>);
        },
      ]),
    );

    backend.handleRpcMessage({
      jsonrpc: "2.0",
      method: "session/update",
      params: {
        sessionId,
        update: {
          sessionUpdate: "tool_call",
          toolCallId: "call-fail-1",
          kind: "read",
          rawInput: { path: "/tmp/missing.txt" },
        },
      },
    });

    backend.handleRpcMessage({
      jsonrpc: "2.0",
      method: "session/update",
      params: {
        sessionId,
        update: {
          sessionUpdate: "tool_call_update",
          toolCallId: "call-fail-1",
          status: "failed",
          rawOutput: { message: "file not found" },
        },
      },
    });

    expect(events).toHaveLength(2);
    expect(events[0]).toMatchObject({
      type: "tool.start",
      toolName: "read",
    });
    expect(events[1]).toEqual({
      type: "tool.complete",
      toolName: "read",
      output: {
        message: "file not found",
        status: "failed",
        error: "file not found",
      },
    });
  });

  test("emits todo.updated when tool_call input carries checklist todos", () => {
    const backend = getBackend();
    const sessionId = "session-3";
    const events: Array<Record<string, unknown>> = [];

    backend.sessionSubscribers.set(
      sessionId,
      new Set([
        (event: unknown) => {
          events.push(event as Record<string, unknown>);
        },
      ]),
    );

    backend.handleRpcMessage({
      jsonrpc: "2.0",
      method: "session/update",
      params: {
        sessionId,
        update: {
          sessionUpdate: "tool_call",
          toolCallId: "call-think",
          kind: "think",
          rawInput: {
            todos: "- [ ] Check existing planning files\n- [x] Verify files and finalize response",
          },
        },
      },
    });

    expect(events).toHaveLength(2);
    expect(events[0]).toEqual({
      type: "tool.start",
      toolName: "think",
      input: {
        todos: "- [ ] Check existing planning files\n- [x] Verify files and finalize response",
      },
    });
    expect(events[1]).toMatchObject({
      type: "todo.updated",
      sessionId,
      todos: [
        {
          content: "Check existing planning files",
          status: "pending",
          priority: "medium",
        },
        {
          content: "Verify files and finalize response",
          status: "completed",
          priority: "medium",
        },
      ],
    });
  });

  test("emits todo.updated from tool_call_update detailedContent checklist", () => {
    const backend = getBackend();
    const sessionId = "session-4";
    const events: Array<Record<string, unknown>> = [];

    backend.sessionSubscribers.set(
      sessionId,
      new Set([
        (event: unknown) => {
          events.push(event as Record<string, unknown>);
        },
      ]),
    );

    backend.handleRpcMessage({
      jsonrpc: "2.0",
      method: "session/update",
      params: {
        sessionId,
        update: {
          sessionUpdate: "tool_call",
          toolCallId: "call-think-update",
          kind: "think",
          rawInput: {},
        },
      },
    });

    backend.handleRpcMessage({
      jsonrpc: "2.0",
      method: "session/update",
      params: {
        sessionId,
        update: {
          sessionUpdate: "tool_call_update",
          toolCallId: "call-think-update",
          status: "completed",
          rawOutput: {
            detailedContent: "TODO List:\n- [ ] Create .planning/plan.md\n- [ ] Create .planning/status.md",
          },
        },
      },
    });

    const todoUpdateEvent = events.find((event) => event["type"] === "todo.updated");
    expect(todoUpdateEvent).toBeDefined();
    expect(todoUpdateEvent).toMatchObject({
      type: "todo.updated",
      sessionId,
      todos: [
        {
          content: "Create .planning/plan.md",
          status: "pending",
          priority: "medium",
        },
        {
          content: "Create .planning/status.md",
          status: "pending",
          priority: "medium",
        },
      ],
    });
  });

  test("parses model lists from availableModels shape", () => {
    const backend = getBackend();
    const parsed = backend.parseModelsFromSessionResult({
      models: {
        availableModels: [
          { modelId: "gpt-5.3-codex", name: "GPT-5.3-Codex" },
          { modelId: "claude-sonnet-4.6", name: "Claude Sonnet 4.6" },
        ],
      },
    }) as Array<Record<string, unknown>>;

    expect(parsed).toHaveLength(2);
    expect(parsed[0]).toMatchObject({
      modelID: "gpt-5.3-codex",
      modelName: "GPT-5.3-Codex",
    });
    expect(parsed[1]).toMatchObject({
      modelID: "claude-sonnet-4.6",
      modelName: "Claude Sonnet 4.6",
    });
  });

  test("replyToPermission responds to pending JSON-RPC permission request", async () => {
    const backend = getBackend();
    const writes: string[] = [];

    backend.connected = true;
    backend.process = {
      stdin: {
        write: (line: string) => {
          writes.push(line);
        },
      },
    };
    backend.pendingPermissionRequests.set("request-1", {
      rpcId: 0,
      options: [
        { optionId: "allow_once", kind: "allow_once" },
        { optionId: "allow_always", kind: "allow_always" },
      ],
    });

    await backend.replyToPermission("request-1", "always");

    expect(backend.pendingPermissionRequests.has("request-1")).toBe(false);
    expect(writes).toHaveLength(1);

    const message = JSON.parse(writes[0]!);
    expect(message).toEqual({
      jsonrpc: "2.0",
      id: 0,
      result: {
        outcome: {
          outcome: "selected",
          optionId: "allow_always",
        },
      },
    });
  });

  test("ignores stale message.complete from previous async prompt", async () => {
    const backend = getBackend();
    const sessionId = "session-stale";
    const events: Array<Record<string, unknown>> = [];

    backend.connected = true;
    backend.process = {
      stdin: {
        write: () => {
          // no-op
        },
      },
    };
    backend.sessionSubscribers.set(
      sessionId,
      new Set([
        (event: unknown) => {
          events.push(event as Record<string, unknown>);
        },
      ]),
    );

    const firstPrompt = createDeferred<unknown>();
    const secondPrompt = createDeferred<unknown>();
    let promptCallCount = 0;
    backend.sendRpcRequest = ((method: string) => {
      if (method !== "session/prompt") {
        return Promise.resolve({}) as Promise<unknown>;
      }
      promptCallCount += 1;
      return promptCallCount === 1 ? firstPrompt.promise : secondPrompt.promise;
    }) as PrivateBackend["sendRpcRequest"];

    await backend.sendPromptAsync(sessionId, { parts: [{ type: "text", text: "first" }] });
    await backend.sendPromptAsync(sessionId, { parts: [{ type: "text", text: "second" }] });

    firstPrompt.resolve({ stopReason: "end_turn" });
    await Promise.resolve();
    await Promise.resolve();
    expect(events).toHaveLength(0);

    secondPrompt.resolve({ stopReason: "end_turn" });
    await Promise.resolve();
    await Promise.resolve();

    expect(events).toEqual([
      {
        type: "message.complete",
        content: "",
      },
    ]);
  });
});
