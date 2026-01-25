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
        name: "Test Loop",
        directory: testWorkDir,
        prompt: "Do something",
      });

      expect(loop.config.id).toBeDefined();
      expect(loop.config.name).toBe("Test Loop");
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
        name: "Custom Loop",
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

  describe("clearPlanningFolder option", () => {
    test("creates a loop with clearPlanningFolder = true", async () => {
      const loop = await manager.createLoop({
        name: "Clear Planning Loop",
        directory: testWorkDir,
        prompt: "Task with clearing",
        clearPlanningFolder: true,
      });

      expect(loop.config.clearPlanningFolder).toBe(true);
    });

    test("creates a loop with clearPlanningFolder = false", async () => {
      const loop = await manager.createLoop({
        name: "Keep Planning Loop",
        directory: testWorkDir,
        prompt: "Task without clearing",
        clearPlanningFolder: false,
      });

      expect(loop.config.clearPlanningFolder).toBe(false);
    });

    test("creates a loop with clearPlanningFolder undefined (default)", async () => {
      const loop = await manager.createLoop({
        name: "Default Planning Loop",
        directory: testWorkDir,
        prompt: "Task with default",
      });

      expect(loop.config.clearPlanningFolder).toBeUndefined();
    });

    test("clearPlanningFolder is persisted correctly", async () => {
      const created = await manager.createLoop({
        name: "Persisted Clear Planning",
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
