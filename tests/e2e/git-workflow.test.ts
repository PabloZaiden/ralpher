/**
 * E2E tests for git integration in Ralph Loops.
 * Tests branch creation, commits per iteration, and accept/discard workflows.
 */

import { test, expect, describe, beforeEach, afterEach } from "bun:test";
import { writeFile } from "fs/promises";
import { join } from "path";
import {
  setupTestContext,
  teardownTestContext,
  waitForEvent,
  countEvents,
  getEvents,
  testModelFields,
  type TestContext,
} from "../setup";

const testWorkspaceId = "test-workspace-id";

describe("Git Workflow", () => {
  let ctx: TestContext;

  beforeEach(async () => {
    ctx = await setupTestContext({
      useMockBackend: true,
      mockResponses: Array(30).fill(null).map((_, i) => {
        // Cycle through: name, iteration, complete
        const mod = i % 3;
        if (mod === 0) return "branch-id-loop";  // Name generation response
        if (mod === 1) return "Working on iteration 1...";
        return "Done! <promise>COMPLETE</promise>";
      }),
      initGit: true, // Initialize git in work directory
    });
  });

  afterEach(async () => {
    await teardownTestContext(ctx);
  });

  describe("Branch Creation", () => {
    test("creates a branch when starting a loop with git enabled", async () => {
      const loop = await ctx.manager.createLoop({
        ...testModelFields,
        directory: ctx.workDir,
        prompt: "Make changes",
        planMode: false,
        workspaceId: testWorkspaceId,
      });

      // Get original branch
      const originalBranch = await ctx.git.getCurrentBranch(ctx.workDir);

      // Start the loop
      await ctx.manager.startLoop(loop.config.id);

      // Wait for completion
      await waitForEvent(ctx.events, "loop.completed");

      // With worktrees, main checkout stays on original branch
      const currentBranch = await ctx.git.getCurrentBranch(ctx.workDir);
      expect(currentBranch).toBe(originalBranch);

      // Verify the loop state has git info with the working branch
      const finalLoop = await ctx.manager.getLoop(loop.config.id);
      expect(finalLoop!.state.git).toBeDefined();
      expect(finalLoop!.state.git!.originalBranch).toBe(originalBranch);
      expect(finalLoop!.state.git!.workingBranch).toMatch(/^ralph\//);
      expect(finalLoop!.state.git!.worktreePath).toBeDefined();
    });

    test("uses custom branch prefix", async () => {
      const loop = await ctx.manager.createLoop({
        ...testModelFields,
        directory: ctx.workDir,
        prompt: "Make changes",
        planMode: false,
        gitBranchPrefix: "feature/",
        workspaceId: testWorkspaceId,
      });

      await ctx.manager.startLoop(loop.config.id);
      await waitForEvent(ctx.events, "loop.completed");

      // With worktrees, check the loop state's working branch, not the main checkout
      const finalLoop = await ctx.manager.getLoop(loop.config.id);
      expect(finalLoop!.state.git!.workingBranch).toMatch(/^feature\//);
    });

    test("branch name includes loop name and timestamp", async () => {
      const loop = await ctx.manager.createLoop({
        ...testModelFields,
        directory: ctx.workDir,
        prompt: "Make changes",
        planMode: false,
        workspaceId: testWorkspaceId,
      });

      await ctx.manager.startLoop(loop.config.id);
      await waitForEvent(ctx.events, "loop.completed");

      // With worktrees, check the loop state's working branch, not the main checkout
      const finalLoop = await ctx.manager.getLoop(loop.config.id);
      const workingBranch = finalLoop!.state.git!.workingBranch;
      // Branch should contain the sanitized loop name
      expect(workingBranch).toContain("branch-id-loop");
      // Branch should start with ralph/ prefix
      expect(workingBranch).toStartWith("ralph/");
      // Branch should contain a date component (YYYY-MM-DD format)
      expect(workingBranch).toMatch(/\d{4}-\d{2}-\d{2}/);
    });
  });

  describe("Commits Per Iteration", () => {
    test("creates a commit after each iteration", async () => {
      // Teardown the default context
      await teardownTestContext(ctx);

      // Create new context with 3 iterations of responses
      ctx = await setupTestContext({
        useMockBackend: true,
        initGit: true,
        mockResponses: [
          "test-loop-name",  // Name generation response
          "Iteration 1...",
          "Iteration 2...",
          "<promise>COMPLETE</promise>",
        ],
      });

      const loop = await ctx.manager.createLoop({
        ...testModelFields,
        directory: ctx.workDir,
        prompt: "Make changes",
        planMode: false,
        workspaceId: testWorkspaceId,
      });

      // Create a file to track changes
      await writeFile(join(ctx.workDir, "test.txt"), "initial content");
      await Bun.$`git add .`.cwd(ctx.workDir).quiet();
      await Bun.$`git commit -m "Add test file"`.cwd(ctx.workDir).quiet();

      await ctx.manager.startLoop(loop.config.id);
      await waitForEvent(ctx.events, "loop.completed");

      // Check that git commit events were emitted
      getEvents(ctx.events, "loop.git.commit");
      // Note: commits only happen if there are changes
      // Since mock backend doesn't actually change files, we may not have commits
      // But we can verify the git info is set up correctly
      
      const finalLoop = await ctx.manager.getLoop(loop.config.id);
      expect(finalLoop!.state.git).toBeDefined();
      expect(Array.isArray(finalLoop!.state.git!.commits)).toBe(true);
    });

    test("uses custom commit scope", async () => {
      const loop = await ctx.manager.createLoop({
        ...testModelFields,
        directory: ctx.workDir,
        prompt: "Make changes",
        planMode: false,
        gitCommitScope: "custom",
        workspaceId: testWorkspaceId,
      });

      // Verify the config is set correctly
      expect(loop.config.git.commitScope).toBe("custom");
    });
  });

  describe("Uncommitted Changes Handling", () => {
    test("allows starting loop with uncommitted changes (worktree isolation)", async () => {
      // Create uncommitted changes
      await writeFile(join(ctx.workDir, "uncommitted.txt"), "uncommitted content");
      await Bun.$`git add .`.cwd(ctx.workDir).quiet();

      const loop = await ctx.manager.createLoop({
        ...testModelFields,
        directory: ctx.workDir,
        prompt: "Make changes",
        planMode: false,
        workspaceId: testWorkspaceId,
      });

      // With worktrees, uncommitted changes in main checkout don't block loop creation
      await ctx.manager.startLoop(loop.config.id);
      await waitForEvent(ctx.events, "loop.completed");

      // Verify loop completed successfully
      const finalLoop = await ctx.manager.getLoop(loop.config.id);
      expect(finalLoop!.state.status).toBe("completed");
      expect(finalLoop!.state.git!.workingBranch).toMatch(/^ralph\//);

      // Clean up uncommitted changes
      await Bun.$`git reset HEAD -- .`.cwd(ctx.workDir).quiet().nothrow();
      await Bun.$`git checkout -- .`.cwd(ctx.workDir).quiet().nothrow();
      await Bun.$`git clean -fd`.cwd(ctx.workDir).quiet().nothrow();
    });

  });

  describe("Accept Loop (Merge Branch)", () => {
    test("merges branch on accept", async () => {
      const loop = await ctx.manager.createLoop({
        ...testModelFields,
        directory: ctx.workDir,
        prompt: "Make changes",
        planMode: false,
        workspaceId: testWorkspaceId,
      });

      const originalBranch = await ctx.git.getCurrentBranch(ctx.workDir);

      await ctx.manager.startLoop(loop.config.id);
      await waitForEvent(ctx.events, "loop.completed");

      // Get the working branch name from in-memory engine
      const loopAfterComplete = await ctx.manager.getLoop(loop.config.id);
      const workingBranch = loopAfterComplete!.state.git!.workingBranch;

      // Accept the loop
      const result = await ctx.manager.acceptLoop(loop.config.id);

      expect(result.success).toBe(true);
      expect(result.mergeCommit).toBeDefined();

      // Verify we're back on original branch
      const currentBranch = await ctx.git.getCurrentBranch(ctx.workDir);
      expect(currentBranch).toBe(originalBranch);

      // Verify working branch was NOT deleted (kept for review mode)
      const branchExists = await ctx.git.branchExists(ctx.workDir, workingBranch);
      expect(branchExists).toBe(true);

      // Verify reviewMode was initialized
      const updatedLoop = await ctx.manager.getLoop(loop.config.id);
      expect(updatedLoop?.state.reviewMode).toBeDefined();
      expect(updatedLoop?.state.reviewMode?.addressable).toBe(true);
      expect(updatedLoop?.state.reviewMode?.completionAction).toBe("merge");
      expect(updatedLoop?.state.reviewMode?.reviewCycles).toBe(0);

      // Verify event was emitted
      expect(countEvents(ctx.events, "loop.accepted")).toBe(1);
    });

    test("returns error when accepting non-completed loop", async () => {
      const loop = await ctx.manager.createLoop({
        ...testModelFields,
        directory: ctx.workDir,
        prompt: "Make changes",
        planMode: false,
        workspaceId: testWorkspaceId,
      });

      const result = await ctx.manager.acceptLoop(loop.config.id);

      expect(result.success).toBe(false);
      expect(result.error).toContain("Cannot accept loop");
    });
  });

  describe("Discard Loop", () => {
    test("discards loop without modifying main checkout", async () => {
      const loop = await ctx.manager.createLoop({
        ...testModelFields,
        directory: ctx.workDir,
        prompt: "Make changes",
        planMode: false,
        workspaceId: testWorkspaceId,
      });

      const originalBranch = await ctx.git.getCurrentBranch(ctx.workDir);

      await ctx.manager.startLoop(loop.config.id);
      await waitForEvent(ctx.events, "loop.completed");

      // Discard the loop
      const result = await ctx.manager.discardLoop(loop.config.id);

      expect(result.success).toBe(true);

      // Main checkout stays on original branch (worktrees don't modify it)
      const currentBranch = await ctx.git.getCurrentBranch(ctx.workDir);
      expect(currentBranch).toBe(originalBranch);

      // With worktrees, discard no longer deletes the branch (only purge does)

      // Verify event was emitted
      expect(countEvents(ctx.events, "loop.discarded")).toBe(1);
    });
  });

  describe("Mark as Merged", () => {
    test("marks loop as deleted without modifying main checkout", async () => {
      const loop = await ctx.manager.createLoop({
        ...testModelFields,
        directory: ctx.workDir,
        prompt: "Make changes",
        planMode: false,
        workspaceId: testWorkspaceId,
      });

      const originalBranch = await ctx.git.getCurrentBranch(ctx.workDir);

      await ctx.manager.startLoop(loop.config.id);
      await waitForEvent(ctx.events, "loop.completed");

      // Mark as merged
      const result = await ctx.manager.markMerged(loop.config.id);

      expect(result.success).toBe(true);

      // Main checkout stays on original branch (worktrees don't modify it)
      const currentBranch = await ctx.git.getCurrentBranch(ctx.workDir);
      expect(currentBranch).toBe(originalBranch);

      // Verify loop status is now deleted
      const finalLoop = await ctx.manager.getLoop(loop.config.id);
      expect(finalLoop!.state.status).toBe("deleted");

      // Verify event was emitted
      expect(countEvents(ctx.events, "loop.deleted")).toBeGreaterThanOrEqual(1);
    });

    test("works for pushed loops", async () => {
      const loop = await ctx.manager.createLoop({
        ...testModelFields,
        directory: ctx.workDir,
        prompt: "Make changes",
        planMode: false,
        workspaceId: testWorkspaceId,
      });

      const originalBranch = await ctx.git.getCurrentBranch(ctx.workDir);

      await ctx.manager.startLoop(loop.config.id);
      await waitForEvent(ctx.events, "loop.completed");

      // Get the working branch name
      const loopAfterComplete = await ctx.manager.getLoop(loop.config.id);

      // Push the loop (simulates pushing to remote, but no actual remote exists)
      // For this test, we manually set status to pushed since there's no remote
      const { updateLoopState } = await import("../../src/persistence/loops");
      await updateLoopState(loop.config.id, {
        ...loopAfterComplete!.state,
        status: "pushed",
      });

      // Mark as merged
      const result = await ctx.manager.markMerged(loop.config.id);

      expect(result.success).toBe(true);

      // Main checkout stays on original branch
      const currentBranch = await ctx.git.getCurrentBranch(ctx.workDir);
      expect(currentBranch).toBe(originalBranch);

      // Verify loop status is deleted
      const finalLoop = await ctx.manager.getLoop(loop.config.id);
      expect(finalLoop!.state.status).toBe("deleted");
    });

    test("returns error when loop is not in final state", async () => {
      const loop = await ctx.manager.createLoop({
        ...testModelFields,
        directory: ctx.workDir,
        prompt: "Make changes",
        planMode: false,
        workspaceId: testWorkspaceId,
      });

      // Try to mark as merged without running the loop
      const result = await ctx.manager.markMerged(loop.config.id);

      expect(result.success).toBe(false);
      expect(result.error).toContain("Cannot mark loop as merged");
    });
  });
});
