/**
 * Unit tests for LoopManager.
 */

import { test, expect, describe, beforeEach, afterEach } from "bun:test";
import { mkdtemp, rm, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { LoopManager } from "../../src/core/loop-manager";
import { SimpleEventEmitter } from "../../src/core/event-emitter";
import { GitService } from "../../src/core/git-service";
import { backendRegistry } from "../../src/backends/registry";
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

describe("LoopManager", () => {
  let testDataDir: string;
  let testWorkDir: string;
  let manager: LoopManager;
  let emitter: SimpleEventEmitter<LoopEvent>;
  let emittedEvents: LoopEvent[];
  let git: GitService;

  // Create a mock backend that completes immediately
  function createMockBackend(): AgentBackend {
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
        return {
          id: `msg-${Date.now()}`,
          content: "<promise>COMPLETE</promise>",
          parts: [{ type: "text", text: "<promise>COMPLETE</promise>" }],
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

  beforeEach(async () => {
    // Create temp directories
    testDataDir = await mkdtemp(join(tmpdir(), "ralpher-manager-test-data-"));
    testWorkDir = await mkdtemp(join(tmpdir(), "ralpher-manager-test-work-"));

    // Set env var for persistence
    process.env.RALPHER_DATA_DIR = testDataDir;

    // Ensure data directories exist
    const { ensureDataDirectories } = await import("../../src/persistence/paths");
    await ensureDataDirectories();

    // Set up event emitter
    emittedEvents = [];
    emitter = new SimpleEventEmitter<LoopEvent>();
    emitter.subscribe((event) => emittedEvents.push(event));

    git = new GitService();

    // Register mock backend
    backendRegistry.register("opencode", createMockBackend);

    // Create manager
    manager = new LoopManager({
      gitService: git,
      eventEmitter: emitter,
    });
  });

  afterEach(async () => {
    // Shutdown manager
    await manager.shutdown();

    // Clean up
    delete process.env.RALPHER_DATA_DIR;
    await rm(testDataDir, { recursive: true });
    await rm(testWorkDir, { recursive: true });

    // Clear registry
    await backendRegistry.clear();
  });

  describe("createLoop", () => {
    test("creates a new loop with defaults", async () => {
      const loop = await manager.createLoop({
        name: "Test Loop",
        directory: testWorkDir,
        prompt: "Do something",
      });

      expect(loop.config.id).toBeDefined();
      expect(loop.config.name).toBe("Test Loop");
      expect(loop.config.directory).toBe(testWorkDir);
      expect(loop.config.prompt).toBe("Do something");
      expect(loop.config.backend.type).toBe("opencode");
      expect(loop.config.backend.mode).toBe("spawn");
      expect(loop.config.git.branchPrefix).toBe("ralph/");
      expect(loop.state.status).toBe("idle");

      // Check event was emitted
      const createEvents = emittedEvents.filter((e) => e.type === "loop.created");
      expect(createEvents.length).toBe(1);
    });

    test("creates a loop with custom options", async () => {
      const loop = await manager.createLoop({
        name: "Custom Loop",
        directory: testWorkDir,
        prompt: "Custom task",
        backendMode: "connect",
        backendHostname: "localhost",
        backendPort: 8080,
        maxIterations: 10,
      });

      expect(loop.config.backend.mode).toBe("connect");
      expect(loop.config.backend.hostname).toBe("localhost");
      expect(loop.config.backend.port).toBe(8080);
      expect(loop.config.maxIterations).toBe(10);
    });
  });

  describe("getLoop", () => {
    test("returns a loop by ID", async () => {
      const created = await manager.createLoop({
        name: "Get Test",
        directory: testWorkDir,
        prompt: "Test",
      });

      const fetched = await manager.getLoop(created.config.id);

      expect(fetched).not.toBeNull();
      expect(fetched!.config.name).toBe("Get Test");
    });

    test("returns null for non-existent loop", async () => {
      const fetched = await manager.getLoop("non-existent-id");
      expect(fetched).toBeNull();
    });
  });

  describe("getAllLoops", () => {
    test("returns all loops", async () => {
      await manager.createLoop({
        name: "Loop 1",
        directory: testWorkDir,
        prompt: "Test 1",
      });

      await manager.createLoop({
        name: "Loop 2",
        directory: testWorkDir,
        prompt: "Test 2",
      });

      const loops = await manager.getAllLoops();

      expect(loops.length).toBe(2);
    });
  });

  describe("updateLoop", () => {
    test("updates loop configuration", async () => {
      const loop = await manager.createLoop({
        name: "Original Name",
        directory: testWorkDir,
        prompt: "Original prompt",
      });

      const updated = await manager.updateLoop(loop.config.id, {
        name: "Updated Name",
        prompt: "Updated prompt",
      });

      expect(updated).not.toBeNull();
      expect(updated!.config.name).toBe("Updated Name");
      expect(updated!.config.prompt).toBe("Updated prompt");
    });

    test("returns null for non-existent loop", async () => {
      const updated = await manager.updateLoop("non-existent", { name: "Test" });
      expect(updated).toBeNull();
    });
  });

  describe("deleteLoop", () => {
    test("soft-deletes a loop (marks as deleted)", async () => {
      const loop = await manager.createLoop({
        name: "To Delete",
        directory: testWorkDir,
        prompt: "Test",
      });

      const deleted = await manager.deleteLoop(loop.config.id);
      expect(deleted).toBe(true);

      // Soft delete: loop still exists but with status "deleted"
      const fetched = await manager.getLoop(loop.config.id);
      expect(fetched).not.toBeNull();
      expect(fetched!.state.status).toBe("deleted");

      // Check delete event
      const deleteEvents = emittedEvents.filter((e) => e.type === "loop.deleted");
      expect(deleteEvents.length).toBe(1);
    });

    test("purges a deleted loop", async () => {
      const loop = await manager.createLoop({
        name: "To Purge",
        directory: testWorkDir,
        prompt: "Test",
      });

      // First soft delete
      await manager.deleteLoop(loop.config.id);
      
      // Then purge
      const purgeResult = await manager.purgeLoop(loop.config.id);
      expect(purgeResult.success).toBe(true);

      // Now it should be actually gone
      const fetched = await manager.getLoop(loop.config.id);
      expect(fetched).toBeNull();
    });

    test("cannot purge a non-deleted/non-merged loop", async () => {
      const loop = await manager.createLoop({
        name: "Cannot Purge",
        directory: testWorkDir,
        prompt: "Test",
      });

      const purgeResult = await manager.purgeLoop(loop.config.id);
      expect(purgeResult.success).toBe(false);
      expect(purgeResult.error).toContain("Cannot purge loop in status");
    });

    test("returns false for non-existent loop", async () => {
      const deleted = await manager.deleteLoop("non-existent");
      expect(deleted).toBe(false);
    });
  });

  describe("isRunning", () => {
    test("returns false for non-running loop", async () => {
      const loop = await manager.createLoop({
        name: "Not Running",
        directory: testWorkDir,
        prompt: "Test",
      });

      expect(manager.isRunning(loop.config.id)).toBe(false);
    });
  });
});
