/**
 * API integration tests for workspace endpoints.
 * Tests use actual HTTP requests to a test server.
 */

import { test, expect, describe, beforeAll, afterAll, beforeEach } from "bun:test";
import { mkdtemp, rm } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { serve, type Server } from "bun";
import { apiRoutes } from "../../src/api";
import { ensureDataDirectories } from "../../src/persistence/paths";
import { backendManager } from "../../src/core/backend-manager";
import { createMockBackend } from "../mocks/mock-backend";
import { TestCommandExecutor } from "../mocks/mock-executor";

describe("Workspace API Integration", () => {
  let testDataDir: string;
  let testWorkDir: string;
  let server: Server<unknown>;
  let baseUrl: string;

  beforeAll(async () => {
    // Create temp directories
    testDataDir = await mkdtemp(join(tmpdir(), "ralpher-api-workspace-test-data-"));
    testWorkDir = await mkdtemp(join(tmpdir(), "ralpher-api-workspace-test-work-"));

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

  // Clean up workspaces before each test
  beforeEach(async () => {
    const { getDatabase } = await import("../../src/persistence/database");
    // Clear the workspaces and loops tables
    const db = getDatabase();
    db.run("DELETE FROM loops WHERE workspace_id IS NOT NULL");
    db.run("DELETE FROM workspaces");
  });

  describe("GET /api/workspaces", () => {
    test("returns empty array when no workspaces exist", async () => {
      const response = await fetch(`${baseUrl}/api/workspaces`);
      expect(response.ok).toBe(true);
      const data = await response.json();
      expect(data).toEqual([]);
    });

    test("returns list of workspaces with loop counts", async () => {
      // Create a workspace first
      const createResponse = await fetch(`${baseUrl}/api/workspaces`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "Test Workspace",
          directory: testWorkDir,
        }),
      });
      expect(createResponse.ok).toBe(true);

      // Get the list
      const response = await fetch(`${baseUrl}/api/workspaces`);
      expect(response.ok).toBe(true);
      const data = await response.json();

      expect(data.length).toBe(1);
      expect(data[0].name).toBe("Test Workspace");
      expect(data[0].directory).toBe(testWorkDir);
      expect(data[0].loopCount).toBe(0);
    });
  });

  describe("POST /api/workspaces", () => {
    test("creates a new workspace", async () => {
      const response = await fetch(`${baseUrl}/api/workspaces`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "New Workspace",
          directory: testWorkDir,
        }),
      });

      expect(response.ok).toBe(true);
      const data = await response.json();

      expect(data.id).toBeDefined();
      expect(data.name).toBe("New Workspace");
      expect(data.directory).toBe(testWorkDir);
      expect(data.createdAt).toBeDefined();
      expect(data.updatedAt).toBeDefined();
    });

    test("fails if name is missing", async () => {
      const response = await fetch(`${baseUrl}/api/workspaces`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          directory: testWorkDir,
        }),
      });

      expect(response.ok).toBe(false);
      expect(response.status).toBe(400);
    });

    test("fails if directory is missing", async () => {
      const response = await fetch(`${baseUrl}/api/workspaces`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "Test Workspace",
        }),
      });

      expect(response.ok).toBe(false);
      expect(response.status).toBe(400);
    });

    test("fails if directory is not a git repository", async () => {
      const nonGitDir = await mkdtemp(join(tmpdir(), "non-git-"));

      const response = await fetch(`${baseUrl}/api/workspaces`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "Non-Git Workspace",
          directory: nonGitDir,
        }),
      });

      expect(response.ok).toBe(false);
      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.message).toContain("git repository");

      // Cleanup
      await rm(nonGitDir, { recursive: true, force: true });
    });

    test("returns existing workspace if directory already exists", async () => {
      // Create first workspace
      const firstResponse = await fetch(`${baseUrl}/api/workspaces`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "First Workspace",
          directory: testWorkDir,
        }),
      });
      expect(firstResponse.ok).toBe(true);
      const firstData = await firstResponse.json();

      // Try to create another workspace with the same directory
      const secondResponse = await fetch(`${baseUrl}/api/workspaces`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "Second Workspace",
          directory: testWorkDir,
        }),
      });

      // Should return 409 Conflict with the existing workspace
      expect(secondResponse.status).toBe(409);
      const secondData = await secondResponse.json();
      expect(secondData.existingWorkspace).toBeDefined();
      expect(secondData.existingWorkspace.id).toBe(firstData.id);
    });
  });

  describe("GET /api/workspaces/:id", () => {
    test("returns workspace by id", async () => {
      // Create a workspace
      const createResponse = await fetch(`${baseUrl}/api/workspaces`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "Get By ID Test",
          directory: testWorkDir,
        }),
      });
      const workspace = await createResponse.json();

      // Get by ID
      const response = await fetch(`${baseUrl}/api/workspaces/${workspace.id}`);
      expect(response.ok).toBe(true);
      const data = await response.json();

      expect(data.id).toBe(workspace.id);
      expect(data.name).toBe("Get By ID Test");
    });

    test("returns 404 for non-existent id", async () => {
      const response = await fetch(`${baseUrl}/api/workspaces/non-existent-id`);
      expect(response.status).toBe(404);
    });
  });

  describe("PUT /api/workspaces/:id", () => {
    test("updates workspace name", async () => {
      // Create a workspace
      const createResponse = await fetch(`${baseUrl}/api/workspaces`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "Original Name",
          directory: testWorkDir,
        }),
      });
      const workspace = await createResponse.json();

      // Update name
      const response = await fetch(`${baseUrl}/api/workspaces/${workspace.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "Updated Name",
        }),
      });
      expect(response.ok).toBe(true);
      const data = await response.json();

      expect(data.name).toBe("Updated Name");
      expect(data.directory).toBe(testWorkDir);
    });

    test("returns 404 for non-existent id", async () => {
      const response = await fetch(`${baseUrl}/api/workspaces/non-existent-id`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "New Name",
        }),
      });
      expect(response.status).toBe(404);
    });
  });

  describe("DELETE /api/workspaces/:id", () => {
    test("deletes workspace with no loops", async () => {
      // Create a workspace
      const createResponse = await fetch(`${baseUrl}/api/workspaces`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "Delete Me",
          directory: testWorkDir,
        }),
      });
      const workspace = await createResponse.json();

      // Delete it
      const response = await fetch(`${baseUrl}/api/workspaces/${workspace.id}`, {
        method: "DELETE",
      });
      expect(response.ok).toBe(true);

      // Verify it's gone
      const getResponse = await fetch(`${baseUrl}/api/workspaces/${workspace.id}`);
      expect(getResponse.status).toBe(404);
    });

    test("returns 404 for non-existent id", async () => {
      const response = await fetch(`${baseUrl}/api/workspaces/non-existent-id`, {
        method: "DELETE",
      });
      expect(response.status).toBe(404);
    });
  });

  describe("GET /api/workspaces/by-directory", () => {
    test("returns workspace by directory path", async () => {
      // Create a workspace
      const createResponse = await fetch(`${baseUrl}/api/workspaces`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "Find By Directory Test",
          directory: testWorkDir,
        }),
      });
      const workspace = await createResponse.json();

      // Get by directory
      const response = await fetch(
        `${baseUrl}/api/workspaces/by-directory?directory=${encodeURIComponent(testWorkDir)}`
      );
      expect(response.ok).toBe(true);
      const data = await response.json();

      expect(data.id).toBe(workspace.id);
      expect(data.name).toBe("Find By Directory Test");
    });

    test("returns 404 for non-existent directory", async () => {
      const response = await fetch(
        `${baseUrl}/api/workspaces/by-directory?directory=${encodeURIComponent("/non/existent/path")}`
      );
      expect(response.status).toBe(404);
    });

    test("returns 400 if directory query param is missing", async () => {
      const response = await fetch(`${baseUrl}/api/workspaces/by-directory`);
      expect(response.status).toBe(400);
    });
  });

  describe("Loop creation with workspaceId", () => {
    test("creates a loop using workspaceId and touches the workspace", async () => {
      // Step 1: Create a workspace
      const workspaceResponse = await fetch(`${baseUrl}/api/workspaces`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "Loop Test Workspace",
          directory: testWorkDir,
        }),
      });
      expect(workspaceResponse.ok).toBe(true);
      const workspace = await workspaceResponse.json();
      const originalUpdatedAt = workspace.updatedAt;

      // Wait a bit to ensure timestamp difference
      await new Promise((resolve) => setTimeout(resolve, 50));

      // Step 2: Create a loop using the workspaceId (draft to avoid git operations)
      const loopResponse = await fetch(`${baseUrl}/api/loops`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          workspaceId: workspace.id,
          prompt: "Test prompt for loop creation",
          draft: true,
        }),
      });
      expect(loopResponse.ok).toBe(true);
      const loop = await loopResponse.json();

      // Verify the loop was created with the workspace's directory
      expect(loop.config.directory).toBe(testWorkDir);
      expect(loop.config.workspaceId).toBe(workspace.id);
      expect(loop.state.status).toBe("draft");

      // Step 3: Verify the workspace was touched (updatedAt should be updated)
      const updatedWorkspaceResponse = await fetch(`${baseUrl}/api/workspaces/${workspace.id}`);
      expect(updatedWorkspaceResponse.ok).toBe(true);
      const updatedWorkspace = await updatedWorkspaceResponse.json();
      expect(new Date(updatedWorkspace.updatedAt).getTime()).toBeGreaterThan(
        new Date(originalUpdatedAt).getTime()
      );

      // Step 4: Verify the workspace's loop count increased
      const workspacesListResponse = await fetch(`${baseUrl}/api/workspaces`);
      expect(workspacesListResponse.ok).toBe(true);
      const workspacesList = await workspacesListResponse.json();
      const workspaceWithCount = workspacesList.find((w: { id: string }) => w.id === workspace.id);
      expect(workspaceWithCount.loopCount).toBe(1);
    });

    test("fails when creating loop with non-existent workspaceId", async () => {
      const response = await fetch(`${baseUrl}/api/loops`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          workspaceId: "non-existent-workspace-id",
          prompt: "Test prompt",
          draft: true,
        }),
      });

      expect(response.ok).toBe(false);
      expect(response.status).toBe(404);
      const data = await response.json();
      expect(data.error).toBe("workspace_not_found");
    });

    test("fails when creating loop without workspaceId", async () => {
      const response = await fetch(`${baseUrl}/api/loops`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt: "Test prompt",
          draft: true,
        }),
      });

      expect(response.ok).toBe(false);
      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error).toBe("validation_error");
      expect(data.message).toContain("workspaceId");
    });
  });
});
