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
          name: "test-loop",
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
          name: "delete-me",
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
          name: "loop-1",
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
          name: "loop-2",
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

    describe("getActiveLoopByDirectory", () => {
      test("returns null when no loops exist for directory", async () => {
        const { ensureDataDirectories } = await import("../../src/persistence/paths");
        const { getActiveLoopByDirectory } = await import("../../src/persistence/loops");

        await ensureDataDirectories();

        const result = await getActiveLoopByDirectory("/tmp/test");
        expect(result).toBeNull();
      });

      test("returns null when only draft loops exist for directory", async () => {
        const { ensureDataDirectories } = await import("../../src/persistence/paths");
        const { saveLoop, getActiveLoopByDirectory } = await import("../../src/persistence/loops");

        await ensureDataDirectories();

        const draftLoop = {
          config: {
            id: "draft-loop",
            name: "draft-loop",
            directory: "/tmp/test",
            prompt: "Test",
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            stopPattern: "<promise>COMPLETE</promise>$",
            git: { branchPrefix: "ralph/", commitPrefix: "[Ralph]" },
          },
          state: {
            id: "draft-loop",
            status: "draft" as const,
            currentIteration: 0,
            recentIterations: [],
          },
        };

        await saveLoop(draftLoop);

        const result = await getActiveLoopByDirectory("/tmp/test");
        expect(result).toBeNull();
      });

      test("returns null when only terminal state loops exist for directory", async () => {
        const { ensureDataDirectories } = await import("../../src/persistence/paths");
        const { saveLoop, getActiveLoopByDirectory } = await import("../../src/persistence/loops");

        await ensureDataDirectories();

        const terminalStatuses = ["completed", "stopped", "failed", "max_iterations", "merged", "pushed", "deleted"] as const;

        for (let i = 0; i < terminalStatuses.length; i++) {
          await saveLoop({
            config: {
              id: `terminal-loop-${i}`,
              name: `terminal-loop-${i}`,
              directory: "/tmp/test",
              prompt: "Test",
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
              stopPattern: "<promise>COMPLETE</promise>$",
              git: { branchPrefix: "ralph/", commitPrefix: "[Ralph]" },
            },
            state: {
              id: `terminal-loop-${i}`,
              status: terminalStatuses[i]!,
              currentIteration: 0,
              recentIterations: [],
            },
          });
        }

        const result = await getActiveLoopByDirectory("/tmp/test");
        expect(result).toBeNull();
      });

      test("returns the active loop when one exists", async () => {
        const { ensureDataDirectories } = await import("../../src/persistence/paths");
        const { saveLoop, getActiveLoopByDirectory, deleteLoop } = await import("../../src/persistence/loops");

        await ensureDataDirectories();

        const activeStatuses = ["idle", "planning", "starting", "running", "waiting"] as const;

        for (const status of activeStatuses) {
          const testLoop = {
            config: {
              id: `active-loop-${status}`,
              name: `active-loop-${status}`,
              directory: `/tmp/active-test-${status}`,
              prompt: "Test",
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
              stopPattern: "<promise>COMPLETE</promise>$",
              git: { branchPrefix: "ralph/", commitPrefix: "[Ralph]" },
            },
            state: {
              id: `active-loop-${status}`,
              status: status,
              currentIteration: 0,
              recentIterations: [],
            },
          };

          await saveLoop(testLoop);

          const result = await getActiveLoopByDirectory(`/tmp/active-test-${status}`);
          expect(result).not.toBeNull();
          expect(result!.config.id).toBe(`active-loop-${status}`);
          expect(result!.state.status).toBe(status);

          // Clean up
          await deleteLoop(testLoop.config.id);
        }
      });

      test("does not return loops from different directories", async () => {
        const { ensureDataDirectories } = await import("../../src/persistence/paths");
        const { saveLoop, getActiveLoopByDirectory } = await import("../../src/persistence/loops");

        await ensureDataDirectories();

        // Save a running loop in a different directory
        const otherDirLoop = {
          config: {
            id: "other-dir-loop",
            name: "other-dir-loop",
            directory: "/tmp/other-dir",
            prompt: "Test",
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            stopPattern: "<promise>COMPLETE</promise>$",
            git: { branchPrefix: "ralph/", commitPrefix: "[Ralph]" },
          },
          state: {
            id: "other-dir-loop",
            status: "running" as const,
            currentIteration: 0,
            recentIterations: [],
          },
        };

        await saveLoop(otherDirLoop);

        // Query for a different directory
        const result = await getActiveLoopByDirectory("/tmp/my-dir");
        expect(result).toBeNull();
      });

      test("returns the active loop even when other loops exist for same directory", async () => {
        const { ensureDataDirectories } = await import("../../src/persistence/paths");
        const { saveLoop, getActiveLoopByDirectory } = await import("../../src/persistence/loops");

        await ensureDataDirectories();

        // Save a draft loop
        await saveLoop({
          config: {
            id: "draft-loop",
            name: "draft-loop",
            directory: "/tmp/multi-test",
            prompt: "Test",
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            stopPattern: "<promise>COMPLETE</promise>$",
            git: { branchPrefix: "ralph/", commitPrefix: "[Ralph]" },
          },
          state: {
            id: "draft-loop",
            status: "draft" as const,
            currentIteration: 0,
            recentIterations: [],
          },
        });

        // Save a completed loop
        await saveLoop({
          config: {
            id: "completed-loop",
            name: "completed-loop",
            directory: "/tmp/multi-test",
            prompt: "Test",
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            stopPattern: "<promise>COMPLETE</promise>$",
            git: { branchPrefix: "ralph/", commitPrefix: "[Ralph]" },
          },
          state: {
            id: "completed-loop",
            status: "completed" as const,
            currentIteration: 5,
            recentIterations: [],
          },
        });

        // Save a running loop
        await saveLoop({
          config: {
            id: "running-loop",
            name: "running-loop",
            directory: "/tmp/multi-test",
            prompt: "Test",
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            stopPattern: "<promise>COMPLETE</promise>$",
            git: { branchPrefix: "ralph/", commitPrefix: "[Ralph]" },
          },
          state: {
            id: "running-loop",
            status: "running" as const,
            currentIteration: 2,
            recentIterations: [],
          },
        });

        const result = await getActiveLoopByDirectory("/tmp/multi-test");
        expect(result).not.toBeNull();
        expect(result!.config.id).toBe("running-loop");
        expect(result!.state.status).toBe("running");
      });
    });
  });
});
