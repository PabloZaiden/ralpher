/**
 * Unit tests for log level preference persistence.
 */

import { test, expect, describe, beforeEach, afterEach } from "bun:test";
import { mkdtemp, rm } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";

let testDataDir: string;

describe("Log Level Preference Persistence", () => {
  beforeEach(async () => {
    // Create a temp directory for each test
    testDataDir = await mkdtemp(join(tmpdir(), "ralpher-test-"));
    process.env["RALPHER_DATA_DIR"] = testDataDir;
    
    // Initialize the database
    const { ensureDataDirectories } = await import("../../src/persistence/paths");
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

  describe("getLogLevelPreference", () => {
    test("returns info by default when no preference is set", async () => {
      const { getLogLevelPreference, DEFAULT_LOG_LEVEL } = await import("../../src/persistence/preferences");
      const level = await getLogLevelPreference();
      expect(level).toBe(DEFAULT_LOG_LEVEL);
      expect(level).toBe("info");
    });

    test("returns stored preference value", async () => {
      const { getLogLevelPreference, setLogLevelPreference } = await import("../../src/persistence/preferences");
      
      await setLogLevelPreference("debug");
      expect(await getLogLevelPreference()).toBe("debug");
      
      await setLogLevelPreference("error");
      expect(await getLogLevelPreference()).toBe("error");
    });

    test("returns default if stored value is invalid", async () => {
      // Manually insert an invalid value to test validation
      const { getDatabase } = await import("../../src/persistence/database");
      const { getLogLevelPreference, DEFAULT_LOG_LEVEL } = await import("../../src/persistence/preferences");
      
      const db = getDatabase();
      db.run("INSERT OR REPLACE INTO preferences (key, value) VALUES (?, ?)", ["logLevel", "invalid_level"]);
      
      expect(await getLogLevelPreference()).toBe(DEFAULT_LOG_LEVEL);
    });
  });

  describe("setLogLevelPreference", () => {
    test("stores the log level preference", async () => {
      const { setLogLevelPreference, getLogLevelPreference } = await import("../../src/persistence/preferences");
      
      await setLogLevelPreference("trace");
      expect(await getLogLevelPreference()).toBe("trace");
    });

    test("overwrites existing preference", async () => {
      const { setLogLevelPreference, getLogLevelPreference } = await import("../../src/persistence/preferences");
      
      await setLogLevelPreference("debug");
      expect(await getLogLevelPreference()).toBe("debug");
      
      await setLogLevelPreference("warn");
      expect(await getLogLevelPreference()).toBe("warn");
    });

    test("accepts all valid log levels", async () => {
      const { setLogLevelPreference, getLogLevelPreference } = await import("../../src/persistence/preferences");
      
      const validLevels = ["silly", "trace", "debug", "info", "warn", "error", "fatal"] as const;
      
      for (const level of validLevels) {
        await setLogLevelPreference(level);
        expect(await getLogLevelPreference()).toBe(level);
      }
    });

    test("throws error for invalid log level", async () => {
      const { setLogLevelPreference } = await import("../../src/persistence/preferences");
      
      await expect(setLogLevelPreference("invalid" as never)).rejects.toThrow("Invalid log level");
    });
  });
});
