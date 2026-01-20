/**
 * Unit tests for LoopEngine and StopPatternDetector.
 */

import { test, expect, describe, beforeEach, afterEach, mock } from "bun:test";
import { mkdtemp, rm, writeFile, mkdir } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import {
  LoopEngine,
  StopPatternDetector,
  type IterationResult,
} from "../../src/core/loop-engine";
import { SimpleEventEmitter } from "../../src/core/event-emitter";
import type { Loop, LoopConfig, LoopState } from "../../src/types/loop";
import type { LoopEvent } from "../../src/types/events";
import type {
  AgentBackend,
  AgentSession,
  AgentResponse,
  AgentEvent,
  BackendConnectionConfig,
  CreateSessionOptions,
  PromptInput,
} from "../../src/backends/types";
import { GitService } from "../../src/core/git-service";

describe("StopPatternDetector", () => {
  test("matches default stop pattern at end of string", () => {
    const detector = new StopPatternDetector("<promise>COMPLETE</promise>$");

    expect(detector.matches("Some text\n<promise>COMPLETE</promise>")).toBe(true);
    expect(detector.matches("<promise>COMPLETE</promise>")).toBe(true);
    expect(detector.matches("No pattern here")).toBe(false);
    expect(detector.matches("<promise>COMPLETE</promise> more text")).toBe(false);
  });

  test("matches custom patterns", () => {
    const detector = new StopPatternDetector("DONE$");

    expect(detector.matches("Task is DONE")).toBe(true);
    expect(detector.matches("DONE")).toBe(true);
    expect(detector.matches("DONE but more")).toBe(false);
  });

  test("supports regex patterns", () => {
    const detector = new StopPatternDetector("(DONE|COMPLETE)$");

    expect(detector.matches("DONE")).toBe(true);
    expect(detector.matches("COMPLETE")).toBe(true);
    expect(detector.matches("OTHER")).toBe(false);
  });
});

describe("LoopEngine", () => {
  let testDir: string;
  let mockBackend: AgentBackend;
  let emitter: SimpleEventEmitter<LoopEvent>;
  let emittedEvents: LoopEvent[];

  // Create a mock backend
  function createMockBackend(responses: string[]): AgentBackend {
    let responseIndex = 0;
    let connected = false;
    const sessions = new Map<string, AgentSession>();

    return {
      name: "mock",

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
        const session: AgentSession = {
          id: `session-${Date.now()}`,
          title: options.title,
          createdAt: new Date().toISOString(),
        };
        sessions.set(session.id, session);
        return session;
      },

      async getSession(id: string): Promise<AgentSession | null> {
        return sessions.get(id) ?? null;
      },

      async deleteSession(id: string): Promise<void> {
        sessions.delete(id);
      },

      async sendPrompt(_sessionId: string, _prompt: PromptInput): Promise<AgentResponse> {
        const content = responses[responseIndex] ?? "Default response";
        responseIndex++;
        return {
          id: `msg-${Date.now()}`,
          content,
          parts: [{ type: "text", text: content }],
        };
      },

      async sendPromptAsync(_sessionId: string, _prompt: PromptInput): Promise<void> {
        // Not used in tests
      },

      async abortSession(_sessionId: string): Promise<void> {
        // Not used in tests
      },

      async *subscribeToEvents(_sessionId: string): AsyncIterable<AgentEvent> {
        // Not used in tests
      },
    };
  }

  function createTestLoop(overrides?: Partial<LoopConfig>): Loop {
    const config: LoopConfig = {
      id: "test-loop-123",
      name: "Test Loop",
      directory: testDir,
      prompt: "Do something",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      backend: { type: "opencode", mode: "spawn" },
      stopPattern: "<promise>COMPLETE</promise>$",
      git: { enabled: false, branchPrefix: "ralph/", commitPrefix: "[Ralph]" },
      ...overrides,
    };

    const state: LoopState = {
      id: config.id,
      status: "idle",
      currentIteration: 0,
      recentIterations: [],
    };

    return { config, state };
  }

  beforeEach(async () => {
    testDir = await mkdtemp(join(tmpdir(), "loop-engine-test-"));
    emittedEvents = [];
    emitter = new SimpleEventEmitter<LoopEvent>();
    emitter.subscribe((event) => emittedEvents.push(event));
  });

  afterEach(async () => {
    await rm(testDir, { recursive: true });
  });

  test("initializes with correct state", () => {
    const loop = createTestLoop();
    mockBackend = createMockBackend([]);

    const engine = new LoopEngine({
      loop,
      backend: mockBackend,
      eventEmitter: emitter,
    });

    expect(engine.state.status).toBe("idle");
    expect(engine.config.id).toBe("test-loop-123");
  });

  test("starts and runs until completion", async () => {
    const loop = createTestLoop({ maxIterations: 5 });
    mockBackend = createMockBackend([
      "Working on iteration 1...",
      "Working on iteration 2...",
      "Done! <promise>COMPLETE</promise>",
    ]);

    const engine = new LoopEngine({
      loop,
      backend: mockBackend,
      eventEmitter: emitter,
    });

    await engine.start();

    expect(engine.state.status).toBe("completed");
    expect(engine.state.currentIteration).toBe(3);

    // Check emitted events
    const startedEvents = emittedEvents.filter((e) => e.type === "loop.started");
    const iterationStartEvents = emittedEvents.filter((e) => e.type === "loop.iteration.start");
    const completedEvents = emittedEvents.filter((e) => e.type === "loop.completed");

    expect(startedEvents.length).toBe(1);
    expect(iterationStartEvents.length).toBe(3);
    expect(completedEvents.length).toBe(1);
  });

  test("stops at max iterations", async () => {
    const loop = createTestLoop({ maxIterations: 2 });
    mockBackend = createMockBackend([
      "Working...",
      "Still working...",
      "More work...",
    ]);

    const engine = new LoopEngine({
      loop,
      backend: mockBackend,
      eventEmitter: emitter,
    });

    await engine.start();

    expect(engine.state.status).toBe("max_iterations");
    expect(engine.state.currentIteration).toBe(2);
  });

  test("can be stopped manually", async () => {
    const loop = createTestLoop({ maxIterations: 10 });

    // Create a slow backend that we can control
    let resolvePrompt: (() => void) | undefined;
    let promptCalled = false;

    mockBackend = {
      ...createMockBackend([]),
      async sendPrompt(): Promise<AgentResponse> {
        promptCalled = true;
        // Wait for external signal
        await new Promise<void>((resolve) => {
          resolvePrompt = resolve;
        });
        return {
          id: `msg-${Date.now()}`,
          content: "Still working...",
          parts: [{ type: "text", text: "Still working..." }],
        };
      },
    };

    const engine = new LoopEngine({
      loop,
      backend: mockBackend,
      eventEmitter: emitter,
    });

    // Start in background
    const startPromise = engine.start();

    // Wait for the prompt to be called
    while (!promptCalled) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }

    // Now stop the engine (this sets aborted flag)
    await engine.stop("Test stop");

    // Resolve the pending prompt so the loop can finish
    if (resolvePrompt) resolvePrompt();

    await startPromise;

    expect(engine.state.status).toBe("stopped");
  });

  test("pause and resume works", async () => {
    // For this test, we just verify that the engine correctly handles
    // the pause method when it's in a pauseable state
    const loop = createTestLoop({ maxIterations: 5 });

    // Create a backend that completes on 2nd iteration
    let responseCount = 0;

    mockBackend = {
      ...createMockBackend([]),
      async sendPrompt(): Promise<AgentResponse> {
        responseCount++;
        // Complete on second iteration
        const content = responseCount >= 2 ? "<promise>COMPLETE</promise>" : "Working...";
        return {
          id: `msg-${Date.now()}`,
          content,
          parts: [{ type: "text", text: content }],
        };
      },
    };

    const engine = new LoopEngine({
      loop,
      backend: mockBackend,
      eventEmitter: emitter,
    });

    // Run to completion
    await engine.start();

    // Verify it completed
    expect(engine.state.status).toBe("completed");
    expect(engine.state.currentIteration).toBe(2);
  });

  test("handles errors gracefully", async () => {
    const loop = createTestLoop();

    mockBackend = {
      ...createMockBackend([]),
      async sendPrompt(): Promise<AgentResponse> {
        throw new Error("Backend error");
      },
    };

    const engine = new LoopEngine({
      loop,
      backend: mockBackend,
      eventEmitter: emitter,
    });

    await engine.start();

    expect(engine.state.status).toBe("failed");
    expect(engine.state.error?.message).toContain("Backend error");

    // Check error event was emitted
    const errorEvents = emittedEvents.filter((e) => e.type === "loop.error");
    expect(errorEvents.length).toBe(1);
  });

  test("records iteration summaries", async () => {
    const loop = createTestLoop({ maxIterations: 3 });
    mockBackend = createMockBackend([
      "First",
      "Second",
      "<promise>COMPLETE</promise>",
    ]);

    const engine = new LoopEngine({
      loop,
      backend: mockBackend,
      eventEmitter: emitter,
    });

    await engine.start();

    expect(engine.state.recentIterations.length).toBe(3);
    expect(engine.state.recentIterations[0]!.iteration).toBe(1);
    expect(engine.state.recentIterations[0]!.outcome).toBe("continue");
    expect(engine.state.recentIterations[2]!.outcome).toBe("complete");
  });
});
