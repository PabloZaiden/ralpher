/**
 * E2E tests for full loop workflow.
 * Tests the complete lifecycle of a Ralph Loop from creation to completion.
 */

import { test, expect, describe, beforeEach, afterEach } from "bun:test";
import {
  setupTestContext,
  teardownTestContext,
  waitForEvent,
  countEvents,
  getEvents,
  type TestContext,
} from "../setup";

describe("Full Loop Workflow", () => {
  let ctx: TestContext;

  beforeEach(async () => {
    ctx = await setupTestContext({
      useMockBackend: true,
      mockResponses: [
        "Working on iteration 1...",
        "Working on iteration 2...",
        "Done! <promise>COMPLETE</promise>",
      ],
    });
  });

  afterEach(async () => {
    await teardownTestContext(ctx);
  });

  describe("Loop Creation", () => {
    test("creates a loop via manager with correct defaults", async () => {
      const loop = await ctx.manager.createLoop({
        name: "Test Loop",
        directory: ctx.workDir,
        prompt: "Implement a feature",
      });

      expect(loop.config.id).toBeDefined();
      expect(loop.config.name).toBe("Test Loop");
      expect(loop.config.directory).toBe(ctx.workDir);
      expect(loop.config.prompt).toBe("Implement a feature");
      expect(loop.config.backend.type).toBe("opencode");
      expect(loop.config.backend.mode).toBe("spawn");
      expect(loop.config.git.enabled).toBe(true);
      expect(loop.state.status).toBe("idle");
      expect(loop.state.currentIteration).toBe(0);

      // Verify creation event was emitted
      expect(countEvents(ctx.events, "loop.created")).toBe(1);
    });

    test("creates a loop with custom options", async () => {
      const loop = await ctx.manager.createLoop({
        name: "Custom Loop",
        directory: ctx.workDir,
        prompt: "Custom task",
        backendMode: "connect",
        backendHostname: "localhost",
        backendPort: 8080,
        maxIterations: 10,
        gitEnabled: false,
      });

      expect(loop.config.backend.mode).toBe("connect");
      expect(loop.config.backend.hostname).toBe("localhost");
      expect(loop.config.backend.port).toBe(8080);
      expect(loop.config.maxIterations).toBe(10);
      expect(loop.config.git.enabled).toBe(false);
    });

    test("persists loop to disk", async () => {
      const loop = await ctx.manager.createLoop({
        name: "Persisted Loop",
        directory: ctx.workDir,
        prompt: "Test persistence",
      });

      // Get the loop back from the manager
      const fetched = await ctx.manager.getLoop(loop.config.id);
      expect(fetched).not.toBeNull();
      expect(fetched!.config.name).toBe("Persisted Loop");
    });
  });

  describe("Loop Execution", () => {
    test("starts loop and runs through iterations until completion", async () => {
      const loop = await ctx.manager.createLoop({
        name: "Execute Loop",
        directory: ctx.workDir,
        prompt: "Do the work",
        gitEnabled: false, // Disable git for simpler test
      });

      // Start the loop
      await ctx.manager.startLoop(loop.config.id);

      // Wait for completion
      await waitForEvent(ctx.events, "loop.completed");

      // Check final state
      const finalLoop = await ctx.manager.getLoop(loop.config.id);
      expect(finalLoop).not.toBeNull();
      expect(finalLoop!.state.status).toBe("completed");
      expect(finalLoop!.state.currentIteration).toBe(3);

      // Verify event sequence
      expect(countEvents(ctx.events, "loop.started")).toBe(1);
      expect(countEvents(ctx.events, "loop.iteration.start")).toBe(3);
      expect(countEvents(ctx.events, "loop.iteration.end")).toBe(3);
      expect(countEvents(ctx.events, "loop.completed")).toBe(1);

      // Verify iteration outcomes
      const iterationEndEvents = getEvents(ctx.events, "loop.iteration.end");
      expect(iterationEndEvents[0]!.outcome).toBe("continue");
      expect(iterationEndEvents[1]!.outcome).toBe("continue");
      expect(iterationEndEvents[2]!.outcome).toBe("complete");
    });

    test("respects maxIterations limit", async () => {
      // Configure mock to never complete
      ctx.mockBackend!.setResponses([
        "Still working...",
        "More work...",
        "Even more...",
        "Never ending...",
      ]);

      const loop = await ctx.manager.createLoop({
        name: "Limited Loop",
        directory: ctx.workDir,
        prompt: "Work forever",
        maxIterations: 2,
        gitEnabled: false,
      });

      await ctx.manager.startLoop(loop.config.id);

      // Wait for max iterations status
      await waitForEvent(ctx.events, "loop.stopped");

      const finalLoop = await ctx.manager.getLoop(loop.config.id);
      expect(finalLoop!.state.status).toBe("max_iterations");
      expect(finalLoop!.state.currentIteration).toBe(2);
    });

    test("can stop a running loop", async () => {
      // Configure slow responses so we have time to stop
      ctx.mockBackend!.setResponses([
        "Working on iteration 1...",
        "Working on iteration 2...",
        "Working on iteration 3...",
        "<promise>COMPLETE</promise>",
      ]);

      const loop = await ctx.manager.createLoop({
        name: "Stoppable Loop",
        directory: ctx.workDir,
        prompt: "Do work",
        gitEnabled: false,
      });

      // Start the loop
      const startPromise = ctx.manager.startLoop(loop.config.id);

      // Wait for first iteration to start
      await waitForEvent(ctx.events, "loop.iteration.start");

      // Stop the loop
      await ctx.manager.stopLoop(loop.config.id);

      // Wait for the start promise to resolve
      await startPromise;

      const finalLoop = await ctx.manager.getLoop(loop.config.id);
      expect(finalLoop!.state.status).toBe("stopped");
    });

    test("handles backend errors gracefully", async () => {
      // Configure mock to throw error
      ctx.mockBackend!.setThrowOnPrompt(true, "Backend crashed");

      const loop = await ctx.manager.createLoop({
        name: "Error Loop",
        directory: ctx.workDir,
        prompt: "Cause error",
        gitEnabled: false,
        // Set maxConsecutiveErrors to 1 so it fails after first error
        maxConsecutiveErrors: 1,
      });

      await ctx.manager.startLoop(loop.config.id);

      // Wait for error event
      await waitForEvent(ctx.events, "loop.error");

      const finalLoop = await ctx.manager.getLoop(loop.config.id);
      expect(finalLoop!.state.status).toBe("failed");
      expect(finalLoop!.state.error?.message).toContain("Backend crashed");
    });
  });

  describe("Loop CRUD Operations", () => {
    test("lists all loops", async () => {
      await ctx.manager.createLoop({
        name: "Loop 1",
        directory: ctx.workDir,
        prompt: "Task 1",
      });

      await ctx.manager.createLoop({
        name: "Loop 2",
        directory: ctx.workDir,
        prompt: "Task 2",
      });

      await ctx.manager.createLoop({
        name: "Loop 3",
        directory: ctx.workDir,
        prompt: "Task 3",
      });

      const loops = await ctx.manager.getAllLoops();
      expect(loops.length).toBe(3);
    });

    test("updates loop configuration", async () => {
      const loop = await ctx.manager.createLoop({
        name: "Original",
        directory: ctx.workDir,
        prompt: "Original prompt",
      });

      const updated = await ctx.manager.updateLoop(loop.config.id, {
        name: "Updated Name",
        prompt: "Updated prompt",
      });

      expect(updated).not.toBeNull();
      expect(updated!.config.name).toBe("Updated Name");
      expect(updated!.config.prompt).toBe("Updated prompt");

      // Verify persistence
      const fetched = await ctx.manager.getLoop(loop.config.id);
      expect(fetched!.config.name).toBe("Updated Name");
    });

    test("deletes a loop", async () => {
      const loop = await ctx.manager.createLoop({
        name: "To Delete",
        directory: ctx.workDir,
        prompt: "Delete me",
      });

      const deleted = await ctx.manager.deleteLoop(loop.config.id);
      expect(deleted).toBe(true);

      const fetched = await ctx.manager.getLoop(loop.config.id);
      expect(fetched).toBeNull();

      // Verify delete event
      expect(countEvents(ctx.events, "loop.deleted")).toBe(1);
    });

    test("returns null/false for non-existent loops", async () => {
      const fetched = await ctx.manager.getLoop("non-existent");
      expect(fetched).toBeNull();

      const updated = await ctx.manager.updateLoop("non-existent", { name: "Test" });
      expect(updated).toBeNull();

      const deleted = await ctx.manager.deleteLoop("non-existent");
      expect(deleted).toBe(false);
    });
  });

  describe("Loop State Tracking", () => {
    test("tracks running state correctly", async () => {
      const loop = await ctx.manager.createLoop({
        name: "Track State",
        directory: ctx.workDir,
        prompt: "Track me",
        gitEnabled: false,
      });

      // Before start
      expect(ctx.manager.isRunning(loop.config.id)).toBe(false);

      // Start the loop
      await ctx.manager.startLoop(loop.config.id);

      // Wait for completion
      await waitForEvent(ctx.events, "loop.completed");

      // After completion, check the loop state (isRunning may still be true 
      // until the periodic state persistence clears it)
      const finalLoop = await ctx.manager.getLoop(loop.config.id);
      expect(finalLoop!.state.status).toBe("completed");
    });

    test("records iteration summaries", async () => {
      const loop = await ctx.manager.createLoop({
        name: "Summary Loop",
        directory: ctx.workDir,
        prompt: "Track iterations",
        gitEnabled: false,
      });

      await ctx.manager.startLoop(loop.config.id);
      await waitForEvent(ctx.events, "loop.completed");

      const finalLoop = await ctx.manager.getLoop(loop.config.id);
      expect(finalLoop!.state.recentIterations.length).toBe(3);

      // Check iteration 1
      const iter1 = finalLoop!.state.recentIterations[0]!;
      expect(iter1.iteration).toBe(1);
      expect(iter1.outcome).toBe("continue");

      // Check iteration 3 (completion)
      const iter3 = finalLoop!.state.recentIterations[2]!;
      expect(iter3.iteration).toBe(3);
      expect(iter3.outcome).toBe("complete");
    });
  });
});
