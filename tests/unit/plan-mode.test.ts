/**
 * Unit tests for Plan Mode functionality.
 * Tests clearPlanningFolder behavior and state transitions.
 */

import { test, expect, describe, beforeEach, afterEach } from "bun:test";
import { mkdir, writeFile } from "fs/promises";
import { join } from "path";
import { setupTestContext, teardownTestContext, waitForEvent, delay } from "../setup";
import type { TestContext } from "../setup";

// Helper to check if a file exists
async function exists(path: string): Promise<boolean> {
  return Bun.file(path).exists();
}

describe("Plan Mode - Clear Planning Folder", () => {
  let ctx: TestContext;

  beforeEach(async () => {
    ctx = await setupTestContext({ initGit: true });
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
      name: "Test Plan Mode Clear",
      prompt: "Create a simple plan",
      directory: ctx.workDir,
      maxIterations: 1,
      clearPlanningFolder: true,
      planMode: true,
    });
    const loopId = loop.config.id;

    // Start plan mode (this is when clearing happens)
    await ctx.manager.startPlanMode(loopId);

    // Wait a bit for the plan creation to start
    await delay(200);

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
      name: "Test No Clear",
      prompt: "Create a plan",
      directory: ctx.workDir,
      maxIterations: 1,
      clearPlanningFolder: false,
      planMode: true,
    });
    const loopId = loop.config.id;

    // Start plan mode
    await ctx.manager.startPlanMode(loopId);
    await delay(200);

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
      name: "Test Plan Persistence",
      prompt: "Create a plan",
      directory: ctx.workDir,
      maxIterations: 1,
      clearPlanningFolder: true,
      planMode: true,
    });
    const loopId = loop.config.id;

    // Start plan mode
    await ctx.manager.startPlanMode(loopId);

    // Wait for mock backend to create plan
    await delay(500);

    // Create a plan file (simulating AI creating it)
    await writeFile(join(planningDir, "plan.md"), "# My Plan\n\nTask 1: Do something");

    // Verify plan file exists
    expect(await exists(join(planningDir, "plan.md"))).toBe(true);

    // Accept the plan (should transition to running without clearing folder)
    await ctx.manager.acceptPlan(loopId);
    await delay(200);

    // Verify plan file still exists (was NOT cleared on start)
    expect(await exists(join(planningDir, "plan.md"))).toBe(true);

    // Verify the loop transitioned to running
    const loopData = await ctx.manager.getLoop(loopId);
    expect(loopData!.state.status).toBe("running");
  });

  test("planningFolderCleared persists across restart", async () => {
    // Create loop, clear folder, mark as cleared
    const loop = await ctx.manager.createLoop({
      name: "Test Persistence",
      prompt: "Create a plan",
      directory: ctx.workDir,
      maxIterations: 1,
      clearPlanningFolder: true,
      planMode: true,
    });
    const loopId = loop.config.id;

    // Start plan mode
    await ctx.manager.startPlanMode(loopId);
    await delay(500);

    // Simulate plan creation
    const planningDir = join(ctx.workDir, ".planning");
    await mkdir(planningDir, { recursive: true });
    await writeFile(join(planningDir, "plan.md"), "# Plan\n\nTask: Test");

    // Accept and wait for it to start running
    await ctx.manager.acceptPlan(loopId);
    await delay(300);

    // Stop the loop
    await ctx.manager.stopLoop(loopId);
    await delay(200);

    // Verify plan still exists
    expect(await exists(join(planningDir, "plan.md"))).toBe(true);

    // Restart the loop
    await ctx.manager.startLoop(loopId);
    await delay(300);

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
    ctx = await setupTestContext({ initGit: true });
  });

  afterEach(async () => {
    await teardownTestContext(ctx);
  });

  test("creates loop in planning status when planMode is true", async () => {
    const loop = await ctx.manager.createLoop({
      name: "Test Planning Status",
      prompt: "Create a plan",
      directory: ctx.workDir,
      maxIterations: 1,
      planMode: true,
    });
    const loopId = loop.config.id;

    await delay(100);

    const loopData = await ctx.manager.getLoop(loopId);
    expect(loopData).toBeDefined();
    expect(loopData!.state.status).toBe("planning");
    expect(loopData!.state.planMode?.active).toBe(true);
  });

  test("transitions from planning to running on accept", async () => {
    const loop = await ctx.manager.createLoop({
      name: "Test Accept Transition",
      prompt: "Create a plan",
      directory: ctx.workDir,
      maxIterations: 1,
      planMode: true,
    });
    const loopId = loop.config.id;

    // Start plan mode
    await ctx.manager.startPlanMode(loopId);
    await delay(200);

    // Verify initial status
    let loopData = await ctx.manager.getLoop(loopId);
    expect(loopData!.state.status).toBe("planning");

    // Accept the plan
    await ctx.manager.acceptPlan(loopId);
    await delay(200);

    // Verify transition to running
    loopData = await ctx.manager.getLoop(loopId);
    expect(loopData!.state.status).toBe("running");

    // Wait for completion event
    await waitForEvent(ctx.events, "loop.completed", 5000);
  });

  test("increments feedback rounds on each feedback", async () => {
    const loop = await ctx.manager.createLoop({
      name: "Test Feedback Rounds",
      prompt: "Create a plan",
      directory: ctx.workDir,
      maxIterations: 1,
      planMode: true,
    });
    const loopId = loop.config.id;

    // Start plan mode
    await ctx.manager.startPlanMode(loopId);
    await delay(200);

    // Initial feedback rounds should be 0
    let loopData = await ctx.manager.getLoop(loopId);
    expect(loopData!.state.planMode?.feedbackRounds).toBe(0);

    // Send first feedback
    await ctx.manager.sendPlanFeedback(loopId, "Please add more details");
    await delay(200);

    loopData = await ctx.manager.getLoop(loopId);
    expect(loopData!.state.planMode?.feedbackRounds).toBe(1);

    // Send second feedback
    await ctx.manager.sendPlanFeedback(loopId, "Add time estimates");
    await delay(200);

    loopData = await ctx.manager.getLoop(loopId);
    expect(loopData!.state.planMode?.feedbackRounds).toBe(2);
  });

  test("deletes loop on discard", async () => {
    const loop = await ctx.manager.createLoop({
      name: "Test Discard",
      prompt: "Create a plan",
      directory: ctx.workDir,
      maxIterations: 1,
      planMode: true,
    });
    const loopId = loop.config.id;

    await delay(200);

    // Verify loop exists
    let loopData = await ctx.manager.getLoop(loopId);
    expect(loopData).toBeDefined();

    // Discard the plan
    await ctx.manager.discardPlan(loopId);
    await delay(200);

    // Verify loop is deleted (should return deleted status, not null)
    loopData = await ctx.manager.getLoop(loopId);
    expect(loopData!.state.status).toBe("deleted");
  });

  test("reuses session from plan creation when starting execution", async () => {
    const loop = await ctx.manager.createLoop({
      name: "Test Session Continuity",
      prompt: "Create a plan",
      directory: ctx.workDir,
      maxIterations: 1,
      planMode: true,
    });
    const loopId = loop.config.id;

    // Start plan mode
    await ctx.manager.startPlanMode(loopId);
    await delay(200);

    // Get the plan session info
    let loopData = await ctx.manager.getLoop(loopId);
    const planSessionId = loopData!.state.planMode?.planSessionId;
    expect(planSessionId).toBeDefined();

    // Accept the plan
    await ctx.manager.acceptPlan(loopId);
    await delay(200);

    // Verify the session is still the same (session continuity)
    loopData = await ctx.manager.getLoop(loopId);
    expect(loopData!.state.planMode?.planSessionId).toBe(planSessionId);
  });
});
