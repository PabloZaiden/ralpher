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

/**
 * Resettable mock backend for plan mode testing.
 * Uses per-session response tracking to handle multiple loops correctly.
 * 
 * Name generation uses sendPrompt (synchronous), while the main loop uses
 * subscribeToEvents + sendPromptAsync. To handle this correctly:
 * - sendPrompt always returns "test-loop-name" for name generation
 * - subscribeToEvents uses the per-session response sequence for planning/execution
 */
class PlanModeMockBackend implements LoopBackend {
  private connected = false;
  private pendingPrompt = false;
  private sessions = new Map<string, AgentSession>();
  // Track response index per session (for subscribeToEvents only)
  private sessionResponseIndex = new Map<string, number>();

  reset(): void {
    this.sessionResponseIndex.clear();
    this.pendingPrompt = false;
  }

  private getNextStreamResponse(sessionId: string): string {
    const idx = this.sessionResponseIndex.get(sessionId) ?? 0;
    this.sessionResponseIndex.set(sessionId, idx + 1);
    
    // Response sequence per session for streaming (subscribeToEvents):
    // 0-8: PLAN_READY for planning phase (multiple feedback rounds possible)
    // 9+: COMPLETE for execution phase
    if (idx < 9) {
      return "<promise>PLAN_READY</promise>"; // Planning phase
    }
    return "<promise>COMPLETE</promise>"; // Execution phase
  }

  async connect(_config: BackendConnectionConfig): Promise<void> {
    this.connected = true;
  }

  async disconnect(): Promise<void> {
    this.connected = false;
  }

  isConnected(): boolean {
    return this.connected;
  }

  async createSession(options: CreateSessionOptions): Promise<AgentSession> {
    const session: AgentSession = {
      id: `session-${Date.now()}-${Math.random()}`,
      title: options.title,
      createdAt: new Date().toISOString(),
    };
    this.sessions.set(session.id, session);
    // Initialize response index for this session
    this.sessionResponseIndex.set(session.id, 0);
    return session;
  }

  // Track unique name counter for generating unique loop names
  private nameCounter = 0;

  async sendPrompt(_sessionId: string, _prompt: PromptInput): Promise<AgentResponse> {
    // sendPrompt is used for name generation - return a unique name to avoid branch collisions
    const uniqueName = `test-loop-name-${++this.nameCounter}`;
    return {
      id: `msg-${Date.now()}`,
      content: uniqueName,
      parts: [{ type: "text", text: uniqueName }],
    };
  }

  async sendPromptAsync(_sessionId: string, _prompt: PromptInput): Promise<void> {
    this.pendingPrompt = true;
  }

  async abortSession(_sessionId: string): Promise<void> {
    // Not used in tests
  }

  async subscribeToEvents(sessionId: string): Promise<EventStream<AgentEvent>> {
    const { stream, push, end } = createEventStream<AgentEvent>();
    const self = this;

    (async () => {
      let attempts = 0;
      while (!self.pendingPrompt && attempts < 100) {
        await new Promise((resolve) => setTimeout(resolve, 10));
        attempts++;
      }
      self.pendingPrompt = false;

      // Get response based on current phase for this session
      const response = self.getNextStreamResponse(sessionId);
      push({ type: "message.start", messageId: `msg-${Date.now()}` });
      push({ type: "message.delta", content: response });
      push({ type: "message.complete", content: response });
      end();
    })();

    return stream;
  }

  async replyToPermission(_requestId: string, _response: string): Promise<void> {
    // Not used in tests
  }

  async replyToQuestion(_requestId: string, _answers: string[][]): Promise<void> {
    // Not used in tests
  }
}

describe("Plan Mode API Integration", () => {
  let testDataDir: string;
  let testWorkDir: string;
  let server: Server<unknown>;
  let baseUrl: string;
  let mockBackend: PlanModeMockBackend;

  // Helper to check if file exists
  async function exists(path: string): Promise<boolean> {
    return Bun.file(path).exists();
  }

  // Poll until loop reaches expected status
  async function waitForStatus(
    loopId: string,
    expectedStatuses: string[],
    timeoutMs = 10000
  ): Promise<Record<string, unknown>> {
    const startTime = Date.now();
    let lastStatus = "unknown";
    while (Date.now() - startTime < timeoutMs) {
      const response = await fetch(`${baseUrl}/api/loops/${loopId}`);
      if (response.ok) {
        const loop = await response.json();
        lastStatus = loop.state?.status ?? "unknown";
        if (expectedStatuses.includes(lastStatus)) {
          return loop;
        }
      }
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    throw new Error(
      `Loop ${loopId} did not reach status [${expectedStatuses.join(", ")}] within ${timeoutMs}ms. Last: ${lastStatus}`
    );
  }

  // Poll until isPlanReady becomes true
  async function waitForPlanReady(loopId: string, timeoutMs = 10000): Promise<Record<string, unknown>> {
    const startTime = Date.now();
    while (Date.now() - startTime < timeoutMs) {
      const response = await fetch(`${baseUrl}/api/loops/${loopId}`);
      if (response.ok) {
        const loop = await response.json();
        if (loop.state?.planMode?.isPlanReady === true) {
          return loop;
        }
      }
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    throw new Error(`Plan for loop ${loopId} did not become ready within ${timeoutMs}ms`);
  }

  // Poll until file no longer exists
  async function waitForFileDeleted(filePath: string, timeoutMs = 5000): Promise<void> {
    const startTime = Date.now();
    while (Date.now() - startTime < timeoutMs) {
      if (!(await exists(filePath))) {
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    throw new Error(`File ${filePath} was not deleted within ${timeoutMs}ms`);
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

    // Set up backend manager with class-based mock
    mockBackend = new PlanModeMockBackend();
    backendManager.setBackendForTesting(mockBackend);
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

      // Wait for file to be cleared
      await waitForFileDeleted(join(planningDir, "old-plan.md"));

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
      await waitForPlanReady(id);

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
      await waitForPlanReady(id);

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
      await waitForPlanReady(id);

      // Verify in planning status
      let getResponse = await fetch(`${baseUrl}/api/loops/${id}`);
      let loop = await getResponse.json();
      expect(loop.state.status).toBe("planning");

      // Accept the plan
      const acceptResponse = await fetch(`${baseUrl}/api/loops/${id}/plan/accept`, {
        method: "POST",
      });

      expect(acceptResponse.status).toBe(200);
      
      // Wait for status transition from planning
      loop = await waitForStatus(id, ["running", "completed", "max_iterations", "stopped"]);
      expect(["running", "completed", "max_iterations", "stopped"]).toContain(loop.state.status);
    });

    test("does not clear planning folder on accept", async () => {
      // IMPORTANT: Previous tests may leave us on a working branch, so we need to
      // checkout the base branch before creating the loop to ensure proper test isolation.
      // Get the default branch by checking if 'main' or 'master' exists (same logic as GitService.getDefaultBranch)
      const mainExists = await Bun.$`git -C ${testWorkDir} rev-parse --verify main`.quiet().then(() => true).catch(() => false);
      const baseBranch = mainExists ? "main" : "master";
      
      // Checkout the base branch to ensure we're not on a working branch from previous tests
      await Bun.$`git -C ${testWorkDir} checkout ${baseBranch}`.quiet();
      
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
      await waitForPlanReady(id);

      // Create a plan file and commit it to the base branch.
      // When accept is called, the loop engine will switch to the base branch and
      // create a new working branch from it. The plan.md must exist on the base branch
      // so it will also exist on the new working branch.
      await writeFile(join(planningDir, "plan.md"), "# My Plan");
      await Bun.$`git -C ${testWorkDir} add .`.quiet();
      await Bun.$`git -C ${testWorkDir} commit -m "Add plan file"`.quiet();

      // Accept the plan
      const acceptResponse = await fetch(`${baseUrl}/api/loops/${id}/plan/accept`, { method: "POST" });
      if (acceptResponse.status !== 200) {
        const body = await acceptResponse.json();
        throw new Error(`Accept failed with ${acceptResponse.status}: ${JSON.stringify(body)}`);
      }
      
      await waitForStatus(id, ["running", "completed", "max_iterations", "stopped"]);

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
      await waitForPlanReady(id);

      // Verify loop exists
      let getResponse = await fetch(`${baseUrl}/api/loops/${id}`);
      expect(getResponse.ok).toBe(true);

      // Discard the plan
      const discardResponse = await fetch(`${baseUrl}/api/loops/${id}/plan/discard`, {
        method: "POST",
      });

      expect(discardResponse.status).toBe(200);
      await waitForStatus(id, ["deleted"]);

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
