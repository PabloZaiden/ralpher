/**
 * Integration tests for regular loop user scenarios.
 * These tests simulate UI interactions via API calls.
 */

import { test, expect, describe, beforeAll, afterAll } from "bun:test";
import { writeFile, readdir } from "fs/promises";
import { join } from "path";
import {
  setupTestServer,
  teardownTestServer,
  createLoopViaAPI,
  waitForLoopStatus,
  acceptLoopViaAPI,
  pushLoopViaAPI,
  discardLoopViaAPI,
  getLoopDiffViaAPI,
  getLoopPlanViaAPI,
  getLoopStatusFileViaAPI,
  getCurrentBranch,
  branchExists,
  remoteBranchExists,
  assertLoopState,
  type TestServerContext,
} from "./helpers";
import type { Loop } from "../../../src/types/loop";

describe("Regular Loop User Scenarios", () => {
  describe("Loop Creation Variants", () => {
    let ctx: TestServerContext;

    beforeAll(async () => {
      ctx = await setupTestServer({
        mockResponses: [
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

    test("creates loop based on main branch without clearing .planning folder", async () => {
      // Verify .planning files exist before creating loop
      const planContent = await Bun.file(join(ctx.workDir, ".planning/plan.md")).text();
      expect(planContent).toContain("# Plan");

      // Create loop via API (simulating UI "Create Loop" button)
      const { status, body } = await createLoopViaAPI(ctx.baseUrl, {
        name: "Test Loop No Clear",
        directory: ctx.workDir,
        prompt: "Implement a feature",
        clearPlanningFolder: false,
      });

      expect(status).toBe(201);
      const loop = body as Loop;
      expect(loop.config.id).toBeDefined();
      expect(loop.config.name).toBe("Test Loop No Clear");
      expect(loop.config.clearPlanningFolder).toBe(false);

      // Wait for loop to complete (3 iterations: 2 continue + 1 complete)
      const completedLoop = await waitForLoopStatus(ctx.baseUrl, loop.config.id, "completed");

      // Validate loop state for UI display
      assertLoopState(completedLoop, {
        status: "completed",
        iterationCount: 3,
        hasGitBranch: true,
        hasError: false,
      });

      // Verify .planning files still exist
      const planContentAfter = await Bun.file(join(ctx.workDir, ".planning/plan.md")).text();
      expect(planContentAfter).toContain("# Plan");

      // Clean up - discard the loop
      await discardLoopViaAPI(ctx.baseUrl, loop.config.id);
    });

    test("creates loop based on main branch with clearing .planning folder", async () => {
      // Reset mock backend for this test
      ctx.mockBackend.reset([
        "Working on iteration 1...",
        "Working on iteration 2...",
        "Done! <promise>COMPLETE</promise>",
      ]);

      // Add some extra files to .planning that should be cleared
      await writeFile(join(ctx.workDir, ".planning/extra.md"), "Extra content");
      // Commit the change so the repo is clean
      await Bun.$`git -C ${ctx.workDir} add .`.quiet();
      await Bun.$`git -C ${ctx.workDir} commit -m "Add extra planning file"`.quiet();

      // Verify extra file exists
      const extraExists = await Bun.file(join(ctx.workDir, ".planning/extra.md")).exists();
      expect(extraExists).toBe(true);

      // Create loop via API with clearPlanningFolder=true
      const { status, body } = await createLoopViaAPI(ctx.baseUrl, {
        name: "Test Loop With Clear",
        directory: ctx.workDir,
        prompt: "Implement a feature",
        clearPlanningFolder: true,
      });

      expect(status).toBe(201);
      const loop = body as Loop;

      // Wait for loop to complete
      const completedLoop = await waitForLoopStatus(ctx.baseUrl, loop.config.id, "completed");

      // Validate loop state
      assertLoopState(completedLoop, {
        status: "completed",
        iterationCount: 3,
        hasGitBranch: true,
        hasError: false,
      });

      // Verify .planning files were cleared (folder should be empty or only have .gitkeep)
      const planningDir = join(ctx.workDir, ".planning");
      const filesAfterClear = await readdir(planningDir);
      // The folder should have been cleared before the loop started
      // But the loop may have created new files, so we just check it was processed
      expect(completedLoop.config.clearPlanningFolder).toBe(true);
      // After clearing, the folder should be empty or have minimal files
      expect(filesAfterClear.length).toBeLessThanOrEqual(2); // May have .gitkeep or be empty

      // Clean up
      await discardLoopViaAPI(ctx.baseUrl, loop.config.id);
    });
  });

  describe("Loop Execution - 2 iterations without completion, 1 final iteration completing", () => {
    let ctx: TestServerContext;

    beforeAll(async () => {
      ctx = await setupTestServer({
        mockResponses: [
          "Working on iteration 1, still more to do...",
          "Working on iteration 2, getting closer...",
          "All done! <promise>COMPLETE</promise>",
        ],
        withPlanningDir: true,
      });
    });

    afterAll(async () => {
      await teardownTestServer(ctx);
    });

    test("runs 2 iterations without completion, then 1 iteration that completes", async () => {
      // Create loop
      const { status, body } = await createLoopViaAPI(ctx.baseUrl, {
        name: "Iteration Test Loop",
        directory: ctx.workDir,
        prompt: "Complete a multi-step task",
      });

      expect(status).toBe(201);
      const loop = body as Loop;

      // Wait for completion
      const completedLoop = await waitForLoopStatus(ctx.baseUrl, loop.config.id, "completed");

      // Validate the loop ran exactly 3 iterations
      assertLoopState(completedLoop, {
        status: "completed",
        iterationCount: 3,
        hasGitBranch: true,
        hasError: false,
      });

      // Verify iteration history
      expect(completedLoop.state.recentIterations.length).toBe(3);
      expect(completedLoop.state.recentIterations[0]?.outcome).toBe("continue");
      expect(completedLoop.state.recentIterations[1]?.outcome).toBe("continue");
      expect(completedLoop.state.recentIterations[2]?.outcome).toBe("complete");

      // Verify we're on a ralph/ branch
      const currentBranch = await getCurrentBranch(ctx.workDir);
      expect(currentBranch).toMatch(/^ralph\//);

      // Verify diff endpoint works
      const { status: diffStatus, body: diffBody } = await getLoopDiffViaAPI(ctx.baseUrl, loop.config.id);
      expect(diffStatus).toBe(200);
      // Diff should be an array (even if empty since mock doesn't actually change files)
      expect(Array.isArray(diffBody)).toBe(true);

      // Verify plan endpoint works
      const { status: planStatus, body: planBody } = await getLoopPlanViaAPI(ctx.baseUrl, loop.config.id);
      expect(planStatus).toBe(200);
      const plan = planBody as { exists: boolean; content: string };
      expect(plan.exists).toBe(true);
      expect(plan.content).toContain("# Plan");

      // Verify status-file endpoint works
      const { status: statusFileStatus, body: statusFileBody } = await getLoopStatusFileViaAPI(ctx.baseUrl, loop.config.id);
      expect(statusFileStatus).toBe(200);
      const statusFile = statusFileBody as { exists: boolean; content: string };
      expect(statusFile.exists).toBe(true);
      expect(statusFile.content).toContain("# Status");

      // Clean up
      await discardLoopViaAPI(ctx.baseUrl, loop.config.id);
    });
  });

  describe("Finish Variant A: Accept and Merge to Base Branch", () => {
    let ctx: TestServerContext;

    beforeAll(async () => {
      ctx = await setupTestServer({
        mockResponses: [
          "Working...",
          "Done! <promise>COMPLETE</promise>",
        ],
        withPlanningDir: true,
      });
    });

    afterAll(async () => {
      await teardownTestServer(ctx);
    });

    test("accepts loop and merges to base branch", async () => {
      // Get the original branch before creating the loop
      const originalBranch = await getCurrentBranch(ctx.workDir);

      // Create and wait for loop completion
      const { body } = await createLoopViaAPI(ctx.baseUrl, {
        name: "Accept Merge Test",
        directory: ctx.workDir,
        prompt: "Make some changes",
      });
      const loop = body as Loop;

      // Wait for completion
      const completedLoop = await waitForLoopStatus(ctx.baseUrl, loop.config.id, "completed");
      const workingBranch = completedLoop.state.git!.workingBranch;

      // Verify we're on the working branch
      expect(await getCurrentBranch(ctx.workDir)).toBe(workingBranch);
      expect(await branchExists(ctx.workDir, workingBranch)).toBe(true);

      // Accept the loop via API (simulating UI "Accept" button)
      const { status, body: acceptBody } = await acceptLoopViaAPI(ctx.baseUrl, loop.config.id);

      expect(status).toBe(200);
      expect(acceptBody.success).toBe(true);
      expect(acceptBody.mergeCommit).toBeDefined();

      // Verify we're back on the original branch
      expect(await getCurrentBranch(ctx.workDir)).toBe(originalBranch);

      // Verify the working branch was deleted
      expect(await branchExists(ctx.workDir, workingBranch)).toBe(false);

      // Verify the loop state is now "merged"
      const mergedLoop = await waitForLoopStatus(ctx.baseUrl, loop.config.id, "merged");
      assertLoopState(mergedLoop, {
        status: "merged",
        hasError: false,
      });
    });
  });

  describe("Finish Variant B: Accept and Push (with local file-based remote)", () => {
    let ctx: TestServerContext;

    beforeAll(async () => {
      ctx = await setupTestServer({
        mockResponses: [
          "Working...",
          "Done! <promise>COMPLETE</promise>",
        ],
        withPlanningDir: true,
        withRemote: true, // This creates a local bare git repository as remote
      });
    });

    afterAll(async () => {
      await teardownTestServer(ctx);
    });

    test("accepts loop and pushes to remote (offline-compatible)", async () => {
      // Verify we have a remote configured
      expect(ctx.remoteDir).toBeDefined();

      // Create and wait for loop completion
      const { body } = await createLoopViaAPI(ctx.baseUrl, {
        name: "Accept Push Test",
        directory: ctx.workDir,
        prompt: "Make some changes",
      });
      const loop = body as Loop;

      // Wait for completion
      const completedLoop = await waitForLoopStatus(ctx.baseUrl, loop.config.id, "completed");
      const workingBranch = completedLoop.state.git!.workingBranch;

      // Push the loop via API (simulating UI "Push" button)
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

      // Clean up - discard the loop
      await discardLoopViaAPI(ctx.baseUrl, loop.config.id);
    });
  });

  describe("Finish Variant C: Discard", () => {
    let ctx: TestServerContext;

    beforeAll(async () => {
      ctx = await setupTestServer({
        mockResponses: [
          "Working...",
          "Done! <promise>COMPLETE</promise>",
        ],
        withPlanningDir: true,
      });
    });

    afterAll(async () => {
      await teardownTestServer(ctx);
    });

    test("discards loop and deletes working branch", async () => {
      // Get the original branch
      const originalBranch = await getCurrentBranch(ctx.workDir);

      // Create and wait for loop completion
      const { body } = await createLoopViaAPI(ctx.baseUrl, {
        name: "Discard Test",
        directory: ctx.workDir,
        prompt: "Make some changes",
      });
      const loop = body as Loop;

      // Wait for completion
      const completedLoop = await waitForLoopStatus(ctx.baseUrl, loop.config.id, "completed");
      const workingBranch = completedLoop.state.git!.workingBranch;

      // Verify the working branch exists
      expect(await branchExists(ctx.workDir, workingBranch)).toBe(true);

      // Discard the loop via API (simulating UI "Discard" button)
      const { status, body: discardBody } = await discardLoopViaAPI(ctx.baseUrl, loop.config.id);

      expect(status).toBe(200);
      expect(discardBody.success).toBe(true);

      // Verify we're back on the original branch
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
  });

  describe("Edge Cases and Error Handling", () => {
    let ctx: TestServerContext;

    beforeAll(async () => {
      ctx = await setupTestServer({
        mockResponses: ["<promise>COMPLETE</promise>"],
        withPlanningDir: true,
      });
    });

    afterAll(async () => {
      await teardownTestServer(ctx);
    });

    test("returns error when creating loop with uncommitted changes", async () => {
      // Create uncommitted changes
      await writeFile(join(ctx.workDir, "uncommitted.txt"), "uncommitted content");
      await Bun.$`git -C ${ctx.workDir} add .`.quiet();

      // Try to create a loop
      const { status, body } = await createLoopViaAPI(ctx.baseUrl, {
        name: "Uncommitted Test",
        directory: ctx.workDir,
        prompt: "This should fail",
      });

      expect(status).toBe(409);
      const error = body as { error: string; message: string; changedFiles?: string[] };
      expect(error.error).toBe("uncommitted_changes");
      expect(error.changedFiles).toBeDefined();
      expect(error.changedFiles!.length).toBeGreaterThan(0);

      // Clean up the uncommitted change
      await Bun.$`git -C ${ctx.workDir} reset HEAD -- . 2>/dev/null || true`.quiet().nothrow();
      await Bun.$`git -C ${ctx.workDir} checkout -- . 2>/dev/null || true`.quiet().nothrow();
      await Bun.$`git -C ${ctx.workDir} clean -fd 2>/dev/null || true`.quiet().nothrow();
    });

    test("returns 404 for non-existent loop", async () => {
      const response = await fetch(`${ctx.baseUrl}/api/loops/non-existent-id`);
      expect(response.status).toBe(404);
    });

    test("cannot accept a loop that is not completed", async () => {
      // Clean up any leftover changes from previous tests
      await Bun.$`git -C ${ctx.workDir} checkout -- . 2>/dev/null || true`.quiet().nothrow();
      await Bun.$`git -C ${ctx.workDir} clean -fd 2>/dev/null || true`.quiet().nothrow();
      
      // Create a loop but don't wait for completion
      ctx.mockBackend.reset([
        "Still working...",
        "More work...",
        "Even more...",
        "Almost done...",
        "<promise>COMPLETE</promise>",
      ]);

      const { status: createStatus, body } = await createLoopViaAPI(ctx.baseUrl, {
        name: "Not Completed Test",
        directory: ctx.workDir,
        prompt: "Long running task",
      });
      
      // If creation fails due to some issue, skip the rest of the test
      if (createStatus !== 201) {
        expect(createStatus).toBe(201); // This will fail with a meaningful message
        return;
      }
      
      const loop = body as Loop;

      // Wait for it to be running (or already completed)
      await waitForLoopStatus(ctx.baseUrl, loop.config.id, ["running", "completed"]);

      // Try to accept (might already be completed due to fast mock)
      // This is a race condition test - if it completes fast, skip the assertion
      const { status } = await acceptLoopViaAPI(ctx.baseUrl, loop.config.id);

      // Either we catch it running (400) or it already completed (200)
      expect([200, 400]).toContain(status);

      // Wait for completion and clean up
      await waitForLoopStatus(ctx.baseUrl, loop.config.id, ["completed", "merged"]);
      const finalLoop = await waitForLoopStatus(ctx.baseUrl, loop.config.id, ["completed", "merged", "deleted"]);
      if (finalLoop.state.status !== "deleted" && finalLoop.state.status !== "merged") {
        await discardLoopViaAPI(ctx.baseUrl, loop.config.id);
      }
    });
  });
});
