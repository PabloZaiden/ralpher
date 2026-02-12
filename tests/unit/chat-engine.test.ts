/**
 * Unit tests for LoopEngine chat mode behavior.
 * Tests single-turn execution, chat prompt building, stop pattern skipping,
 * and chat message injection (both while running and while idle).
 */

import { test, expect, describe, beforeEach, afterEach } from "bun:test";
import { mkdtemp, rm, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import {
  LoopEngine,
  type LoopBackend,
} from "../../src/core/loop-engine";
import { SimpleEventEmitter } from "../../src/core/event-emitter";
import type { Loop, LoopConfig, LoopState } from "../../src/types/loop";
import { DEFAULT_LOOP_CONFIG } from "../../src/types/loop";
import type { LoopEvent } from "../../src/types/events";
import type {
  AgentSession,
  AgentEvent,
  BackendConnectionConfig,
  CreateSessionOptions,
  PromptInput,
} from "../../src/backends/types";
import { createEventStream, type EventStream } from "../../src/utils/event-stream";
import { GitService } from "../../src/core/git-service";
import { TestCommandExecutor } from "../mocks/mock-executor";
import { backendManager } from "../../src/core/backend-manager";

describe("LoopEngine - Chat Mode", () => {
  let testDir: string;
  let mockBackend: LoopBackend;
  let emitter: SimpleEventEmitter<LoopEvent>;
  let emittedEvents: LoopEvent[];
  let gitService: GitService;

  /**
   * Create a mock backend that supports async streaming.
   * Tracks prompts sent for assertion.
   */
  function createMockBackend(responses: string[]): LoopBackend & { sentPrompts: PromptInput[] } {
    let responseIndex = 0;
    let connected = false;
    let pendingResponse: string | null = null;
    const sentPrompts: PromptInput[] = [];

    const backend: LoopBackend & { sentPrompts: PromptInput[] } = {
      sentPrompts,

      async connect(_config: BackendConnectionConfig): Promise<void> {
        connected = true;
      },

      async disconnect(): Promise<void> {
        connected = false;
      },

      isConnected(): boolean {
        return connected;
      },

      async createSession(options: CreateSessionOptions): Promise<AgentSession> {
        return {
          id: `session-${Date.now()}`,
          title: options.title,
          createdAt: new Date().toISOString(),
        };
      },

      async sendPrompt(_sessionId: string, _prompt: PromptInput) {
        const content = responses[responseIndex] ?? "Default response";
        responseIndex++;
        return {
          id: `msg-${Date.now()}`,
          content,
          parts: [{ type: "text" as const, text: content }],
        };
      },

      async sendPromptAsync(_sessionId: string, prompt: PromptInput): Promise<void> {
        sentPrompts.push(prompt);
        const content = responses[responseIndex] ?? "Default response";
        responseIndex++;
        pendingResponse = content;
      },

      async abortSession(_sessionId: string): Promise<void> {
        // Mark as aborted
      },

      async subscribeToEvents(_sessionId: string): Promise<EventStream<AgentEvent>> {
        const { stream, push, end } = createEventStream<AgentEvent>();

        (async () => {
          // Wait for sendPromptAsync to set pendingResponse
          let attempts = 0;
          while (pendingResponse === null && attempts < 100) {
            await new Promise((resolve) => setTimeout(resolve, 10));
            attempts++;
          }

          const content = pendingResponse;
          pendingResponse = null;

          if (content !== null) {
            push({ type: "message.start", messageId: `msg-${Date.now()}` });
            push({ type: "message.delta", content });
            push({ type: "message.complete", content });
          }
          end();
        })();

        return stream;
      },

      async replyToPermission(_requestId: string, _response: string): Promise<void> {
        // No-op
      },

      async replyToQuestion(_requestId: string, _answers: string[][]): Promise<void> {
        // No-op
      },
    };

    return backend;
  }

  function createChatLoop(overrides?: Partial<LoopConfig>): Loop {
    const config: LoopConfig = {
      id: "test-chat-123",
      name: "test-chat",
      directory: testDir,
      prompt: "Hello, how are you?",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      workspaceId: "test-workspace-id",
      model: { providerID: "test-provider", modelID: "test-model" },
      stopPattern: "<promise>COMPLETE</promise>$",
      git: { branchPrefix: "ralph/", commitPrefix: "[Ralph]" },
      maxIterations: 1,
      maxConsecutiveErrors: 10,
      activityTimeoutSeconds: DEFAULT_LOOP_CONFIG.activityTimeoutSeconds,
      clearPlanningFolder: false,
      planMode: false,
      mode: "chat",
      ...overrides,
    };

    const state: LoopState = {
      id: config.id,
      status: "idle",
      currentIteration: 0,
      recentIterations: [],
      logs: [],
      messages: [],
      toolCalls: [],
      todos: [],
    };

    return { config, state };
  }

  beforeEach(async () => {
    testDir = await mkdtemp(join(tmpdir(), "chat-engine-test-"));
    emittedEvents = [];
    emitter = new SimpleEventEmitter<LoopEvent>();
    emitter.subscribe((event) => emittedEvents.push(event));

    const executor = new TestCommandExecutor();
    gitService = new GitService(executor);

    backendManager.setExecutorFactoryForTesting(() => new TestCommandExecutor());
    backendManager.enableTestMode();

    await Bun.$`git init`.cwd(testDir).quiet();
    await Bun.$`git config user.email "test@test.com"`.cwd(testDir).quiet();
    await Bun.$`git config user.name "Test User"`.cwd(testDir).quiet();
    await writeFile(join(testDir, ".gitkeep"), "");
    await Bun.$`git add .`.cwd(testDir).quiet();
    await Bun.$`git commit -m "Initial commit"`.cwd(testDir).quiet();
  });

  afterEach(async () => {
    backendManager.resetForTesting();
    await rm(testDir, { recursive: true });
  });

  test("isChatMode returns true for chat mode loops", () => {
    const loop = createChatLoop();
    mockBackend = createMockBackend([]);

    const engine = new LoopEngine({
      loop,
      backend: mockBackend,
      gitService,
      eventEmitter: emitter,
    });

    expect(engine.isChatMode).toBe(true);
  });

  test("isChatMode returns false for loop mode loops", () => {
    const loop = createChatLoop({ mode: "loop" });
    mockBackend = createMockBackend([]);

    const engine = new LoopEngine({
      loop,
      backend: mockBackend,
      gitService,
      eventEmitter: emitter,
    });

    expect(engine.isChatMode).toBe(false);
  });

  test("chat mode runs exactly one iteration and completes", async () => {
    const loop = createChatLoop();
    mockBackend = createMockBackend([
      "Here is my response to your question.",
    ]);

    const engine = new LoopEngine({
      loop,
      backend: mockBackend,
      gitService,
      eventEmitter: emitter,
    });

    await engine.start();

    expect(engine.state.status).toBe("completed");
    expect(engine.state.currentIteration).toBe(1);

    // Should have exactly 1 iteration
    const iterationStartEvents = emittedEvents.filter((e) => e.type === "loop.iteration.start");
    expect(iterationStartEvents.length).toBe(1);

    const completedEvents = emittedEvents.filter((e) => e.type === "loop.completed");
    expect(completedEvents.length).toBe(1);
  });

  test("chat mode completes even when response contains COMPLETE pattern", async () => {
    // In chat mode, stop pattern detection is skipped entirely.
    // The outcome is always "complete" after one iteration, regardless of content.
    const loop = createChatLoop();
    mockBackend = createMockBackend([
      "Done! <promise>COMPLETE</promise>",
    ]);

    const engine = new LoopEngine({
      loop,
      backend: mockBackend,
      gitService,
      eventEmitter: emitter,
    });

    await engine.start();

    expect(engine.state.status).toBe("completed");
    expect(engine.state.currentIteration).toBe(1);
  });

  test("chat mode does not auto-iterate even with maxIterations > 1", async () => {
    // Even if maxIterations allows more, chat mode stops after 1
    const loop = createChatLoop({ maxIterations: 10 });
    mockBackend = createMockBackend([
      "First response",
      "Second response (should not be reached)",
    ]);

    const engine = new LoopEngine({
      loop,
      backend: mockBackend,
      gitService,
      eventEmitter: emitter,
    });

    await engine.start();

    expect(engine.state.status).toBe("completed");
    expect(engine.state.currentIteration).toBe(1);
  });

  test("chat prompt includes working directory context on first message", async () => {
    const loop = createChatLoop({ prompt: "What files are here?" });
    const backend = createMockBackend(["Here are your files..."]);
    mockBackend = backend;

    const engine = new LoopEngine({
      loop,
      backend: mockBackend,
      gitService,
      eventEmitter: emitter,
    });

    await engine.start();

    // The first prompt sent should include the working directory context
    expect(backend.sentPrompts.length).toBeGreaterThanOrEqual(1);
    const firstPromptText = backend.sentPrompts[0]!.parts[0]!.text;
    expect(firstPromptText).toContain("You are working in directory:");
    expect(firstPromptText).toContain("What files are here?");
  });

  test("chat prompt does NOT include planning instructions", async () => {
    const loop = createChatLoop({ prompt: "Help me with this bug" });
    const backend = createMockBackend(["Fixed the bug."]);
    mockBackend = backend;

    const engine = new LoopEngine({
      loop,
      backend: mockBackend,
      gitService,
      eventEmitter: emitter,
    });

    await engine.start();

    expect(backend.sentPrompts.length).toBeGreaterThanOrEqual(1);
    const firstPromptText = backend.sentPrompts[0]!.parts[0]!.text;

    // Should NOT contain loop-mode planning instructions
    expect(firstPromptText).not.toContain(".planning/plan.md");
    expect(firstPromptText).not.toContain("<promise>COMPLETE</promise>");
    expect(firstPromptText).not.toContain("never ask for input");
    expect(firstPromptText).not.toContain("PLAN_READY");
    expect(firstPromptText).not.toContain("Read AGENTS.md");
  });

  test("chat prompt uses pendingPrompt when set", async () => {
    const loop = createChatLoop({ prompt: "Initial prompt" });
    loop.state.pendingPrompt = "Follow-up question";
    const backend = createMockBackend(["Answer to follow-up."]);
    mockBackend = backend;

    const engine = new LoopEngine({
      loop,
      backend: mockBackend,
      gitService,
      eventEmitter: emitter,
    });

    await engine.start();

    const firstPromptText = backend.sentPrompts[0]!.parts[0]!.text;
    expect(firstPromptText).toContain("Follow-up question");

    // pendingPrompt should be cleared after use
    expect(engine.state.pendingPrompt).toBeUndefined();
  });

  test("chat prompt supports model override via pendingModel", async () => {
    const loop = createChatLoop();
    const backend = createMockBackend(["Response with custom model."]);
    mockBackend = backend;

    const engine = new LoopEngine({
      loop,
      backend: mockBackend,
      gitService,
      eventEmitter: emitter,
    });

    // Set pending model before start
    engine.setPendingModel({ providerID: "anthropic", modelID: "claude-3-opus" });

    await engine.start();

    // The prompt should have used the overridden model
    expect(backend.sentPrompts.length).toBeGreaterThanOrEqual(1);
    const usedModel = backend.sentPrompts[0]!.model;
    expect(usedModel?.providerID).toBe("anthropic");
    expect(usedModel?.modelID).toBe("claude-3-opus");

    // pendingModel should be cleared after use
    expect(engine.state.pendingModel).toBeUndefined();
  });

  test("injectChatMessage while running aborts and re-iterates", async () => {
    const loop = createChatLoop();

    // Create a controllable backend
    let sendPromptAsyncCalled = false;
    let abortCalled = false;
    let resolveEvents: (() => void) | undefined;
    const sentPrompts: PromptInput[] = [];

    const baseMock = createMockBackend([]);
    mockBackend = {
      ...baseMock,
      async sendPromptAsync(_sessionId: string, prompt: PromptInput): Promise<void> {
        sentPrompts.push(prompt);
        sendPromptAsyncCalled = true;
      },
      async abortSession(): Promise<void> {
        abortCalled = true;
        // Resolve the waiting events to let the iteration finish
        if (resolveEvents) resolveEvents();
      },
      async subscribeToEvents(): Promise<EventStream<AgentEvent>> {
        const { stream, push, end } = createEventStream<AgentEvent>();

        (async () => {
          // Wait for external signal or abort
          await new Promise<void>((resolve) => {
            resolveEvents = resolve;
          });

          // After abort/resolve, emit a minimal response
          push({ type: "message.start", messageId: `msg-${Date.now()}` });
          push({ type: "message.delta", content: "Interrupted" });
          push({ type: "message.complete", content: "Interrupted" });
          end();
        })();

        return stream;
      },
    };

    const engine = new LoopEngine({
      loop,
      backend: mockBackend,
      gitService,
      eventEmitter: emitter,
    });

    // Start the engine (will block waiting for resolveEvents)
    const startPromise = engine.start();

    // Wait for the prompt to be sent
    while (!sendPromptAsyncCalled) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }

    // Inject a chat message while running
    await engine.injectChatMessage("New follow-up message");

    // The abort should have been called
    expect(abortCalled).toBe(true);

    // Wait for start to complete
    await startPromise;

    // The pending prompt should have been consumed by the second iteration
    // (chat mode runs 1 iteration per turn, so after injection we get another iteration)
    expect(engine.state.status).toBe("completed");
  }, 10000);

  test("injectChatMessage while idle starts new chat turn", async () => {
    const loop = createChatLoop();
    const backend = createMockBackend([
      "First response",
      "Second response to follow-up",
    ]);
    mockBackend = backend;

    const engine = new LoopEngine({
      loop,
      backend: mockBackend,
      gitService,
      eventEmitter: emitter,
    });

    // Run first turn
    await engine.start();
    expect(engine.state.status).toBe("completed");
    expect(engine.state.currentIteration).toBe(1);

    // Now inject a message while idle — this should start a new turn
    await engine.injectChatMessage("Follow-up question");

    // Wait for the new turn to complete (fire-and-forget pattern)
    let attempts = 0;
    while (engine.state.currentIteration < 1 || engine.state.status === "running" || engine.state.status === "starting") {
      await new Promise((resolve) => setTimeout(resolve, 50));
      attempts++;
      if (attempts > 100) {
        throw new Error("Timed out waiting for chat turn to complete");
      }
    }

    // Should have completed the second turn
    expect(engine.state.status).toBe("completed");
    // The turn resets currentIteration, so it should be 1 (one iteration per turn)
    expect(engine.state.currentIteration).toBe(1);

    // The second prompt should contain the follow-up question
    const secondPromptText = backend.sentPrompts[1]?.parts[0]?.text;
    expect(secondPromptText).toContain("Follow-up question");
  }, 10000);

  test("injectChatMessage with model override applies the model", async () => {
    const loop = createChatLoop();
    const backend = createMockBackend([
      "First response",
      "Response with new model",
    ]);
    mockBackend = backend;

    const engine = new LoopEngine({
      loop,
      backend: mockBackend,
      gitService,
      eventEmitter: emitter,
    });

    // Run first turn
    await engine.start();
    expect(engine.state.status).toBe("completed");

    // Inject with model override
    await engine.injectChatMessage("Use a different model", {
      providerID: "openai",
      modelID: "gpt-4o",
    });

    // Wait for turn to complete
    let attempts = 0;
    while (engine.state.status === "running" || engine.state.status === "starting" || engine.state.status === "stopped") {
      await new Promise((resolve) => setTimeout(resolve, 50));
      attempts++;
      if (attempts > 100) {
        throw new Error("Timed out waiting for chat turn to complete");
      }
    }

    expect(engine.state.status).toBe("completed");

    // The second prompt should use the overridden model
    const secondPrompt = backend.sentPrompts[1];
    expect(secondPrompt?.model?.providerID).toBe("openai");
    expect(secondPrompt?.model?.modelID).toBe("gpt-4o");
  }, 10000);

  test("chat mode emits user log for injected chat message", async () => {
    const loop = createChatLoop({ prompt: "Initial message" });
    // Set pendingPrompt to simulate an injected follow-up message
    loop.state.pendingPrompt = "What is TypeScript?";
    mockBackend = createMockBackend(["TypeScript is a typed superset of JavaScript."]);

    const engine = new LoopEngine({
      loop,
      backend: mockBackend,
      gitService,
      eventEmitter: emitter,
    });

    await engine.start();

    // Check that a user-level log was emitted with the chat message
    const logEvents = emittedEvents.filter(
      (e) => e.type === "loop.log" && "level" in e && e.level === "user"
    );
    expect(logEvents.length).toBeGreaterThanOrEqual(1);
  });

  test("loop mode still auto-iterates normally (regression check)", async () => {
    // Ensure loop mode behavior is unchanged
    const config: LoopConfig = {
      id: "test-loop-regression",
      name: "test-loop",
      directory: testDir,
      prompt: "Do something",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      workspaceId: "test-workspace-id",
      model: { providerID: "test-provider", modelID: "test-model" },
      stopPattern: "<promise>COMPLETE</promise>$",
      git: { branchPrefix: "ralph/", commitPrefix: "[Ralph]" },
      maxIterations: 5,
      maxConsecutiveErrors: 10,
      activityTimeoutSeconds: DEFAULT_LOOP_CONFIG.activityTimeoutSeconds,
      clearPlanningFolder: false,
      planMode: false,
      mode: "loop",
    };

    const state: LoopState = {
      id: config.id,
      status: "idle",
      currentIteration: 0,
      recentIterations: [],
      logs: [],
      messages: [],
      toolCalls: [],
      todos: [],
    };

    const loop: Loop = { config, state };
    mockBackend = createMockBackend([
      "Working...",
      "Still working...",
      "Done! <promise>COMPLETE</promise>",
    ]);

    const engine = new LoopEngine({
      loop,
      backend: mockBackend,
      gitService,
      eventEmitter: emitter,
    });

    await engine.start();

    // Loop mode should auto-iterate until stop pattern
    expect(engine.state.status).toBe("completed");
    expect(engine.state.currentIteration).toBe(3);
  });
});
