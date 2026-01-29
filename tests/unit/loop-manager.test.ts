/**
 * Unit tests for LoopManager.
 */

import { test, expect, describe, beforeEach, afterEach } from "bun:test";
import { mkdtemp, rm } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { LoopManager } from "../../src/core/loop-manager";
import { SimpleEventEmitter } from "../../src/core/event-emitter";
import type { LoopEvent } from "../../src/types/events";
import { updateLoopState } from "../../src/persistence/loops";

describe("LoopManager", () => {
  let testDataDir: string;
  let testWorkDir: string;
  let manager: LoopManager;
  let emitter: SimpleEventEmitter<LoopEvent>;
  let emittedEvents: LoopEvent[];

  beforeEach(async () => {
    // Create temp directories
    testDataDir = await mkdtemp(join(tmpdir(), "ralpher-manager-test-data-"));
    testWorkDir = await mkdtemp(join(tmpdir(), "ralpher-manager-test-work-"));

    // Set env var for persistence
    process.env["RALPHER_DATA_DIR"] = testDataDir;

    // Ensure data directories exist
    const { ensureDataDirectories } = await import("../../src/persistence/paths");
    await ensureDataDirectories();

    // Set up event emitter
    emittedEvents = [];
    emitter = new SimpleEventEmitter<LoopEvent>();
    emitter.subscribe((event) => emittedEvents.push(event));

    // Create manager
    manager = new LoopManager({
      eventEmitter: emitter,
    });
  });

  afterEach(async () => {
    // Shutdown manager
    await manager.shutdown();

    // Clean up
    delete process.env["RALPHER_DATA_DIR"];
    await rm(testDataDir, { recursive: true });
    await rm(testWorkDir, { recursive: true });
  });

  describe("createLoop", () => {
    test("creates a new loop with defaults", async () => {
      const loop = await manager.createLoop({
        directory: testWorkDir,
        prompt: "Do something",
      });

      expect(loop.config.id).toBeDefined();
      expect(loop.config.directory).toBe(testWorkDir);
      expect(loop.config.prompt).toBe("Do something");
      // Backend is now global, not per-loop config
      expect(loop.config.git.branchPrefix).toBe("ralph/");
      expect(loop.state.status).toBe("idle");

      // Check event was emitted
      const createEvents = emittedEvents.filter((e) => e.type === "loop.created");
      expect(createEvents.length).toBe(1);
    });

    test("creates a loop with custom options", async () => {
      const loop = await manager.createLoop({
        directory: testWorkDir,
        prompt: "Custom task",
        // Backend options removed - now global
        maxIterations: 10,
      });

      // Backend is now global, not per-loop config
      expect(loop.config.maxIterations).toBe(10);
    });
  });

  describe("getLoop", () => {
    test("returns a loop by ID", async () => {
      const created = await manager.createLoop({
        directory: testWorkDir,
        prompt: "Test",
      });

      const fetched = await manager.getLoop(created.config.id);

      expect(fetched).not.toBeNull();
    });

    test("returns null for non-existent loop", async () => {
      const fetched = await manager.getLoop("non-existent-id");
      expect(fetched).toBeNull();
    });
  });

  describe("getAllLoops", () => {
    test("returns all loops", async () => {
      await manager.createLoop({
        directory: testWorkDir,
        prompt: "Test 1",
      });

      await manager.createLoop({
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
        directory: testWorkDir,
        prompt: "Original prompt",
      });

      const updated = await manager.updateLoop(loop.config.id, {
        prompt: "Updated prompt",
      });

      expect(updated).not.toBeNull();
      expect(updated!.config.prompt).toBe("Updated prompt");
    });

    test("rejects baseBranch update when git state exists", async () => {
      const loop = await manager.createLoop({
        directory: testWorkDir,
        prompt: "Test",
      });

      await updateLoopState(loop.config.id, {
        ...loop.state,
        git: {
          originalBranch: "main",
          workingBranch: "ralph/test",
          commits: [],
        },
      });

      await expect(
        manager.updateLoop(loop.config.id, {
          baseBranch: "develop",
        })
      ).rejects.toMatchObject({
        code: "BASE_BRANCH_IMMUTABLE",
        status: 409,
      });
    });

    test("allows baseBranch update when git state is undefined", async () => {
      const loop = await manager.createLoop({
        directory: testWorkDir,
        prompt: "Test",
      });

      const updated = await manager.updateLoop(loop.config.id, {
        baseBranch: "develop",
      });

      expect(updated).not.toBeNull();
      expect(updated!.config.baseBranch).toBe("develop");
    });
  
    test("returns null for non-existent loop", async () => {
      const updated = await manager.updateLoop("non-existent", { prompt: "Test" });
      expect(updated).toBeNull();
    });
  });

  describe("deleteLoop", () => {
    test("soft-deletes a loop (marks as deleted)", async () => {
      const loop = await manager.createLoop({
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

  describe("markMerged", () => {
    test("requires loop to be in final state", async () => {
      // Create a loop in idle state (not a final state)
      const loop = await manager.createLoop({
        directory: testWorkDir,
        prompt: "Test",
      });

      const result = await manager.markMerged(loop.config.id);
      
      expect(result.success).toBe(false);
      expect(result.error).toContain("Cannot mark loop as merged");
      expect(result.error).toContain("idle");
    });

    test("requires loop to have git state", async () => {
      // Create a loop and set it to a final state without git
      const loop = await manager.createLoop({
        directory: testWorkDir,
        prompt: "Test",
      });

      // Manually update the state to a final state without git
      await updateLoopState(loop.config.id, {
        ...loop.state,
        status: "completed",
        // No git state
      });

      const result = await manager.markMerged(loop.config.id);
      
      expect(result.success).toBe(false);
      expect(result.error).toContain("No git branch");
    });

    test("returns error for non-existent loop", async () => {
      const result = await manager.markMerged("non-existent-id");
      
      expect(result.success).toBe(false);
      expect(result.error).toContain("not found");
    });

    // Note: Success case for markMerged requires real git operations and is tested
    // in e2e/git-workflow.test.ts which verifies:
    // - Loop status becomes "deleted"
    // - Working branch is deleted
    // - Repository switches to original branch
    // - loop.deleted event is emitted
  });

  describe("isRunning", () => {
    test("returns false for non-running loop", async () => {
      const loop = await manager.createLoop({
        directory: testWorkDir,
        prompt: "Test",
      });

      expect(manager.isRunning(loop.config.id)).toBe(false);
    });
  });

  describe("clearPlanningFolder option", () => {
    test("creates a loop with clearPlanningFolder = true", async () => {
      const loop = await manager.createLoop({
        directory: testWorkDir,
        prompt: "Task with clearing",
        clearPlanningFolder: true,
      });

      expect(loop.config.clearPlanningFolder).toBe(true);
    });

    test("creates a loop with clearPlanningFolder = false", async () => {
      const loop = await manager.createLoop({
        directory: testWorkDir,
        prompt: "Task without clearing",
        clearPlanningFolder: false,
      });

      expect(loop.config.clearPlanningFolder).toBe(false);
    });

    test("creates a loop with clearPlanningFolder defaulting to false", async () => {
      const loop = await manager.createLoop({
        directory: testWorkDir,
        prompt: "Task with default",
      });

      // After persistence, clearPlanningFolder defaults to false (not undefined)
      expect(loop.config.clearPlanningFolder).toBe(false);
    });

    test("clearPlanningFolder is persisted correctly", async () => {
      const created = await manager.createLoop({
        directory: testWorkDir,
        prompt: "Test persistence",
        clearPlanningFolder: true,
      });

      // Fetch the loop to verify persistence
      const fetched = await manager.getLoop(created.config.id);

      expect(fetched).not.toBeNull();
      expect(fetched!.config.clearPlanningFolder).toBe(true);
    });
  });
});
