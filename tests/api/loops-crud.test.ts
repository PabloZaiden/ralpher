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
import packageJson from "../../package.json";
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
  async function waitForLoopCompletion(loopId: string, timeoutMs = 10000): Promise<void> {
    const startTime = Date.now();
    let lastStatus = "unknown";
    while (Date.now() - startTime < timeoutMs) {
      const response = await fetch(`${baseUrl}/api/loops/${loopId}`);
      if (response.ok) {
        const data = await response.json();
        lastStatus = data.state?.status ?? "unknown";
        if (lastStatus === "completed" || lastStatus === "failed") {
          return;
        }
      }
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    throw new Error(`Loop ${loopId} did not complete within ${timeoutMs}ms. Last status: ${lastStatus}`);
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
      expect(body.version).toBe(packageJson.version);
    });
  });

  describe("POST /api/loops", () => {
    test("creates a new loop with required fields and auto-generates name", async () => {
      const response = await fetch(`${baseUrl}/api/loops`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          directory: testWorkDir,
          prompt: "Build something",
        }),
      });

      expect(response.status).toBe(201);
      const body = await response.json();
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
        body: JSON.stringify({ prompt: "Missing directory" }),
      });

      expect(response.status).toBe(400);
      const body = await response.json();
      expect(body.error).toBe("validation_error");
    });

    test("returns 400 for empty prompt", async () => {
      const response = await fetch(`${baseUrl}/api/loops`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          directory: testWorkDir,
          prompt: "",
        }),
      });

      expect(response.status).toBe(400);
      const body = await response.json();
      expect(body.error).toBe("validation_error");
      expect(body.message).toContain("prompt");
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
          prompt: "Updated prompt",
        }),
      });
      expect(response.status).toBe(200);

      const body = await response.json();
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

  describe("Draft loops", () => {
    test("creates a draft loop without starting", async () => {
      const response = await fetch(`${baseUrl}/api/loops`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          directory: testWorkDir,
          prompt: "Draft task",
          draft: true,
        }),
      });

      expect(response.status).toBe(201);
      const body = await response.json();
      expect(body.state.status).toBe("draft");
      expect(body.state.session).toBeUndefined();
      expect(body.state.git).toBeUndefined();
    });

    test("non-draft loops still auto-start", async () => {
      const response = await fetch(`${baseUrl}/api/loops`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          directory: testWorkDir,
          prompt: "Normal task",
          draft: false,
        }),
      });

      expect(response.status).toBe(201);
      const body = await response.json();
      expect(body.state.status).not.toBe("draft");
      expect(body.state.status).not.toBe("idle");
    });

    test("can update a draft loop via PUT", async () => {
      // Create draft
      const createResponse = await fetch(`${baseUrl}/api/loops`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          directory: testWorkDir,
          prompt: "Original prompt",
          draft: true,
        }),
      });
      const createBody = await createResponse.json();
      const loopId = createBody.config.id;

      // Update draft
      const updateResponse = await fetch(`${baseUrl}/api/loops/${loopId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt: "Updated prompt",
        }),
      });

      expect(updateResponse.status).toBe(200);
      const updateBody = await updateResponse.json();
      expect(updateBody.config.prompt).toBe("Updated prompt");
      expect(updateBody.state.status).toBe("draft");
    });

    test("cannot update non-draft loop via PUT", async () => {
      // Create regular loop
      const createResponse = await fetch(`${baseUrl}/api/loops`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          directory: testWorkDir,
          prompt: "Task",
        }),
      });
      const createBody = await createResponse.json();
      const loopId = createBody.config.id;

      // Wait for completion
      await waitForLoopCompletion(loopId);

      // Try to update
      const updateResponse = await fetch(`${baseUrl}/api/loops/${loopId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
        }),
      });

      expect(updateResponse.status).toBe(400);
      const body = await updateResponse.json();
      expect(body.error).toBe("not_draft");
    });

    test("can start draft as immediate execution", async () => {
      // Create draft
      const createResponse = await fetch(`${baseUrl}/api/loops`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          directory: testWorkDir,
          prompt: "Task",
          draft: true,
        }),
      });
      const createBody = await createResponse.json();
      const loopId = createBody.config.id;

      // Start draft
      const startResponse = await fetch(`${baseUrl}/api/loops/${loopId}/draft/start`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          planMode: false,
        }),
      });

      expect(startResponse.status).toBe(200);
      const startBody = await startResponse.json();
      expect(startBody.state.status).not.toBe("draft");
      
      // Wait for completion
      await waitForLoopCompletion(loopId);
      
      // Verify final state
      const getResponse = await fetch(`${baseUrl}/api/loops/${loopId}`);
      const getBody = await getResponse.json();
      expect(getBody.state.status).toBe("completed");
      expect(getBody.state.git).toBeDefined();
    });

    test("can start draft as plan mode", async () => {
      // Create draft
      const createResponse = await fetch(`${baseUrl}/api/loops`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          directory: testWorkDir,
          prompt: "Task",
          draft: true,
        }),
      });
      const createBody = await createResponse.json();
      const loopId = createBody.config.id;

      // Start draft in plan mode
      const startResponse = await fetch(`${baseUrl}/api/loops/${loopId}/draft/start`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          planMode: true,
        }),
      });

      expect(startResponse.status).toBe(200);
      const startBody = await startResponse.json();
      expect(startBody.state.status).toBe("planning");
    });

    test("cannot start non-draft loop via draft/start", async () => {
      // Create regular loop
      const createResponse = await fetch(`${baseUrl}/api/loops`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          directory: testWorkDir,
          prompt: "Task",
        }),
      });
      const createBody = await createResponse.json();
      const loopId = createBody.config.id;

      // Try to start via draft endpoint
      const startResponse = await fetch(`${baseUrl}/api/loops/${loopId}/draft/start`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          planMode: false,
        }),
      });

      expect(startResponse.status).toBe(400);
      const body = await startResponse.json();
      expect(body.error).toBe("not_draft");
    });

    test("can delete a draft loop", async () => {
      // Create draft
      const createResponse = await fetch(`${baseUrl}/api/loops`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          directory: testWorkDir,
          prompt: "Task",
          draft: true,
        }),
      });
      const createBody = await createResponse.json();
      const loopId = createBody.config.id;

      // Delete draft
      const deleteResponse = await fetch(`${baseUrl}/api/loops/${loopId}`, {
        method: "DELETE",
      });

      expect(deleteResponse.status).toBe(200);

      // Verify it's soft-deleted (still exists but with status "deleted")
      const getResponse = await fetch(`${baseUrl}/api/loops/${loopId}`);
      expect(getResponse.status).toBe(200);
      const getBody = await getResponse.json();
      expect(getBody.state.status).toBe("deleted");
    });
  });

  describe("POST /api/loops/:id/mark-merged", () => {
    test("returns 404 for non-existent loop", async () => {
      const response = await fetch(`${baseUrl}/api/loops/non-existent-id/mark-merged`, {
        method: "POST",
      });
      expect(response.status).toBe(404);

      const body = await response.json();
      expect(body.error).toBe("not_found");
    });

    test("returns 400 for loop not in final state", async () => {
      // Create a draft loop (not in final state)
      const createResponse = await fetch(`${baseUrl}/api/loops`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          directory: testWorkDir,
          prompt: "Test mark merged",
          draft: true,
        }),
      });
      const createBody = await createResponse.json();
      const loopId = createBody.config.id;

      // Try to mark as merged
      const response = await fetch(`${baseUrl}/api/loops/${loopId}/mark-merged`, {
        method: "POST",
      });
      expect(response.status).toBe(400);

      const body = await response.json();
      expect(body.error).toBe("mark_merged_failed");
      expect(body.message).toContain("Cannot mark loop as merged");
    });

    test("returns 400 for loop without git state", async () => {
      // Create a loop, complete it, but ensure it has no git state
      const createResponse = await fetch(`${baseUrl}/api/loops`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          directory: testWorkDir,
          prompt: "Test no git",
        }),
      });
      const createBody = await createResponse.json();
      const loopId = createBody.config.id;

      // Wait for completion
      await waitForLoopCompletion(loopId);

      // Manually update loop to completed without git state
      // This simulates a loop that was completed without git integration
      const { updateLoopState, loadLoop } = await import("../../src/persistence/loops");
      const loop = await loadLoop(loopId);
      if (loop) {
        await updateLoopState(loopId, {
          ...loop.state,
          git: undefined, // Remove git state
        });
      }

      // Try to mark as merged
      const response = await fetch(`${baseUrl}/api/loops/${loopId}/mark-merged`, {
        method: "POST",
      });
      expect(response.status).toBe(400);

      const body = await response.json();
      expect(body.error).toBe("mark_merged_failed");
      expect(body.message).toContain("No git branch");
    });

    test("marks a completed loop as merged and sets status to deleted", async () => {
      // Create and complete a loop
      const createResponse = await fetch(`${baseUrl}/api/loops`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          directory: testWorkDir,
          prompt: "Test mark merged",
        }),
      });
      const createBody = await createResponse.json();
      const loopId = createBody.config.id;

      // Wait for completion
      await waitForLoopCompletion(loopId);

      // Mark as merged
      const response = await fetch(`${baseUrl}/api/loops/${loopId}/mark-merged`, {
        method: "POST",
      });
      expect(response.status).toBe(200);

      const body = await response.json();
      expect(body.success).toBe(true);

      // Verify loop status is now deleted
      const getResponse = await fetch(`${baseUrl}/api/loops/${loopId}`);
      expect(getResponse.status).toBe(200);
      const getBody = await getResponse.json();
      expect(getBody.state.status).toBe("deleted");
    });
  });
});
