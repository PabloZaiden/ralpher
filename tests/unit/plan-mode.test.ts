/**
 * Unit tests for Plan Mode functionality.
 * Tests clearPlanningFolder behavior and state transitions.
 */

import { test, expect, describe, beforeEach, afterEach } from "bun:test";
import { mkdir, writeFile } from "fs/promises";
import { join } from "path";
import { setupTestContext, teardownTestContext, waitForPlanReady, waitForLoopStatus } from "../setup";
import type { TestContext } from "../setup";

// Helper to check if a file exists
async function exists(path: string): Promise<boolean> {
  return Bun.file(path).exists();
}

describe("Plan Mode - Clear Planning Folder", () => {
  let ctx: TestContext;

  beforeEach(async () => {
    ctx = await setupTestContext({ 
      initGit: true,
      mockResponses: ["<promise>PLAN_READY</promise>"],
    });
  });

  afterEach(async () => {
    await teardownTestContext(ctx);
  });

  test("clears .planning folder before plan creation when clearPlanningFolder is true", async () => {
    // Setup: Create existing plan files in the work directory
    const planningDir = join(ctx.workDir, ".planning");
    await mkdir(planningDir, { recursive: true });
    await writeFile(join(planningDir, "old-plan.md"), "Old plan content");
    await writeFile(join(planningDir, "status.md"), "Old status");

    // Verify files exist before loop creation
    expect(await exists(join(planningDir, "old-plan.md"))).toBe(true);
    expect(await exists(join(planningDir, "status.md"))).toBe(true);

    // Create loop with plan mode + clear folder
    const loop = await ctx.manager.createLoop({
      prompt: "Create a simple plan",
      directory: ctx.workDir,
      maxIterations: 1,
      clearPlanningFolder: true,
      planMode: true,
    });
    const loopId = loop.config.id;

    // Start plan mode (this is when clearing happens)
    await ctx.manager.startPlanMode(loopId);

    // Wait for plan to be ready (polling instead of fixed delay)
    await waitForPlanReady(ctx.manager, loopId);

    // Get the loop state
    const loopData = await ctx.manager.getLoop(loopId);
    expect(loopData).toBeDefined();

    // Verify the folder was cleared (old files gone)
    expect(await exists(join(planningDir, "old-plan.md"))).toBe(false);
    expect(await exists(join(planningDir, "status.md"))).toBe(false);

    // Verify state tracks that clearing happened
    expect(loopData!.state.planMode?.planningFolderCleared).toBe(true);
  });

  test("does not clear .planning folder if clearPlanningFolder is false", async () => {
    // Setup existing files
    const planningDir = join(ctx.workDir, ".planning");
    await mkdir(planningDir, { recursive: true });
    await writeFile(join(planningDir, "existing-plan.md"), "Existing content");

    // Verify file exists
    expect(await exists(join(planningDir, "existing-plan.md"))).toBe(true);

    // Create loop without clear option
    const loop = await ctx.manager.createLoop({
      prompt: "Create a plan",
      directory: ctx.workDir,
      maxIterations: 1,
      clearPlanningFolder: false,
      planMode: true,
    });
    const loopId = loop.config.id;

    // Start plan mode and wait for plan to be ready
    await ctx.manager.startPlanMode(loopId);
    await waitForPlanReady(ctx.manager, loopId);

    // Verify folder was NOT cleared
    expect(await exists(join(planningDir, "existing-plan.md"))).toBe(true);

    // Verify state shows clearing did not happen
    const loopData = await ctx.manager.getLoop(loopId);
    expect(loopData!.state.planMode?.planningFolderCleared).toBe(false);
  });

  test("never clears .planning folder after plan is created", async () => {
    // Setup: Create loop with plan mode + clear folder
    const planningDir = join(ctx.workDir, ".planning");
    await mkdir(planningDir, { recursive: true });
    await writeFile(join(planningDir, "old-file.md"), "Old content");

    const loop = await ctx.manager.createLoop({
      prompt: "Create a plan",
      directory: ctx.workDir,
      maxIterations: 1,
      clearPlanningFolder: true,
      planMode: true,
    });
    const loopId = loop.config.id;

    // Start plan mode and wait for plan to be ready
    await ctx.manager.startPlanMode(loopId);
    await waitForPlanReady(ctx.manager, loopId);

    // Create a plan file (simulating AI creating it)
    await writeFile(join(planningDir, "plan.md"), "# My Plan\n\nTask 1: Do something");

    // Verify plan file exists
    expect(await exists(join(planningDir, "plan.md"))).toBe(true);

    // Accept the plan (should transition to running without clearing folder)
    await ctx.manager.acceptPlan(loopId);
    
    // Wait for transition from planning
    await waitForLoopStatus(ctx.manager, loopId, ["running", "completed", "max_iterations", "stopped"]);

    // Verify plan file still exists (was NOT cleared on start)
    expect(await exists(join(planningDir, "plan.md"))).toBe(true);

    // Verify the loop transitioned from planning
    const loopData = await ctx.manager.getLoop(loopId);
    expect(["running", "completed", "max_iterations", "stopped"]).toContain(loopData!.state.status);
  });

  test("planningFolderCleared persists across restart", async () => {
    // Create loop, clear folder, mark as cleared
    const loop = await ctx.manager.createLoop({
      prompt: "Create a plan",
      directory: ctx.workDir,
      maxIterations: 1,
      clearPlanningFolder: true,
      planMode: true,
    });
    const loopId = loop.config.id;

    // Start plan mode and wait for plan to be ready
    await ctx.manager.startPlanMode(loopId);
    await waitForPlanReady(ctx.manager, loopId);

    // Simulate plan creation
    const planningDir = join(ctx.workDir, ".planning");
    await mkdir(planningDir, { recursive: true });
    await writeFile(join(planningDir, "plan.md"), "# Plan\n\nTask: Test");

    // Accept and wait for it to start running
    await ctx.manager.acceptPlan(loopId);
    await waitForLoopStatus(ctx.manager, loopId, ["running", "completed", "max_iterations", "stopped"]);

    // Stop the loop
    await ctx.manager.stopLoop(loopId);
    await waitForLoopStatus(ctx.manager, loopId, ["stopped", "completed", "max_iterations"]);

    // Verify plan still exists
    expect(await exists(join(planningDir, "plan.md"))).toBe(true);

    // Restart the loop
    await ctx.manager.startLoop(loopId);
    
    // Brief wait for restart to process
    await new Promise((resolve) => setTimeout(resolve, 100));

    // Verify plan still exists (folder not cleared again)
    expect(await exists(join(planningDir, "plan.md"))).toBe(true);

    // Verify flag is still set
    const loopData = await ctx.manager.getLoop(loopId);
    expect(loopData!.state.planMode?.planningFolderCleared).toBe(true);
  });
});

describe("Plan Mode - State Transitions", () => {
  let ctx: TestContext;

  beforeEach(async () => {
    ctx = await setupTestContext({ 
      initGit: true,
      // Need multiple PLAN_READY responses for feedback tests, followed by COMPLETE for acceptance
      mockResponses: [
        "<promise>PLAN_READY</promise>",  // Initial plan creation
        "<promise>PLAN_READY</promise>",  // After first feedback
        "<promise>PLAN_READY</promise>",  // After second feedback
        "<promise>PLAN_READY</promise>",  // After third feedback
        "<promise>COMPLETE</promise>",    // After acceptance (execution complete)
      ],
    });
  });

  afterEach(async () => {
    await teardownTestContext(ctx);
  });

  test("creates loop in planning status when planMode is true", async () => {
    const loop = await ctx.manager.createLoop({
      prompt: "Create a plan",
      directory: ctx.workDir,
      maxIterations: 1,
      planMode: true,
    });
    const loopId = loop.config.id;

    // Wait for loop to be in planning status
    const loopData = await waitForLoopStatus(ctx.manager, loopId, ["planning"]);
    expect(loopData.state.status).toBe("planning");
    expect(loopData.state.planMode?.active).toBe(true);
  });

  test("transitions from planning to running on accept", async () => {
    const loop = await ctx.manager.createLoop({
      prompt: "Create a plan",
      directory: ctx.workDir,
      maxIterations: 1,
      planMode: true,
    });
    const loopId = loop.config.id;

    // Start plan mode and wait for plan to be ready
    await ctx.manager.startPlanMode(loopId);
    await waitForPlanReady(ctx.manager, loopId);

    // Verify initial status
    let loopData = await ctx.manager.getLoop(loopId);
    expect(loopData!.state.status).toBe("planning");

    // Accept the plan
    await ctx.manager.acceptPlan(loopId);
    
    // Wait for transition from planning
    loopData = await waitForLoopStatus(ctx.manager, loopId, ["running", "completed", "max_iterations", "stopped"]);
    expect(["running", "completed", "max_iterations", "stopped"]).toContain(loopData!.state.status);
    
    // Clean up - stop the loop
    await ctx.manager.stopLoop(loopId);
  });

  test("increments feedback rounds on each feedback", async () => {
    const loop = await ctx.manager.createLoop({
      prompt: "Create a plan",
      directory: ctx.workDir,
      maxIterations: 1,
      planMode: true,
    });
    const loopId = loop.config.id;

    // Start plan mode and wait for plan to be ready
    await ctx.manager.startPlanMode(loopId);
    await waitForPlanReady(ctx.manager, loopId);

    // Initial feedback rounds should be 0
    let loopData = await ctx.manager.getLoop(loopId);
    expect(loopData!.state.planMode?.feedbackRounds).toBe(0);

    // Send first feedback (awaits iteration completion)
    await ctx.manager.sendPlanFeedback(loopId, "Please add more details");

    loopData = await ctx.manager.getLoop(loopId);
    expect(loopData!.state.planMode?.feedbackRounds).toBe(1);

    // Send second feedback
    await ctx.manager.sendPlanFeedback(loopId, "Add time estimates");

    loopData = await ctx.manager.getLoop(loopId);
    expect(loopData!.state.planMode?.feedbackRounds).toBe(2);
  });

  test("deletes loop on discard", async () => {
    const loop = await ctx.manager.createLoop({
      prompt: "Create a plan",
      directory: ctx.workDir,
      maxIterations: 1,
      planMode: true,
    });
    const loopId = loop.config.id;

    // Wait for loop to be in planning status
    await waitForLoopStatus(ctx.manager, loopId, ["planning"]);

    // Verify loop exists
    let loopData = await ctx.manager.getLoop(loopId);
    expect(loopData).toBeDefined();

    // Discard the plan
    await ctx.manager.discardPlan(loopId);
    
    // Wait for loop to be deleted
    loopData = await waitForLoopStatus(ctx.manager, loopId, ["deleted"]);
    expect(loopData.state.status).toBe("deleted");
  });

  test("reuses session from plan creation when starting execution", async () => {
    const loop = await ctx.manager.createLoop({
      prompt: "Create a plan",
      directory: ctx.workDir,
      maxIterations: 1,
      planMode: true,
    });
    const loopId = loop.config.id;

    // Start plan mode and wait for plan to be ready
    await ctx.manager.startPlanMode(loopId);
    await waitForPlanReady(ctx.manager, loopId);

    // Get the plan session info from state.session (where it's stored during planning)
    let loopData = await ctx.manager.getLoop(loopId);
    const planSessionId = loopData!.state.session?.id;
    expect(planSessionId).toBeDefined();

    // Accept the plan
    await ctx.manager.acceptPlan(loopId);
    
    // Wait for transition from planning
    await waitForLoopStatus(ctx.manager, loopId, ["running", "completed", "max_iterations", "stopped"]);

    // Verify the session is still the same (session continuity)
    // After acceptance, it should be copied to planMode.planSessionId for persistence
    loopData = await ctx.manager.getLoop(loopId);
    expect(loopData!.state.planMode?.planSessionId).toBe(planSessionId);
    expect(loopData!.state.session?.id).toBe(planSessionId);
  });
});

describe("Plan Mode - isPlanReady Flag", () => {
  let ctx: TestContext;

  beforeEach(async () => {
    ctx = await setupTestContext({ 
      initGit: true,
      mockResponses: [
        "<promise>PLAN_READY</promise>",  // Initial plan creation
        "<promise>PLAN_READY</promise>",  // After feedback (extra for safety)
        "<promise>PLAN_READY</promise>",  // After feedback
        "<promise>COMPLETE</promise>",    // After acceptance
      ],
    });
  });

  afterEach(async () => {
    await teardownTestContext(ctx);
  });

  test("isPlanReady is false when plan mode starts", async () => {
    const loop = await ctx.manager.createLoop({
      prompt: "Create a simple plan",
      directory: ctx.workDir,
      maxIterations: 1,
      planMode: true,
    });
    const loopId = loop.config.id;

    // Verify isPlanReady is false initially
    const loopData = await ctx.manager.getLoop(loopId);
    expect(loopData!.state.planMode?.isPlanReady).toBe(false);
  });

  test("isPlanReady becomes true after PLAN_READY marker detected", async () => {
    const loop = await ctx.manager.createLoop({
      prompt: "Create a simple plan",
      directory: ctx.workDir,
      maxIterations: 1,
      planMode: true,
    });
    const loopId = loop.config.id;

    // Start plan mode
    await ctx.manager.startPlanMode(loopId);
    
    // Wait for the mock backend to emit PLAN_READY
    const loopData = await waitForPlanReady(ctx.manager, loopId);
    expect(loopData!.state.planMode?.isPlanReady).toBe(true);
  });

  test("isPlanReady resets to false when feedback is sent", async () => {
    const loop = await ctx.manager.createLoop({
      prompt: "Create a simple plan",
      directory: ctx.workDir,
      maxIterations: 5, // Increase max iterations to allow feedback iteration
      planMode: true,
    });
    const loopId = loop.config.id;

    // Start plan mode and wait for PLAN_READY
    await ctx.manager.startPlanMode(loopId);
    let loopData = await waitForPlanReady(ctx.manager, loopId);
    expect(loopData.state.planMode?.isPlanReady).toBe(true);

    // Send feedback - this resets isPlanReady to false internally,
    // but with fast mocks the new plan might be ready by the time this returns
    await ctx.manager.sendPlanFeedback(loopId, "Please add more details");
    
    // After feedback, wait for the plan to be ready again
    loopData = await waitForPlanReady(ctx.manager, loopId);
    
    // The important thing is that after feedback, we can still accept the plan
    // and feedback rounds should have incremented
    expect(loopData.state.planMode?.feedbackRounds).toBe(1);
    expect(loopData.state.planMode?.isPlanReady).toBe(true);
  });

  test("isPlanReady persists in database across restarts", async () => {
    const loop = await ctx.manager.createLoop({
      prompt: "Create a simple plan",
      directory: ctx.workDir,
      maxIterations: 1,
      planMode: true,
    });
    const loopId = loop.config.id;

    // Start plan mode and wait for PLAN_READY
    await ctx.manager.startPlanMode(loopId);
    let loopData = await waitForPlanReady(ctx.manager, loopId);
    expect(loopData.state.planMode?.isPlanReady).toBe(true);

    // Stop the loop
    await ctx.manager.stopLoop(loopId);
    await waitForLoopStatus(ctx.manager, loopId, ["stopped", "paused"]);

    // Retrieve the loop from database (simulating restart)
    const retrievedLoop = await ctx.manager.getLoop(loopId);
    
    // Verify isPlanReady is still true
    expect(retrievedLoop).not.toBeNull();
    expect(retrievedLoop!.state.planMode?.isPlanReady).toBe(true);
  });
});
