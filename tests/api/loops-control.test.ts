/**
 * API integration tests for loops control endpoints.
 * Tests use actual HTTP requests to a test server.
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

describe("Loops Control API Integration", () => {
  let testDataDir: string;
  let testWorkDir: string;
  let testBareRepoDir: string;
  let server: Server<unknown>;
  let baseUrl: string;

  // Create a mock backend that completes immediately
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
          content: "<promise>COMPLETE</promise>",
          parts: [{ type: "text", text: "<promise>COMPLETE</promise>" }],
        };
      },

      async sendPromptAsync(_sessionId: string, _prompt: PromptInput): Promise<void> {
        // Signal that we're ready for events
        pendingPrompt = true;
      },

      async abortSession(_sessionId: string): Promise<void> {
        // Not used in tests
      },

      async subscribeToEvents(_sessionId: string): Promise<EventStream<AgentEvent>> {
        // Return a stream that yields complete message with stop pattern
        const { stream, push, end } = createEventStream<AgentEvent>();

        // Push events asynchronously AFTER sendPromptAsync sets pendingPrompt
        (async () => {
          // Wait for sendPromptAsync to set pendingPrompt
          let attempts = 0;
          while (!pendingPrompt && attempts < 100) {
            await new Promise((resolve) => setTimeout(resolve, 10));
            attempts++;
          }
          pendingPrompt = false;

          push({ type: "message.start", messageId: `msg-${Date.now()}` });
          push({ type: "message.delta", content: "<promise>COMPLETE</promise>" });
          push({ type: "message.complete", content: "<promise>COMPLETE</promise>" });
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

  // Helper function to poll for loop completion
  async function waitForLoopCompletion(loopId: string, timeoutMs = 10000): Promise<void> {
    const startTime = Date.now();
    let lastStatus = "";
    while (Date.now() - startTime < timeoutMs) {
      const response = await fetch(`${baseUrl}/api/loops/${loopId}`);
      if (response.ok) {
        const data = await response.json();
        lastStatus = data.state?.status ?? "no state";
        if (lastStatus === "completed" || lastStatus === "failed") {
          return;
        }
      } else {
        lastStatus = `HTTP ${response.status}`;
      }
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    throw new Error(`Loop ${loopId} did not complete within ${timeoutMs}ms. Last status: ${lastStatus}`);
  }

  beforeAll(async () => {
    // Create temp directories
    testDataDir = await mkdtemp(join(tmpdir(), "ralpher-api-control-test-data-"));
    testWorkDir = await mkdtemp(join(tmpdir(), "ralpher-api-control-test-work-"));

    // Set env var for persistence before importing modules
    process.env["RALPHER_DATA_DIR"] = testDataDir;

    // Ensure directories exist
    await ensureDataDirectories();

    // Initialize git repo
    await Bun.$`git init ${testWorkDir}`.quiet();
    await Bun.$`git -C ${testWorkDir} config user.email "test@test.com"`.quiet();
    await Bun.$`git -C ${testWorkDir} config user.name "Test User"`.quiet();
    
    // Add a fake remote for push tests (using local file path as a valid remote)
    testBareRepoDir = await mkdtemp(join(tmpdir(), "ralpher-api-control-test-bare-"));
    await Bun.$`git init --bare ${testBareRepoDir}`.quiet();
    await Bun.$`git -C ${testWorkDir} remote add origin ${testBareRepoDir}`.quiet();
    
    await Bun.$`touch ${testWorkDir}/README.md`.quiet();
    await Bun.$`git -C ${testWorkDir} add .`.quiet();
    await Bun.$`git -C ${testWorkDir} commit -m "Initial commit"`.quiet();

    // Create .planning directory and commit it
    await mkdir(join(testWorkDir, ".planning"), { recursive: true });
    await writeFile(join(testWorkDir, ".planning/plan.md"), "# Test Plan\n\nThis is a test plan.");
    await writeFile(join(testWorkDir, ".planning/status.md"), "# Status\n\nIn progress.");
    await Bun.$`git -C ${testWorkDir} add .`.quiet();
    await Bun.$`git -C ${testWorkDir} commit -m "Add planning files"`.quiet();

    // Set up backend manager with test executor factory
    backendManager.setBackendForTesting(createMockBackend());
    backendManager.setExecutorFactoryForTesting(() => new TestCommandExecutor());

    // Start test server on random port
    server = serve({
      port: 0, // Random available port
      routes: {
        ...apiRoutes,
      },
    });
    baseUrl = server.url.toString().replace(/\/$/, "");
  });

  afterAll(async () => {
    // Stop server
    server.stop();

    // Reset loop manager (stop any running loops)
    loopManager.resetForTesting();

    // Reset backend manager
    backendManager.resetForTesting();

    // Close database before deleting files
    closeDatabase();

    // Cleanup temp directories
    await rm(testDataDir, { recursive: true, force: true });
    await rm(testWorkDir, { recursive: true, force: true });
    await rm(testBareRepoDir, { recursive: true, force: true });

    // Clear env
    delete process.env["RALPHER_DATA_DIR"];
  });

  // Clean up any active loops before and after each test to prevent blocking
  const cleanupActiveLoops = async () => {
    const { listLoops, updateLoopState, loadLoop } = await import("../../src/persistence/loops");
    
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

  describe("POST /api/loops/:id/accept", () => {
    // Note: Loops are auto-started on creation by default, but they can still
    // remain in "idle" status if auto-start fails (e.g., git issues/uncommitted changes).
    
    test("returns 404 for non-existent loop", async () => {
      const response = await fetch(`${baseUrl}/api/loops/non-existent/accept`, {
        method: "POST",
      });

      expect(response.status).toBe(404);
    });
  });

  describe("POST /api/loops/:id/discard", () => {
    test("returns error for loop without git branch (plan mode)", async () => {
      // Create a loop in plan mode - no git branch created until plan acceptance
      const createResponse = await fetch(`${baseUrl}/api/loops`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          directory: testWorkDir,
          prompt: "Test prompt",
          planMode: true,
          backend: { type: "mock" },
        }),
      });
      const createBody = await createResponse.json();
      const loopId = createBody.config.id;

      const response = await fetch(`${baseUrl}/api/loops/${loopId}/discard`, {
        method: "POST",
      });

      expect(response.status).toBe(400);
      const body = await response.json();
      expect(body.error).toBe("discard_failed");
      expect(body.message).toContain("No git branch");
    });

    test("returns 404 for non-existent loop", async () => {
      const response = await fetch(`${baseUrl}/api/loops/non-existent/discard`, {
        method: "POST",
      });

      expect(response.status).toBe(404);
    });
  });

  describe("GET /api/loops/:id/diff", () => {
    test("returns 404 for non-existent loop", async () => {
      const response = await fetch(`${baseUrl}/api/loops/non-existent/diff`);
      expect(response.status).toBe(404);
    });

    test("returns 400 for loop without git branch (draft mode)", async () => {
      // Create a draft loop - no git branch is created until the loop is started
      const createResponse = await fetch(`${baseUrl}/api/loops`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          directory: testWorkDir,
          prompt: "Test prompt",
          draft: true,
        }),
      });
      const createBody = await createResponse.json();
      expect(createResponse.status).toBe(201);
      expect(createBody.config).toBeDefined();
      const loopId = createBody.config.id;

      const response = await fetch(`${baseUrl}/api/loops/${loopId}/diff`);

      expect(response.status).toBe(400);
      const body = await response.json();
      expect(body.error).toBe("no_git_branch");
    });
  });

  describe("GET /api/loops/:id/plan", () => {
    test("returns plan.md content", async () => {
      // Create a fresh workdir with .planning to avoid pollution from other tests
      const planTestDir = await mkdtemp(join(tmpdir(), "ralpher-plan-test-"));
      await Bun.$`git init ${planTestDir}`.quiet();
      await Bun.$`git -C ${planTestDir} config user.email "test@test.com"`.quiet();
      await Bun.$`git -C ${planTestDir} config user.name "Test User"`.quiet();
      await writeFile(join(planTestDir, "README.md"), "# Test");
      await mkdir(join(planTestDir, ".planning"), { recursive: true });
      await writeFile(join(planTestDir, ".planning/plan.md"), "# Test Plan\n\nThis is a test plan.");
      await Bun.$`git -C ${planTestDir} add .`.quiet();
      await Bun.$`git -C ${planTestDir} commit -m "Initial commit"`.quiet();

      // Use draft mode to avoid starting the loop in the background
      const createResponse = await fetch(`${baseUrl}/api/loops`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          directory: planTestDir,
          prompt: "Test",
          draft: true,
        }),
      });
      expect(createResponse.status).toBe(201);
      const createBody = await createResponse.json();
      expect(createBody.config).toBeDefined();
      const loopId = createBody.config.id;

      const response = await fetch(`${baseUrl}/api/loops/${loopId}/plan`);

      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.exists).toBe(true);
      expect(body.content).toContain("# Test Plan");

      await rm(planTestDir, { recursive: true, force: true });
    });

    test("returns 404 for non-existent loop", async () => {
      const response = await fetch(`${baseUrl}/api/loops/non-existent/plan`);
      expect(response.status).toBe(404);
    });

    test("returns exists=false for missing plan.md", async () => {
      // Create a new workdir without .planning (but with git)
      const emptyWorkDir = await mkdtemp(join(tmpdir(), "ralpher-empty-work-"));
      await Bun.$`git init ${emptyWorkDir}`.quiet();
      await Bun.$`git -C ${emptyWorkDir} config user.email "test@test.com"`.quiet();
      await Bun.$`git -C ${emptyWorkDir} config user.name "Test User"`.quiet();
      await writeFile(join(emptyWorkDir, "README.md"), "# Empty");
      await Bun.$`git -C ${emptyWorkDir} add .`.quiet();
      await Bun.$`git -C ${emptyWorkDir} commit -m "Initial commit"`.quiet();

      // Use draft mode to avoid starting the loop in the background
      const createResponse = await fetch(`${baseUrl}/api/loops`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          directory: emptyWorkDir,
          prompt: "Test",
          draft: true,
        }),
      });
      expect(createResponse.status).toBe(201);
      const createBody = await createResponse.json();
      expect(createBody.config).toBeDefined();
      const loopId = createBody.config.id;

      const response = await fetch(`${baseUrl}/api/loops/${loopId}/plan`);

      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.exists).toBe(false);
      expect(body.content).toBe("");

      await rm(emptyWorkDir, { recursive: true, force: true });
    });
  });

  describe("GET /api/loops/:id/status-file", () => {
    test("returns status.md content", async () => {
      // Create a fresh workdir with .planning to avoid pollution from other tests
      const statusTestDir = await mkdtemp(join(tmpdir(), "ralpher-status-test-"));
      await Bun.$`git init ${statusTestDir}`.quiet();
      await Bun.$`git -C ${statusTestDir} config user.email "test@test.com"`.quiet();
      await Bun.$`git -C ${statusTestDir} config user.name "Test User"`.quiet();
      await writeFile(join(statusTestDir, "README.md"), "# Test");
      await mkdir(join(statusTestDir, ".planning"), { recursive: true });
      await writeFile(join(statusTestDir, ".planning/status.md"), "# Status\n\nIn progress.");
      await Bun.$`git -C ${statusTestDir} add .`.quiet();
      await Bun.$`git -C ${statusTestDir} commit -m "Initial commit"`.quiet();

      // Use draft mode to avoid starting the loop in the background
      const createResponse = await fetch(`${baseUrl}/api/loops`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          directory: statusTestDir,
          prompt: "Test",
          draft: true,
        }),
      });
      expect(createResponse.status).toBe(201);
      const createBody = await createResponse.json();
      expect(createBody.config).toBeDefined();
      const loopId = createBody.config.id;

      const response = await fetch(`${baseUrl}/api/loops/${loopId}/status-file`);

      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.exists).toBe(true);
      expect(body.content).toContain("# Status");

      await rm(statusTestDir, { recursive: true, force: true });
    });

    test("returns 404 for non-existent loop", async () => {
      const response = await fetch(`${baseUrl}/api/loops/non-existent/status-file`);
      expect(response.status).toBe(404);
    });
  });

  describe("Pending Prompt API", () => {
    test("PUT /api/loops/:id/pending-prompt returns 409 when loop is not running", async () => {
      // Use unique directory to avoid conflicts
      const uniqueWorkDir = await mkdtemp(join(tmpdir(), "ralpher-pending-prompt-test-"));
      await Bun.$`git init ${uniqueWorkDir}`.quiet();
      await Bun.$`git -C ${uniqueWorkDir} config user.email "test@test.com"`.quiet();
      await Bun.$`git -C ${uniqueWorkDir} config user.name "Test User"`.quiet();
      await Bun.$`touch ${uniqueWorkDir}/README.md`.quiet();
      await Bun.$`git -C ${uniqueWorkDir} add .`.quiet();
      await Bun.$`git -C ${uniqueWorkDir} commit -m "Initial commit"`.quiet();
      
      try {
        // Create a loop - it will auto-start and complete immediately with mock backend
        const createResponse = await fetch(`${baseUrl}/api/loops`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            directory: uniqueWorkDir,
            prompt: "Test prompt",
          }),
        });
        const createBody = await createResponse.json();
        const loopId = createBody.config.id;

        // Wait for the loop to complete
        await waitForLoopCompletion(loopId);

        // Try to set pending prompt on completed loop
        const response = await fetch(`${baseUrl}/api/loops/${loopId}/pending-prompt`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ prompt: "New prompt" }),
        });

        expect(response.status).toBe(409);
        const body = await response.json();
        expect(body.error).toBe("not_running");
      } finally {
        await rm(uniqueWorkDir, { recursive: true, force: true });
      }
    });

    test("PUT /api/loops/:id/pending-prompt requires prompt in body", async () => {
      // Use unique directory to avoid conflicts
      const uniqueWorkDir = await mkdtemp(join(tmpdir(), "ralpher-pending-body-test-"));
      await Bun.$`git init ${uniqueWorkDir}`.quiet();
      await Bun.$`git -C ${uniqueWorkDir} config user.email "test@test.com"`.quiet();
      await Bun.$`git -C ${uniqueWorkDir} config user.name "Test User"`.quiet();
      await Bun.$`touch ${uniqueWorkDir}/README.md`.quiet();
      await Bun.$`git -C ${uniqueWorkDir} add .`.quiet();
      await Bun.$`git -C ${uniqueWorkDir} commit -m "Initial commit"`.quiet();
      
      try {
        const createResponse = await fetch(`${baseUrl}/api/loops`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            directory: uniqueWorkDir,
            prompt: "Test prompt",
          }),
        });
        const createBody = await createResponse.json();
        const loopId = createBody.config.id;

        // Try without prompt
        const response = await fetch(`${baseUrl}/api/loops/${loopId}/pending-prompt`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({}),
        });

        expect(response.status).toBe(400);
        const body = await response.json();
        expect(body.error).toBe("invalid_body");
      } finally {
        await rm(uniqueWorkDir, { recursive: true, force: true });
      }
    });

    test("PUT /api/loops/:id/pending-prompt rejects empty prompt", async () => {
      // Use unique directory to avoid conflicts
      const uniqueWorkDir = await mkdtemp(join(tmpdir(), "ralpher-pending-empty-test-"));
      await Bun.$`git init ${uniqueWorkDir}`.quiet();
      await Bun.$`git -C ${uniqueWorkDir} config user.email "test@test.com"`.quiet();
      await Bun.$`git -C ${uniqueWorkDir} config user.name "Test User"`.quiet();
      await Bun.$`touch ${uniqueWorkDir}/README.md`.quiet();
      await Bun.$`git -C ${uniqueWorkDir} add .`.quiet();
      await Bun.$`git -C ${uniqueWorkDir} commit -m "Initial commit"`.quiet();
      
      try {
        const createResponse = await fetch(`${baseUrl}/api/loops`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            directory: uniqueWorkDir,
            prompt: "Test prompt",
          }),
        });
        const createBody = await createResponse.json();
        const loopId = createBody.config.id;

        // Try with empty prompt
        const response = await fetch(`${baseUrl}/api/loops/${loopId}/pending-prompt`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ prompt: "   " }),
        });

        expect(response.status).toBe(400);
        const body = await response.json();
        expect(body.error).toBe("validation_error");
      } finally {
        await rm(uniqueWorkDir, { recursive: true, force: true });
      }
    });

    test("DELETE /api/loops/:id/pending-prompt returns 409 when loop is not running", async () => {
      // Use unique directory to avoid conflicts
      const uniqueWorkDir = await mkdtemp(join(tmpdir(), "ralpher-pending-del-test-"));
      await Bun.$`git init ${uniqueWorkDir}`.quiet();
      await Bun.$`git -C ${uniqueWorkDir} config user.email "test@test.com"`.quiet();
      await Bun.$`git -C ${uniqueWorkDir} config user.name "Test User"`.quiet();
      await Bun.$`touch ${uniqueWorkDir}/README.md`.quiet();
      await Bun.$`git -C ${uniqueWorkDir} add .`.quiet();
      await Bun.$`git -C ${uniqueWorkDir} commit -m "Initial commit"`.quiet();
      
      try {
        // Create a loop - it will auto-start and complete immediately with mock backend
        const createResponse = await fetch(`${baseUrl}/api/loops`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            directory: uniqueWorkDir,
            prompt: "Test prompt",
          }),
        });
        const createBody = await createResponse.json();
        const loopId = createBody.config.id;

        // Wait for the loop to complete
        await waitForLoopCompletion(loopId);

        const response = await fetch(`${baseUrl}/api/loops/${loopId}/pending-prompt`, {
          method: "DELETE",
        });

        expect(response.status).toBe(409);
        const body = await response.json();
        expect(body.error).toBe("not_running");
      } finally {
        await rm(uniqueWorkDir, { recursive: true, force: true });
      }
    });

    test("PUT /api/loops/:id/pending-prompt returns 404 for non-existent loop", async () => {
      const response = await fetch(`${baseUrl}/api/loops/non-existent/pending-prompt`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: "Test" }),
      });
      expect(response.status).toBe(404);
    });

    test("DELETE /api/loops/:id/pending-prompt returns 404 for non-existent loop", async () => {
      const response = await fetch(`${baseUrl}/api/loops/non-existent/pending-prompt`, {
        method: "DELETE",
      });
      expect(response.status).toBe(404);
    });
  });

  describe("Review Comments API", () => {
    test("GET /api/loops/:id/comments returns empty array for new loop", async () => {
      // Use unique directory to avoid conflicts
      const uniqueWorkDir = await mkdtemp(join(tmpdir(), "ralpher-comments-empty-test-"));
      await Bun.$`git init ${uniqueWorkDir}`.quiet();
      await Bun.$`git -C ${uniqueWorkDir} config user.email "test@test.com"`.quiet();
      await Bun.$`git -C ${uniqueWorkDir} config user.name "Test User"`.quiet();
      await Bun.$`touch ${uniqueWorkDir}/README.md`.quiet();
      await Bun.$`git -C ${uniqueWorkDir} add .`.quiet();
      await Bun.$`git -C ${uniqueWorkDir} commit -m "Initial commit"`.quiet();
      
      try {
        const createResponse = await fetch(`${baseUrl}/api/loops`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            directory: uniqueWorkDir,
            prompt: "Test prompt",
          }),
        });
        const createBody = await createResponse.json();
        const loopId = createBody.config.id;

        const response = await fetch(`${baseUrl}/api/loops/${loopId}/comments`);

        expect(response.status).toBe(200);
        const body = await response.json();
        expect(body.success).toBe(true);
        expect(body.comments).toEqual([]);
      } finally {
        await rm(uniqueWorkDir, { recursive: true, force: true });
      }
    });

    test("GET /api/loops/:id/comments returns 404 for non-existent loop", async () => {
      const response = await fetch(`${baseUrl}/api/loops/non-existent/comments`);
      expect(response.status).toBe(404);
    });

    test("POST /api/loops/:id/address-comments stores and returns comment IDs", async () => {
      // Use unique directory with bare repo to avoid conflicts
      const uniqueWorkDir = await mkdtemp(join(tmpdir(), "ralpher-comments-store-test-"));
      const uniqueBareRepo = await mkdtemp(join(tmpdir(), "ralpher-comments-store-bare-"));
      await Bun.$`git init --bare ${uniqueBareRepo}`.quiet();
      await Bun.$`git init ${uniqueWorkDir}`.quiet();
      await Bun.$`git -C ${uniqueWorkDir} config user.email "test@test.com"`.quiet();
      await Bun.$`git -C ${uniqueWorkDir} config user.name "Test User"`.quiet();
      await Bun.$`git -C ${uniqueWorkDir} remote add origin ${uniqueBareRepo}`.quiet();
      await Bun.$`touch ${uniqueWorkDir}/README.md`.quiet();
      await Bun.$`git -C ${uniqueWorkDir} add .`.quiet();
      await Bun.$`git -C ${uniqueWorkDir} commit -m "Initial commit"`.quiet();
      
      try {
        // Create a loop
        const createResponse = await fetch(`${baseUrl}/api/loops`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            directory: uniqueWorkDir,
            prompt: "Test prompt",
          }),
        });
        const createBody = await createResponse.json();
        const loopId = createBody.config.id;

        // Wait for loop to complete
        await waitForLoopCompletion(loopId);

        // Push the loop to enable review mode
        const pushResponse = await fetch(`${baseUrl}/api/loops/${loopId}/push`, { method: "POST" });
        if (pushResponse.status !== 200) {
          const pushBody = await pushResponse.json();
          const loopResponse = await fetch(`${baseUrl}/api/loops/${loopId}`);
          const loopData = await loopResponse.json();
          throw new Error(`Push failed with status ${pushResponse.status}: ${JSON.stringify(pushBody)}. Loop state: ${JSON.stringify(loopData.state)}`);
        }
        expect(pushResponse.status).toBe(200);

        // Submit comments
        const commentsText = "Please add error handling\nImprove test coverage";
        const addressResponse = await fetch(`${baseUrl}/api/loops/${loopId}/address-comments`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ comments: commentsText }),
        });

        if (addressResponse.status !== 200) {
          const errorBody = await addressResponse.json();
          throw new Error(`Address comments failed: ${JSON.stringify(errorBody)}`);
        }
        expect(addressResponse.status).toBe(200);
        const addressBody = await addressResponse.json();
        expect(addressBody.success).toBe(true);
        expect(addressBody.commentIds).toBeInstanceOf(Array);
        expect(addressBody.commentIds.length).toBeGreaterThan(0);

        // Verify comments are stored
        const commentsResponse = await fetch(`${baseUrl}/api/loops/${loopId}/comments`);
        expect(commentsResponse.status).toBe(200);
        const commentsBody = await commentsResponse.json();
        expect(commentsBody.success).toBe(true);
        expect(commentsBody.comments).toBeInstanceOf(Array);
        expect(commentsBody.comments.length).toBeGreaterThan(0);
        expect(commentsBody.comments[0].status).toBe("pending");
        expect(commentsBody.comments[0].reviewCycle).toBe(1);
      } finally {
        await rm(uniqueWorkDir, { recursive: true, force: true });
        await rm(uniqueBareRepo, { recursive: true, force: true });
      }
    });

    test("POST /api/loops/:id/address-comments returns 400 for loop not in review mode", async () => {
      // Use unique directory to avoid conflicts
      const uniqueWorkDir = await mkdtemp(join(tmpdir(), "ralpher-comments-notreview-test-"));
      await Bun.$`git init ${uniqueWorkDir}`.quiet();
      await Bun.$`git -C ${uniqueWorkDir} config user.email "test@test.com"`.quiet();
      await Bun.$`git -C ${uniqueWorkDir} config user.name "Test User"`.quiet();
      await Bun.$`touch ${uniqueWorkDir}/README.md`.quiet();
      await Bun.$`git -C ${uniqueWorkDir} add .`.quiet();
      await Bun.$`git -C ${uniqueWorkDir} commit -m "Initial commit"`.quiet();
      
      try {
        // Create a loop without review mode
        const createResponse = await fetch(`${baseUrl}/api/loops`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            directory: uniqueWorkDir,
            prompt: "Test prompt",
          }),
        });
        const createBody = await createResponse.json();
        const loopId = createBody.config.id;

        // Wait for loop to complete
        await waitForLoopCompletion(loopId);

        // Try to address comments without enabling review mode (no push)
        const response = await fetch(`${baseUrl}/api/loops/${loopId}/address-comments`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ comments: "Some comment" }),
        });

        expect(response.status).toBe(400);
        const body = await response.json();
        expect(body.error).toContain("not addressable");
      } finally {
        await rm(uniqueWorkDir, { recursive: true, force: true });
      }
    });

    test("POST /api/loops/:id/address-comments returns 404 for non-existent loop", async () => {
      const response = await fetch(`${baseUrl}/api/loops/non-existent/address-comments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ comments: "Some comment" }),
      });
      expect(response.status).toBe(404);
    });

    test("GET /api/loops/:id/comments returns comments in correct order", async () => {
      // Use unique directory with bare repo to avoid conflicts
      const uniqueWorkDir = await mkdtemp(join(tmpdir(), "ralpher-comments-order-test-"));
      const uniqueBareRepo = await mkdtemp(join(tmpdir(), "ralpher-comments-order-bare-"));
      await Bun.$`git init --bare ${uniqueBareRepo}`.quiet();
      await Bun.$`git init ${uniqueWorkDir}`.quiet();
      await Bun.$`git -C ${uniqueWorkDir} config user.email "test@test.com"`.quiet();
      await Bun.$`git -C ${uniqueWorkDir} config user.name "Test User"`.quiet();
      await Bun.$`git -C ${uniqueWorkDir} remote add origin ${uniqueBareRepo}`.quiet();
      await Bun.$`touch ${uniqueWorkDir}/README.md`.quiet();
      await Bun.$`git -C ${uniqueWorkDir} add .`.quiet();
      await Bun.$`git -C ${uniqueWorkDir} commit -m "Initial commit"`.quiet();
      
      try {
        // Create a loop
        const createResponse = await fetch(`${baseUrl}/api/loops`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            directory: uniqueWorkDir,
            prompt: "Test prompt",
          }),
        });
        const createBody = await createResponse.json();
        const loopId = createBody.config.id;

        // Wait for completion and push
        await waitForLoopCompletion(loopId);
        const pushResponse = await fetch(`${baseUrl}/api/loops/${loopId}/push`, { method: "POST" });
        expect(pushResponse.status).toBe(200);

        // Add comments
        const addressResponse = await fetch(`${baseUrl}/api/loops/${loopId}/address-comments`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ comments: "First comment" }),
        });
        expect(addressResponse.status).toBe(200);

        // Get comments - should be ordered correctly
        const response = await fetch(`${baseUrl}/api/loops/${loopId}/comments`);
        expect(response.status).toBe(200);
        const body = await response.json();

        // Should have at least one comment
        expect(body.comments.length).toBeGreaterThan(0);
        
        // First comment should be from cycle 1
        expect(body.comments[0].reviewCycle).toBe(1);
      } finally {
        await rm(uniqueWorkDir, { recursive: true, force: true });
        await rm(uniqueBareRepo, { recursive: true, force: true });
      }
    });

    test("Comments are stored with pending status initially", async () => {
      // Use unique directory with bare repo to avoid conflicts
      const uniqueWorkDir = await mkdtemp(join(tmpdir(), "ralpher-comments-pending-test-"));
      const uniqueBareRepo = await mkdtemp(join(tmpdir(), "ralpher-comments-pending-bare-"));
      await Bun.$`git init --bare ${uniqueBareRepo}`.quiet();
      await Bun.$`git init ${uniqueWorkDir}`.quiet();
      await Bun.$`git -C ${uniqueWorkDir} config user.email "test@test.com"`.quiet();
      await Bun.$`git -C ${uniqueWorkDir} config user.name "Test User"`.quiet();
      await Bun.$`git -C ${uniqueWorkDir} remote add origin ${uniqueBareRepo}`.quiet();
      await Bun.$`touch ${uniqueWorkDir}/README.md`.quiet();
      await Bun.$`git -C ${uniqueWorkDir} add .`.quiet();
      await Bun.$`git -C ${uniqueWorkDir} commit -m "Initial commit"`.quiet();
      
      try {
        // Create a loop
        const createResponse = await fetch(`${baseUrl}/api/loops`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            directory: uniqueWorkDir,
            prompt: "Test prompt",
          }),
        });
        const createBody = await createResponse.json();
        const loopId = createBody.config.id;

        // Wait for first completion
        await waitForLoopCompletion(loopId);

        // Push the loop
        const pushResponse = await fetch(`${baseUrl}/api/loops/${loopId}/push`, { method: "POST" });
        expect(pushResponse.status).toBe(200);

        // Add comments
        const addressResponse = await fetch(`${baseUrl}/api/loops/${loopId}/address-comments`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ comments: "Test comment" }),
        });
        expect(addressResponse.status).toBe(200);

        // Get comments - should be pending
        const commentsResponse = await fetch(`${baseUrl}/api/loops/${loopId}/comments`);
        const commentsBody = await commentsResponse.json();
        expect(commentsBody.success).toBe(true);
        expect(commentsBody.comments.length).toBeGreaterThan(0);
        expect(commentsBody.comments[0].status).toBe("pending");
        expect(commentsBody.comments[0].addressedAt).toBeUndefined();
      } finally {
        await rm(uniqueWorkDir, { recursive: true, force: true });
        await rm(uniqueBareRepo, { recursive: true, force: true });
      }
    });
  });
});
