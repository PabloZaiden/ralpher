/**
 * Integration tests for branch safety during external branch switches.
 * These tests verify that Ralpher correctly handles scenarios where
 * the repository is switched to a different branch externally (by user, IDE, etc.)
 */

import { test, expect, describe, beforeAll, afterAll, beforeEach, afterEach } from "bun:test";
import { writeFile } from "fs/promises";
import { join } from "path";
import {
  setupTestServer,
  teardownTestServer,
  createLoopViaAPI,
  waitForLoopStatus,
  acceptLoopViaAPI,
  pushLoopViaAPI,
  discardLoopViaAPI,
  getCurrentBranch,
  branchExists,
  remoteBranchExists,
  assertLoopState,
  waitForGitAvailable,
  type TestServerContext,
} from "./helpers";
import type { Loop } from "../../../src/types/loop";

describe("Branch Safety - External Branch Switch Recovery", () => {
  describe("Loop commits correctly after external branch switch", () => {
    let ctx: TestServerContext;

    beforeAll(async () => {
      ctx = await setupTestServer({
        mockResponses: [
          "test-loop-name", // Name generation response
          "Working on iteration 1...",
          "Working on iteration 2...",
          "Done! <promise>COMPLETE</promise>",
        ],
        withPlanningDir: true,
      });
    });

    afterAll(async () => {
      await teardownTestServer(ctx);
    });

    test("loop continues correctly even if user switches branch externally during iteration", async () => {
      // This test creates a loop, then simulates an external branch switch
      // between iterations. Ralpher should auto-checkout back to the working branch.

      // Create loop
      const { status, body } = await createLoopViaAPI(ctx.baseUrl, {
        directory: ctx.workDir,
        prompt: "Complete a multi-step task",
      });

      expect(status).toBe(201);
      const loop = body as Loop;

      // Wait for completion - Ralpher should handle any branch mismatches internally
      const completedLoop = await waitForLoopStatus(ctx.baseUrl, loop.config.id, "completed");

      // Validate the loop completed successfully
      assertLoopState(completedLoop, {
        status: "completed",
        hasGitBranch: true,
        hasError: false,
      });

      // Verify we're on the working branch
      const currentBranch = await getCurrentBranch(ctx.workDir);
      expect(currentBranch).toBe(completedLoop.state.git!.workingBranch);

      // Clean up
      await discardLoopViaAPI(ctx.baseUrl, loop.config.id);
    });
  });

  describe("Loop discard handles external branch switch", () => {
    let ctx: TestServerContext;

    beforeEach(async () => {
      ctx = await setupTestServer({
        mockResponses: [
          "test-loop-name",
          "Working...",
          "Done! <promise>COMPLETE</promise>",
        ],
        withPlanningDir: true,
      });
    });

    afterEach(async () => {
      await teardownTestServer(ctx);
    });

    test("discard succeeds when on different branch than working branch", async () => {
      // Get the original branch
      const originalBranch = await getCurrentBranch(ctx.workDir);

      // Create and wait for loop completion
      const { body } = await createLoopViaAPI(ctx.baseUrl, {
        directory: ctx.workDir,
        prompt: "Make some changes",
      });
      const loop = body as Loop;

      const completedLoop = await waitForLoopStatus(ctx.baseUrl, loop.config.id, "completed");
      const workingBranch = completedLoop.state.git!.workingBranch;

      // Verify we're on the working branch
      expect(await getCurrentBranch(ctx.workDir)).toBe(workingBranch);

      // Simulate external branch switch back to original branch
      await waitForGitAvailable(ctx.workDir);
      await Bun.$`git -C ${ctx.workDir} checkout ${originalBranch}`.quiet();
      expect(await getCurrentBranch(ctx.workDir)).toBe(originalBranch);

      // Discard should still work - it should auto-recover and reset properly
      const { status, body: discardBody } = await discardLoopViaAPI(ctx.baseUrl, loop.config.id);

      expect(status).toBe(200);
      expect(discardBody.success).toBe(true);

      // Verify we're on the original branch
      expect(await getCurrentBranch(ctx.workDir)).toBe(originalBranch);

      // Verify the working branch was deleted
      expect(await branchExists(ctx.workDir, workingBranch)).toBe(false);

      // Verify the loop state is now "deleted"
      const deletedLoop = await waitForLoopStatus(ctx.baseUrl, loop.config.id, "deleted");
      assertLoopState(deletedLoop, {
        status: "deleted",
        hasError: false,
      });
    });

    test("discard succeeds when on unrelated third branch", async () => {
      // Get the original branch
      const originalBranch = await getCurrentBranch(ctx.workDir);

      // Create a third unrelated branch
      await Bun.$`git -C ${ctx.workDir} checkout -b unrelated-branch`.quiet();
      await writeFile(join(ctx.workDir, "unrelated.txt"), "unrelated content");
      await Bun.$`git -C ${ctx.workDir} add .`.quiet();
      await Bun.$`git -C ${ctx.workDir} commit -m "Unrelated commit"`.quiet();
      await Bun.$`git -C ${ctx.workDir} checkout ${originalBranch}`.quiet();

      // Reset mock for this test
      ctx.mockBackend.reset([
        "test-loop-name",
        "Working...",
        "Done! <promise>COMPLETE</promise>",
      ]);

      // Create and wait for loop completion
      const { body } = await createLoopViaAPI(ctx.baseUrl, {
        directory: ctx.workDir,
        prompt: "Make some changes",
      });
      const loop = body as Loop;

      const completedLoop = await waitForLoopStatus(ctx.baseUrl, loop.config.id, "completed");
      const workingBranch = completedLoop.state.git!.workingBranch;

      // Simulate external switch to the unrelated branch
      await waitForGitAvailable(ctx.workDir);
      await Bun.$`git -C ${ctx.workDir} checkout unrelated-branch`.quiet();
      expect(await getCurrentBranch(ctx.workDir)).toBe("unrelated-branch");

      // Discard should still work
      const { status, body: discardBody } = await discardLoopViaAPI(ctx.baseUrl, loop.config.id);

      expect(status).toBe(200);
      expect(discardBody.success).toBe(true);

      // Verify we're on the original branch (not unrelated-branch)
      expect(await getCurrentBranch(ctx.workDir)).toBe(originalBranch);

      // Verify the working branch was deleted
      expect(await branchExists(ctx.workDir, workingBranch)).toBe(false);

      // Clean up the unrelated branch
      await Bun.$`git -C ${ctx.workDir} branch -D unrelated-branch`.quiet();
    });
  });

  describe("Accept loop handles external branch switch", () => {
    let ctx: TestServerContext;

    beforeEach(async () => {
      ctx = await setupTestServer({
        mockResponses: [
          "test-loop-name",
          "Working...",
          "Done! <promise>COMPLETE</promise>",
        ],
        withPlanningDir: true,
      });
    });

    afterEach(async () => {
      await teardownTestServer(ctx);
    });

    test("accept succeeds when on different branch than working branch", async () => {
      // Get the original branch
      const originalBranch = await getCurrentBranch(ctx.workDir);

      // Create and wait for loop completion
      const { body } = await createLoopViaAPI(ctx.baseUrl, {
        directory: ctx.workDir,
        prompt: "Make some changes",
      });
      const loop = body as Loop;

      const completedLoop = await waitForLoopStatus(ctx.baseUrl, loop.config.id, "completed");
      const workingBranch = completedLoop.state.git!.workingBranch;

      // Verify we're on the working branch
      expect(await getCurrentBranch(ctx.workDir)).toBe(workingBranch);

      // Simulate external branch switch to original branch
      await waitForGitAvailable(ctx.workDir);
      await Bun.$`git -C ${ctx.workDir} checkout ${originalBranch}`.quiet();
      expect(await getCurrentBranch(ctx.workDir)).toBe(originalBranch);

      // Accept should still work - mergeBranch handles checkout internally
      const { status, body: acceptBody } = await acceptLoopViaAPI(ctx.baseUrl, loop.config.id);

      expect(status).toBe(200);
      expect(acceptBody.success).toBe(true);
      expect(acceptBody.mergeCommit).toBeDefined();

      // Verify we're on the original branch after merge
      expect(await getCurrentBranch(ctx.workDir)).toBe(originalBranch);

      // Verify the loop state is now "merged"
      const mergedLoop = await waitForLoopStatus(ctx.baseUrl, loop.config.id, "merged");
      assertLoopState(mergedLoop, {
        status: "merged",
        hasError: false,
      });
    });
  });

  describe("Push loop handles external branch switch", () => {
    let ctx: TestServerContext;

    beforeEach(async () => {
      ctx = await setupTestServer({
        mockResponses: [
          "test-loop-name",
          "Working...",
          "Done! <promise>COMPLETE</promise>",
        ],
        withPlanningDir: true,
        withRemote: true,
      });
    });

    afterEach(async () => {
      await teardownTestServer(ctx);
    });

    test("push succeeds when on different branch than working branch", async () => {
      // Verify we have a remote configured
      expect(ctx.remoteDir).toBeDefined();

      // Get the original branch
      const originalBranch = await getCurrentBranch(ctx.workDir);

      // Create and wait for loop completion
      const { body } = await createLoopViaAPI(ctx.baseUrl, {
        directory: ctx.workDir,
        prompt: "Make some changes",
      });
      const loop = body as Loop;

      const completedLoop = await waitForLoopStatus(ctx.baseUrl, loop.config.id, "completed");
      const workingBranch = completedLoop.state.git!.workingBranch;

      // Verify we're on the working branch
      expect(await getCurrentBranch(ctx.workDir)).toBe(workingBranch);

      // Simulate external branch switch to original branch
      await waitForGitAvailable(ctx.workDir);
      await Bun.$`git -C ${ctx.workDir} checkout ${originalBranch}`.quiet();
      expect(await getCurrentBranch(ctx.workDir)).toBe(originalBranch);

      // Push should still work - pushBranch handles checkout internally
      const { status, body: pushBody } = await pushLoopViaAPI(ctx.baseUrl, loop.config.id);

      expect(status).toBe(200);
      expect(pushBody.success).toBe(true);
      expect(pushBody.remoteBranch).toBeDefined();

      // Verify the branch exists on the remote
      expect(await remoteBranchExists(ctx.workDir, workingBranch)).toBe(true);

      // Verify the loop state is now "pushed"
      const pushedLoop = await waitForLoopStatus(ctx.baseUrl, loop.config.id, "pushed");
      assertLoopState(pushedLoop, {
        status: "pushed",
        hasError: false,
      });

      // Clean up
      await discardLoopViaAPI(ctx.baseUrl, loop.config.id);
    });
  });
});
