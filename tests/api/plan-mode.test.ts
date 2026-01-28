/**
 * API integration tests for Plan Mode endpoints.
 * Tests HTTP requests to plan mode API endpoints.
 */

import { test, expect, describe, beforeAll, afterAll } from "bun:test";
import { mkdtemp, rm, writeFile, mkdir } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { serve, type Server } from "bun";
import { apiRoutes } from "../../src/api";
import { ensureDataDirectories } from "../../src/persistence/paths";
import { backendManager } from "../../src/core/backend-manager";
import { TestCommandExecutor } from "../mocks/mock-executor";
import { closeDatabase } from "../../src/persistence/database";
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

describe("Plan Mode API Integration", () => {
  let testDataDir: string;
  let testWorkDir: string;
  let server: Server<unknown>;
  let baseUrl: string;

  // Helper to check if file exists
  async function exists(path: string): Promise<boolean> {
    return Bun.file(path).exists();
  }

  // Create a mock backend for plan mode testing
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
          id: `session-${Date.now()}-${Math.random()}`,
          title: options.title,
          createdAt: new Date().toISOString(),
        };
        sessions.set(session.id, session);
        return session;
      },

      async sendPrompt(_sessionId: string, _prompt: PromptInput): Promise<AgentResponse> {
        // For plan mode, return PLAN_READY marker
        return {
          id: `msg-${Date.now()}`,
          content: "<promise>PLAN_READY</promise>",
          parts: [{ type: "text", text: "<promise>PLAN_READY</promise>" }],
        };
      },

      async sendPromptAsync(_sessionId: string, _prompt: PromptInput): Promise<void> {
        pendingPrompt = true;
      },

      async abortSession(_sessionId: string): Promise<void> {
        // Not used in tests
      },

      async subscribeToEvents(_sessionId: string): Promise<EventStream<AgentEvent>> {
        const { stream, push, end } = createEventStream<AgentEvent>();

        (async () => {
          let attempts = 0;
          while (!pendingPrompt && attempts < 100) {
            await new Promise((resolve) => setTimeout(resolve, 10));
            attempts++;
          }
          pendingPrompt = false;

          push({ type: "message.start", messageId: `msg-${Date.now()}` });
          push({ type: "message.delta", content: "<promise>PLAN_READY</promise>" });
          push({ type: "message.complete", content: "<promise>PLAN_READY</promise>" });
          end();
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

  beforeAll(async () => {
    // Create temp directories
    testDataDir = await mkdtemp(join(tmpdir(), "ralpher-api-plan-test-data-"));
    testWorkDir = await mkdtemp(join(tmpdir(), "ralpher-api-plan-test-work-"));

    // Set env var for persistence
    process.env["RALPHER_DATA_DIR"] = testDataDir;
    await ensureDataDirectories();

    // Initialize git repo
    await Bun.$`git init ${testWorkDir}`.quiet();
    await Bun.$`git -C ${testWorkDir} config user.email "test@test.com"`.quiet();
    await Bun.$`git -C ${testWorkDir} config user.name "Test User"`.quiet();
    await Bun.$`touch ${testWorkDir}/README.md`.quiet();
    await Bun.$`git -C ${testWorkDir} add .`.quiet();
    await Bun.$`git -C ${testWorkDir} commit -m "Initial commit"`.quiet();

    // Set up backend manager
    backendManager.setBackendForTesting(createMockBackend());
    backendManager.setExecutorFactoryForTesting(() => new TestCommandExecutor());

    // Start test server
    server = serve({
      port: 0,
      routes: {
        ...apiRoutes,
      },
    });

    baseUrl = server.url.toString().replace(/\/$/, "");
  });

  afterAll(async () => {
    // Stop server
    server.stop(true);

    // Clean up
    backendManager.resetForTesting();
    closeDatabase();
    delete process.env["RALPHER_DATA_DIR"];

    // Remove temp directories
    await rm(testDataDir, { recursive: true });
    await rm(testWorkDir, { recursive: true });
  });

  describe("POST /api/loops (plan mode)", () => {
    // Helper to commit any changes after tests
    async function commitChanges() {
      try {
        await Bun.$`git -C ${testWorkDir} add -A`.quiet();
        await Bun.$`git -C ${testWorkDir} commit -m "Test changes" --allow-empty`.quiet();
      } catch {
        // Ignore if nothing to commit
      }
    }

    test("creates loop in planning status when planMode is true", async () => {
      const response = await fetch(`${baseUrl}/api/loops`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt: "Create a plan",
          directory: testWorkDir,
          maxIterations: 1,
          planMode: true,
        }),
      });

      expect(response.ok).toBe(true);
      const data = await response.json();
      expect(data.config?.id).toBeDefined();

      // Get the loop and verify status
      const getResponse = await fetch(`${baseUrl}/api/loops/${data.config.id}`);
      expect(getResponse.ok).toBe(true);
      const loop = await getResponse.json();
      expect(loop.state.status).toBe("planning");
      expect(loop.state.planMode?.active).toBe(true);

      // Clean up for next test
      await commitChanges();
    });

    test("clears planning folder before plan creation when clearPlanningFolder is true", async () => {
      // Setup: Create existing files in .planning folder
      const planningDir = join(testWorkDir, ".planning");
      await mkdir(planningDir, { recursive: true });
      await writeFile(join(planningDir, "old-plan.md"), "Old content");

      const response = await fetch(`${baseUrl}/api/loops`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt: "Create a plan",
          directory: testWorkDir,
          maxIterations: 1,
          clearPlanningFolder: true,
          planMode: true,
        }),
      });

      expect(response.ok).toBe(true);
      const data = await response.json();

      // Wait a bit for clearing to happen
      await new Promise((resolve) => setTimeout(resolve, 300));

      // Verify file was cleared
      expect(await exists(join(planningDir, "old-plan.md"))).toBe(false);

      // Verify state tracks clearing
      const getResponse2 = await fetch(`${baseUrl}/api/loops/${data.config.id}`);
      const loop = await getResponse2.json();
      expect(loop.state.planMode?.planningFolderCleared).toBe(true);

      // Clean up for next test
      await commitChanges();
    });

    test("returns 400 if required fields missing", async () => {
      const response = await fetch(`${baseUrl}/api/loops`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          // Missing name, prompt, directory
          planMode: true,
        }),
      });

      expect(response.status).toBe(400);
    });
  });

  describe("POST /api/loops/:id/plan/feedback", () => {
    test("sends feedback to AI and increments round counter", async () => {
      // Create a loop in plan mode
      const createResponse = await fetch(`${baseUrl}/api/loops`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt: "Create a plan",
          directory: testWorkDir,
          maxIterations: 1,
          planMode: true,
        }),
      });

      const response = await createResponse.json(); const id = response.config.id;
      await new Promise((resolve) => setTimeout(resolve, 200));

      // Get initial feedback rounds
      let getResponse = await fetch(`${baseUrl}/api/loops/${id}`);
      let loop = await getResponse.json();
      expect(loop.state.planMode.feedbackRounds).toBe(0);

      // Send feedback
      const feedbackResponse = await fetch(`${baseUrl}/api/loops/${id}/plan/feedback`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          feedback: "Please add more details",
        }),
      });

      expect(feedbackResponse.status).toBe(200);
      await new Promise((resolve) => setTimeout(resolve, 200));

      // Verify feedback rounds incremented
      getResponse = await fetch(`${baseUrl}/api/loops/${id}`);
      loop = await getResponse.json();
      expect(loop.state.planMode.feedbackRounds).toBe(1);
    });

    test("returns 400 if loop is not in planning status", async () => {
      // Create a normal loop (not plan mode)
      const createResponse = await fetch(`${baseUrl}/api/loops`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt: "Do something",
          directory: testWorkDir,
          maxIterations: 1,
          planMode: false,
        }),
      });

      const response = await createResponse.json(); const id = response.config.id;

      // Try to send feedback (should fail)
      const feedbackResponse = await fetch(`${baseUrl}/api/loops/${id}/plan/feedback`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          feedback: "This should fail",
        }),
      });

      expect(feedbackResponse.status).toBe(400);
    });

    test("returns 409 if loop not found", async () => {
      const response = await fetch(`${baseUrl}/api/loops/nonexistent/plan/feedback`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          feedback: "Test",
        }),
      });

      expect(response.status).toBe(409);
    });
  });

  describe("POST /api/loops/:id/plan/accept", () => {
    test("transitions loop from planning to running", async () => {
      // Create loop in plan mode
      const createResponse = await fetch(`${baseUrl}/api/loops`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt: "Create a plan",
          directory: testWorkDir,
          maxIterations: 1,
          planMode: true,
        }),
      });

      const response = await createResponse.json(); const id = response.config.id;
      await new Promise((resolve) => setTimeout(resolve, 200));

      // Verify in planning status
      let getResponse = await fetch(`${baseUrl}/api/loops/${id}`);
      let loop = await getResponse.json();
      expect(loop.state.status).toBe("planning");

      // Accept the plan
      const acceptResponse = await fetch(`${baseUrl}/api/loops/${id}/plan/accept`, {
        method: "POST",
      });

      expect(acceptResponse.status).toBe(200);
      await new Promise((resolve) => setTimeout(resolve, 300));

      // Verify transitioned from planning (could be running or already completed due to mock)
      getResponse = await fetch(`${baseUrl}/api/loops/${id}`);
      loop = await getResponse.json();
      expect(["running", "completed", "max_iterations", "stopped"]).toContain(loop.state.status);
    });

    test("does not clear planning folder on accept", async () => {
      // Create loop with clear folder enabled
      const planningDir = join(testWorkDir, ".planning-test2");
      await mkdir(planningDir, { recursive: true });

      const createResponse = await fetch(`${baseUrl}/api/loops`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt: "Create a plan",
          directory: testWorkDir,
          planningFolderPath: ".planning-test2",
          maxIterations: 1,
          clearPlanningFolder: true,
          planMode: true,
        }),
      });

      const response = await createResponse.json(); const id = response.config.id;
      await new Promise((resolve) => setTimeout(resolve, 300));

      // Create a plan file
      await writeFile(join(planningDir, "plan.md"), "# My Plan");

      // Accept the plan
      await fetch(`${baseUrl}/api/loops/${id}/plan/accept`, { method: "POST" });
      await new Promise((resolve) => setTimeout(resolve, 300));

      // Verify plan still exists
      expect(await exists(join(planningDir, "plan.md"))).toBe(true);
    });

    test("returns 400 if loop is not in planning status", async () => {
      // Commit any previous changes first
      try {
        await Bun.$`git -C ${testWorkDir} add -A`.quiet();
        await Bun.$`git -C ${testWorkDir} commit -m "Test changes" --allow-empty`.quiet();
      } catch {
        // Ignore if nothing to commit
      }

      // Create normal loop
      const createResponse = await fetch(`${baseUrl}/api/loops`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt: "Do something",
          directory: testWorkDir,
          maxIterations: 1,
        }),
      });

      const response = await createResponse.json(); const id = response.config.id;

      // Try to accept (should fail)
      const acceptResponse = await fetch(`${baseUrl}/api/loops/${id}/plan/accept`, {
        method: "POST",
      });

      expect(acceptResponse.status).toBe(400);
    });
  });

  describe("POST /api/loops/:id/plan/discard", () => {
    test("deletes the loop", async () => {
      // Commit any previous changes first
      try {
        await Bun.$`git -C ${testWorkDir} add -A`.quiet();
        await Bun.$`git -C ${testWorkDir} commit -m "Test changes" --allow-empty`.quiet();
      } catch {
        // Ignore if nothing to commit
      }

      // Create loop in plan mode
      const createResponse = await fetch(`${baseUrl}/api/loops`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt: "Create a plan",
          directory: testWorkDir,
          maxIterations: 1,
          planMode: true,
        }),
      });

      expect(createResponse.status).toBe(201);
      const response = await createResponse.json();
      expect(response.config).toBeDefined();
      const id = response.config.id;
      await new Promise((resolve) => setTimeout(resolve, 200));

      // Verify loop exists
      let getResponse = await fetch(`${baseUrl}/api/loops/${id}`);
      expect(getResponse.ok).toBe(true);

      // Discard the plan
      const discardResponse = await fetch(`${baseUrl}/api/loops/${id}/plan/discard`, {
        method: "POST",
      });

      expect(discardResponse.status).toBe(200);
      await new Promise((resolve) => setTimeout(resolve, 500));

      // Verify loop is marked as deleted (soft delete)
      getResponse = await fetch(`${baseUrl}/api/loops/${id}`);
      expect(getResponse.ok).toBe(true);
      const deletedLoop = await getResponse.json();
      expect(deletedLoop.state.status).toBe("deleted");
    });

    test("returns 404 if loop not found", async () => {
      const response = await fetch(`${baseUrl}/api/loops/nonexistent/plan/discard`, {
        method: "POST",
      });

      expect(response.status).toBe(404);
    });
  });
});
