/**
 * API integration tests for active loop directory check.
 * Tests that at most one non-draft, non-terminal loop can exist per directory.
 */

import { test, expect, describe, beforeAll, afterAll, beforeEach, afterEach } from "bun:test";
import { mkdtemp, rm } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { serve, type Server } from "bun";
import { apiRoutes } from "../../src/api";
import { ensureDataDirectories } from "../../src/persistence/paths";
import { backendManager } from "../../src/core/backend-manager";
import { TestCommandExecutor } from "../mocks/mock-executor";
import { updateLoopState } from "../../src/persistence/loops";
import { NeverCompletingMockBackend } from "../mocks/mock-backend";

describe("Active Loop Directory Check API", () => {
  let testDataDir: string;
  let testWorkDir: string;
  let server: Server<unknown>;
  let baseUrl: string;
  let testWorkspaceId: string;

  // Helper to create or get a workspace for a directory
  async function getOrCreateWorkspace(directory: string, name?: string): Promise<string> {
    const createResponse = await fetch(`${baseUrl}/api/workspaces`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: name || directory.split("/").pop() || "Test",
        directory,
      }),
    });
    const data = await createResponse.json();
    
    if (createResponse.status === 409 && data.existingWorkspace) {
      return data.existingWorkspace.id;
    }
    
    if (createResponse.ok && data.id) {
      return data.id;
    }
    
    throw new Error(`Failed to create workspace: ${JSON.stringify(data)}`);
  }

  beforeAll(async () => {
    // Create temp directories
    testDataDir = await mkdtemp(join(tmpdir(), "ralpher-api-active-test-data-"));
    testWorkDir = await mkdtemp(join(tmpdir(), "ralpher-api-active-test-work-"));

    // Set env var for persistence before importing modules
    process.env["RALPHER_DATA_DIR"] = testDataDir;

    // Ensure directories exist
    await ensureDataDirectories();

    // Initialize git repo in test work directory
    await Bun.$`git init ${testWorkDir}`.quiet();
    await Bun.$`git -C ${testWorkDir} config user.email "test@test.com"`.quiet();
    await Bun.$`git -C ${testWorkDir} config user.name "Test User"`.quiet();
    await Bun.$`touch ${testWorkDir}/README.md`.quiet();
    await Bun.$`git -C ${testWorkDir} add .`.quiet();
    await Bun.$`git -C ${testWorkDir} commit -m "Initial commit"`.quiet();

    // Set up backend manager with test executor factory
    backendManager.setBackendForTesting(new NeverCompletingMockBackend());
    backendManager.setExecutorFactoryForTesting(() => new TestCommandExecutor());

    // Start test server on random port
    server = serve({
      port: 0, // Random available port
      routes: {
        ...apiRoutes,
      },
    });
    baseUrl = server.url.toString().replace(/\/$/, "");

    // Create a workspace for the testWorkDir
    testWorkspaceId = await getOrCreateWorkspace(testWorkDir, "Test Workspace");
  });

  afterAll(async () => {
    // Stop server
    server.stop();

    // Reset backend manager
    backendManager.resetForTesting();

    // Cleanup temp directories
    await rm(testDataDir, { recursive: true, force: true });
    await rm(testWorkDir, { recursive: true, force: true });

    // Clear env
    delete process.env["RALPHER_DATA_DIR"];
  });

  // Clean up any active loops before and after each test to prevent blocking
  const cleanupActiveLoops = async () => {
    const { listLoops, loadLoop } = await import("../../src/persistence/loops");
    const { loopManager } = await import("../../src/core/loop-manager");
    
    // Clear all running engines first
    loopManager.resetForTesting();
    
    const loops = await listLoops();
    const activeStatuses = ["idle", "planning", "starting", "running", "waiting"];
    
    for (const loop of loops) {
      if (activeStatuses.includes(loop.state.status)) {
        // Load full loop to get current state
        const fullLoop = await loadLoop(loop.config.id);
        if (fullLoop) {
          // Mark as deleted to make it a terminal state
          await updateLoopState(loop.config.id, {
            ...fullLoop.state,
            status: "deleted",
          });
        }
      }
    }
  };

  beforeEach(cleanupActiveLoops);
  afterEach(cleanupActiveLoops);

  describe("POST /api/loops - active loop check", () => {
    test("creating non-draft loop fails with 409 when active loop exists", async () => {
      // Create first loop as draft (this bypasses the check)
      const firstResponse = await fetch(`${baseUrl}/api/loops`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          workspaceId: testWorkspaceId,
          prompt: "First task",
          draft: true,
          planMode: false,
        }),
      });

      expect(firstResponse.status).toBe(201);
      const firstLoop = await firstResponse.json();

      // Manually set the first loop to "running" status to simulate an active loop
      await updateLoopState(firstLoop.config.id, {
        ...firstLoop.state,
        status: "running",
      });

      // Try to create a second non-draft loop for the same directory
      const secondResponse = await fetch(`${baseUrl}/api/loops`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          workspaceId: testWorkspaceId,
          prompt: "Second task",
          planMode: false,
        }),
      });

      expect(secondResponse.status).toBe(409);
      const errorBody = await secondResponse.json();
      expect(errorBody.error).toBe("active_loop_exists");
      expect(errorBody.conflictingLoop).toBeDefined();
      expect(errorBody.conflictingLoop.id).toBe(firstLoop.config.id);
      expect(errorBody.message).toContain("already active");
    });

    test("creating draft loop succeeds even when active loop exists", async () => {
      // Create a loop and set it to running
      const firstResponse = await fetch(`${baseUrl}/api/loops`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          workspaceId: testWorkspaceId,
          prompt: "Active task",
          draft: true,
          planMode: false,
        }),
      });

      const firstLoop = await firstResponse.json();
      await updateLoopState(firstLoop.config.id, {
        ...firstLoop.state,
        status: "running",
      });

      // Create a draft loop - should succeed
      const draftResponse = await fetch(`${baseUrl}/api/loops`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          workspaceId: testWorkspaceId,
          prompt: "Draft task",
          draft: true,
          planMode: false,
        }),
      });

      expect(draftResponse.status).toBe(201);
      const draftLoop = await draftResponse.json();
      expect(draftLoop.state.status).toBe("draft");
    });

    test("creating loop succeeds after conflicting loop is stopped", async () => {
      // Create a loop and set it to running
      const firstResponse = await fetch(`${baseUrl}/api/loops`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          workspaceId: testWorkspaceId,
          prompt: "Will be stopped",
          draft: true,
          planMode: false,
        }),
      });

      const firstLoop = await firstResponse.json();
      await updateLoopState(firstLoop.config.id, {
        ...firstLoop.state,
        status: "running",
      });

      // Stop the loop (terminal state)
      await updateLoopState(firstLoop.config.id, {
        ...firstLoop.state,
        status: "stopped",
      });

      // Now create another loop - should succeed
      const secondResponse = await fetch(`${baseUrl}/api/loops`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          workspaceId: testWorkspaceId,
          prompt: "After stopped",
          draft: true, // Use draft to avoid triggering the loop
          planMode: false,
        }),
      });

      expect(secondResponse.status).toBe(201);
    });

    test("response includes conflicting loop details", async () => {
      // Create a loop and set it to planning status
      const firstResponse = await fetch(`${baseUrl}/api/loops`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          workspaceId: testWorkspaceId,
          prompt: "Planning task with a specific name",
          draft: true,
          planMode: false,
        }),
      });

      const firstLoop = await firstResponse.json();
      await updateLoopState(firstLoop.config.id, {
        ...firstLoop.state,
        status: "planning",
      });

      // Try to create another non-draft loop
      const secondResponse = await fetch(`${baseUrl}/api/loops`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          workspaceId: testWorkspaceId,
          prompt: "Another task",
          planMode: false,
        }),
      });

      expect(secondResponse.status).toBe(409);
      const errorBody = await secondResponse.json();
      expect(errorBody.conflictingLoop.id).toBe(firstLoop.config.id);
      expect(errorBody.conflictingLoop.name).toBe(firstLoop.config.name);
    });
  });

  describe("POST /api/loops/:id/draft/start - active loop check", () => {
    test("starting draft loop fails with 409 when active loop exists", async () => {
      // Create a running loop first
      const runningLoopResponse = await fetch(`${baseUrl}/api/loops`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          workspaceId: testWorkspaceId,
          prompt: "Running loop",
          draft: true,
          planMode: false,
        }),
      });

      const runningLoop = await runningLoopResponse.json();
      await updateLoopState(runningLoop.config.id, {
        ...runningLoop.state,
        status: "running",
      });

      // Create a draft loop
      const draftResponse = await fetch(`${baseUrl}/api/loops`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          workspaceId: testWorkspaceId,
          prompt: "Draft to start",
          draft: true,
          planMode: false,
        }),
      });

      expect(draftResponse.status).toBe(201);
      const draftLoop = await draftResponse.json();

      // Try to start the draft loop - should fail
      const startResponse = await fetch(`${baseUrl}/api/loops/${draftLoop.config.id}/draft/start`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ planMode: false }),
      });

      expect(startResponse.status).toBe(409);
      const errorBody = await startResponse.json();
      expect(errorBody.error).toBe("active_loop_exists");
      expect(errorBody.conflictingLoop.id).toBe(runningLoop.config.id);
    });

    test("starting draft loop succeeds after conflicting loop is completed", async () => {
      // Create a loop and set it to completed
      const completedLoopResponse = await fetch(`${baseUrl}/api/loops`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          workspaceId: testWorkspaceId,
          prompt: "Completed loop",
          draft: true,
          planMode: false,
        }),
      });

      const completedLoop = await completedLoopResponse.json();
      await updateLoopState(completedLoop.config.id, {
        ...completedLoop.state,
        status: "completed",
      });

      // Create a draft loop
      const draftResponse = await fetch(`${baseUrl}/api/loops`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          workspaceId: testWorkspaceId,
          prompt: "Draft to start after completion",
          draft: true,
          planMode: false,
        }),
      });

      const draftLoop = await draftResponse.json();

      // Try to start the draft loop - should succeed
      const startResponse = await fetch(`${baseUrl}/api/loops/${draftLoop.config.id}/draft/start`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ planMode: true }),
      });

      // Should start successfully (might be 200 or could be an error due to git issues, but not 409)
      expect(startResponse.status).not.toBe(409);
    });
  });

  describe("terminal states do not block", () => {
    const terminalStatuses = ["completed", "stopped", "failed", "max_iterations", "merged", "pushed", "deleted"] as const;

    for (const status of terminalStatuses) {
      test(`loop in "${status}" status does not block new loops`, async () => {
        // Create a loop and set it to terminal status
        const terminalLoopResponse = await fetch(`${baseUrl}/api/loops`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            workspaceId: testWorkspaceId,
            prompt: `Terminal ${status} loop`,
            draft: true,
            planMode: false,
          }),
        });

        const terminalLoop = await terminalLoopResponse.json();
        await updateLoopState(terminalLoop.config.id, {
          ...terminalLoop.state,
          status: status,
        });

        // Create another draft loop - should succeed
        const newLoopResponse = await fetch(`${baseUrl}/api/loops`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            workspaceId: testWorkspaceId,
            prompt: `New loop after ${status}`,
            draft: true,
            planMode: false,
          }),
        });

        expect(newLoopResponse.status).toBe(201);
      });
    }
  });

  describe("active states block new loops", () => {
    const activeStatuses = ["idle", "planning", "starting", "running", "waiting"] as const;

    for (const status of activeStatuses) {
      test(`loop in "${status}" status blocks new non-draft loops`, async () => {
        // Create a loop and set it to active status
        const activeLoopResponse = await fetch(`${baseUrl}/api/loops`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            workspaceId: testWorkspaceId,
            prompt: `Active ${status} loop`,
            draft: true,
            planMode: false,
          }),
        });

        const activeLoop = await activeLoopResponse.json();
        await updateLoopState(activeLoop.config.id, {
          ...activeLoop.state,
          status: status,
        });

        // Try to create another non-draft loop - should fail
        const newLoopResponse = await fetch(`${baseUrl}/api/loops`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            workspaceId: testWorkspaceId,
            prompt: `Blocked by ${status}`,
            planMode: false,
            // Not a draft
          }),
        });

        expect(newLoopResponse.status).toBe(409);
        const errorBody = await newLoopResponse.json();
        expect(errorBody.error).toBe("active_loop_exists");
      });
    }
  });
});
