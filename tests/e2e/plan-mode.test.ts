/**
 * E2E tests for Plan Mode workflow.
 * Tests the complete plan mode workflow from creation to execution.
 */

import { test, expect, describe, beforeEach, afterEach } from "bun:test";
import { mkdir, writeFile } from "fs/promises";
import { join } from "path";
import { setupTestContext, teardownTestContext, delay } from "../setup";
import type { TestContext } from "../setup";
import type { Loop } from "../../src/types";

// Helper to check if file exists
async function exists(path: string): Promise<boolean> {
  return Bun.file(path).exists();
}

describe("Plan Mode E2E Workflow", () => {
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

  test("full plan mode workflow: create -> feedback -> accept -> complete", async () => {
    const planningDir = join(ctx.workDir, ".planning");
    await mkdir(planningDir, { recursive: true });

    // 1. Create loop with plan mode
    const loop = await ctx.manager.createLoop({
      name: "E2E Plan Mode Test",
      prompt: "Create a simple implementation plan",
      directory: ctx.workDir,
      maxIterations: 2,
      planMode: true,
    });
    const loopId = loop.config.id;

    // Start plan mode
    await ctx.manager.startPlanMode(loopId);

    // 2. Wait for AI to create initial plan
    await delay(500);

    // 3. Verify loop is in planning status
    let loopData: Loop | null = await ctx.manager.getLoop(loopId);
    expect(loopData).toBeDefined();
    expect(loopData!.state.status).toBe("planning");
    expect(loopData!.state.planMode?.active).toBe(true);

    // 4. Create a plan file (simulating AI creating it)
    const planContent = "# Implementation Plan\n\n## Task 1\nImplement feature X\n\n## Task 2\nAdd tests";
    await writeFile(join(planningDir, "plan.md"), planContent);

    // 5. Verify plan file exists
    expect(await exists(join(planningDir, "plan.md"))).toBe(true);

    // 6. Send feedback
    await ctx.manager.sendPlanFeedback(loopId, "Please add time estimates to each task");
    await delay(300);

    // 7. Verify feedback rounds incremented
    loopData = await ctx.manager.getLoop(loopId);
    expect(loopData!.state.planMode?.feedbackRounds).toBe(1);

    // 8. Update plan (simulating AI updating it)
    const updatedPlan = "# Implementation Plan\n\n## Task 1 (2 hours)\nImplement feature X\n\n## Task 2 (1 hour)\nAdd tests";
    await writeFile(join(planningDir, "plan.md"), updatedPlan);

    // 9. Verify plan was updated
    const planFile = Bun.file(join(planningDir, "plan.md"));
    const planText = await planFile.text();
    expect(planText).toContain("2 hours");
    expect(planText).toContain("1 hour");

    // 10. Accept the plan
    await ctx.manager.acceptPlan(loopId);
    await delay(300);

    // 11. Verify loop has transitioned from planning (could be running or already completed)
    loopData = await ctx.manager.getLoop(loopId);
    expect(["running", "completed", "max_iterations", "stopped"]).toContain(loopData!.state.status);

    // 12. Verify plan was NOT cleared on start
    expect(await exists(join(planningDir, "plan.md"))).toBe(true);

    // 13. Stop the loop (completion test would require more sophisticated mock)
    await ctx.manager.stopLoop(loopId);
    
    // 14. Verify plan still exists after stop
    expect(await exists(join(planningDir, "plan.md"))).toBe(true);
  });

  test("discard plan workflow", async () => {
    // 1. Create loop with plan mode
    const loop = await ctx.manager.createLoop({
      name: "Test Discard Workflow",
      prompt: "Create a plan",
      directory: ctx.workDir,
      maxIterations: 1,
      planMode: true,
    });
    const loopId = loop.config.id;

    // 2. Wait for plan creation
    await delay(300);

    // 3. Verify loop exists and is in planning status
    let loopData: Loop | null = await ctx.manager.getLoop(loopId);
    expect(loopData).toBeDefined();
    expect(loopData!.state.status).toBe("planning");

    // 4. Create plan file
    const planningDir = join(ctx.workDir, ".planning");
    await mkdir(planningDir, { recursive: true });
    await writeFile(join(planningDir, "plan.md"), "# Plan to discard");

    // 5. Discard the plan
    const result = await ctx.manager.discardPlan(loopId);
    expect(result).toBe(true);
    await delay(200);

    // 6. Verify loop deleted (returns with deleted status, not null)
    loopData = await ctx.manager.getLoop(loopId);
    expect(loopData!.state.status).toBe("deleted");

    // 7. Verify discarded event was emitted
    const discardEvents = ctx.events.filter((e) => e.type === "loop.plan.discarded");
    expect(discardEvents.length).toBeGreaterThan(0);
  });

  test("multiple feedback rounds", async () => {
    // 1. Create loop
    const loop = await ctx.manager.createLoop({
      name: "Test Multiple Feedback",
      prompt: "Create a detailed plan",
      directory: ctx.workDir,
      maxIterations: 1,
      planMode: true,
    });
    const loopId = loop.config.id;

    // Start plan mode
    await ctx.manager.startPlanMode(loopId);
    await delay(300);

    // 2. Send feedback 3 times
    await ctx.manager.sendPlanFeedback(loopId, "Feedback round 1");
    await delay(200);

    await ctx.manager.sendPlanFeedback(loopId, "Feedback round 2");
    await delay(200);

    await ctx.manager.sendPlanFeedback(loopId, "Feedback round 3");
    await delay(200);

    // 3. Verify round counter is 3
    const loopData: Loop | null = await ctx.manager.getLoop(loopId);
    expect(loopData!.state.planMode?.feedbackRounds).toBe(3);

    // 4. Verify feedback events were emitted
    const feedbackEvents = ctx.events.filter((e) => e.type === "loop.plan.feedback");
    expect(feedbackEvents.length).toBe(3);

    // 5. Accept and verify execution starts (or has already completed due to mock)
    await ctx.manager.acceptPlan(loopId);
    await delay(300);

    const finalLoop = await ctx.manager.getLoop(loopId);
    // The loop should have transitioned from planning - could be running or already completed
    expect(["running", "completed", "max_iterations", "stopped"]).toContain(finalLoop!.state.status);

    // 6. Verify accept event was emitted
    const acceptEvents = ctx.events.filter((e) => e.type === "loop.plan.accepted");
    expect(acceptEvents.length).toBe(1);
  });

  test("plan mode with clearPlanningFolder preserves plan after acceptance", async () => {
    // Setup: Create existing files to be cleared
    const planningDir = join(ctx.workDir, ".planning");
    await mkdir(planningDir, { recursive: true });
    await writeFile(join(planningDir, "old-file.md"), "Old content");

    // Create loop with clearPlanningFolder enabled
    const loop = await ctx.manager.createLoop({
      name: "Test Clear and Preserve",
      prompt: "Create a plan",
      directory: ctx.workDir,
      maxIterations: 1,
      clearPlanningFolder: true,
      planMode: true,
    });
    const loopId = loop.config.id;

    // Start plan mode (this is when clearing happens)
    await ctx.manager.startPlanMode(loopId);
    await delay(500);

    // Verify old file was cleared
    expect(await exists(join(planningDir, "old-file.md"))).toBe(false);

    // Create new plan (simulating AI)
    await writeFile(join(planningDir, "plan.md"), "# New Plan");
    await writeFile(join(planningDir, "status.md"), "Status: In progress");

    // Verify new files exist
    expect(await exists(join(planningDir, "plan.md"))).toBe(true);
    expect(await exists(join(planningDir, "status.md"))).toBe(true);

    // Accept the plan
    await ctx.manager.acceptPlan(loopId);
    await delay(300);

    // Verify files still exist (not cleared on accept)
    expect(await exists(join(planningDir, "plan.md"))).toBe(true);
    expect(await exists(join(planningDir, "status.md"))).toBe(true);

    // Verify planningFolderCleared flag is set
    const loopData: Loop | null = await ctx.manager.getLoop(loopId);
    expect(loopData!.state.planMode?.planningFolderCleared).toBe(true);
  });

  test("session continuity from planning to execution", async () => {
    // Create loop with plan mode
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
    await delay(300);

    // Get the planning session ID from state.session (where it's stored during planning)
    let loopData: Loop | null = await ctx.manager.getLoop(loopId);
    const planSessionId = loopData!.state.session?.id;
    expect(planSessionId).toBeDefined();

    // Send feedback (uses same session)
    await ctx.manager.sendPlanFeedback(loopId, "Add more details");
    await delay(200);

    // Verify session ID unchanged (still in state.session during planning)
    loopData = await ctx.manager.getLoop(loopId);
    expect(loopData!.state.session?.id).toBe(planSessionId);

    // Accept plan (transitions to execution with same session)
    await ctx.manager.acceptPlan(loopId);
    await delay(300);

    // Verify session ID preserved in both places after acceptance
    loopData = await ctx.manager.getLoop(loopId);
    expect(loopData!.state.planMode?.planSessionId).toBe(planSessionId);
    expect(loopData!.state.session?.id).toBe(planSessionId);
    // The loop should have transitioned from planning - could be running or already completed
    expect(["running", "completed", "max_iterations", "stopped"]).toContain(loopData!.state.status);

    // Verify the same session is being used for execution
    // (The mock backend creates unique session IDs, so if it's the same, it proves continuity)
  });
});
