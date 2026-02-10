/**
 * API integration tests for markdown rendering preference endpoints.
 */

import { test, expect, describe, beforeEach, afterEach } from "bun:test";
import { mkdtemp, rm } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";

let testDataDir: string;

describe("Markdown Rendering Preference API", () => {
  beforeEach(async () => {
    // Create a temp directory for each test
    testDataDir = await mkdtemp(join(tmpdir(), "ralpher-test-"));
    process.env["RALPHER_DATA_DIR"] = testDataDir;
    
    // Initialize the database
    const { ensureDataDirectories } = await import("../../src/persistence/database");
    await ensureDataDirectories();
  });

  afterEach(async () => {
    // Close the database before cleaning up
    const { closeDatabase } = await import("../../src/persistence/database");
    closeDatabase();

    // Clean up
    delete process.env["RALPHER_DATA_DIR"];
    await rm(testDataDir, { recursive: true });
  });

  describe("GET /api/preferences/markdown-rendering", () => {
    test("returns enabled: true by default", async () => {
      const { preferencesRoutes } = await import("../../src/api/models");
      const handler = preferencesRoutes["/api/preferences/markdown-rendering"].GET;
      const response = await handler();

      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body).toEqual({ enabled: true });
    });

    test("returns current preference value", async () => {
      const { setMarkdownRenderingEnabled } = await import("../../src/persistence/preferences");
      await setMarkdownRenderingEnabled(false);

      const { preferencesRoutes } = await import("../../src/api/models");
      const handler = preferencesRoutes["/api/preferences/markdown-rendering"].GET;
      const response = await handler();

      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body).toEqual({ enabled: false });
    });

    test("response has correct content-type", async () => {
      const { preferencesRoutes } = await import("../../src/api/models");
      const handler = preferencesRoutes["/api/preferences/markdown-rendering"].GET;
      const response = await handler();

      expect(response.headers.get("content-type")).toContain("application/json");
    });
  });

  describe("PUT /api/preferences/markdown-rendering", () => {
    test("sets preference to false", async () => {
      const { preferencesRoutes } = await import("../../src/api/models");
      const handler = preferencesRoutes["/api/preferences/markdown-rendering"].PUT;
      
      const request = new Request("http://localhost/api/preferences/markdown-rendering", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: false }),
      });
      
      const response = await handler(request);
      expect(response.status).toBe(200);
      
      const body = await response.json();
      expect(body).toEqual({ success: true });

      // Verify it was persisted
      const { getMarkdownRenderingEnabled } = await import("../../src/persistence/preferences");
      expect(await getMarkdownRenderingEnabled()).toBe(false);
    });

    test("sets preference to true", async () => {
      const { setMarkdownRenderingEnabled } = await import("../../src/persistence/preferences");
      await setMarkdownRenderingEnabled(false);

      const { preferencesRoutes } = await import("../../src/api/models");
      const handler = preferencesRoutes["/api/preferences/markdown-rendering"].PUT;
      
      const request = new Request("http://localhost/api/preferences/markdown-rendering", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: true }),
      });
      
      const response = await handler(request);
      expect(response.status).toBe(200);

      // Verify it was persisted
      const { getMarkdownRenderingEnabled } = await import("../../src/persistence/preferences");
      expect(await getMarkdownRenderingEnabled()).toBe(true);
    });

    test("returns error for invalid body - missing enabled", async () => {
      const { preferencesRoutes } = await import("../../src/api/models");
      const handler = preferencesRoutes["/api/preferences/markdown-rendering"].PUT;
      
      const request = new Request("http://localhost/api/preferences/markdown-rendering", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      
      const response = await handler(request);
      expect(response.status).toBe(400);
      
      const body = await response.json();
      expect(body.error).toBe("validation_error");
    });

    test("returns error for invalid body - non-boolean enabled", async () => {
      const { preferencesRoutes } = await import("../../src/api/models");
      const handler = preferencesRoutes["/api/preferences/markdown-rendering"].PUT;
      
      const request = new Request("http://localhost/api/preferences/markdown-rendering", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: "yes" }),
      });
      
      const response = await handler(request);
      expect(response.status).toBe(400);
      
      const body = await response.json();
      expect(body.error).toBe("validation_error");
    });
  });
});
