/**
 * API integration tests for loops CRUD endpoints.
 * Tests use actual HTTP requests to a test server.
 */

import { test, expect, describe, beforeAll, afterAll } from "bun:test";
import { mkdtemp, rm } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { serve, type Server } from "bun";
import { apiRoutes } from "../../src/api";
import { ensureDataDirectories } from "../../src/persistence/paths";
import { backendManager } from "../../src/core/backend-manager";
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

describe("Loops CRUD API Integration", () => {
  let testDataDir: string;
  let testWorkDir: string;
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
  async function waitForLoopCompletion(loopId: string, timeoutMs = 5000): Promise<void> {
    const startTime = Date.now();
    while (Date.now() - startTime < timeoutMs) {
      const response = await fetch(`${baseUrl}/api/loops/${loopId}`);
      if (response.ok) {
        const data = await response.json();
        if (data.state?.status === "completed") {
          return;
        }
      }
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    throw new Error(`Loop ${loopId} did not complete within ${timeoutMs}ms`);
  }

  beforeAll(async () => {
    // Create temp directories
    testDataDir = await mkdtemp(join(tmpdir(), "ralpher-api-crud-test-data-"));
    testWorkDir = await mkdtemp(join(tmpdir(), "ralpher-api-crud-test-work-"));

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

    // Reset backend manager
    backendManager.resetForTesting();

    // Cleanup temp directories
    await rm(testDataDir, { recursive: true, force: true });
    await rm(testWorkDir, { recursive: true, force: true });

    // Clear env
    delete process.env["RALPHER_DATA_DIR"];
  });

  describe("GET /api/health", () => {
    test("returns healthy status", async () => {
      const response = await fetch(`${baseUrl}/api/health`);
      expect(response.status).toBe(200);

      const body = await response.json();
      expect(body.healthy).toBe(true);
      expect(body.version).toBe("1.0.0");
    });
  });

  describe("POST /api/loops", () => {
    test("creates a new loop with required fields", async () => {
      const response = await fetch(`${baseUrl}/api/loops`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "Test Loop",
          directory: testWorkDir,
          prompt: "Build something",
        }),
      });

      expect(response.status).toBe(201);
      const body = await response.json();
      expect(body.config.name).toBe("Test Loop");
      expect(body.config.directory).toBe(testWorkDir);
      expect(body.config.prompt).toBe("Build something");
      expect(body.config.id).toBeDefined();
      // Loops are auto-started on creation, so status should not be idle
      expect(["starting", "running", "completed"]).toContain(body.state.status);
    });

    test("creates a loop with optional fields", async () => {
      const response = await fetch(`${baseUrl}/api/loops`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "Custom Loop",
          directory: testWorkDir,
          prompt: "Custom task",
          maxIterations: 10,
          stopPattern: "<done>FINISHED</done>$",
          git: { branchPrefix: "custom/" },
        }),
      });

      expect(response.status).toBe(201);
      const body = await response.json();
      expect(body.config.maxIterations).toBe(10);
      expect(body.config.stopPattern).toBe("<done>FINISHED</done>$");
      expect(body.config.git.branchPrefix).toBe("custom/");
    });

    test("returns 400 for invalid JSON", async () => {
      const response = await fetch(`${baseUrl}/api/loops`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "not valid json",
      });

      expect(response.status).toBe(400);
      const body = await response.json();
      expect(body.error).toBe("invalid_body");
    });

    test("returns 400 for missing required fields", async () => {
      const response = await fetch(`${baseUrl}/api/loops`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "Missing fields" }),
      });

      expect(response.status).toBe(400);
      const body = await response.json();
      expect(body.error).toBe("validation_error");
    });

    test("returns 400 for empty name", async () => {
      const response = await fetch(`${baseUrl}/api/loops`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "",
          directory: testWorkDir,
          prompt: "Test",
        }),
      });

      expect(response.status).toBe(400);
      const body = await response.json();
      expect(body.error).toBe("validation_error");
      expect(body.message).toContain("name");
    });
  });

  describe("GET /api/loops", () => {
    test("returns array of loops", async () => {
      const response = await fetch(`${baseUrl}/api/loops`);
      expect(response.status).toBe(200);

      const body = await response.json();
      expect(Array.isArray(body)).toBe(true);
      // Should have loops from previous tests
      expect(body.length).toBeGreaterThan(0);
    });
  });

  describe("GET /api/loops/:id", () => {
    test("returns a specific loop", async () => {
      // First create a loop
      const createResponse = await fetch(`${baseUrl}/api/loops`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "Get Test Loop",
          directory: testWorkDir,
          prompt: "Test prompt",
        }),
      });
      const createBody = await createResponse.json();
      const loopId = createBody.config.id;

      // Then get it
      const response = await fetch(`${baseUrl}/api/loops/${loopId}`);
      expect(response.status).toBe(200);

      const body = await response.json();
      expect(body.config.id).toBe(loopId);
      expect(body.config.name).toBe("Get Test Loop");
    });

    test("returns 404 for non-existent loop", async () => {
      const response = await fetch(`${baseUrl}/api/loops/non-existent-id`);
      expect(response.status).toBe(404);

      const body = await response.json();
      expect(body.error).toBe("not_found");
    });
  });

  describe("PATCH /api/loops/:id", () => {
    test("updates a loop", async () => {
      // First create a loop
      const createResponse = await fetch(`${baseUrl}/api/loops`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "Original Name",
          directory: testWorkDir,
          prompt: "Original prompt",
        }),
      });
      const createBody = await createResponse.json();
      const loopId = createBody.config.id;

      // Wait for the loop to complete (loops auto-start now)
      await waitForLoopCompletion(loopId);

      // Then update it
      const response = await fetch(`${baseUrl}/api/loops/${loopId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "Updated Name",
          prompt: "Updated prompt",
        }),
      });
      expect(response.status).toBe(200);

      const body = await response.json();
      expect(body.config.name).toBe("Updated Name");
      expect(body.config.prompt).toBe("Updated prompt");
    });

    test("returns 404 for non-existent loop", async () => {
      const response = await fetch(`${baseUrl}/api/loops/non-existent-id`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "New Name" }),
      });
      expect(response.status).toBe(404);
    });

    test("returns 400 for invalid JSON", async () => {
      // First create a loop
      const createResponse = await fetch(`${baseUrl}/api/loops`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "Test Loop",
          directory: testWorkDir,
          prompt: "Test",
        }),
      });
      const createBody = await createResponse.json();
      const loopId = createBody.config.id;

      // Try to update with invalid JSON
      const response = await fetch(`${baseUrl}/api/loops/${loopId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: "invalid json",
      });
      expect(response.status).toBe(400);

      const body = await response.json();
      expect(body.error).toBe("invalid_body");
    });
  });

  describe("DELETE /api/loops/:id", () => {
    test("deletes a loop", async () => {
      // First create a loop
      const createResponse = await fetch(`${baseUrl}/api/loops`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "Delete Test Loop",
          directory: testWorkDir,
          prompt: "Test prompt",
        }),
      });
      const createBody = await createResponse.json();
      const loopId = createBody.config.id;

      // Delete it
      const response = await fetch(`${baseUrl}/api/loops/${loopId}`, {
        method: "DELETE",
      });
      expect(response.status).toBe(200);

      const body = await response.json();
      expect(body.success).toBe(true);

      // Verify it's soft-deleted (still exists but with status "deleted")
      const getResponse = await fetch(`${baseUrl}/api/loops/${loopId}`);
      expect(getResponse.status).toBe(200);
      const getBody = await getResponse.json();
      expect(getBody.state.status).toBe("deleted");
    });

    test("purges a deleted loop", async () => {
      // Create a loop first
      const createResponse = await fetch(`${baseUrl}/api/loops`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "To Purge",
          directory: testWorkDir,
          prompt: "Purge me",
        }),
      });
      const createBody = await createResponse.json();
      const loopId = createBody.config.id;

      // Soft delete it
      await fetch(`${baseUrl}/api/loops/${loopId}`, { method: "DELETE" });

      // Purge it
      const purgeResponse = await fetch(`${baseUrl}/api/loops/${loopId}/purge`, {
        method: "POST",
      });
      expect(purgeResponse.status).toBe(200);

      // Verify it's actually deleted
      const getResponse = await fetch(`${baseUrl}/api/loops/${loopId}`);
      expect(getResponse.status).toBe(404);
    });

    test("returns 404 for non-existent loop", async () => {
      const response = await fetch(`${baseUrl}/api/loops/non-existent-id`, {
        method: "DELETE",
      });
      expect(response.status).toBe(404);

      const body = await response.json();
      expect(body.error).toBe("not_found");
    });
  });

  describe("clearPlanningFolder option", () => {
    test("creates a loop with clearPlanningFolder = true", async () => {
      const response = await fetch(`${baseUrl}/api/loops`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "Clear Planning Test",
          directory: testWorkDir,
          prompt: "Task with clearing",
          clearPlanningFolder: true,
        }),
      });

      expect(response.status).toBe(201);
      const body = await response.json();
      expect(body.config.clearPlanningFolder).toBe(true);
    });

    test("creates a loop with clearPlanningFolder = false", async () => {
      const response = await fetch(`${baseUrl}/api/loops`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "Keep Planning Test",
          directory: testWorkDir,
          prompt: "Task without clearing",
          clearPlanningFolder: false,
        }),
      });

      expect(response.status).toBe(201);
      const body = await response.json();
      expect(body.config.clearPlanningFolder).toBe(false);
    });

    test("creates a loop with clearPlanningFolder defaulting to false", async () => {
      const response = await fetch(`${baseUrl}/api/loops`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "Default Planning Test",
          directory: testWorkDir,
          prompt: "Task with default",
        }),
      });

      expect(response.status).toBe(201);
      const body = await response.json();
      // Default value is false (not clearing the planning folder)
      expect(body.config.clearPlanningFolder).toBe(false);
    });

    test("GET returns clearPlanningFolder value correctly", async () => {
      // Create a loop with clearPlanningFolder = true
      const createResponse = await fetch(`${baseUrl}/api/loops`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "Get Clear Planning Test",
          directory: testWorkDir,
          prompt: "Test",
          clearPlanningFolder: true,
        }),
      });
      const createBody = await createResponse.json();
      const loopId = createBody.config.id;

      // Wait for the loop to complete
      await waitForLoopCompletion(loopId);

      // Get the loop and verify clearPlanningFolder is set
      const getResponse = await fetch(`${baseUrl}/api/loops/${loopId}`);
      expect(getResponse.status).toBe(200);

      const getBody = await getResponse.json();
      expect(getBody.config.clearPlanningFolder).toBe(true);
    });
  });
});
