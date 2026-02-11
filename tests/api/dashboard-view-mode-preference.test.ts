/**
 * API integration tests for dashboard view mode preference endpoints.
 */

import { test, expect, describe, beforeEach, afterEach } from "bun:test";
import { mkdtemp, rm } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";

let testDataDir: string;

describe("Dashboard View Mode Preference API", () => {
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

  describe("GET /api/preferences/dashboard-view-mode", () => {
    test("returns rows by default", async () => {
      const { preferencesRoutes } = await import("../../src/api/models");
      const handler = preferencesRoutes["/api/preferences/dashboard-view-mode"].GET;
      const response = await handler();

      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.mode).toBe("rows");
    });

    test("returns current preference value", async () => {
      const { setDashboardViewMode } = await import("../../src/persistence/preferences");
      await setDashboardViewMode("cards");

      const { preferencesRoutes } = await import("../../src/api/models");
      const handler = preferencesRoutes["/api/preferences/dashboard-view-mode"].GET;
      const response = await handler();

      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.mode).toBe("cards");
    });

    test("response has correct content-type", async () => {
      const { preferencesRoutes } = await import("../../src/api/models");
      const handler = preferencesRoutes["/api/preferences/dashboard-view-mode"].GET;
      const response = await handler();

      expect(response.headers.get("content-type")).toContain("application/json");
    });
  });

  describe("PUT /api/preferences/dashboard-view-mode", () => {
    test("sets preference to cards", async () => {
      const { preferencesRoutes } = await import("../../src/api/models");
      const handler = preferencesRoutes["/api/preferences/dashboard-view-mode"].PUT;

      const request = new Request("http://localhost/api/preferences/dashboard-view-mode", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: "cards" }),
      });

      const response = await handler(request);
      expect(response.status).toBe(200);

      const body = await response.json();
      expect(body.success).toBe(true);
      expect(body.mode).toBe("cards");

      // Verify it was persisted
      const { getDashboardViewMode } = await import("../../src/persistence/preferences");
      expect(await getDashboardViewMode()).toBe("cards");
    });

    test("sets preference to rows", async () => {
      const { preferencesRoutes } = await import("../../src/api/models");
      const handler = preferencesRoutes["/api/preferences/dashboard-view-mode"].PUT;

      const request = new Request("http://localhost/api/preferences/dashboard-view-mode", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: "rows" }),
      });

      const response = await handler(request);
      expect(response.status).toBe(200);

      // Verify it was persisted
      const { getDashboardViewMode } = await import("../../src/persistence/preferences");
      expect(await getDashboardViewMode()).toBe("rows");
    });

    test("accepts all valid view modes", async () => {
      const validModes = ["rows", "cards"];

      for (const mode of validModes) {
        const { preferencesRoutes } = await import("../../src/api/models");
        const handler = preferencesRoutes["/api/preferences/dashboard-view-mode"].PUT;

        const request = new Request("http://localhost/api/preferences/dashboard-view-mode", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ mode }),
        });

        const response = await handler(request);
        expect(response.status).toBe(200);
      }
    });

    test("returns error for invalid body - missing mode", async () => {
      const { preferencesRoutes } = await import("../../src/api/models");
      const handler = preferencesRoutes["/api/preferences/dashboard-view-mode"].PUT;

      const request = new Request("http://localhost/api/preferences/dashboard-view-mode", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });

      const response = await handler(request);
      expect(response.status).toBe(400);

      const body = await response.json();
      expect(body.error).toBe("validation_error");
    });

    test("returns error for invalid view mode value", async () => {
      const { preferencesRoutes } = await import("../../src/api/models");
      const handler = preferencesRoutes["/api/preferences/dashboard-view-mode"].PUT;

      const request = new Request("http://localhost/api/preferences/dashboard-view-mode", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: "invalid_mode" }),
      });

      const response = await handler(request);
      expect(response.status).toBe(400);

      const body = await response.json();
      expect(body.error).toBe("validation_error");
    });

    test("returns error for numeric mode (should be string)", async () => {
      const { preferencesRoutes } = await import("../../src/api/models");
      const handler = preferencesRoutes["/api/preferences/dashboard-view-mode"].PUT;

      const request = new Request("http://localhost/api/preferences/dashboard-view-mode", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: 3 }),
      });

      const response = await handler(request);
      expect(response.status).toBe(400);

      const body = await response.json();
      expect(body.error).toBe("validation_error");
    });
  });
});
