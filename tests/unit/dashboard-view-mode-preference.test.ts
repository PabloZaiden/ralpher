/**
 * Unit tests for dashboard view mode preference persistence.
 */

import { test, expect, describe, beforeEach, afterEach } from "bun:test";
import { mkdtemp, rm } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";

let testDataDir: string;

describe("Dashboard View Mode Preference Persistence", () => {
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

  describe("getDashboardViewMode", () => {
    test("returns rows by default when no preference is set", async () => {
      const { getDashboardViewMode, DEFAULT_VIEW_MODE } = await import("../../src/persistence/preferences");
      const mode = await getDashboardViewMode();
      expect(mode).toBe(DEFAULT_VIEW_MODE);
      expect(mode).toBe("rows");
    });

    test("returns stored preference value", async () => {
      const { getDashboardViewMode, setDashboardViewMode } = await import("../../src/persistence/preferences");

      await setDashboardViewMode("cards");
      expect(await getDashboardViewMode()).toBe("cards");

      await setDashboardViewMode("rows");
      expect(await getDashboardViewMode()).toBe("rows");
    });

    test("returns default if stored value is invalid", async () => {
      // Manually insert an invalid value to test validation
      const { getDatabase } = await import("../../src/persistence/database");
      const { getDashboardViewMode, DEFAULT_VIEW_MODE } = await import("../../src/persistence/preferences");

      const db = getDatabase();
      db.run("INSERT OR REPLACE INTO preferences (key, value) VALUES (?, ?)", ["dashboardViewMode", "invalid_mode"]);

      expect(await getDashboardViewMode()).toBe(DEFAULT_VIEW_MODE);
    });
  });

  describe("setDashboardViewMode", () => {
    test("stores the view mode preference", async () => {
      const { setDashboardViewMode, getDashboardViewMode } = await import("../../src/persistence/preferences");

      await setDashboardViewMode("cards");
      expect(await getDashboardViewMode()).toBe("cards");
    });

    test("overwrites existing preference", async () => {
      const { setDashboardViewMode, getDashboardViewMode } = await import("../../src/persistence/preferences");

      await setDashboardViewMode("cards");
      expect(await getDashboardViewMode()).toBe("cards");

      await setDashboardViewMode("rows");
      expect(await getDashboardViewMode()).toBe("rows");
    });

    test("accepts all valid view modes", async () => {
      const { setDashboardViewMode, getDashboardViewMode } = await import("../../src/persistence/preferences");

      const validModes = ["rows", "cards"] as const;

      for (const mode of validModes) {
        await setDashboardViewMode(mode);
        expect(await getDashboardViewMode()).toBe(mode);
      }
    });

    test("throws error for invalid view mode", async () => {
      const { setDashboardViewMode } = await import("../../src/persistence/preferences");

      await expect(setDashboardViewMode("invalid" as never)).rejects.toThrow("Invalid dashboard view mode");
    });
  });
});
