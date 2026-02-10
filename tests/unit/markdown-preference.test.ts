/**
 * Unit tests for markdown rendering preference.
 */

import { test, expect, describe, beforeEach, afterEach } from "bun:test";
import { mkdtemp, rm } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";

let testDataDir: string;

describe("Markdown Rendering Preference", () => {
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

  describe("getMarkdownRenderingEnabled", () => {
    test("returns true by default when not set", async () => {
      const { getMarkdownRenderingEnabled } = await import("../../src/persistence/preferences");
      const result = await getMarkdownRenderingEnabled();
      expect(result).toBe(true);
    });

    test("returns true when set to true", async () => {
      const { getMarkdownRenderingEnabled, setMarkdownRenderingEnabled } = await import("../../src/persistence/preferences");
      await setMarkdownRenderingEnabled(true);
      const result = await getMarkdownRenderingEnabled();
      expect(result).toBe(true);
    });

    test("returns false when set to false", async () => {
      const { getMarkdownRenderingEnabled, setMarkdownRenderingEnabled } = await import("../../src/persistence/preferences");
      await setMarkdownRenderingEnabled(false);
      const result = await getMarkdownRenderingEnabled();
      expect(result).toBe(false);
    });
  });

  describe("setMarkdownRenderingEnabled", () => {
    test("can toggle between true and false", async () => {
      const { getMarkdownRenderingEnabled, setMarkdownRenderingEnabled } = await import("../../src/persistence/preferences");
      
      // Set to false
      await setMarkdownRenderingEnabled(false);
      expect(await getMarkdownRenderingEnabled()).toBe(false);
      
      // Toggle to true
      await setMarkdownRenderingEnabled(true);
      expect(await getMarkdownRenderingEnabled()).toBe(true);
      
      // Toggle back to false
      await setMarkdownRenderingEnabled(false);
      expect(await getMarkdownRenderingEnabled()).toBe(false);
    });

    test("persists value across module reimports", async () => {
      const preferences1 = await import("../../src/persistence/preferences");
      await preferences1.setMarkdownRenderingEnabled(false);
      
      // Re-import the module (simulating a new request)
      const { getMarkdownRenderingEnabled } = await import("../../src/persistence/preferences");
      expect(await getMarkdownRenderingEnabled()).toBe(false);
    });
  });
});
