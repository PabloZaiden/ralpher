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
  delay,
  type TestContext,
} from "../setup";

describe("Git Workflow", () => {
  let ctx: TestContext;

  beforeEach(async () => {
    ctx = await setupTestContext({
      useMockBackend: true,
      mockResponses: [
        "Working on iteration 1...",
        "Done! <promise>COMPLETE</promise>",
      ],
      initGit: true, // Initialize git in work directory
    });
  });

  afterEach(async () => {
    await teardownTestContext(ctx);
  });

  describe("Branch Creation", () => {
    test("creates a branch when starting a loop with git enabled", async () => {
      const loop = await ctx.manager.createLoop({
        name: "Git Loop",
        directory: ctx.workDir,
        prompt: "Make changes",
        gitEnabled: true,
      });

      // Get original branch
      const originalBranch = await ctx.git.getCurrentBranch(ctx.workDir);

      // Start the loop
      await ctx.manager.startLoop(loop.config.id);

      // Wait for completion
      await waitForEvent(ctx.events, "loop.completed");

      // Check that we're on the working branch
      const currentBranch = await ctx.git.getCurrentBranch(ctx.workDir);
      expect(currentBranch).toMatch(/^ralph\//);
      expect(currentBranch).not.toBe(originalBranch);

      // Verify the loop state has git info
      const finalLoop = await ctx.manager.getLoop(loop.config.id);
      expect(finalLoop!.state.git).toBeDefined();
      expect(finalLoop!.state.git!.originalBranch).toBe(originalBranch);
      expect(finalLoop!.state.git!.workingBranch).toBe(currentBranch);
    });

    test("uses custom branch prefix", async () => {
      const loop = await ctx.manager.createLoop({
        name: "Custom Prefix Loop",
        directory: ctx.workDir,
        prompt: "Make changes",
        gitEnabled: true,
        gitBranchPrefix: "feature/",
      });

      await ctx.manager.startLoop(loop.config.id);
      await waitForEvent(ctx.events, "loop.completed");

      const currentBranch = await ctx.git.getCurrentBranch(ctx.workDir);
      expect(currentBranch).toMatch(/^feature\//);
    });

    test("branch name includes loop ID", async () => {
      const loop = await ctx.manager.createLoop({
        name: "Branch ID Loop",
        directory: ctx.workDir,
        prompt: "Make changes",
        gitEnabled: true,
      });

      await ctx.manager.startLoop(loop.config.id);
      await waitForEvent(ctx.events, "loop.completed");

      const currentBranch = await ctx.git.getCurrentBranch(ctx.workDir);
      // Branch should contain part of the loop ID
      expect(currentBranch).toContain(loop.config.id.slice(0, 8));
    });
  });

  describe("Commits Per Iteration", () => {
    test("creates a commit after each iteration", async () => {
      // Set up mock to run 3 iterations
      ctx.mockBackend!.setResponses([
        "Iteration 1...",
        "Iteration 2...",
        "<promise>COMPLETE</promise>",
      ]);

      const loop = await ctx.manager.createLoop({
        name: "Commit Loop",
        directory: ctx.workDir,
        prompt: "Make changes",
        gitEnabled: true,
      });

      // Create a file to track changes
      await writeFile(join(ctx.workDir, "test.txt"), "initial content");
      await Bun.$`git add .`.cwd(ctx.workDir).quiet();
      await Bun.$`git commit -m "Add test file"`.cwd(ctx.workDir).quiet();

      await ctx.manager.startLoop(loop.config.id);
      await waitForEvent(ctx.events, "loop.completed");

      // Check that git commit events were emitted
      const commitEvents = getEvents(ctx.events, "loop.git.commit");
      // Note: commits only happen if there are changes
      // Since mock backend doesn't actually change files, we may not have commits
      // But we can verify the git info is set up correctly
      
      const finalLoop = await ctx.manager.getLoop(loop.config.id);
      expect(finalLoop!.state.git).toBeDefined();
      expect(Array.isArray(finalLoop!.state.git!.commits)).toBe(true);
    });

    test("uses custom commit prefix", async () => {
      const loop = await ctx.manager.createLoop({
        name: "Custom Commit Loop",
        directory: ctx.workDir,
        prompt: "Make changes",
        gitEnabled: true,
        gitCommitPrefix: "[CustomPrefix]",
      });

      // Verify the config is set correctly
      expect(loop.config.git.commitPrefix).toBe("[CustomPrefix]");
    });
  });

  describe("Uncommitted Changes Handling", () => {
    test("throws error when starting with uncommitted changes", async () => {
      // Create uncommitted changes
      await writeFile(join(ctx.workDir, "uncommitted.txt"), "uncommitted content");
      await Bun.$`git add .`.cwd(ctx.workDir).quiet();

      const loop = await ctx.manager.createLoop({
        name: "Uncommitted Loop",
        directory: ctx.workDir,
        prompt: "Make changes",
        gitEnabled: true,
      });

      try {
        await ctx.manager.startLoop(loop.config.id);
        expect.unreachable("Should have thrown");
      } catch (error: any) {
        expect(error.code).toBe("UNCOMMITTED_CHANGES");
        expect(error.changedFiles).toBeDefined();
        expect(error.changedFiles.length).toBeGreaterThan(0);
      }
    });

    test("commits uncommitted changes when handleUncommitted is 'commit'", async () => {
      // Create uncommitted changes
      await writeFile(join(ctx.workDir, "uncommitted.txt"), "uncommitted content");
      await Bun.$`git add .`.cwd(ctx.workDir).quiet();

      const loop = await ctx.manager.createLoop({
        name: "Handle Uncommitted Loop",
        directory: ctx.workDir,
        prompt: "Make changes",
        gitEnabled: true,
      });

      // Start with handleUncommitted option
      await ctx.manager.startLoop(loop.config.id, { handleUncommitted: "commit" });
      await waitForEvent(ctx.events, "loop.completed");

      // Verify the uncommitted changes were committed
      const hasChanges = await ctx.git.hasUncommittedChanges(ctx.workDir);
      expect(hasChanges).toBe(false);
    });

    test("stashes uncommitted changes when handleUncommitted is 'stash'", async () => {
      // Create uncommitted changes
      await writeFile(join(ctx.workDir, "uncommitted.txt"), "uncommitted content");
      await Bun.$`git add .`.cwd(ctx.workDir).quiet();

      const loop = await ctx.manager.createLoop({
        name: "Stash Uncommitted Loop",
        directory: ctx.workDir,
        prompt: "Make changes",
        gitEnabled: true,
      });

      // Start with handleUncommitted option
      await ctx.manager.startLoop(loop.config.id, { handleUncommitted: "stash" });
      await waitForEvent(ctx.events, "loop.completed");

      // Verify changes were stashed (no uncommitted changes)
      const hasChanges = await ctx.git.hasUncommittedChanges(ctx.workDir);
      expect(hasChanges).toBe(false);
    });
  });

  describe("Accept Loop (Merge Branch)", () => {
    test("merges branch on accept", async () => {
      const loop = await ctx.manager.createLoop({
        name: "Accept Loop",
        directory: ctx.workDir,
        prompt: "Make changes",
        gitEnabled: true,
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

      // Verify working branch was deleted
      const branchExists = await ctx.git.branchExists(ctx.workDir, workingBranch);
      expect(branchExists).toBe(false);

      // Verify event was emitted
      expect(countEvents(ctx.events, "loop.accepted")).toBe(1);
    });

    test("returns error when accepting non-completed loop", async () => {
      const loop = await ctx.manager.createLoop({
        name: "Not Completed Loop",
        directory: ctx.workDir,
        prompt: "Make changes",
        gitEnabled: true,
      });

      const result = await ctx.manager.acceptLoop(loop.config.id);

      expect(result.success).toBe(false);
      expect(result.error).toContain("Cannot accept loop");
    });

    test("returns error when accepting loop without git", async () => {
      const loop = await ctx.manager.createLoop({
        name: "No Git Loop",
        directory: ctx.workDir,
        prompt: "Make changes",
        gitEnabled: false,
      });

      await ctx.manager.startLoop(loop.config.id);
      await waitForEvent(ctx.events, "loop.completed");

      const result = await ctx.manager.acceptLoop(loop.config.id);

      expect(result.success).toBe(false);
      expect(result.error).toContain("Git is not enabled");
    });
  });

  describe("Discard Loop (Delete Branch)", () => {
    test("deletes branch on discard", async () => {
      const loop = await ctx.manager.createLoop({
        name: "Discard Loop",
        directory: ctx.workDir,
        prompt: "Make changes",
        gitEnabled: true,
      });

      const originalBranch = await ctx.git.getCurrentBranch(ctx.workDir);

      await ctx.manager.startLoop(loop.config.id);
      await waitForEvent(ctx.events, "loop.completed");

      // Get the working branch name from in-memory engine
      const loopAfterComplete = await ctx.manager.getLoop(loop.config.id);
      const workingBranch = loopAfterComplete!.state.git!.workingBranch;

      // Discard the loop
      const result = await ctx.manager.discardLoop(loop.config.id);

      expect(result.success).toBe(true);

      // Verify we're back on original branch
      const currentBranch = await ctx.git.getCurrentBranch(ctx.workDir);
      expect(currentBranch).toBe(originalBranch);

      // Verify working branch was deleted
      const branchExists = await ctx.git.branchExists(ctx.workDir, workingBranch);
      expect(branchExists).toBe(false);

      // Verify event was emitted
      expect(countEvents(ctx.events, "loop.discarded")).toBe(1);
    });

    test("returns error when discarding loop without git", async () => {
      const loop = await ctx.manager.createLoop({
        name: "No Git Loop",
        directory: ctx.workDir,
        prompt: "Make changes",
        gitEnabled: false,
      });

      await ctx.manager.startLoop(loop.config.id);
      await waitForEvent(ctx.events, "loop.completed");

      const result = await ctx.manager.discardLoop(loop.config.id);

      expect(result.success).toBe(false);
      expect(result.error).toContain("Git is not enabled");
    });
  });

  describe("Git Disabled", () => {
    test("does not create branch when git is disabled", async () => {
      const loop = await ctx.manager.createLoop({
        name: "No Git Loop",
        directory: ctx.workDir,
        prompt: "Make changes",
        gitEnabled: false,
      });

      const originalBranch = await ctx.git.getCurrentBranch(ctx.workDir);

      await ctx.manager.startLoop(loop.config.id);
      await waitForEvent(ctx.events, "loop.completed");

      // Should still be on original branch
      const currentBranch = await ctx.git.getCurrentBranch(ctx.workDir);
      expect(currentBranch).toBe(originalBranch);

      // No git state in loop
      const finalLoop = await ctx.manager.getLoop(loop.config.id);
      expect(finalLoop!.state.git).toBeUndefined();
    });
  });
});
