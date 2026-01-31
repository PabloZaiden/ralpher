/**
 * API integration tests for reset connections endpoint.
 * Tests POST /api/backend/reset-all which resets stale connections and loops.
 */

import { test, expect, describe, beforeAll, afterAll, beforeEach } from "bun:test";
import { mkdtemp, rm, mkdir, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { serve, type Server } from "bun";
import { apiRoutes } from "../../src/api";
import { ensureDataDirectories } from "../../src/persistence/paths";
import { backendManager } from "../../src/core/backend-manager";
import { loopManager } from "../../src/core/loop-manager";
import { closeDatabase } from "../../src/persistence/database";
import { TestCommandExecutor } from "../mocks/mock-executor";
import { MockOpenCodeBackend } from "../mocks/mock-backend";

describe("POST /api/backend/reset-all", () => {
  let testDataDir: string;
  let server: Server<unknown>;
  let baseUrl: string;

  // Create a mock backend that stays running (doesn't complete immediately)
  function createStayingRunningMockBackend(): MockOpenCodeBackend {
    // Use a response that won't match the stop pattern so the loop stays running
    return new MockOpenCodeBackend({ responses: ["Working on it..."] });
  }

  // Helper to get or create a workspace for a directory
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

  // Helper to create a unique work directory with git AND workspace
  async function createTestWorkDirWithWorkspace(): Promise<{ workDir: string; workspaceId: string }> {
    const workDir = await mkdtemp(join(tmpdir(), "ralpher-reset-test-work-"));
    await Bun.$`git init ${workDir}`.quiet();
    await Bun.$`git -C ${workDir} config user.email "test@test.com"`.quiet();
    await Bun.$`git -C ${workDir} config user.name "Test User"`.quiet();
    await writeFile(join(workDir, "README.md"), "# Test");
    await Bun.$`git -C ${workDir} add .`.quiet();
    await Bun.$`git -C ${workDir} commit -m "Initial commit"`.quiet();
    await mkdir(join(workDir, ".planning"), { recursive: true });
    const workspaceId = await getOrCreateWorkspace(workDir, "Test Workspace");
    return { workDir, workspaceId };
  }

  // Helper to wait for loop to reach a specific status
  async function waitForLoopStatus(loopId: string, targetStatus: string[], timeoutMs = 5000): Promise<void> {
    const startTime = Date.now();
    while (Date.now() - startTime < timeoutMs) {
      const response = await fetch(`${baseUrl}/api/loops/${loopId}`);
      if (response.ok) {
        const data = await response.json();
        if (targetStatus.includes(data.state?.status)) {
          return;
        }
      }
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    throw new Error(`Loop ${loopId} did not reach status ${targetStatus.join("/")} within ${timeoutMs}ms`);
  }

  beforeAll(async () => {
    // Create temp data directory
    testDataDir = await mkdtemp(join(tmpdir(), "ralpher-api-reset-test-data-"));

    // Set env var for persistence before importing modules
    process.env["RALPHER_DATA_DIR"] = testDataDir;

    // Ensure directories exist
    await ensureDataDirectories();

    // Set up backend manager before starting server
    backendManager.setBackendForTesting(createStayingRunningMockBackend());
    backendManager.setExecutorFactoryForTesting(() => new TestCommandExecutor());

    // Start test server on random port
    server = serve({
      port: 0,
      routes: {
        ...apiRoutes,
      },
    });
    baseUrl = server.url.toString().replace(/\/$/, "");
  });

  afterAll(async () => {
    server.stop();
    loopManager.resetForTesting();
    backendManager.resetForTesting();
    closeDatabase();
    await rm(testDataDir, { recursive: true, force: true });
    delete process.env["RALPHER_DATA_DIR"];
  });

  beforeEach(async () => {
    // Reset loop manager state before each test
    loopManager.resetForTesting();
    // Set a fresh mock backend for each test
    backendManager.setBackendForTesting(createStayingRunningMockBackend());
  });

  test("returns success with reset statistics when no loops exist", async () => {
    const response = await fetch(`${baseUrl}/api/backend/reset-all`, {
      method: "POST",
    });

    const body = await response.json();
    if (response.status !== 200) {
      console.error("Reset failed:", body);
    }
    expect(response.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.message).toBe("All connections and stale loops have been reset");
    expect(body.enginesCleared).toBe(0);
    expect(body.loopsReset).toBe(0);
  });

  test("stops running loops and resets them", async () => {
    const { workDir, workspaceId } = await createTestWorkDirWithWorkspace();
    try {
      // Create and start a loop
      const createRes = await fetch(`${baseUrl}/api/loops`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "Reset Test Loop",
          workspaceId,
          prompt: "Test prompt",
          planMode: false,
        }),
      });
      expect(createRes.status).toBe(201);
      const created = await createRes.json();
      const loopId = created.config.id;

      // Wait for it to be running
      await waitForLoopStatus(loopId, ["running"]);

      // Call reset-all
      const resetRes = await fetch(`${baseUrl}/api/backend/reset-all`, {
        method: "POST",
      });

      expect(resetRes.status).toBe(200);
      const resetBody = await resetRes.json();
      expect(resetBody.success).toBe(true);
      expect(resetBody.enginesCleared).toBe(1);
      // The loop was running (active), so it gets stopped by the engine clear
      // The loopsReset count only counts DB loops that were stale (not in engines)

      // Verify the loop is now stopped
      const loopRes = await fetch(`${baseUrl}/api/loops/${loopId}`);
      const loopData = await loopRes.json();
      expect(loopData.state.status).toBe("stopped");
    } finally {
      await rm(workDir, { recursive: true, force: true });
    }
  });

  test("resets stale database loops that are not in engines", async () => {
    const { saveLoop } = await import("../../src/persistence/loops");

    // Directly save a loop with "running" status to the database
    // without creating an engine for it (simulating a crashed loop)
    const staleLoopId = `stale-${Date.now()}`;
    const now = new Date().toISOString();
    await saveLoop({
      config: {
        id: staleLoopId,
        name: "Stale Loop",
        directory: "/tmp/nonexistent",
        prompt: "Test",
        createdAt: now,
        updatedAt: now,
        stopPattern: "<promise>COMPLETE</promise>$",
        git: { branchPrefix: "ralph/", commitPrefix: "[Ralph]" },
        maxIterations: 10,
        maxConsecutiveErrors: 10,
        activityTimeoutSeconds: 180,
        clearPlanningFolder: false,
        planMode: false,
      },
      state: {
        id: staleLoopId,
        status: "running",
        currentIteration: 1,
        recentIterations: [],
        logs: [],
        messages: [],
        toolCalls: [],
        todos: [],
      },
    });

    // Call reset-all
    const resetRes = await fetch(`${baseUrl}/api/backend/reset-all`, {
      method: "POST",
    });

    expect(resetRes.status).toBe(200);
    const resetBody = await resetRes.json();
    expect(resetBody.success).toBe(true);
    expect(resetBody.loopsReset).toBeGreaterThanOrEqual(1);

    // Verify the stale loop is now stopped
    const { loadLoop } = await import("../../src/persistence/loops");
    const loop = await loadLoop(staleLoopId);
    expect(loop).not.toBeNull();
    expect(loop!.state.status).toBe("stopped");
  });

  test("preserves planning loops", async () => {
    const { saveLoop, loadLoop } = await import("../../src/persistence/loops");

    // Directly save a loop with "planning" status
    const planningLoopId = `planning-${Date.now()}`;
    const now = new Date().toISOString();
    await saveLoop({
      config: {
        id: planningLoopId,
        name: "Planning Loop",
        directory: "/tmp/nonexistent-planning",
        prompt: "Test plan",
        createdAt: now,
        updatedAt: now,
        stopPattern: "<promise>COMPLETE</promise>$",
        git: { branchPrefix: "ralph/", commitPrefix: "[Ralph]" },
        maxIterations: 10,
        maxConsecutiveErrors: 10,
        activityTimeoutSeconds: 180,
        clearPlanningFolder: false,
        planMode: true,
      },
      state: {
        id: planningLoopId,
        status: "planning",
        currentIteration: 0,
        recentIterations: [],
        logs: [],
        messages: [],
        toolCalls: [],
        todos: [],
      },
    });

    // Call reset-all
    const resetRes = await fetch(`${baseUrl}/api/backend/reset-all`, {
      method: "POST",
    });

    expect(resetRes.status).toBe(200);

    // Verify the planning loop is still in planning status
    const loop = await loadLoop(planningLoopId);
    expect(loop).not.toBeNull();
    expect(loop!.state.status).toBe("planning");
  });

  test("response has correct content-type", async () => {
    const response = await fetch(`${baseUrl}/api/backend/reset-all`, {
      method: "POST",
    });

    expect(response.headers.get("content-type")).toContain("application/json");
  });
});
