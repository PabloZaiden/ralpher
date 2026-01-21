/**
 * Unit tests for LoopEngine and StopPatternDetector.
 */

import { test, expect, describe, beforeEach, afterEach } from "bun:test";
import { mkdtemp, rm, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import {
  LoopEngine,
  StopPatternDetector,
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

// GitService is used in tests (referenced as type)
void GitService;

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

  // Create a mock backend that supports async streaming
  function createMockBackend(responses: string[]): AgentBackend {
    let responseIndex = 0;
    let connected = false;
    const sessions = new Map<string, AgentSession>();
    let pendingResponse: string | null = null;

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
        // Store the response for subscribeToEvents to yield
        const content = responses[responseIndex] ?? "Default response";
        responseIndex++;
        pendingResponse = content;
      },

      async abortSession(_sessionId: string): Promise<void> {
        // Mark as aborted
      },

      async *subscribeToEvents(_sessionId: string): AsyncIterable<AgentEvent> {
        // Yield events based on pendingResponse
        if (pendingResponse !== null) {
          const content = pendingResponse;
          pendingResponse = null;

          yield { type: "message.start", messageId: `msg-${Date.now()}` };
          yield { type: "message.delta", content };
          yield { type: "message.complete", content };
        }
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
      git: { branchPrefix: "ralph/", commitPrefix: "[Ralph]" },
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
    
    // Initialize git in the test directory (git is always required)
    await Bun.$`git init`.cwd(testDir).quiet();
    await Bun.$`git config user.email "test@test.com"`.cwd(testDir).quiet();
    await Bun.$`git config user.name "Test User"`.cwd(testDir).quiet();
    await writeFile(join(testDir, ".gitkeep"), "");
    await Bun.$`git add .`.cwd(testDir).quiet();
    await Bun.$`git commit -m "Initial commit"`.cwd(testDir).quiet();
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

    // Create a slow backend that we can control using async streaming
    let resolveEvents: (() => void) | undefined;
    let sendPromptAsyncCalled = false;

    const baseMock = createMockBackend([]);
    mockBackend = {
      ...baseMock,
      async sendPromptAsync(): Promise<void> {
        sendPromptAsyncCalled = true;
        // This just signals we're ready for events
      },
      async *subscribeToEvents(): AsyncIterable<AgentEvent> {
        // Wait for external signal before yielding events
        await new Promise<void>((resolve) => {
          resolveEvents = resolve;
        });
        yield { type: "message.start", messageId: `msg-${Date.now()}` };
        yield { type: "message.delta", content: "Still working..." };
        yield { type: "message.complete", content: "Still working..." };
      },
    };

    const engine = new LoopEngine({
      loop,
      backend: mockBackend,
      eventEmitter: emitter,
    });

    // Start in background
    const startPromise = engine.start();

    // Wait for sendPromptAsync to be called
    while (!sendPromptAsyncCalled) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }

    // Now stop the engine (this sets aborted flag)
    await engine.stop("Test stop");

    // Resolve the pending events so the loop can finish
    if (resolveEvents) resolveEvents();

    await startPromise;

    expect(engine.state.status).toBe("stopped");
  });

  test("completes on second iteration", async () => {
    // This test verifies that the engine correctly runs multiple iterations
    // and completes when the stop pattern is detected
    const loop = createTestLoop({ maxIterations: 5 });

    // Create a backend that completes on 2nd iteration using async streaming
    let responseCount = 0;

    const baseMock = createMockBackend([]);
    mockBackend = {
      ...baseMock,
      async sendPromptAsync(): Promise<void> {
        responseCount++;
      },
      async *subscribeToEvents(): AsyncIterable<AgentEvent> {
        // Complete on second iteration
        const content = responseCount >= 2 ? "<promise>COMPLETE</promise>" : "Working...";
        yield { type: "message.start", messageId: `msg-${Date.now()}` };
        yield { type: "message.delta", content };
        yield { type: "message.complete", content };
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
    // Set maxConsecutiveErrors to 1 so it fails after first error
    const loop = createTestLoop({ maxConsecutiveErrors: 1 });

    const baseMock = createMockBackend([]);
    mockBackend = {
      ...baseMock,
      async sendPromptAsync(): Promise<void> {
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

  test("continues to next iteration after error event from backend (error doesn't count towards max iterations)", async () => {
    // This test validates that when the backend emits an error event mid-stream,
    // the engine correctly continues to the next iteration instead of stopping.
    // Also validates that error iterations don't count towards maxIterations.
    const loop = createTestLoop({ maxIterations: 3, maxConsecutiveErrors: 3 });

    let iterationCount = 0;

    // Create a mock backend that:
    // - Iteration 1: starts responding, then emits an error
    // - Iteration 2: completes successfully with COMPLETE pattern
    const baseMock = createMockBackend([]);
    mockBackend = {
      ...baseMock,
      async sendPromptAsync(): Promise<void> {
        iterationCount++;
      },
      async *subscribeToEvents(): AsyncIterable<AgentEvent> {
        if (iterationCount === 1) {
          // First iteration: start responding, then error
          yield { type: "message.start", messageId: `msg-${Date.now()}` };
          yield { type: "message.delta", content: "Starting to work..." };
          // Now emit an error (simulating backend error like file not found)
          yield { type: "error", message: "Error: File not found: /some/file.ts" };
        } else if (iterationCount === 2) {
          // Second iteration: complete successfully
          yield { type: "message.start", messageId: `msg-${Date.now()}` };
          yield { type: "message.delta", content: "Fixed it! <promise>COMPLETE</promise>" };
          yield { type: "message.complete", content: "Fixed it! <promise>COMPLETE</promise>" };
        }
      },
    };

    const engine = new LoopEngine({
      loop,
      backend: mockBackend,
      eventEmitter: emitter,
    });

    // Add timeout to detect if the engine hangs
    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error("Test timed out - engine hung after error")), 5000);
    });

    await Promise.race([engine.start(), timeoutPromise]);

    // Should have completed successfully
    expect(engine.state.status).toBe("completed");
    
    // Error iteration doesn't count - only the successful one counts
    // So currentIteration should be 1, not 2
    expect(engine.state.currentIteration).toBe(1);

    // Check iteration summaries - still have 2 attempts recorded
    expect(engine.state.recentIterations.length).toBe(2);
    expect(engine.state.recentIterations[0]!.outcome).toBe("error");
    expect(engine.state.recentIterations[1]!.outcome).toBe("complete");

    // Check that error event was emitted for iteration 1
    const errorEvents = emittedEvents.filter((e) => e.type === "loop.error");
    expect(errorEvents.length).toBe(1);

    // Check that both iteration start events were emitted
    const iterationStartEvents = emittedEvents.filter((e) => e.type === "loop.iteration.start");
    expect(iterationStartEvents.length).toBe(2);
  }, 10000); // 10 second timeout for the test itself

  test("multiple errors don't count towards maxIterations limit", async () => {
    // If maxIterations is 2, and we have 3 errors followed by 2 successes,
    // we should hit maxIterations after 2 successful iterations, not fail early.
    const loop = createTestLoop({ maxIterations: 2, maxConsecutiveErrors: 10 });

    let attemptCount = 0;

    const baseMock = createMockBackend([]);
    mockBackend = {
      ...baseMock,
      async sendPromptAsync(): Promise<void> {
        attemptCount++;
      },
      async *subscribeToEvents(): AsyncIterable<AgentEvent> {
        if (attemptCount <= 3) {
          // First 3 attempts: emit errors
          yield { type: "message.start", messageId: `msg-${Date.now()}` };
          yield { type: "error", message: `Error attempt ${attemptCount}` };
        } else {
          // After that: success (no COMPLETE pattern, so it continues)
          yield { type: "message.start", messageId: `msg-${Date.now()}` };
          yield { type: "message.delta", content: "Success!" };
          yield { type: "message.complete", content: "Success!" };
        }
      },
    };

    const engine = new LoopEngine({
      loop,
      backend: mockBackend,
      eventEmitter: emitter,
    });

    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error("Test timed out")), 5000);
    });

    await Promise.race([engine.start(), timeoutPromise]);

    // Should have hit maxIterations after 2 successful iterations
    expect(engine.state.status).toBe("max_iterations");
    expect(engine.state.currentIteration).toBe(2);

    // Total attempts should be 5 (3 errors + 2 successes)
    expect(attemptCount).toBe(5);

    // recentIterations should have all 5 attempts
    expect(engine.state.recentIterations.length).toBe(5);
    expect(engine.state.recentIterations[0]!.outcome).toBe("error");
    expect(engine.state.recentIterations[1]!.outcome).toBe("error");
    expect(engine.state.recentIterations[2]!.outcome).toBe("error");
    expect(engine.state.recentIterations[3]!.outcome).toBe("continue");
    expect(engine.state.recentIterations[4]!.outcome).toBe("continue");
  }, 10000);

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

  test("setPendingPrompt updates state", async () => {
    const loop = createTestLoop({ maxIterations: 1 });

    const engine = new LoopEngine({
      loop,
      backend: mockBackend,
      eventEmitter: emitter,
    });

    // Set pending prompt
    engine.setPendingPrompt("New modified prompt");
    expect(engine.state.pendingPrompt).toBe("New modified prompt");

    // Clear pending prompt
    engine.clearPendingPrompt();
    expect(engine.state.pendingPrompt).toBeUndefined();
  });

  test("buildPrompt uses pendingPrompt and clears it after use", async () => {
    const loop = createTestLoop({ maxIterations: 2 });
    mockBackend = createMockBackend([
      "First iteration response",
      "<promise>COMPLETE</promise>",
    ]);

    const engine = new LoopEngine({
      loop,
      backend: mockBackend,
      eventEmitter: emitter,
    });

    // Set pending prompt before starting
    engine.setPendingPrompt("Modified goal for iteration 1");
    expect(engine.state.pendingPrompt).toBe("Modified goal for iteration 1");

    // Start the loop - first iteration should consume the pending prompt
    await engine.start();

    // After the loop completes, pending prompt should be cleared
    expect(engine.state.pendingPrompt).toBeUndefined();

    // Check that log events were emitted for pending prompt usage
    const pendingPromptLogs = emittedEvents.filter(
      (e) => e.type === "loop.log" && e.message.includes("pending prompt")
    );
    expect(pendingPromptLogs.length).toBeGreaterThan(0);
  });
});
