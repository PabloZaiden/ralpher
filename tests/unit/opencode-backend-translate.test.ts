/**
 * Positive-path unit tests for OpenCodeBackend.
 *
 * Tests translateEvent(), mapSession(), and mapResponse() by calling
 * the private methods via type assertion. This complements the existing
 * opencode-backend.test.ts which mostly covers "not connected" errors.
 */

import { test, expect, describe } from "bun:test";
import { OpenCodeBackend } from "../../src/backends/opencode";
import type { AgentEvent } from "../../src/backends/types";

// Access private methods via type assertion
type PrivateBackend = {
  translateEvent(
    event: unknown,
    ctx: {
      sessionId: string;
      subId: string;
      emittedMessageStarts: Set<string>;
      toolPartStatus: Map<string, string>;
      reasoningTextLength: Map<string, number>;
      client: unknown;
      directory: string;
    }
  ): AgentEvent | null;
  mapSession(session: { id: string; title?: string; time: { created: number } }): {
    id: string;
    title?: string;
    createdAt: string;
  };
  mapResponse(response: {
    info: { id: string; tokens: { input: number; output: number } };
    parts: Array<{
      type: string;
      text?: string;
      tool?: string;
      state?: { status: string; input?: unknown; output?: unknown };
    }>;
  }): {
    id: string;
    content: string;
    parts: Array<{ type: string; text?: string; toolName?: string; toolInput?: unknown; toolOutput?: unknown }>;
    usage?: { inputTokens: number; outputTokens: number };
  };
};

/** Helper to create a fresh context for translateEvent tests */
function createContext(sessionId = "test-session") {
  return {
    sessionId,
    subId: "test-sub",
    emittedMessageStarts: new Set<string>(),
    toolPartStatus: new Map<string, string>(),
    reasoningTextLength: new Map<string, number>(),
    client: {} as unknown,
    directory: "/tmp/test",
  };
}

/** Helper to get the private backend for method access */
function getBackend(): PrivateBackend {
  return new OpenCodeBackend() as unknown as PrivateBackend;
}

// ==========================================================================
// translateEvent — message.updated
// ==========================================================================

describe("translateEvent: message.updated", () => {
  test("emits message.start for assistant message on first occurrence", () => {
    const backend = getBackend();
    const ctx = createContext();

    const result = backend.translateEvent(
      {
        type: "message.updated",
        properties: {
          info: {
            sessionID: "test-session",
            role: "assistant",
            id: "msg-1",
          },
        },
      },
      ctx
    );

    expect(result).toEqual({ type: "message.start", messageId: "msg-1" });
    expect(ctx.emittedMessageStarts.has("msg-1")).toBe(true);
  });

  test("returns null for duplicate assistant message", () => {
    const backend = getBackend();
    const ctx = createContext();
    ctx.emittedMessageStarts.add("msg-1");

    const result = backend.translateEvent(
      {
        type: "message.updated",
        properties: {
          info: {
            sessionID: "test-session",
            role: "assistant",
            id: "msg-1",
          },
        },
      },
      ctx
    );

    expect(result).toBeNull();
  });

  test("returns null for non-assistant role", () => {
    const backend = getBackend();
    const ctx = createContext();

    const result = backend.translateEvent(
      {
        type: "message.updated",
        properties: {
          info: {
            sessionID: "test-session",
            role: "user",
            id: "msg-user-1",
          },
        },
      },
      ctx
    );

    expect(result).toBeNull();
  });

  test("returns null for different session ID", () => {
    const backend = getBackend();
    const ctx = createContext("my-session");

    const result = backend.translateEvent(
      {
        type: "message.updated",
        properties: {
          info: {
            sessionID: "other-session",
            role: "assistant",
            id: "msg-1",
          },
        },
      },
      ctx
    );

    expect(result).toBeNull();
  });
});

// ==========================================================================
// translateEvent — message.part.updated (text)
// ==========================================================================

describe("translateEvent: message.part.updated (text)", () => {
  test("emits message.delta for text part with delta", () => {
    const backend = getBackend();
    const ctx = createContext();

    const result = backend.translateEvent(
      {
        type: "message.part.updated",
        properties: {
          part: {
            sessionID: "test-session",
            type: "text",
            id: "part-1",
          },
          delta: "Hello, world!",
        },
      },
      ctx
    );

    expect(result).toEqual({ type: "message.delta", content: "Hello, world!" });
  });

  test("returns null for text part without delta", () => {
    const backend = getBackend();
    const ctx = createContext();

    const result = backend.translateEvent(
      {
        type: "message.part.updated",
        properties: {
          part: {
            sessionID: "test-session",
            type: "text",
            id: "part-1",
          },
        },
      },
      ctx
    );

    expect(result).toBeNull();
  });

  test("returns null for different session ID", () => {
    const backend = getBackend();
    const ctx = createContext("my-session");

    const result = backend.translateEvent(
      {
        type: "message.part.updated",
        properties: {
          part: {
            sessionID: "other-session",
            type: "text",
            id: "part-1",
          },
          delta: "some text",
        },
      },
      ctx
    );

    expect(result).toBeNull();
  });
});

// ==========================================================================
// translateEvent — message.part.updated (tool)
// ==========================================================================

describe("translateEvent: message.part.updated (tool)", () => {
  test("emits tool.start for running tool", () => {
    const backend = getBackend();
    const ctx = createContext();

    const result = backend.translateEvent(
      {
        type: "message.part.updated",
        properties: {
          part: {
            sessionID: "test-session",
            type: "tool",
            id: "tool-part-1",
            tool: "bash",
            state: { status: "running", input: { command: "ls" } },
          },
        },
      },
      ctx
    );

    expect(result).toEqual({
      type: "tool.start",
      toolName: "bash",
      input: { command: "ls" },
    });
    expect(ctx.toolPartStatus.get("tool-part-1")).toBe("running");
  });

  test("returns null for duplicate running status", () => {
    const backend = getBackend();
    const ctx = createContext();
    ctx.toolPartStatus.set("tool-part-1", "running");

    const result = backend.translateEvent(
      {
        type: "message.part.updated",
        properties: {
          part: {
            sessionID: "test-session",
            type: "tool",
            id: "tool-part-1",
            tool: "bash",
            state: { status: "running", input: { command: "ls" } },
          },
        },
      },
      ctx
    );

    expect(result).toBeNull();
  });

  test("emits tool.complete for completed tool", () => {
    const backend = getBackend();
    const ctx = createContext();
    ctx.toolPartStatus.set("tool-part-1", "running");

    const result = backend.translateEvent(
      {
        type: "message.part.updated",
        properties: {
          part: {
            sessionID: "test-session",
            type: "tool",
            id: "tool-part-1",
            tool: "read_file",
            state: { status: "completed", output: "file contents here" },
          },
        },
      },
      ctx
    );

    expect(result).toEqual({
      type: "tool.complete",
      toolName: "read_file",
      output: "file contents here",
    });
    expect(ctx.toolPartStatus.get("tool-part-1")).toBe("completed");
  });

  test("returns null for duplicate completed status", () => {
    const backend = getBackend();
    const ctx = createContext();
    ctx.toolPartStatus.set("tool-part-1", "completed");

    const result = backend.translateEvent(
      {
        type: "message.part.updated",
        properties: {
          part: {
            sessionID: "test-session",
            type: "tool",
            id: "tool-part-1",
            tool: "read_file",
            state: { status: "completed", output: "contents" },
          },
        },
      },
      ctx
    );

    expect(result).toBeNull();
  });

  test("emits error for tool with error status", () => {
    const backend = getBackend();
    const ctx = createContext();

    const result = backend.translateEvent(
      {
        type: "message.part.updated",
        properties: {
          part: {
            sessionID: "test-session",
            type: "tool",
            id: "tool-part-1",
            tool: "bash",
            state: { status: "error", error: "Command failed" },
          },
        },
      },
      ctx
    );

    expect(result).toEqual({ type: "error", message: "Command failed" });
    expect(ctx.toolPartStatus.get("tool-part-1")).toBe("error");
  });

  test("returns null for duplicate error status", () => {
    const backend = getBackend();
    const ctx = createContext();
    ctx.toolPartStatus.set("tool-part-1", "error");

    const result = backend.translateEvent(
      {
        type: "message.part.updated",
        properties: {
          part: {
            sessionID: "test-session",
            type: "tool",
            id: "tool-part-1",
            tool: "bash",
            state: { status: "error", error: "Command failed" },
          },
        },
      },
      ctx
    );

    expect(result).toBeNull();
  });
});

// ==========================================================================
// translateEvent — message.part.updated (reasoning)
// ==========================================================================

describe("translateEvent: message.part.updated (reasoning)", () => {
  test("emits reasoning.delta with delta content", () => {
    const backend = getBackend();
    const ctx = createContext();

    const result = backend.translateEvent(
      {
        type: "message.part.updated",
        properties: {
          part: {
            sessionID: "test-session",
            type: "reasoning",
            id: "reason-1",
          },
          delta: "Let me think...",
        },
      },
      ctx
    );

    expect(result).toEqual({ type: "reasoning.delta", content: "Let me think..." });
  });

  test("emits reasoning.delta computed from full text when no delta", () => {
    const backend = getBackend();
    const ctx = createContext();
    // Simulate we already saw 5 chars
    ctx.reasoningTextLength.set("reason-1", 5);

    const result = backend.translateEvent(
      {
        type: "message.part.updated",
        properties: {
          part: {
            sessionID: "test-session",
            type: "reasoning",
            id: "reason-1",
            text: "Hello, world!",
          },
        },
      },
      ctx
    );

    expect(result).toEqual({ type: "reasoning.delta", content: ", world!" });
    expect(ctx.reasoningTextLength.get("reason-1")).toBe(13);
  });

  test("returns null for reasoning with no new content", () => {
    const backend = getBackend();
    const ctx = createContext();
    ctx.reasoningTextLength.set("reason-1", 5);

    const result = backend.translateEvent(
      {
        type: "message.part.updated",
        properties: {
          part: {
            sessionID: "test-session",
            type: "reasoning",
            id: "reason-1",
            text: "Hello", // same length as what we tracked
          },
        },
      },
      ctx
    );

    expect(result).toBeNull();
  });
});

// ==========================================================================
// translateEvent — reasoning: mixed delta/text duplication bug
// ==========================================================================

describe("translateEvent: reasoning delta/text-only mixed events (duplication bug)", () => {
  test("does not duplicate content when SDK switches from delta to text-only events", () => {
    const backend = getBackend();
    const ctx = createContext();
    const emitted: string[] = [];

    // Step 1: Send reasoning events WITH delta (Branch A)
    const r1 = backend.translateEvent(
      {
        type: "message.part.updated",
        properties: {
          part: { sessionID: "test-session", type: "reasoning", id: "reason-1", text: "Hello" },
          delta: "Hello",
        },
      },
      ctx
    );
    expect(r1).toEqual({ type: "reasoning.delta", content: "Hello" });
    emitted.push((r1 as { content: string }).content);

    const r2 = backend.translateEvent(
      {
        type: "message.part.updated",
        properties: {
          part: { sessionID: "test-session", type: "reasoning", id: "reason-1", text: "Hello, world" },
          delta: ", world",
        },
      },
      ctx
    );
    expect(r2).toEqual({ type: "reasoning.delta", content: ", world" });
    emitted.push((r2 as { content: string }).content);

    // Step 2: SDK switches to text-only (no delta) — Branch B
    // The full text is "Hello, world!" — the new content is just "!"
    const r3 = backend.translateEvent(
      {
        type: "message.part.updated",
        properties: {
          part: { sessionID: "test-session", type: "reasoning", id: "reason-1", text: "Hello, world!" },
          // No delta property — forces Branch B
        },
      },
      ctx
    );
    expect(r3).toEqual({ type: "reasoning.delta", content: "!" });
    emitted.push((r3 as { content: string }).content);

    // Step 3: Verify concatenated content has NO duplication
    const fullContent = emitted.join("");
    expect(fullContent).toBe("Hello, world!");
  });

  test("tracks length correctly across multiple delta-then-text switches", () => {
    const backend = getBackend();
    const ctx = createContext();
    const emitted: string[] = [];

    // Delta event
    const r1 = backend.translateEvent(
      {
        type: "message.part.updated",
        properties: {
          part: { sessionID: "test-session", type: "reasoning", id: "r-2", text: "A" },
          delta: "A",
        },
      },
      ctx
    );
    emitted.push((r1 as { content: string }).content);

    // Text-only event (should only emit "B")
    const r2 = backend.translateEvent(
      {
        type: "message.part.updated",
        properties: {
          part: { sessionID: "test-session", type: "reasoning", id: "r-2", text: "AB" },
        },
      },
      ctx
    );
    emitted.push((r2 as { content: string }).content);

    // Back to delta
    const r3 = backend.translateEvent(
      {
        type: "message.part.updated",
        properties: {
          part: { sessionID: "test-session", type: "reasoning", id: "r-2", text: "ABC" },
          delta: "C",
        },
      },
      ctx
    );
    emitted.push((r3 as { content: string }).content);

    // Text-only again (should only emit "D")
    const r4 = backend.translateEvent(
      {
        type: "message.part.updated",
        properties: {
          part: { sessionID: "test-session", type: "reasoning", id: "r-2", text: "ABCD" },
        },
      },
      ctx
    );
    emitted.push((r4 as { content: string }).content);

    const fullContent = emitted.join("");
    expect(fullContent).toBe("ABCD");
  });

  test("reasoningTextLength is updated even when delta property is present", () => {
    const backend = getBackend();
    const ctx = createContext();

    // Send delta event
    backend.translateEvent(
      {
        type: "message.part.updated",
        properties: {
          part: { sessionID: "test-session", type: "reasoning", id: "r-3", text: "Hello" },
          delta: "Hello",
        },
      },
      ctx
    );

    // Verify reasoningTextLength was updated
    expect(ctx.reasoningTextLength.get("r-3")).toBe(5);
  });
});

// ==========================================================================
// translateEvent — message.part.updated (step-start / step-finish)
// ==========================================================================

describe("translateEvent: message.part.updated (step events)", () => {
  test("emits empty message.delta for step-start", () => {
    const backend = getBackend();
    const ctx = createContext();

    const result = backend.translateEvent(
      {
        type: "message.part.updated",
        properties: {
          part: {
            sessionID: "test-session",
            type: "step-start",
            id: "step-1",
          },
        },
      },
      ctx
    );

    expect(result).toEqual({ type: "message.delta", content: "" });
  });

  test("returns null for step-finish", () => {
    const backend = getBackend();
    const ctx = createContext();

    const result = backend.translateEvent(
      {
        type: "message.part.updated",
        properties: {
          part: {
            sessionID: "test-session",
            type: "step-finish",
            id: "step-1",
          },
        },
      },
      ctx
    );

    expect(result).toBeNull();
  });
});

// ==========================================================================
// translateEvent — session.idle
// ==========================================================================

describe("translateEvent: session.idle", () => {
  test("emits message.complete for matching session", () => {
    const backend = getBackend();
    const ctx = createContext();
    ctx.emittedMessageStarts.add("msg-1"); // simulate we saw a message

    const result = backend.translateEvent(
      {
        type: "session.idle",
        properties: { sessionID: "test-session" },
      },
      ctx
    );

    expect(result).toEqual({ type: "message.complete", content: "" });
  });

  test("returns null for different session ID", () => {
    const backend = getBackend();
    const ctx = createContext("my-session");

    const result = backend.translateEvent(
      {
        type: "session.idle",
        properties: { sessionID: "other-session" },
      },
      ctx
    );

    expect(result).toBeNull();
  });

  test("still emits message.complete even with no prior message.start", () => {
    const backend = getBackend();
    const ctx = createContext();
    // No message starts emitted — edge case

    const result = backend.translateEvent(
      {
        type: "session.idle",
        properties: { sessionID: "test-session" },
      },
      ctx
    );

    // Should still emit message.complete (the caller handles the empty-response case)
    expect(result).toEqual({ type: "message.complete", content: "" });
  });
});

// ==========================================================================
// translateEvent — session.error
// ==========================================================================

describe("translateEvent: session.error", () => {
  test("emits error for matching session", () => {
    const backend = getBackend();
    const ctx = createContext();

    const result = backend.translateEvent(
      {
        type: "session.error",
        properties: {
          sessionID: "test-session",
          error: { data: { message: "Rate limit exceeded" } },
        },
      },
      ctx
    );

    expect(result).toEqual({ type: "error", message: "Rate limit exceeded" });
  });

  test("returns 'Unknown error' when error message is missing", () => {
    const backend = getBackend();
    const ctx = createContext();

    const result = backend.translateEvent(
      {
        type: "session.error",
        properties: {
          sessionID: "test-session",
          error: {},
        },
      },
      ctx
    );

    expect(result).toEqual({ type: "error", message: "Unknown error" });
  });

  test("returns null for different session ID", () => {
    const backend = getBackend();
    const ctx = createContext("my-session");

    const result = backend.translateEvent(
      {
        type: "session.error",
        properties: {
          sessionID: "other-session",
          error: { data: { message: "Error" } },
        },
      },
      ctx
    );

    expect(result).toBeNull();
  });
});

// ==========================================================================
// translateEvent — permission.asked
// ==========================================================================

describe("translateEvent: permission.asked", () => {
  test("emits permission.asked for matching session", () => {
    const backend = getBackend();
    const ctx = createContext();

    const result = backend.translateEvent(
      {
        type: "permission.asked",
        properties: {
          sessionID: "test-session",
          id: "perm-req-1",
          permission: "file.write",
          patterns: ["/tmp/*.txt"],
        },
      },
      ctx
    );

    expect(result).toEqual({
      type: "permission.asked",
      requestId: "perm-req-1",
      sessionId: "test-session",
      permission: "file.write",
      patterns: ["/tmp/*.txt"],
    });
  });

  test("returns null for different session ID", () => {
    const backend = getBackend();
    const ctx = createContext("my-session");

    const result = backend.translateEvent(
      {
        type: "permission.asked",
        properties: {
          sessionID: "other-session",
          id: "perm-req-1",
          permission: "file.write",
          patterns: [],
        },
      },
      ctx
    );

    expect(result).toBeNull();
  });

  test("uses defaults for missing permission and patterns", () => {
    const backend = getBackend();
    const ctx = createContext();

    const result = backend.translateEvent(
      {
        type: "permission.asked",
        properties: {
          sessionID: "test-session",
          id: "perm-req-2",
        },
      },
      ctx
    );

    expect(result).toEqual({
      type: "permission.asked",
      requestId: "perm-req-2",
      sessionId: "test-session",
      permission: "unknown",
      patterns: [],
    });
  });
});

// ==========================================================================
// translateEvent — question.asked
// ==========================================================================

describe("translateEvent: question.asked", () => {
  test("emits question.asked with full question data", () => {
    const backend = getBackend();
    const ctx = createContext();

    const result = backend.translateEvent(
      {
        type: "question.asked",
        properties: {
          sessionID: "test-session",
          id: "q-1",
          questions: [
            {
              question: "Which option?",
              header: "Choose one",
              options: [
                { label: "Option A", description: "First option" },
                { label: "Option B", description: "Second option" },
              ],
              multiple: true,
              custom: false,
            },
          ],
        },
      },
      ctx
    );

    expect(result).toEqual({
      type: "question.asked",
      requestId: "q-1",
      sessionId: "test-session",
      questions: [
        {
          question: "Which option?",
          header: "Choose one",
          options: [
            { label: "Option A", description: "First option" },
            { label: "Option B", description: "Second option" },
          ],
          multiple: true,
          custom: false,
        },
      ],
    });
  });

  test("returns null for different session ID", () => {
    const backend = getBackend();
    const ctx = createContext("my-session");

    const result = backend.translateEvent(
      {
        type: "question.asked",
        properties: {
          sessionID: "other-session",
          id: "q-1",
          questions: [],
        },
      },
      ctx
    );

    expect(result).toBeNull();
  });

  test("handles missing question fields with defaults", () => {
    const backend = getBackend();
    const ctx = createContext();

    const result = backend.translateEvent(
      {
        type: "question.asked",
        properties: {
          sessionID: "test-session",
          id: "q-2",
          // questions missing
        },
      },
      ctx
    ) as { type: string; questions: unknown[] };

    expect(result).not.toBeNull();
    expect(result.questions).toEqual([]);
  });
});

// ==========================================================================
// translateEvent — session.status
// ==========================================================================

describe("translateEvent: session.status", () => {
  test("emits session.status for idle", () => {
    const backend = getBackend();
    const ctx = createContext();

    const result = backend.translateEvent(
      {
        type: "session.status",
        properties: {
          sessionID: "test-session",
          status: { type: "idle" },
        },
      },
      ctx
    );

    expect(result).toEqual({
      type: "session.status",
      sessionId: "test-session",
      status: "idle",
      attempt: undefined,
      message: undefined,
    });
  });

  test("emits session.status for busy", () => {
    const backend = getBackend();
    const ctx = createContext();

    const result = backend.translateEvent(
      {
        type: "session.status",
        properties: {
          sessionID: "test-session",
          status: { type: "busy" },
        },
      },
      ctx
    );

    expect(result).toEqual({
      type: "session.status",
      sessionId: "test-session",
      status: "busy",
      attempt: undefined,
      message: undefined,
    });
  });

  test("emits session.status for retry with attempt and message", () => {
    const backend = getBackend();
    const ctx = createContext();

    const result = backend.translateEvent(
      {
        type: "session.status",
        properties: {
          sessionID: "test-session",
          status: { type: "retry", attempt: 3, message: "Rate limited, retrying..." },
        },
      },
      ctx
    );

    expect(result).toEqual({
      type: "session.status",
      sessionId: "test-session",
      status: "retry",
      attempt: 3,
      message: "Rate limited, retrying...",
    });
  });

  test("returns null for different session ID", () => {
    const backend = getBackend();
    const ctx = createContext("my-session");

    const result = backend.translateEvent(
      {
        type: "session.status",
        properties: {
          sessionID: "other-session",
          status: { type: "idle" },
        },
      },
      ctx
    );

    expect(result).toBeNull();
  });
});

// ==========================================================================
// translateEvent — todo.updated
// ==========================================================================

describe("translateEvent: todo.updated", () => {
  test("emits todo.updated with todo items", () => {
    const backend = getBackend();
    const ctx = createContext();

    const result = backend.translateEvent(
      {
        type: "todo.updated",
        properties: {
          sessionID: "test-session",
          todos: [
            { content: "Fix bug", status: "in_progress", priority: "high", id: "todo-1" },
            { content: "Write tests", status: "pending", priority: "medium", id: "todo-2" },
          ],
        },
      },
      ctx
    );

    expect(result).toEqual({
      type: "todo.updated",
      sessionId: "test-session",
      todos: [
        { content: "Fix bug", status: "in_progress", priority: "high", id: "todo-1" },
        { content: "Write tests", status: "pending", priority: "medium", id: "todo-2" },
      ],
    });
  });

  test("returns null for different session ID", () => {
    const backend = getBackend();
    const ctx = createContext("my-session");

    const result = backend.translateEvent(
      {
        type: "todo.updated",
        properties: {
          sessionID: "other-session",
          todos: [],
        },
      },
      ctx
    );

    expect(result).toBeNull();
  });

  test("handles empty todos list", () => {
    const backend = getBackend();
    const ctx = createContext();

    const result = backend.translateEvent(
      {
        type: "todo.updated",
        properties: {
          sessionID: "test-session",
          // todos missing
        },
      },
      ctx
    ) as { todos: unknown[] };

    expect(result).not.toBeNull();
    expect(result.todos).toEqual([]);
  });
});

// ==========================================================================
// translateEvent — unknown event types
// ==========================================================================

describe("translateEvent: unknown event types", () => {
  test("returns null for unhandled event types", () => {
    const backend = getBackend();
    const ctx = createContext();

    const result = backend.translateEvent(
      {
        type: "some.unknown.event",
        properties: {},
      },
      ctx
    );

    expect(result).toBeNull();
  });
});

// ==========================================================================
// mapSession
// ==========================================================================

describe("mapSession", () => {
  test("maps OpenCode session to AgentSession", () => {
    const backend = getBackend();

    const result = backend.mapSession({
      id: "session-abc",
      title: "My Session",
      time: { created: 1707580800000 },
    });

    expect(result.id).toBe("session-abc");
    expect(result.title).toBe("My Session");
    expect(result.createdAt).toBe(new Date(1707580800000).toISOString());
  });

  test("handles session without title", () => {
    const backend = getBackend();

    const result = backend.mapSession({
      id: "session-xyz",
      time: { created: 1707580800000 },
    });

    expect(result.id).toBe("session-xyz");
    expect(result.title).toBeUndefined();
    expect(result.createdAt).toContain("2024-02-");
  });
});

// ==========================================================================
// mapResponse
// ==========================================================================

describe("mapResponse", () => {
  test("maps response with text parts", () => {
    const backend = getBackend();

    const result = backend.mapResponse({
      info: {
        id: "resp-1",
        tokens: { input: 100, output: 50 },
      },
      parts: [
        { type: "text", text: "Hello " },
        { type: "text", text: "world!" },
      ],
    });

    expect(result.id).toBe("resp-1");
    expect(result.content).toBe("Hello world!");
    expect(result.parts).toEqual([
      { type: "text", text: "Hello " },
      { type: "text", text: "world!" },
    ]);
    expect(result.usage).toEqual({ inputTokens: 100, outputTokens: 50 });
  });

  test("maps response with completed tool parts", () => {
    const backend = getBackend();

    const result = backend.mapResponse({
      info: {
        id: "resp-2",
        tokens: { input: 200, output: 100 },
      },
      parts: [
        {
          type: "tool",
          tool: "bash",
          state: { status: "completed", output: "file1.txt\nfile2.txt" },
        },
      ],
    });

    expect(result.parts).toEqual([
      { type: "tool_result", toolName: "bash", toolOutput: "file1.txt\nfile2.txt" },
    ]);
  });

  test("maps response with running tool parts as tool_call", () => {
    const backend = getBackend();

    const result = backend.mapResponse({
      info: {
        id: "resp-3",
        tokens: { input: 50, output: 25 },
      },
      parts: [
        {
          type: "tool",
          tool: "read_file",
          state: { status: "running", input: { path: "/tmp/file.txt" } },
        },
      ],
    });

    expect(result.parts).toEqual([
      { type: "tool_call", toolName: "read_file", toolInput: { path: "/tmp/file.txt" } },
    ]);
  });

  test("maps response with mixed parts", () => {
    const backend = getBackend();

    const result = backend.mapResponse({
      info: {
        id: "resp-4",
        tokens: { input: 300, output: 150 },
      },
      parts: [
        { type: "text", text: "Let me check the file. " },
        {
          type: "tool",
          tool: "read_file",
          state: { status: "completed", output: "contents" },
        },
        { type: "text", text: "The file contains: contents" },
      ],
    });

    expect(result.content).toBe("Let me check the file. The file contains: contents");
    expect(result.parts.length).toBe(3);
    expect(result.parts[0]!.type).toBe("text");
    expect(result.parts[1]!.type).toBe("tool_result");
    expect(result.parts[2]!.type).toBe("text");
  });

  test("maps response with empty parts", () => {
    const backend = getBackend();

    const result = backend.mapResponse({
      info: {
        id: "resp-5",
        tokens: { input: 10, output: 0 },
      },
      parts: [],
    });

    expect(result.id).toBe("resp-5");
    expect(result.content).toBe("");
    expect(result.parts).toEqual([]);
  });
});

// ==========================================================================
// translateEvent — full flow simulation
// ==========================================================================

describe("translateEvent: full message flow", () => {
  test("simulates a complete message lifecycle", () => {
    const backend = getBackend();
    const ctx = createContext();

    // 1. message.start
    const start = backend.translateEvent(
      {
        type: "message.updated",
        properties: {
          info: { sessionID: "test-session", role: "assistant", id: "msg-1" },
        },
      },
      ctx
    );
    expect(start).toEqual({ type: "message.start", messageId: "msg-1" });

    // 2. Text deltas
    const delta1 = backend.translateEvent(
      {
        type: "message.part.updated",
        properties: {
          part: { sessionID: "test-session", type: "text", id: "p-1" },
          delta: "Let me ",
        },
      },
      ctx
    );
    expect(delta1).toEqual({ type: "message.delta", content: "Let me " });

    const delta2 = backend.translateEvent(
      {
        type: "message.part.updated",
        properties: {
          part: { sessionID: "test-session", type: "text", id: "p-1" },
          delta: "run a command.",
        },
      },
      ctx
    );
    expect(delta2).toEqual({ type: "message.delta", content: "run a command." });

    // 3. Tool call starts
    const toolStart = backend.translateEvent(
      {
        type: "message.part.updated",
        properties: {
          part: {
            sessionID: "test-session",
            type: "tool",
            id: "tool-1",
            tool: "bash",
            state: { status: "running", input: { command: "ls" } },
          },
        },
      },
      ctx
    );
    expect(toolStart).toEqual({ type: "tool.start", toolName: "bash", input: { command: "ls" } });

    // 4. Tool completes
    const toolComplete = backend.translateEvent(
      {
        type: "message.part.updated",
        properties: {
          part: {
            sessionID: "test-session",
            type: "tool",
            id: "tool-1",
            tool: "bash",
            state: { status: "completed", output: "file1.txt\nfile2.txt" },
          },
        },
      },
      ctx
    );
    expect(toolComplete).toEqual({ type: "tool.complete", toolName: "bash", output: "file1.txt\nfile2.txt" });

    // 5. Duplicate message.updated should be filtered
    const dupMsg = backend.translateEvent(
      {
        type: "message.updated",
        properties: {
          info: { sessionID: "test-session", role: "assistant", id: "msg-1" },
        },
      },
      ctx
    );
    expect(dupMsg).toBeNull();

    // 6. session.idle → message.complete
    const complete = backend.translateEvent(
      {
        type: "session.idle",
        properties: { sessionID: "test-session" },
      },
      ctx
    );
    expect(complete).toEqual({ type: "message.complete", content: "" });
  });

  test("handles multiple tool calls with deduplication", () => {
    const backend = getBackend();
    const ctx = createContext();

    // Tool 1 starts
    const t1Start = backend.translateEvent(
      {
        type: "message.part.updated",
        properties: {
          part: {
            sessionID: "test-session",
            type: "tool",
            id: "tool-A",
            tool: "read_file",
            state: { status: "running", input: { path: "/a.txt" } },
          },
        },
      },
      ctx
    );
    expect(t1Start!.type).toBe("tool.start");

    // Tool 1 running again (duplicate)
    const t1Dup = backend.translateEvent(
      {
        type: "message.part.updated",
        properties: {
          part: {
            sessionID: "test-session",
            type: "tool",
            id: "tool-A",
            tool: "read_file",
            state: { status: "running", input: { path: "/a.txt" } },
          },
        },
      },
      ctx
    );
    expect(t1Dup).toBeNull();

    // Tool 2 starts (different tool)
    const t2Start = backend.translateEvent(
      {
        type: "message.part.updated",
        properties: {
          part: {
            sessionID: "test-session",
            type: "tool",
            id: "tool-B",
            tool: "write_file",
            state: { status: "running", input: { path: "/b.txt", content: "hello" } },
          },
        },
      },
      ctx
    );
    expect(t2Start!.type).toBe("tool.start");

    // Tool 1 completes
    const t1Done = backend.translateEvent(
      {
        type: "message.part.updated",
        properties: {
          part: {
            sessionID: "test-session",
            type: "tool",
            id: "tool-A",
            tool: "read_file",
            state: { status: "completed", output: "contents" },
          },
        },
      },
      ctx
    );
    expect(t1Done!.type).toBe("tool.complete");

    // Tool 1 completed again (duplicate)
    const t1DoneDup = backend.translateEvent(
      {
        type: "message.part.updated",
        properties: {
          part: {
            sessionID: "test-session",
            type: "tool",
            id: "tool-A",
            tool: "read_file",
            state: { status: "completed", output: "contents" },
          },
        },
      },
      ctx
    );
    expect(t1DoneDup).toBeNull();
  });
});
