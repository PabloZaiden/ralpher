/**
 * Unit tests for persistence layer.
 */

import { test, expect, describe, beforeEach, afterEach } from "bun:test";
import { mkdtemp, rm } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import type { Loop, LoopStatus } from "../../src/types/loop";

// We need to set the env var before importing the module
let testDataDir: string;
const testWorkspaceId = "test-workspace-id";

/**
 * Helper to ensure data directories and create test workspace.
 */
async function setupPersistence(): Promise<void> {
  const { ensureDataDirectories } = await import("../../src/persistence/paths");
  const { createWorkspace } = await import("../../src/persistence/workspaces");
  
  await ensureDataDirectories();
  
  // Create the test workspace (required for loops with workspaceId)
  await createWorkspace({
    id: testWorkspaceId,
    name: "Test Workspace",
    directory: "/tmp/test",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });
}

/**
 * Helper function to create a test loop with all required fields.
 */
function createTestLoop(overrides: {
  id: string;
  name?: string;
  directory?: string;
  prompt?: string;
  status?: LoopStatus;
  currentIteration?: number;
  createdAt?: string;
}): Loop {
  const now = new Date().toISOString();
  return {
    config: {
      id: overrides.id,
      name: overrides.name ?? overrides.id,
      directory: overrides.directory ?? "/tmp/test",
      prompt: overrides.prompt ?? "Test",
      createdAt: overrides.createdAt ?? now,
      updatedAt: now,
      workspaceId: "test-workspace-id",
      stopPattern: "<promise>COMPLETE</promise>$",
      git: { branchPrefix: "ralph/", commitPrefix: "[Ralph]" },
      maxIterations: Infinity,
      maxConsecutiveErrors: 10,
      activityTimeoutSeconds: 180,
      clearPlanningFolder: false,
      planMode: false,
    },
    state: {
      id: overrides.id,
      status: overrides.status ?? "idle",
      currentIteration: overrides.currentIteration ?? 0,
      recentIterations: [],
      logs: [],
      messages: [],
      toolCalls: [],
      todos: [],
    },
  };
}

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
      const { getDataDir } = await import("../../src/persistence/database");
      expect(getDataDir()).toBe(testDataDir);
    });

    test("getDatabasePath returns correct path", async () => {
      const { getDatabasePath } = await import("../../src/persistence/database");
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
      const { saveLoop, loadLoop } = await import("../../src/persistence/loops");

      await setupPersistence();

      const testLoop = createTestLoop({
        id: "test-loop-123",
        name: "test-loop",
        prompt: "Do something",
      });

      await saveLoop(testLoop);
      const loaded = await loadLoop("test-loop-123");

      expect(loaded).not.toBeNull();
      expect(loaded!.state.status).toBe("idle");
    });

    test("loadLoop returns null for non-existent loop", async () => {
      const { loadLoop } = await import("../../src/persistence/loops");

      await setupPersistence();

      const loaded = await loadLoop("non-existent");
      expect(loaded).toBeNull();
    });

    test("deleteLoop removes the loop", async () => {
      const { saveLoop, loadLoop, deleteLoop } = await import("../../src/persistence/loops");

      await setupPersistence();

      const testLoop = createTestLoop({ id: "delete-me" });

      await saveLoop(testLoop);
      expect(await loadLoop("delete-me")).not.toBeNull();

      const deleted = await deleteLoop("delete-me");
      expect(deleted).toBe(true);
      expect(await loadLoop("delete-me")).toBeNull();
    });

    test("listLoops returns all loops", async () => {
      const { saveLoop, listLoops } = await import("../../src/persistence/loops");

      await setupPersistence();

      // Save two loops
      const loop1 = createTestLoop({
        id: "loop-1",
        directory: "/tmp/1",
        prompt: "Test 1",
        createdAt: "2024-01-01T00:00:00Z",
      });

      const loop2 = createTestLoop({
        id: "loop-2",
        directory: "/tmp/2",
        prompt: "Test 2",
        status: "running",
        currentIteration: 3,
        createdAt: "2024-01-02T00:00:00Z",
      });

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
        const { getActiveLoopByDirectory } = await import("../../src/persistence/loops");

        await setupPersistence();

        const result = await getActiveLoopByDirectory("/tmp/test");
        expect(result).toBeNull();
      });

      test("returns null when only draft loops exist for directory", async () => {
        const { saveLoop, getActiveLoopByDirectory } = await import("../../src/persistence/loops");

        await setupPersistence();

        const draftLoop = createTestLoop({ id: "draft-loop", status: "draft" });
        await saveLoop(draftLoop);

        const result = await getActiveLoopByDirectory("/tmp/test");
        expect(result).toBeNull();
      });

      test("returns null when only terminal state loops exist for directory", async () => {
        const { saveLoop, getActiveLoopByDirectory } = await import("../../src/persistence/loops");

        await setupPersistence();

        const terminalStatuses: LoopStatus[] = ["completed", "stopped", "failed", "max_iterations", "merged", "pushed", "deleted"];

        for (let i = 0; i < terminalStatuses.length; i++) {
          const loop = createTestLoop({
            id: `terminal-loop-${i}`,
            status: terminalStatuses[i],
          });
          await saveLoop(loop);
        }

        const result = await getActiveLoopByDirectory("/tmp/test");
        expect(result).toBeNull();
      });

      test("returns the active loop when one exists", async () => {
        const { saveLoop, getActiveLoopByDirectory, deleteLoop } = await import("../../src/persistence/loops");

        await setupPersistence();

        const activeStatuses: LoopStatus[] = ["idle", "planning", "starting", "running", "waiting"];

        for (const status of activeStatuses) {
          const testLoop = createTestLoop({
            id: `active-loop-${status}`,
            directory: `/tmp/active-test-${status}`,
            status,
          });

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
        const { saveLoop, getActiveLoopByDirectory } = await import("../../src/persistence/loops");

        await setupPersistence();

        // Save a running loop in a different directory
        const otherDirLoop = createTestLoop({
          id: "other-dir-loop",
          directory: "/tmp/other-dir",
          status: "running",
        });

        await saveLoop(otherDirLoop);

        // Query for a different directory
        const result = await getActiveLoopByDirectory("/tmp/my-dir");
        expect(result).toBeNull();
      });

      test("returns the active loop even when other loops exist for same directory", async () => {
        const { saveLoop, getActiveLoopByDirectory } = await import("../../src/persistence/loops");

        await setupPersistence();

        // Save a draft loop
        const draftLoop = createTestLoop({
          id: "draft-loop",
          directory: "/tmp/multi-test",
          status: "draft",
        });
        await saveLoop(draftLoop);

        // Save a completed loop
        const completedLoop = createTestLoop({
          id: "completed-loop",
          directory: "/tmp/multi-test",
          status: "completed",
          currentIteration: 5,
        });
        await saveLoop(completedLoop);

        // Save a running loop
        const runningLoop = createTestLoop({
          id: "running-loop",
          directory: "/tmp/multi-test",
          status: "running",
          currentIteration: 2,
        });
        await saveLoop(runningLoop);

        const result = await getActiveLoopByDirectory("/tmp/multi-test");
        expect(result).not.toBeNull();
        expect(result!.config.id).toBe("running-loop");
        expect(result!.state.status).toBe("running");
      });
    });

    describe("resetStaleLoops", () => {
      test("resets idle loops to stopped", async () => {
        const { saveLoop, loadLoop, resetStaleLoops } = await import("../../src/persistence/loops");

        await setupPersistence();

        const idleLoop = createTestLoop({
          id: "idle-loop",
          status: "idle",
        });
        await saveLoop(idleLoop);

        const resetCount = await resetStaleLoops();
        expect(resetCount).toBe(1);

        const loaded = await loadLoop("idle-loop");
        expect(loaded).not.toBeNull();
        expect(loaded!.state.status).toBe("stopped");
        expect(loaded!.state.error?.message).toBe("Forcefully stopped by connection reset");
      });

      test("resets running and waiting loops to stopped", async () => {
        const { saveLoop, loadLoop, resetStaleLoops } = await import("../../src/persistence/loops");

        await setupPersistence();

        const runningLoop = createTestLoop({
          id: "running-loop",
          directory: "/tmp/test-running",
          status: "running",
        });
        await saveLoop(runningLoop);

        const waitingLoop = createTestLoop({
          id: "waiting-loop",
          directory: "/tmp/test-waiting",
          status: "waiting",
        });
        await saveLoop(waitingLoop);

        const startingLoop = createTestLoop({
          id: "starting-loop",
          directory: "/tmp/test-starting",
          status: "starting",
        });
        await saveLoop(startingLoop);

        const resetCount = await resetStaleLoops();
        expect(resetCount).toBe(3);

        const loadedRunning = await loadLoop("running-loop");
        expect(loadedRunning!.state.status).toBe("stopped");

        const loadedWaiting = await loadLoop("waiting-loop");
        expect(loadedWaiting!.state.status).toBe("stopped");

        const loadedStarting = await loadLoop("starting-loop");
        expect(loadedStarting!.state.status).toBe("stopped");
      });

      test("does NOT reset planning loops", async () => {
        const { saveLoop, loadLoop, resetStaleLoops } = await import("../../src/persistence/loops");

        await setupPersistence();

        const planningLoop = createTestLoop({
          id: "planning-loop",
          status: "planning",
        });
        await saveLoop(planningLoop);

        const resetCount = await resetStaleLoops();
        expect(resetCount).toBe(0);

        const loaded = await loadLoop("planning-loop");
        expect(loaded).not.toBeNull();
        expect(loaded!.state.status).toBe("planning");
      });

      test("does NOT reset terminal state loops", async () => {
        const { saveLoop, loadLoop, resetStaleLoops } = await import("../../src/persistence/loops");

        await setupPersistence();

        const completedLoop = createTestLoop({
          id: "completed-loop",
          directory: "/tmp/test-completed",
          status: "completed",
        });
        await saveLoop(completedLoop);

        const stoppedLoop = createTestLoop({
          id: "stopped-loop",
          directory: "/tmp/test-stopped",
          status: "stopped",
        });
        await saveLoop(stoppedLoop);

        const failedLoop = createTestLoop({
          id: "failed-loop",
          directory: "/tmp/test-failed",
          status: "failed",
        });
        await saveLoop(failedLoop);

        const resetCount = await resetStaleLoops();
        expect(resetCount).toBe(0);

        const loadedCompleted = await loadLoop("completed-loop");
        expect(loadedCompleted!.state.status).toBe("completed");

        const loadedStopped = await loadLoop("stopped-loop");
        expect(loadedStopped!.state.status).toBe("stopped");

        const loadedFailed = await loadLoop("failed-loop");
        expect(loadedFailed!.state.status).toBe("failed");
      });

      test("returns 0 when no stale loops exist", async () => {
        const { resetStaleLoops } = await import("../../src/persistence/loops");

        await setupPersistence();

        const resetCount = await resetStaleLoops();
        expect(resetCount).toBe(0);
      });
    });
  });
});
