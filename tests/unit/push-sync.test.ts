/**
 * Unit tests for the push-with-sync flow in LoopManager.
 * Tests the base branch sync behavior that happens before pushing:
 * - Already up to date: no merge needed
 * - Clean merge: base branch merged cleanly, then push
 * - Conflicts: conflict resolution engine started, auto-push on completion
 */

import { test, expect, describe } from "bun:test";
import { writeFile } from "fs/promises";
import { join } from "path";
import {
  setupTestContext,
  teardownTestContext,
  waitForEvent,
  waitForLoopStatus,
  testModelFields,
} from "../setup";
import type { TestContext } from "../setup";

const testWorkspaceId = "test-workspace-id";

/**
 * Helper: set up a bare remote, push the current branch, and return branch name + remote dir.
 */
async function setupRemote(ctx: TestContext): Promise<{ remoteDir: string; currentBranch: string }> {
  const remoteDir = join(ctx.dataDir, "remote-" + Date.now() + ".git");
  await Bun.$`git init --bare ${remoteDir}`.quiet();
  await Bun.$`git -C ${ctx.workDir} remote add origin ${remoteDir}`.quiet();
  const currentBranch = (await Bun.$`git -C ${ctx.workDir} branch --show-current`.text()).trim();
  await Bun.$`git -C ${ctx.workDir} push -u origin ${currentBranch}`.quiet();
  return { remoteDir, currentBranch };
}

/**
 * Helper: create and complete a loop, returning the loop object.
 */
async function createAndCompleteLoop(ctx: TestContext) {
  const loop = await ctx.manager.createLoop({
    ...testModelFields,
    directory: ctx.workDir,
    prompt: "Make changes",
    planMode: false,
    workspaceId: testWorkspaceId,
  });

  await ctx.manager.startLoop(loop.config.id);
  await waitForEvent(ctx.events, "loop.completed");

  return loop;
}

/**
 * Helper: add a commit to the remote via a second clone.
 * Used to simulate someone else pushing to the base branch.
 */
async function addRemoteCommit(
  remoteDir: string,
  files: Record<string, string>,
  message: string,
  dataDir: string,
): Promise<void> {
  const otherClone = join(dataDir, "other-clone-" + Date.now());
  try {
    await Bun.$`git clone ${remoteDir} ${otherClone}`.quiet();
    await Bun.$`git -C ${otherClone} config user.email "other@test.com"`.quiet();
    await Bun.$`git -C ${otherClone} config user.name "Other User"`.quiet();
    for (const [path, content] of Object.entries(files)) {
      await writeFile(join(otherClone, path), content);
    }
    await Bun.$`git -C ${otherClone} add -A`.quiet();
    await Bun.$`git -C ${otherClone} commit -m ${message}`.quiet();
    await Bun.$`git -C ${otherClone} push`.quiet();
  } finally {
    await Bun.$`rm -rf ${otherClone}`.quiet();
  }
}

describe("Push with Base Branch Sync", () => {
  describe("already up to date", () => {
    test("pushes immediately when base branch has no new commits", async () => {
      const ctx = await setupTestContext({
        initGit: true,
        initialFiles: { "test.txt": "Initial content" },
      });

      try {
        const { currentBranch: _currentBranch } = await setupRemote(ctx);
        const loop = await createAndCompleteLoop(ctx);

        // Push the loop — base branch hasn't changed, should be "already_up_to_date"
        const pushResult = await ctx.manager.pushLoop(loop.config.id);
        expect(pushResult.success).toBe(true);
        expect(pushResult.syncStatus).toBe("already_up_to_date");

        // Verify loop is in pushed state
        const pushedLoop = await ctx.manager.getLoop(loop.config.id);
        expect(pushedLoop).not.toBeNull();
        expect(pushedLoop!.state.status).toBe("pushed");
        expect(pushedLoop!.state.syncState).toBeUndefined();
        expect(pushedLoop!.state.reviewMode).toBeDefined();
        expect(pushedLoop!.state.reviewMode!.completionAction).toBe("push");

        // Verify sync events were emitted
        const syncStarted = ctx.events.find((e) => e.type === "loop.sync.started");
        expect(syncStarted).toBeDefined();
        const syncClean = ctx.events.find((e) => e.type === "loop.sync.clean");
        expect(syncClean).toBeDefined();
      } finally {
        await teardownTestContext(ctx);
      }
    });
  });

  describe("clean merge", () => {
    test("merges and pushes when base branch has non-conflicting changes", async () => {
      const ctx = await setupTestContext({
        initGit: true,
        initialFiles: { "test.txt": "Initial content" },
      });

      try {
        const { remoteDir } = await setupRemote(ctx);
        const loop = await createAndCompleteLoop(ctx);

        // Add a non-conflicting commit to the base branch on the remote
        // The loop's mock backend only responds with COMPLETE and doesn't create files,
        // so a new file on the remote won't conflict
        await addRemoteCommit(
          remoteDir,
          { "remote-only.txt": "Remote content\n" },
          "Non-conflicting remote commit",
          ctx.dataDir,
        );

        // Push the loop — should merge cleanly, then push
        const pushResult = await ctx.manager.pushLoop(loop.config.id);
        expect(pushResult.success).toBe(true);
        expect(pushResult.syncStatus).toBe("clean");

        // Verify loop is in pushed state
        const pushedLoop = await ctx.manager.getLoop(loop.config.id);
        expect(pushedLoop).not.toBeNull();
        expect(pushedLoop!.state.status).toBe("pushed");
        expect(pushedLoop!.state.syncState).toBeUndefined();

        // Verify sync events
        const syncStarted = ctx.events.find((e) => e.type === "loop.sync.started");
        expect(syncStarted).toBeDefined();
        const syncClean = ctx.events.find((e) => e.type === "loop.sync.clean");
        expect(syncClean).toBeDefined();
      } finally {
        await teardownTestContext(ctx);
      }
    });
  });

  describe("conflict resolution", () => {
    test("starts conflict resolution engine when merge conflicts exist", async () => {
      // Mock responses consumed in order:
      // Index 0: sendPrompt (name generation) → COMPLETE name
      // Index 1: subscribeToEvents (initial loop iteration) → COMPLETE
      // Index 2: subscribeToEvents (conflict resolution iteration) → COMPLETE
      const ctx = await setupTestContext({
        initGit: true,
        initialFiles: { "test.txt": "Initial content" },
        mockResponses: [
          "<promise>COMPLETE</promise>",
          "<promise>COMPLETE</promise>",
          "<promise>COMPLETE</promise>",
        ],
      });

      try {
        const { remoteDir } = await setupRemote(ctx);

        // Create loop
        const loop = await ctx.manager.createLoop({
          ...testModelFields,
          directory: ctx.workDir,
          prompt: "Modify test.txt",
          planMode: false,
          workspaceId: testWorkspaceId,
        });

        await ctx.manager.startLoop(loop.config.id);
        await waitForEvent(ctx.events, "loop.completed");

        // Get the worktree path for the loop
        const completedLoop = await ctx.manager.getLoop(loop.config.id);
        const worktreePath = completedLoop!.state.git!.worktreePath!;

        // Modify test.txt in the worktree (simulating what the loop engine would do)
        await writeFile(join(worktreePath, "test.txt"), "Modified by loop\n");
        await Bun.$`git -C ${worktreePath} add -A`.quiet();
        await Bun.$`git -C ${worktreePath} commit -m "Loop changes to test.txt"`.quiet();

        // Now add a conflicting commit to the base branch on the remote
        await addRemoteCommit(
          remoteDir,
          { "test.txt": "Modified by someone else\n" },
          "Conflicting remote commit to test.txt",
          ctx.dataDir,
        );

        // Push the loop — should detect conflicts and start resolution engine
        const pushResult = await ctx.manager.pushLoop(loop.config.id);
        expect(pushResult.success).toBe(true);
        expect(pushResult.syncStatus).toBe("conflicts_being_resolved");

        // Verify sync events
        const syncConflicts = ctx.events.find((e) => e.type === "loop.sync.conflicts");
        expect(syncConflicts).toBeDefined();

        // Verify syncState was set
        const conflictLoop = await ctx.manager.getLoop(loop.config.id);
        expect(conflictLoop).not.toBeNull();

        // The conflict resolution engine should have been started. 
        // With the mock backend, it will complete quickly and trigger auto-push.
        // Wait for the loop to reach "pushed" status (auto-push after resolution).
        const finalLoop = await waitForLoopStatus(ctx.manager, loop.config.id, ["pushed"], 10000);
        expect(finalLoop.state.status).toBe("pushed");
        expect(finalLoop.state.syncState).toBeUndefined();
        expect(finalLoop.state.reviewMode).toBeDefined();
        expect(finalLoop.state.reviewMode!.completionAction).toBe("push");

        // Verify loop.pushed event was emitted
        const pushedEvent = ctx.events.find((e) => e.type === "loop.pushed");
        expect(pushedEvent).toBeDefined();
      } finally {
        await teardownTestContext(ctx);
      }
    });

    test("does not auto-push when conflict resolution fails", async () => {
      // Mock responses consumed in order:
      // Index 0: sendPrompt (name generation) → COMPLETE name
      // Index 1: subscribeToEvents (initial loop iteration) → COMPLETE
      // Index 2: subscribeToEvents (conflict resolution iteration) → ERROR
      // With maxConsecutiveErrors: 1, a single error triggers failsafe → "failed" status
      const ctx = await setupTestContext({
        initGit: true,
        initialFiles: { "test.txt": "Initial content" },
        mockResponses: [
          "<promise>COMPLETE</promise>",
          "<promise>COMPLETE</promise>",
          "ERROR:Failed to resolve conflicts",
        ],
      });

      try {
        const { remoteDir } = await setupRemote(ctx);

        const loop = await ctx.manager.createLoop({
          ...testModelFields,
          directory: ctx.workDir,
          prompt: "Modify test.txt",
          planMode: false,
          workspaceId: testWorkspaceId,
          maxConsecutiveErrors: 1,
        });

        await ctx.manager.startLoop(loop.config.id);
        await waitForEvent(ctx.events, "loop.completed");

        // Get the worktree path and modify test.txt to create a conflict
        const completedLoop = await ctx.manager.getLoop(loop.config.id);
        const worktreePath = completedLoop!.state.git!.worktreePath!;

        await writeFile(join(worktreePath, "test.txt"), "Modified by loop\n");
        await Bun.$`git -C ${worktreePath} add -A`.quiet();
        await Bun.$`git -C ${worktreePath} commit -m "Loop changes"`.quiet();

        // Add conflicting commit to remote
        await addRemoteCommit(
          remoteDir,
          { "test.txt": "Conflicting remote\n" },
          "Conflicting remote commit",
          ctx.dataDir,
        );

        // Clear events for cleaner assertions
        ctx.events.length = 0;

        // Push — should start conflict resolution
        const pushResult = await ctx.manager.pushLoop(loop.config.id);
        expect(pushResult.success).toBe(true);
        expect(pushResult.syncStatus).toBe("conflicts_being_resolved");

        // Wait for the conflict resolution engine to fail
        const failedLoop = await waitForLoopStatus(
          ctx.manager,
          loop.config.id,
          ["failed"],
          10000,
        );
        expect(failedLoop.state.status).toBe("failed");

        // autoPushOnComplete should have been cleared
        expect(failedLoop.state.syncState?.autoPushOnComplete).toBe(false);

        // Verify NO loop.pushed event was emitted
        const pushedEvent = ctx.events.find((e) => e.type === "loop.pushed");
        expect(pushedEvent).toBeUndefined();
      } finally {
        await teardownTestContext(ctx);
      }
    });
  });

  describe("edge cases", () => {
    test("rejects push when loop is not in completed status", async () => {
      const ctx = await setupTestContext({
        initGit: true,
        initialFiles: { "test.txt": "content" },
      });

      try {
        await setupRemote(ctx);
        const loop = await ctx.manager.createLoop({
          ...testModelFields,
          directory: ctx.workDir,
          prompt: "Test",
          planMode: false,
          workspaceId: testWorkspaceId,
        });

        // Don't start the loop — it's still in "idle" status
        const pushResult = await ctx.manager.pushLoop(loop.config.id);
        expect(pushResult.success).toBe(false);
        expect(pushResult.error).toContain("Cannot push loop in status");
      } finally {
        await teardownTestContext(ctx);
      }
    });

    test("rejects push for non-existent loop", async () => {
      const ctx = await setupTestContext({ initGit: true });

      try {
        const pushResult = await ctx.manager.pushLoop("non-existent-id");
        expect(pushResult.success).toBe(false);
        expect(pushResult.error).toContain("not found");
      } finally {
        await teardownTestContext(ctx);
      }
    });

    test("syncState is cleared when jumpstarting a loop", async () => {
      // Mock responses consumed in order:
      // Index 0: sendPrompt (name generation) → COMPLETE name
      // Index 1: subscribeToEvents (initial loop iteration) → COMPLETE
      // Index 2: subscribeToEvents (conflict resolution iteration) → ERROR (fails with maxConsecutiveErrors: 1)
      // Index 3: subscribeToEvents (jumpstarted loop iteration) → COMPLETE
      const ctx = await setupTestContext({
        initGit: true,
        initialFiles: { "test.txt": "Initial content" },
        mockResponses: [
          "<promise>COMPLETE</promise>",
          "<promise>COMPLETE</promise>",
          "ERROR:Failed to resolve conflicts",
          "<promise>COMPLETE</promise>",
        ],
      });

      try {
        const { remoteDir } = await setupRemote(ctx);

        const loop = await ctx.manager.createLoop({
          ...testModelFields,
          directory: ctx.workDir,
          prompt: "Modify test.txt",
          planMode: false,
          workspaceId: testWorkspaceId,
          maxConsecutiveErrors: 1,
        });

        await ctx.manager.startLoop(loop.config.id);
        await waitForEvent(ctx.events, "loop.completed");

        // Create a conflict scenario
        const completedLoop = await ctx.manager.getLoop(loop.config.id);
        const worktreePath = completedLoop!.state.git!.worktreePath!;

        await writeFile(join(worktreePath, "test.txt"), "Modified by loop\n");
        await Bun.$`git -C ${worktreePath} add -A`.quiet();
        await Bun.$`git -C ${worktreePath} commit -m "Loop changes"`.quiet();

        await addRemoteCommit(
          remoteDir,
          { "test.txt": "Conflicting remote\n" },
          "Conflicting commit",
          ctx.dataDir,
        );

        // Push to trigger conflict resolution (which will fail)
        await ctx.manager.pushLoop(loop.config.id);

        // Wait for the conflict resolution to fail
        await waitForLoopStatus(ctx.manager, loop.config.id, ["failed"], 10000);

        // Jumpstart the loop via injectPending — syncState should be cleared
        ctx.events.length = 0;
        await ctx.manager.injectPending(loop.config.id, { message: "Try again" });
        await waitForEvent(ctx.events, "loop.completed");

        const jumpstartedLoop = await ctx.manager.getLoop(loop.config.id);
        expect(jumpstartedLoop).not.toBeNull();
        expect(jumpstartedLoop!.state.syncState).toBeUndefined();
      } finally {
        await teardownTestContext(ctx);
      }
    });
  });
});
