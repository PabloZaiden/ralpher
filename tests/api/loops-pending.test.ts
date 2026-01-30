/**
 * API tests for /api/loops/:id/pending endpoint.
 * Tests setting and clearing pending message and model for mid-loop steering.
 */

import { test, expect, describe, beforeAll, afterAll, beforeEach, afterEach } from "bun:test";
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
import type { LoopBackend } from "../../src/core/loop-engine";
import type {
  AgentSession,
  AgentResponse,
  AgentEvent,
  BackendConnectionConfig,
  CreateSessionOptions,
  PromptInput,
} from "../../src/backends/types";
import { createEventStream, type EventStream } from "../../src/utils/event-stream";

describe("POST /api/loops/:id/pending", () => {
  let testDataDir: string;
  let server: Server<unknown>;
  let baseUrl: string;

  // Create a mock backend that stays running (doesn't complete immediately)
  function createMockBackend(): LoopBackend {
    let connected = false;
    let pendingPrompt = false;
    const sessions = new Map<string, AgentSession>();

    return {
      async connect(_config: BackendConnectionConfig): Promise<void> {
        connected = true;
      },

      async disconnect(): Promise<void> {
        connected = false;
      },

      isConnected(): boolean {
        return connected;
      },

      async createSession(options: CreateSessionOptions): Promise<AgentSession> {
        const session: AgentSession = {
          id: `session-${Date.now()}`,
          title: options.title,
          createdAt: new Date().toISOString(),
        };
        sessions.set(session.id, session);
        return session;
      },

      async sendPrompt(_sessionId: string, _prompt: PromptInput): Promise<AgentResponse> {
        return {
          id: `msg-${Date.now()}`,
          content: "Working...",
          parts: [{ type: "text", text: "Working..." }],
        };
      },

      async sendPromptAsync(_sessionId: string, _prompt: PromptInput): Promise<void> {
        pendingPrompt = true;
      },

      async abortSession(_sessionId: string): Promise<void> {
        // Not used in tests
      },

      async subscribeToEvents(_sessionId: string): Promise<EventStream<AgentEvent>> {
        const { stream, push } = createEventStream<AgentEvent>();

        (async () => {
          // Wait for sendPromptAsync to set pendingPrompt
          let attempts = 0;
          while (!pendingPrompt && attempts < 100) {
            await new Promise((resolve) => setTimeout(resolve, 10));
            attempts++;
          }
          pendingPrompt = false;

          // Start the message but don't complete it - keep the loop running
          push({ type: "message.start", messageId: `msg-${Date.now()}` });
          push({ type: "message.delta", content: "Working..." });
          // Don't call end() - keep the stream open so loop stays running
        })();

        return stream;
      },

      async replyToPermission(_requestId: string, _response: string): Promise<void> {
        // Not used in tests
      },

      async replyToQuestion(_requestId: string, _answers: string[][]): Promise<void> {
        // Not used in tests
      },
    };
  }

  // Helper to create a unique work directory with git initialized
  async function createTestWorkDir(): Promise<string> {
    const workDir = await mkdtemp(join(tmpdir(), "ralpher-pending-test-work-"));
    await Bun.$`git init ${workDir}`.quiet();
    await Bun.$`git -C ${workDir} config user.email "test@test.com"`.quiet();
    await Bun.$`git -C ${workDir} config user.name "Test User"`.quiet();
    await writeFile(join(workDir, "README.md"), "# Test");
    await Bun.$`git -C ${workDir} add .`.quiet();
    await Bun.$`git -C ${workDir} commit -m "Initial commit"`.quiet();
    await mkdir(join(workDir, ".planning"), { recursive: true });
    return workDir;
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
    testDataDir = await mkdtemp(join(tmpdir(), "ralpher-api-pending-test-data-"));

    // Set env var for persistence before importing modules
    process.env["RALPHER_DATA_DIR"] = testDataDir;

    // Ensure directories exist
    await ensureDataDirectories();

    // Set up backend manager before starting server
    backendManager.setBackendForTesting(createMockBackend());
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

  // Clean up any active loops before and after each test
  const cleanupActiveLoops = async () => {
    const { listLoops, updateLoopState, loadLoop } = await import("../../src/persistence/loops");
    
    // Clear all running engines first
    loopManager.resetForTesting();
    
    const loops = await listLoops();
    const activeStatuses = ["idle", "planning", "starting", "running", "waiting"];
    
    for (const loop of loops) {
      if (activeStatuses.includes(loop.state.status)) {
        const fullLoop = await loadLoop(loop.config.id);
        if (fullLoop) {
          await updateLoopState(loop.config.id, {
            ...fullLoop.state,
            status: "deleted",
          });
        }
      }
    }
    
    // Re-setup backend after reset
    backendManager.setBackendForTesting(createMockBackend());
    backendManager.setExecutorFactoryForTesting(() => new TestCommandExecutor());
  };

  beforeEach(async () => {
    await cleanupActiveLoops();
  });

  afterEach(async () => {
    await cleanupActiveLoops();
  });

  test("POST with message succeeds for running loop", async () => {
    const workDir = await createTestWorkDir();
    try {
      // Create a loop - it auto-starts when created without draft: true
      const createRes = await fetch(`${baseUrl}/api/loops`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "Test Loop",
          directory: workDir,
          prompt: "Test prompt",
        }),
      });
      expect(createRes.status).toBe(201);
      const created = await createRes.json();
      const loopId = created.config.id;

      // Wait for it to be running
      await waitForLoopStatus(loopId, ["running"]);

      // Set pending message
      const pendingRes = await fetch(`${baseUrl}/api/loops/${loopId}/pending`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: "Please focus on the login feature",
        }),
      });
      expect(pendingRes.status).toBe(200);
      const pendingData = await pendingRes.json();
      expect(pendingData.success).toBe(true);

      // Verify the pending message was stored
      const loopRes = await fetch(`${baseUrl}/api/loops/${loopId}`);
      const loopData = await loopRes.json();
      expect(loopData.state.pendingPrompt).toBe("Please focus on the login feature");

      // Stop the loop to clean up
      await fetch(`${baseUrl}/api/loops/${loopId}/stop`, { method: "POST" });
    } finally {
      await rm(workDir, { recursive: true, force: true });
    }
  });

  test("POST with model succeeds for running loop", async () => {
    const workDir = await createTestWorkDir();
    try {
      const createRes = await fetch(`${baseUrl}/api/loops`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "Test Loop",
          directory: workDir,
          prompt: "Test prompt",
        }),
      });
      expect(createRes.status).toBe(201);
      const created = await createRes.json();
      const loopId = created.config.id;

      await waitForLoopStatus(loopId, ["running"]);

      // Set pending model
      const pendingRes = await fetch(`${baseUrl}/api/loops/${loopId}/pending`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: { providerID: "openai", modelID: "gpt-4o" },
        }),
      });
      expect(pendingRes.status).toBe(200);

      // Verify the pending model was stored
      const loopRes = await fetch(`${baseUrl}/api/loops/${loopId}`);
      const loopData = await loopRes.json();
      expect(loopData.state.pendingModel).toEqual({
        providerID: "openai",
        modelID: "gpt-4o",
      });

      await fetch(`${baseUrl}/api/loops/${loopId}/stop`, { method: "POST" });
    } finally {
      await rm(workDir, { recursive: true, force: true });
    }
  });

  test("POST with both message and model succeeds", async () => {
    const workDir = await createTestWorkDir();
    try {
      const createRes = await fetch(`${baseUrl}/api/loops`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "Test Loop",
          directory: workDir,
          prompt: "Test prompt",
        }),
      });
      expect(createRes.status).toBe(201);
      const created = await createRes.json();
      const loopId = created.config.id;

      await waitForLoopStatus(loopId, ["running"]);

      // Set both pending message and model
      const pendingRes = await fetch(`${baseUrl}/api/loops/${loopId}/pending`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: "Use the new API",
          model: { providerID: "anthropic", modelID: "claude-sonnet-4-20250514" },
        }),
      });
      expect(pendingRes.status).toBe(200);

      // Verify both were stored
      const loopRes = await fetch(`${baseUrl}/api/loops/${loopId}`);
      const loopData = await loopRes.json();
      expect(loopData.state.pendingPrompt).toBe("Use the new API");
      expect(loopData.state.pendingModel).toEqual({
        providerID: "anthropic",
        modelID: "claude-sonnet-4-20250514",
      });

      await fetch(`${baseUrl}/api/loops/${loopId}/stop`, { method: "POST" });
    } finally {
      await rm(workDir, { recursive: true, force: true });
    }
  });

  test("DELETE clears pending values", async () => {
    const workDir = await createTestWorkDir();
    try {
      const createRes = await fetch(`${baseUrl}/api/loops`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "Test Loop",
          directory: workDir,
          prompt: "Test prompt",
        }),
      });
      expect(createRes.status).toBe(201);
      const created = await createRes.json();
      const loopId = created.config.id;

      await waitForLoopStatus(loopId, ["running"]);

      // Set pending values
      await fetch(`${baseUrl}/api/loops/${loopId}/pending`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: "To be cleared",
          model: { providerID: "openai", modelID: "gpt-4o" },
        }),
      });

      // Clear pending values
      const deleteRes = await fetch(`${baseUrl}/api/loops/${loopId}/pending`, {
        method: "DELETE",
      });
      expect(deleteRes.status).toBe(200);

      // Verify both were cleared
      const loopRes = await fetch(`${baseUrl}/api/loops/${loopId}`);
      const loopData = await loopRes.json();
      expect(loopData.state.pendingPrompt).toBeUndefined();
      expect(loopData.state.pendingModel).toBeUndefined();

      await fetch(`${baseUrl}/api/loops/${loopId}/stop`, { method: "POST" });
    } finally {
      await rm(workDir, { recursive: true, force: true });
    }
  });

  test("POST returns 409 for idle loop", async () => {
    const workDir = await createTestWorkDir();
    try {
      // Create a draft loop (doesn't auto-start)
      const createRes = await fetch(`${baseUrl}/api/loops`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "Test Loop",
          directory: workDir,
          prompt: "Test prompt",
          draft: true,  // Create as draft - stays in idle status
        }),
      });
      expect(createRes.status).toBe(201);
      const created = await createRes.json();
      const loopId = created.config.id;

      // Try to set pending message on idle/draft loop
      const pendingRes = await fetch(`${baseUrl}/api/loops/${loopId}/pending`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: "This should fail",
        }),
      });
      expect(pendingRes.status).toBe(409);
      const data = await pendingRes.json();
      expect(data.error).toBe("not_running");
    } finally {
      await rm(workDir, { recursive: true, force: true });
    }
  });

  test("DELETE returns 409 for idle loop", async () => {
    const workDir = await createTestWorkDir();
    try {
      // Create a draft loop
      const createRes = await fetch(`${baseUrl}/api/loops`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "Test Loop",
          directory: workDir,
          prompt: "Test prompt",
          draft: true,
        }),
      });
      expect(createRes.status).toBe(201);
      const created = await createRes.json();
      const loopId = created.config.id;

      // Try to clear pending on idle loop
      const deleteRes = await fetch(`${baseUrl}/api/loops/${loopId}/pending`, {
        method: "DELETE",
      });
      expect(deleteRes.status).toBe(409);
    } finally {
      await rm(workDir, { recursive: true, force: true });
    }
  });

  test("POST returns 404 for non-existent loop", async () => {
    const pendingRes = await fetch(`${baseUrl}/api/loops/non-existent-id/pending`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        message: "Test",
      }),
    });
    expect(pendingRes.status).toBe(404);
  });

  test("DELETE returns 404 for non-existent loop", async () => {
    const deleteRes = await fetch(`${baseUrl}/api/loops/non-existent-id/pending`, {
      method: "DELETE",
    });
    expect(deleteRes.status).toBe(404);
  });

  test("POST requires at least message or model", async () => {
    const workDir = await createTestWorkDir();
    try {
      const createRes = await fetch(`${baseUrl}/api/loops`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "Test Loop",
          directory: workDir,
          prompt: "Test prompt",
        }),
      });
      expect(createRes.status).toBe(201);
      const created = await createRes.json();
      const loopId = created.config.id;

      await waitForLoopStatus(loopId, ["running"]);

      // Try to set with empty body
      const pendingRes = await fetch(`${baseUrl}/api/loops/${loopId}/pending`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      expect(pendingRes.status).toBe(400);
      const data = await pendingRes.json();
      expect(data.error).toBe("validation_error");
      expect(data.message).toContain("message");
      expect(data.message).toContain("model");

      await fetch(`${baseUrl}/api/loops/${loopId}/stop`, { method: "POST" });
    } finally {
      await rm(workDir, { recursive: true, force: true });
    }
  });

  test("POST validates model format", async () => {
    const workDir = await createTestWorkDir();
    try {
      const createRes = await fetch(`${baseUrl}/api/loops`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "Test Loop",
          directory: workDir,
          prompt: "Test prompt",
        }),
      });
      expect(createRes.status).toBe(201);
      const created = await createRes.json();
      const loopId = created.config.id;

      await waitForLoopStatus(loopId, ["running"]);

      // Try with invalid model (missing modelID)
      const pendingRes = await fetch(`${baseUrl}/api/loops/${loopId}/pending`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: { providerID: "openai" },  // Missing modelID
        }),
      });
      expect(pendingRes.status).toBe(400);
      const data = await pendingRes.json();
      expect(data.error).toBe("validation_error");
      expect(data.message).toContain("modelID");

      await fetch(`${baseUrl}/api/loops/${loopId}/stop`, { method: "POST" });
    } finally {
      await rm(workDir, { recursive: true, force: true });
    }
  });

  test("POST validates message type", async () => {
    const workDir = await createTestWorkDir();
    try {
      const createRes = await fetch(`${baseUrl}/api/loops`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "Test Loop",
          directory: workDir,
          prompt: "Test prompt",
        }),
      });
      expect(createRes.status).toBe(201);
      const created = await createRes.json();
      const loopId = created.config.id;

      await waitForLoopStatus(loopId, ["running"]);

      // Try with invalid message type
      const pendingRes = await fetch(`${baseUrl}/api/loops/${loopId}/pending`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: 12345,  // Should be string
        }),
      });
      expect(pendingRes.status).toBe(400);
      const data = await pendingRes.json();
      expect(data.error).toBe("validation_error");
      expect(data.message).toContain("message");
      expect(data.message).toContain("string");

      await fetch(`${baseUrl}/api/loops/${loopId}/stop`, { method: "POST" });
    } finally {
      await rm(workDir, { recursive: true, force: true });
    }
  });
});
