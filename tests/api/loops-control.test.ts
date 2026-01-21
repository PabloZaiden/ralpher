/**
 * API integration tests for loops control endpoints.
 * Tests use actual HTTP requests to a test server.
 */

import { test, expect, describe, beforeAll, afterAll } from "bun:test";
import { mkdtemp, rm, mkdir, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { serve, type Server } from "bun";
import { apiRoutes } from "../../src/api";
import { ensureDataDirectories } from "../../src/persistence/paths";
import { backendRegistry } from "../../src/backends/registry";
import type {
  AgentBackend,
  AgentSession,
  AgentResponse,
  AgentEvent,
  BackendConnectionConfig,
  CreateSessionOptions,
  PromptInput,
} from "../../src/backends/types";

describe("Loops Control API Integration", () => {
  let testDataDir: string;
  let testWorkDir: string;
  let server: Server<unknown>;
  let baseUrl: string;

  // Create a mock backend that completes immediately
  function createMockBackend(): AgentBackend {
    let connected = false;
    const sessions = new Map<string, AgentSession>();

    return {
      name: "mock",

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

      async getSession(id: string): Promise<AgentSession | null> {
        return sessions.get(id) ?? null;
      },

      async deleteSession(id: string): Promise<void> {
        sessions.delete(id);
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
      },

      async abortSession(_sessionId: string): Promise<void> {
        // Not used in tests
      },

      async *subscribeToEvents(_sessionId: string): AsyncIterable<AgentEvent> {
        // Yield complete message with stop pattern
        yield { type: "message.start", messageId: `msg-${Date.now()}` };
        yield { type: "message.delta", content: "<promise>COMPLETE</promise>" };
        yield { type: "message.complete", content: "<promise>COMPLETE</promise>" };
      },
    };
  }

  beforeAll(async () => {
    // Create temp directories
    testDataDir = await mkdtemp(join(tmpdir(), "ralpher-api-control-test-data-"));
    testWorkDir = await mkdtemp(join(tmpdir(), "ralpher-api-control-test-work-"));

    // Set env var for persistence before importing modules
    process.env.RALPHER_DATA_DIR = testDataDir;

    // Ensure directories exist
    await ensureDataDirectories();

    // Initialize git repo
    await Bun.$`git init ${testWorkDir}`.quiet();
    await Bun.$`git -C ${testWorkDir} config user.email "test@test.com"`.quiet();
    await Bun.$`git -C ${testWorkDir} config user.name "Test User"`.quiet();
    await Bun.$`touch ${testWorkDir}/README.md`.quiet();
    await Bun.$`git -C ${testWorkDir} add .`.quiet();
    await Bun.$`git -C ${testWorkDir} commit -m "Initial commit"`.quiet();

    // Create .planning directory
    await mkdir(join(testWorkDir, ".planning"), { recursive: true });
    await writeFile(join(testWorkDir, ".planning/plan.md"), "# Test Plan\n\nThis is a test plan.");
    await writeFile(join(testWorkDir, ".planning/status.md"), "# Status\n\nIn progress.");

    // Register mock backend
    backendRegistry.register("mock", createMockBackend);

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

    // Cleanup temp directories
    await rm(testDataDir, { recursive: true, force: true });
    await rm(testWorkDir, { recursive: true, force: true });

    // Clear env
    delete process.env.RALPHER_DATA_DIR;
  });

  describe("POST /api/loops/:id/start", () => {
    test("starts a loop successfully", async () => {
      // Create a loop
      const createResponse = await fetch(`${baseUrl}/api/loops`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "Start Test Loop",
          directory: testWorkDir,
          prompt: "Test prompt",
          backend: { type: "mock" },
          git: { enabled: false },
        }),
      });
      const createBody = await createResponse.json();
      const loopId = createBody.config.id;

      // Start it
      const response = await fetch(`${baseUrl}/api/loops/${loopId}/start`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });

      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.success).toBe(true);
    });

    test("returns 404 for non-existent loop", async () => {
      const response = await fetch(`${baseUrl}/api/loops/non-existent/start`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });

      expect(response.status).toBe(404);
    });

    test("returns 409 for uncommitted changes when git enabled", async () => {
      // Create uncommitted changes
      await writeFile(join(testWorkDir, "uncommitted.txt"), "uncommitted content");

      // Create a loop with git enabled
      const createResponse = await fetch(`${baseUrl}/api/loops`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "Uncommitted Test Loop",
          directory: testWorkDir,
          prompt: "Test prompt",
          backend: { type: "mock" },
          git: { enabled: true },
        }),
      });
      const createBody = await createResponse.json();
      const loopId = createBody.config.id;

      // Try to start
      const response = await fetch(`${baseUrl}/api/loops/${loopId}/start`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });

      expect(response.status).toBe(409);
      const body = await response.json();
      expect(body.error).toBe("uncommitted_changes");
      expect(body.options).toContain("commit");
      expect(body.options).toContain("stash");
      expect(body.options).toContain("cancel");
      expect(Array.isArray(body.changedFiles)).toBe(true);
    });

    test("starts with handleUncommitted=commit", async () => {
      // Create a loop with git enabled
      const createResponse = await fetch(`${baseUrl}/api/loops`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "Commit Test Loop",
          directory: testWorkDir,
          prompt: "Test prompt",
          backend: { type: "mock" },
          git: { enabled: true },
        }),
      });
      const createBody = await createResponse.json();
      const loopId = createBody.config.id;

      // Start with commit option
      const response = await fetch(`${baseUrl}/api/loops/${loopId}/start`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ handleUncommitted: "commit" }),
      });

      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.success).toBe(true);
    });
  });

  describe("POST /api/loops/:id/stop", () => {
    test("returns 409 for non-running loop", async () => {
      // Create a loop but don't start it
      const createResponse = await fetch(`${baseUrl}/api/loops`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "Stop Test Loop",
          directory: testWorkDir,
          prompt: "Test prompt",
          backend: { type: "mock" },
        }),
      });
      const createBody = await createResponse.json();
      const loopId = createBody.config.id;

      // Try to stop
      const response = await fetch(`${baseUrl}/api/loops/${loopId}/stop`, {
        method: "POST",
      });

      expect(response.status).toBe(409);
      const body = await response.json();
      expect(body.error).toBe("not_running");
    });
  });

  describe("POST /api/loops/:id/accept", () => {
    test("returns error for loop with git disabled", async () => {
      const createResponse = await fetch(`${baseUrl}/api/loops`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "Accept No Git Loop",
          directory: testWorkDir,
          prompt: "Test prompt",
          backend: { type: "mock" },
          git: { enabled: false },
        }),
      });
      const createBody = await createResponse.json();
      const loopId = createBody.config.id;

      const response = await fetch(`${baseUrl}/api/loops/${loopId}/accept`, {
        method: "POST",
      });

      expect(response.status).toBe(400);
    });

    test("returns 404 for non-existent loop", async () => {
      const response = await fetch(`${baseUrl}/api/loops/non-existent/accept`, {
        method: "POST",
      });

      expect(response.status).toBe(404);
    });
  });

  describe("POST /api/loops/:id/discard", () => {
    test("returns error for loop with git disabled", async () => {
      const createResponse = await fetch(`${baseUrl}/api/loops`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "Discard No Git Loop",
          directory: testWorkDir,
          prompt: "Test prompt",
          backend: { type: "mock" },
          git: { enabled: false },
        }),
      });
      const createBody = await createResponse.json();
      const loopId = createBody.config.id;

      const response = await fetch(`${baseUrl}/api/loops/${loopId}/discard`, {
        method: "POST",
      });

      expect(response.status).toBe(400);
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

    test("returns 400 for loop with git disabled", async () => {
      const createResponse = await fetch(`${baseUrl}/api/loops`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "Diff No Git Loop",
          directory: testWorkDir,
          prompt: "Test prompt",
          backend: { type: "mock" },
          git: { enabled: false },
        }),
      });
      const createBody = await createResponse.json();
      const loopId = createBody.config.id;

      const response = await fetch(`${baseUrl}/api/loops/${loopId}/diff`);

      expect(response.status).toBe(400);
      const body = await response.json();
      expect(body.error).toBe("git_disabled");
    });
  });

  describe("GET /api/loops/:id/plan", () => {
    test("returns plan.md content", async () => {
      const createResponse = await fetch(`${baseUrl}/api/loops`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "Plan Test Loop",
          directory: testWorkDir,
          prompt: "Test prompt",
          backend: { type: "mock" },
        }),
      });
      const createBody = await createResponse.json();
      const loopId = createBody.config.id;

      const response = await fetch(`${baseUrl}/api/loops/${loopId}/plan`);

      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.exists).toBe(true);
      expect(body.content).toContain("# Test Plan");
    });

    test("returns 404 for non-existent loop", async () => {
      const response = await fetch(`${baseUrl}/api/loops/non-existent/plan`);
      expect(response.status).toBe(404);
    });

    test("returns exists=false for missing plan.md", async () => {
      // Create a new workdir without .planning
      const emptyWorkDir = await mkdtemp(join(tmpdir(), "ralpher-empty-work-"));

      const createResponse = await fetch(`${baseUrl}/api/loops`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "Empty Plan Loop",
          directory: emptyWorkDir,
          prompt: "Test prompt",
          backend: { type: "mock" },
        }),
      });
      const createBody = await createResponse.json();
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
      const createResponse = await fetch(`${baseUrl}/api/loops`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "Status Test Loop",
          directory: testWorkDir,
          prompt: "Test prompt",
          backend: { type: "mock" },
        }),
      });
      const createBody = await createResponse.json();
      const loopId = createBody.config.id;

      const response = await fetch(`${baseUrl}/api/loops/${loopId}/status-file`);

      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.exists).toBe(true);
      expect(body.content).toContain("# Status");
    });

    test("returns 404 for non-existent loop", async () => {
      const response = await fetch(`${baseUrl}/api/loops/non-existent/status-file`);
      expect(response.status).toBe(404);
    });
  });

  describe("Pending Prompt API", () => {
    test("PUT /api/loops/:id/pending-prompt returns 409 when loop is not running", async () => {
      // Create a loop but don't start it
      const createResponse = await fetch(`${baseUrl}/api/loops`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "Pending Prompt Test (Idle)",
          directory: testWorkDir,
          prompt: "Test prompt",
          backend: { type: "mock" },
        }),
      });
      const createBody = await createResponse.json();
      const loopId = createBody.config.id;

      // Try to set pending prompt on idle loop
      const response = await fetch(`${baseUrl}/api/loops/${loopId}/pending-prompt`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: "New prompt" }),
      });

      expect(response.status).toBe(409);
      const body = await response.json();
      expect(body.error).toBe("not_running");
    });

    test("PUT /api/loops/:id/pending-prompt requires prompt in body", async () => {
      const createResponse = await fetch(`${baseUrl}/api/loops`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "Pending Prompt Test (No Body)",
          directory: testWorkDir,
          prompt: "Test prompt",
          backend: { type: "mock" },
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
    });

    test("PUT /api/loops/:id/pending-prompt rejects empty prompt", async () => {
      const createResponse = await fetch(`${baseUrl}/api/loops`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "Pending Prompt Test (Empty)",
          directory: testWorkDir,
          prompt: "Test prompt",
          backend: { type: "mock" },
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
    });

    test("DELETE /api/loops/:id/pending-prompt returns 409 when loop is not running", async () => {
      const createResponse = await fetch(`${baseUrl}/api/loops`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "Pending Prompt Delete Test",
          directory: testWorkDir,
          prompt: "Test prompt",
          backend: { type: "mock" },
        }),
      });
      const createBody = await createResponse.json();
      const loopId = createBody.config.id;

      const response = await fetch(`${baseUrl}/api/loops/${loopId}/pending-prompt`, {
        method: "DELETE",
      });

      expect(response.status).toBe(409);
      const body = await response.json();
      expect(body.error).toBe("not_running");
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
});
