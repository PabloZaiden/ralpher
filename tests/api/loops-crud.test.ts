/**
 * API integration tests for loops CRUD endpoints.
 * Tests use actual HTTP requests to a test server.
 */

import { test, expect, describe, beforeAll, afterAll, beforeEach, afterEach } from "bun:test";
import { mkdtemp, rm, mkdir } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { serve, type Server } from "bun";
import { apiRoutes } from "../../src/api";
import { ensureDataDirectories } from "../../src/persistence/paths";

describe("Loops CRUD API Integration", () => {
  let testDataDir: string;
  let testWorkDir: string;
  let server: Server;
  let baseUrl: string;

  beforeAll(async () => {
    // Create temp directories
    testDataDir = await mkdtemp(join(tmpdir(), "ralpher-api-crud-test-data-"));
    testWorkDir = await mkdtemp(join(tmpdir(), "ralpher-api-crud-test-work-"));

    // Set env var for persistence before importing modules
    process.env.RALPHER_DATA_DIR = testDataDir;

    // Ensure directories exist
    await ensureDataDirectories();

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
      expect(body.state.status).toBe("idle");
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
          git: { enabled: false },
        }),
      });

      expect(response.status).toBe(201);
      const body = await response.json();
      expect(body.config.maxIterations).toBe(10);
      expect(body.config.stopPattern).toBe("<done>FINISHED</done>$");
      expect(body.config.git.enabled).toBe(false);
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

      // Verify it's deleted
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
});
