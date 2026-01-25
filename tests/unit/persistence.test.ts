/**
 * Unit tests for persistence layer.
 */

import { test, expect, describe, beforeEach, afterEach } from "bun:test";
import { mkdtemp, rm } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";

// We need to set the env var before importing the module
let testDataDir: string;

describe("Persistence", () => {
  beforeEach(async () => {
    // Create a temp directory for each test
    testDataDir = await mkdtemp(join(tmpdir(), "ralpher-test-"));
    process.env["RALPHER_DATA_DIR"] = testDataDir;
  });

  afterEach(async () => {
    // Close the database before cleaning up
    const { closeDatabase } = await import("../../src/persistence/database");
    closeDatabase();

    // Clean up
    delete process.env["RALPHER_DATA_DIR"];
    await rm(testDataDir, { recursive: true });
  });

  describe("paths", () => {
    test("getDataDir returns env var when set", async () => {
      // Re-import to get fresh module with env var
      const { getDataDir } = await import("../../src/persistence/paths");
      expect(getDataDir()).toBe(testDataDir);
    });

    test("getDatabasePath returns correct path", async () => {
      const { getDatabasePath } = await import("../../src/persistence/paths");
      expect(getDatabasePath()).toBe(join(testDataDir, "ralpher.db"));
    });

    test("ensureDataDirectories creates database", async () => {
      const { ensureDataDirectories, isDataDirectoryReady } = await import("../../src/persistence/paths");

      await ensureDataDirectories();

      const ready = await isDataDirectoryReady();
      expect(ready).toBe(true);
    });
  });

  describe("loops", () => {
    test("saveLoop and loadLoop work correctly", async () => {
      const { ensureDataDirectories } = await import("../../src/persistence/paths");
      const { saveLoop, loadLoop } = await import("../../src/persistence/loops");

      await ensureDataDirectories();

      const testLoop = {
        config: {
          id: "test-loop-123",
          name: "Test Loop",
          directory: "/tmp/test",
          prompt: "Do something",
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          stopPattern: "<promise>COMPLETE</promise>$",
          git: { branchPrefix: "ralph/", commitPrefix: "[Ralph]" },
        },
        state: {
          id: "test-loop-123",
          status: "idle" as const,
          currentIteration: 0,
          recentIterations: [],
        },
      };

      await saveLoop(testLoop);
      const loaded = await loadLoop("test-loop-123");

      expect(loaded).not.toBeNull();
      expect(loaded!.config.name).toBe("Test Loop");
      expect(loaded!.state.status).toBe("idle");
    });

    test("loadLoop returns null for non-existent loop", async () => {
      const { ensureDataDirectories } = await import("../../src/persistence/paths");
      const { loadLoop } = await import("../../src/persistence/loops");

      await ensureDataDirectories();

      const loaded = await loadLoop("non-existent");
      expect(loaded).toBeNull();
    });

    test("deleteLoop removes the loop", async () => {
      const { ensureDataDirectories } = await import("../../src/persistence/paths");
      const { saveLoop, loadLoop, deleteLoop } = await import("../../src/persistence/loops");

      await ensureDataDirectories();

      const testLoop = {
        config: {
          id: "delete-me",
          name: "Delete Me",
          directory: "/tmp/test",
          prompt: "Test",
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          stopPattern: "<promise>COMPLETE</promise>$",
          git: { branchPrefix: "ralph/", commitPrefix: "[Ralph]" },
        },
        state: {
          id: "delete-me",
          status: "idle" as const,
          currentIteration: 0,
          recentIterations: [],
        },
      };

      await saveLoop(testLoop);
      expect(await loadLoop("delete-me")).not.toBeNull();

      const deleted = await deleteLoop("delete-me");
      expect(deleted).toBe(true);
      expect(await loadLoop("delete-me")).toBeNull();
    });

    test("listLoops returns all loops", async () => {
      const { ensureDataDirectories } = await import("../../src/persistence/paths");
      const { saveLoop, listLoops } = await import("../../src/persistence/loops");

      await ensureDataDirectories();

      // Save two loops
      const loop1 = {
        config: {
          id: "loop-1",
          name: "Loop 1",
          directory: "/tmp/1",
          prompt: "Test 1",
          createdAt: "2024-01-01T00:00:00Z",
          updatedAt: "2024-01-01T00:00:00Z",
          stopPattern: "<promise>COMPLETE</promise>$",
          git: { branchPrefix: "ralph/", commitPrefix: "[Ralph]" },
        },
        state: {
          id: "loop-1",
          status: "idle" as const,
          currentIteration: 0,
          recentIterations: [],
        },
      };

      const loop2 = {
        config: {
          id: "loop-2",
          name: "Loop 2",
          directory: "/tmp/2",
          prompt: "Test 2",
          createdAt: "2024-01-02T00:00:00Z",
          updatedAt: "2024-01-02T00:00:00Z",
          stopPattern: "<promise>COMPLETE</promise>$",
          git: { branchPrefix: "ralph/", commitPrefix: "[Ralph]" },
        },
        state: {
          id: "loop-2",
          status: "running" as const,
          currentIteration: 3,
          recentIterations: [],
        },
      };

      await saveLoop(loop1);
      await saveLoop(loop2);

      const loops = await listLoops();
      expect(loops.length).toBe(2);

      // Should be sorted by createdAt, newest first
      expect(loops[0]!.config.id).toBe("loop-2");
      expect(loops[1]!.config.id).toBe("loop-1");
    });
  });
});
