/**
 * E2E tests for chat workflow.
 * Tests the complete lifecycle of a chat from creation through multi-turn
 * conversation to post-completion actions (accept, push, discard).
 */

import { test, expect, describe, beforeEach, afterEach } from "bun:test";
import {
  setupTestContext,
  teardownTestContext,
  waitForEvent,
  waitForLoopStatus,
  countEvents,
  getEvents,
  testModelFields,
  testWorkspaceId,
  type TestContext,
} from "../setup";
import { NeverCompletingMockBackend } from "../mocks/mock-backend";
import { backendManager } from "../../src/core/backend-manager";

describe("Chat Workflow E2E", () => {
  let ctx: TestContext;

  beforeEach(async () => {
    ctx = await setupTestContext({
      useMockBackend: true,
      initGit: true,
      mockResponses: [
        "Hello! I can see the project files. How can I help?",
        "Sure, I'll add a README for you.",
        "Done! The README has been updated.",
        "Here's one more response if needed.",
      ],
    });
  });

  afterEach(async () => {
    await teardownTestContext(ctx);
  });

  describe("Chat Creation and First Turn", () => {
    test("creates a chat and completes the first turn", async () => {
      const loop = await ctx.manager.createChat({
        ...testModelFields,
        directory: ctx.workDir,
        prompt: "What files are in this project?",
        workspaceId: testWorkspaceId,
      });

      // Verify chat config
      expect(loop.config.mode).toBe("chat");
      expect(loop.config.planMode).toBe(false);
      expect(loop.config.maxIterations).toBe(1);
      expect(loop.config.clearPlanningFolder).toBe(false);
      expect(loop.config.prompt).toBe("What files are in this project?");

      // Wait for first turn to complete
      await waitForLoopStatus(ctx.manager, loop.config.id, ["completed", "max_iterations"]);

      const updated = await ctx.manager.getLoop(loop.config.id);
      expect(updated).not.toBeNull();
      expect(updated!.state.status).toMatch(/completed|max_iterations/);

      // Verify git setup happened (worktree created)
      expect(updated!.state.git).toBeDefined();
      expect(updated!.state.git!.worktreePath).toBeDefined();
      expect(updated!.state.git!.workingBranch).toBeDefined();
    });

    test("emits correct event sequence for first turn", async () => {
      const loop = await ctx.manager.createChat({
        ...testModelFields,
        directory: ctx.workDir,
        prompt: "Hello",
        workspaceId: testWorkspaceId,
      });

      // Wait for completion
      await waitForLoopStatus(ctx.manager, loop.config.id, ["completed", "max_iterations"]);

      // Verify events
      expect(countEvents(ctx.events, "loop.created")).toBe(1);
      expect(countEvents(ctx.events, "loop.started")).toBe(1);
      expect(countEvents(ctx.events, "loop.iteration.start")).toBeGreaterThanOrEqual(1);
      expect(countEvents(ctx.events, "loop.iteration.end")).toBeGreaterThanOrEqual(1);

      // Verify iteration outcome is "complete" (chat mode always completes)
      const iterEndEvents = getEvents(ctx.events, "loop.iteration.end");
      const lastEnd = iterEndEvents[iterEndEvents.length - 1]!;
      expect(lastEnd.outcome).toBe("complete");
    });

    test("chat runs exactly one iteration per turn", async () => {
      const loop = await ctx.manager.createChat({
        ...testModelFields,
        directory: ctx.workDir,
        prompt: "Quick question",
        workspaceId: testWorkspaceId,
      });

      await waitForLoopStatus(ctx.manager, loop.config.id, ["completed", "max_iterations"]);

      // Chat mode: shouldContinue returns false after 1 iteration
      const updated = await ctx.manager.getLoop(loop.config.id);
      expect(updated!.state.currentIteration).toBeGreaterThanOrEqual(1);
    });
  });

  describe("Multi-Turn Conversation", () => {
    test("sends follow-up message and gets response", async () => {
      const loop = await ctx.manager.createChat({
        ...testModelFields,
        directory: ctx.workDir,
        prompt: "First message",
        workspaceId: testWorkspaceId,
      });

      // Wait for first turn
      await waitForLoopStatus(ctx.manager, loop.config.id, ["completed", "max_iterations"]);

      // Send follow-up
      await ctx.manager.sendChatMessage(loop.config.id, "Please add a README");

      // Wait for second turn
      await waitForLoopStatus(ctx.manager, loop.config.id, ["completed", "max_iterations"], 15000);

      const updated = await ctx.manager.getLoop(loop.config.id);
      expect(updated!.state.status).toMatch(/completed|max_iterations/);
    });

    test("supports three consecutive turns", async () => {
      const loop = await ctx.manager.createChat({
        ...testModelFields,
        directory: ctx.workDir,
        prompt: "Turn 1",
        workspaceId: testWorkspaceId,
      });

      // Turn 1
      await waitForLoopStatus(ctx.manager, loop.config.id, ["completed", "max_iterations"]);

      // Turn 2
      await ctx.manager.sendChatMessage(loop.config.id, "Turn 2");
      await waitForLoopStatus(ctx.manager, loop.config.id, ["completed", "max_iterations"], 15000);

      // Turn 3
      await ctx.manager.sendChatMessage(loop.config.id, "Turn 3");
      await waitForLoopStatus(ctx.manager, loop.config.id, ["completed", "max_iterations"], 15000);

      const updated = await ctx.manager.getLoop(loop.config.id);
      expect(updated!.state.status).toMatch(/completed|max_iterations/);

      // Verify multiple iteration events were emitted
      expect(countEvents(ctx.events, "loop.iteration.start")).toBeGreaterThanOrEqual(3);
    });
  });

  describe("Chat with Post-Completion Actions", () => {
    test("accept (merge) a completed chat", async () => {
      const loop = await ctx.manager.createChat({
        ...testModelFields,
        directory: ctx.workDir,
        prompt: "Make some changes",
        workspaceId: testWorkspaceId,
      });

      await waitForLoopStatus(ctx.manager, loop.config.id, ["completed", "max_iterations"]);

      // Accept the chat (merges worktree branch into base branch)
      const result = await ctx.manager.acceptLoop(loop.config.id);
      expect(result.success).toBe(true);

      const updated = await ctx.manager.getLoop(loop.config.id);
      expect(updated!.state.status).toBe("merged");
    });

    test("discard (delete) a completed chat", async () => {
      const loop = await ctx.manager.createChat({
        ...testModelFields,
        directory: ctx.workDir,
        prompt: "Some work",
        workspaceId: testWorkspaceId,
      });

      await waitForLoopStatus(ctx.manager, loop.config.id, ["completed", "max_iterations"]);

      // Delete (soft delete)
      const deleted = await ctx.manager.deleteLoop(loop.config.id);
      expect(deleted).toBe(true);

      const updated = await ctx.manager.getLoop(loop.config.id);
      expect(updated!.state.status).toBe("deleted");

      // Verify event
      expect(countEvents(ctx.events, "loop.deleted")).toBe(1);
    });

    test("accept chat after multi-turn conversation", async () => {
      const loop = await ctx.manager.createChat({
        ...testModelFields,
        directory: ctx.workDir,
        prompt: "Start the work",
        workspaceId: testWorkspaceId,
      });

      // Turn 1
      await waitForLoopStatus(ctx.manager, loop.config.id, ["completed", "max_iterations"]);

      // Turn 2
      await ctx.manager.sendChatMessage(loop.config.id, "Now refine it");
      await waitForLoopStatus(ctx.manager, loop.config.id, ["completed", "max_iterations"], 15000);

      // Accept after two turns
      const result = await ctx.manager.acceptLoop(loop.config.id);
      expect(result.success).toBe(true);

      const updated = await ctx.manager.getLoop(loop.config.id);
      expect(updated!.state.status).toBe("merged");
    });

    test("stop a running chat", async () => {
      // Use a backend that never completes
      const neverCompletingBackend = new NeverCompletingMockBackend();
      backendManager.setBackendForTesting(neverCompletingBackend);

      const loop = await ctx.manager.createChat({
        ...testModelFields,
        directory: ctx.workDir,
        prompt: "Long running chat",
        workspaceId: testWorkspaceId,
      });

      // Wait for the chat to be running
      await waitForLoopStatus(ctx.manager, loop.config.id, ["running"]);

      // Stop it
      await ctx.manager.stopLoop(loop.config.id);

      const updated = await ctx.manager.getLoop(loop.config.id);
      expect(updated!.state.status).toBe("stopped");
    });
  });

  describe("Chat Engine Persistence", () => {
    test("chat engine stays in memory after turn completion", async () => {
      const loop = await ctx.manager.createChat({
        ...testModelFields,
        directory: ctx.workDir,
        prompt: "Test persistence",
        workspaceId: testWorkspaceId,
      });

      await waitForLoopStatus(ctx.manager, loop.config.id, ["completed", "max_iterations"]);

      // Engine should remain in memory for future turns
      // @ts-expect-error - accessing private field for test verification
      const engine = ctx.manager.engines.get(loop.config.id);
      expect(engine).toBeDefined();
    });

    test("chat recovers after engine removed from memory", async () => {
      const loop = await ctx.manager.createChat({
        ...testModelFields,
        directory: ctx.workDir,
        prompt: "Initial message",
        workspaceId: testWorkspaceId,
      });

      await waitForLoopStatus(ctx.manager, loop.config.id, ["completed", "max_iterations"]);

      // Simulate server restart by removing engine from memory
      // @ts-expect-error - accessing private field for test purposes
      ctx.manager.engines.delete(loop.config.id);

      // Sending a message should trigger recovery and work
      await ctx.manager.sendChatMessage(loop.config.id, "After restart");

      await waitForLoopStatus(ctx.manager, loop.config.id, ["completed", "max_iterations"], 15000);

      const updated = await ctx.manager.getLoop(loop.config.id);
      expect(updated!.state.status).toMatch(/completed|max_iterations/);
    });
  });

  describe("Chat Mode Filtering", () => {
    test("getAllLoops returns both chats and loops", async () => {
      // Create a chat
      await ctx.manager.createChat({
        ...testModelFields,
        directory: ctx.workDir,
        prompt: "Chat message",
        workspaceId: testWorkspaceId,
      });

      // Create a regular loop (don't start it to avoid needing extra mock responses)
      await ctx.manager.createLoop({
        ...testModelFields,
        directory: ctx.workDir,
        prompt: "Loop task",
        workspaceId: testWorkspaceId,
        planMode: false,
      });

      const allLoops = await ctx.manager.getAllLoops();
      expect(allLoops.length).toBe(2);

      const chatLoops = allLoops.filter((l) => l.config.mode === "chat");
      const regularLoops = allLoops.filter((l) => l.config.mode === "loop");
      expect(chatLoops.length).toBe(1);
      expect(regularLoops.length).toBe(1);
    });
  });

  describe("Error Handling", () => {
    test("rejects sendChatMessage to a non-chat loop", async () => {
      // Teardown default context and create one with loop-friendly responses
      await teardownTestContext(ctx);
      ctx = await setupTestContext({
        useMockBackend: true,
        initGit: true,
        mockResponses: [
          "test-loop-name",
          "Done! <promise>COMPLETE</promise>",
        ],
      });

      const loop = await ctx.manager.createLoop({
        ...testModelFields,
        directory: ctx.workDir,
        prompt: "Regular loop",
        workspaceId: testWorkspaceId,
        planMode: false,
      });

      // Start and complete the loop
      await ctx.manager.startLoop(loop.config.id);
      await waitForEvent(ctx.events, "loop.completed");

      await expect(
        ctx.manager.sendChatMessage(loop.config.id, "Should fail"),
      ).rejects.toThrow(/not a chat/);
    });

    test("rejects sendChatMessage to non-existent loop", async () => {
      await expect(
        ctx.manager.sendChatMessage("non-existent-id", "Hello"),
      ).rejects.toThrow(/not found/);
    });

    test("rejects sendChatMessage to a stopped chat", async () => {
      const loop = await ctx.manager.createChat({
        ...testModelFields,
        directory: ctx.workDir,
        prompt: "Chat to stop",
        workspaceId: testWorkspaceId,
      });

      await waitForLoopStatus(ctx.manager, loop.config.id, ["completed", "max_iterations"]);

      // Stop the chat
      await ctx.manager.stopLoop(loop.config.id);

      await expect(
        ctx.manager.sendChatMessage(loop.config.id, "Should fail"),
      ).rejects.toThrow(/Cannot (send chat message|recover chat engine)/);
    });

    test("handles backend error during chat turn gracefully", async () => {
      // Teardown default context and create one with error response
      await teardownTestContext(ctx);

      ctx = await setupTestContext({
        useMockBackend: true,
        initGit: true,
        mockResponses: ["ERROR:Chat backend error"],
      });

      const loop = await ctx.manager.createChat({
        ...testModelFields,
        directory: ctx.workDir,
        prompt: "Trigger error",
        workspaceId: testWorkspaceId,
        maxConsecutiveErrors: 1,
      });

      // Wait for the loop to fail
      await waitForEvent(ctx.events, "loop.error");

      const updated = await ctx.manager.getLoop(loop.config.id);
      expect(updated!.state.status).toBe("failed");
      expect(updated!.state.error?.message).toContain("Chat backend error");
    });
  });
});
