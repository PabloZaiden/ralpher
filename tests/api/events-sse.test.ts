/**
 * API integration tests for SSE events endpoints.
 * Tests use actual HTTP requests to a test server.
 */

import { test, expect, describe, beforeAll, afterAll } from "bun:test";
import { mkdtemp, rm } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { serve, type Server } from "bun";
import { apiRoutes } from "../../src/api";
import { ensureDataDirectories } from "../../src/persistence/paths";

describe("Events SSE API Integration", () => {
  let testDataDir: string;
  let testWorkDir: string;
  let server: Server<unknown>;
  let baseUrl: string;

  beforeAll(async () => {
    // Create temp directories
    testDataDir = await mkdtemp(join(tmpdir(), "ralpher-api-events-test-data-"));
    testWorkDir = await mkdtemp(join(tmpdir(), "ralpher-api-events-test-work-"));

    // Set env var for persistence
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

  describe("GET /api/events", () => {
    test("returns SSE response with correct headers", async () => {
      // Use AbortController to cancel the request after getting headers
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 100);

      try {
        const response = await fetch(`${baseUrl}/api/events`, {
          signal: controller.signal,
        });

        expect(response.status).toBe(200);
        expect(response.headers.get("content-type")).toBe("text/event-stream");
        expect(response.headers.get("cache-control")).toBe("no-cache");
        expect(response.headers.get("connection")).toBe("keep-alive");
      } catch (e) {
        // AbortError is expected - we just want to check headers
        if ((e as Error).name !== "AbortError") {
          throw e;
        }
      } finally {
        clearTimeout(timeoutId);
      }
    });

    test("returns a readable stream", async () => {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 100);

      try {
        const response = await fetch(`${baseUrl}/api/events`, {
          signal: controller.signal,
        });

        expect(response.body).toBeDefined();
        expect(response.body).not.toBeNull();
      } catch (e) {
        if ((e as Error).name !== "AbortError") {
          throw e;
        }
      } finally {
        clearTimeout(timeoutId);
      }
    });
  });

  describe("GET /api/loops/:id/events", () => {
    test("returns SSE response for existing loop", async () => {
      // Create a loop first
      const createResponse = await fetch(`${baseUrl}/api/loops`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "SSE Test Loop",
          directory: testWorkDir,
          prompt: "Test prompt",
        }),
      });
      const createBody = await createResponse.json();
      const loopId = createBody.config.id;

      // Use AbortController to cancel the request after getting headers
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 100);

      try {
        const response = await fetch(`${baseUrl}/api/loops/${loopId}/events`, {
          signal: controller.signal,
        });

        expect(response.status).toBe(200);
        expect(response.headers.get("content-type")).toBe("text/event-stream");
        expect(response.headers.get("cache-control")).toBe("no-cache");
      } catch (e) {
        if ((e as Error).name !== "AbortError") {
          throw e;
        }
      } finally {
        clearTimeout(timeoutId);
      }
    });

    test("returns 404 for non-existent loop", async () => {
      const response = await fetch(`${baseUrl}/api/loops/non-existent/events`);

      expect(response.status).toBe(404);
      const body = await response.json();
      expect(body.error).toBe("not_found");
    });
  });
});
