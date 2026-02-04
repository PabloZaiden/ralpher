/**
 * Tests for the logger module.
 */

import { describe, test, expect, afterEach, beforeEach } from "bun:test";
import { LOG_LEVELS, setLogLevel, getLogLevel, isLogLevelFromEnv, DEFAULT_LOG_LEVEL } from "../../src/core/logger";

describe("Logger", () => {
  const originalLogLevel = process.env["RALPHER_LOG_LEVEL"];

  afterEach(() => {
    // Restore original log level
    if (originalLogLevel === undefined) {
      delete process.env["RALPHER_LOG_LEVEL"];
    } else {
      process.env["RALPHER_LOG_LEVEL"] = originalLogLevel;
    }
    // Reset logger to default level
    setLogLevel(DEFAULT_LOG_LEVEL);
  });

  test("log module exports log instance", async () => {
    // Need to dynamically import to test with clean state
    const { log } = await import("../../src/core/logger");
    expect(log).toBeDefined();
    expect(typeof log.silly).toBe("function");
    expect(typeof log.trace).toBe("function");
    expect(typeof log.debug).toBe("function");
    expect(typeof log.info).toBe("function");
    expect(typeof log.warn).toBe("function");
    expect(typeof log.error).toBe("function");
    expect(typeof log.fatal).toBe("function");
  });

  test("log module exports createLogger function", async () => {
    const { createLogger } = await import("../../src/core/logger");
    expect(typeof createLogger).toBe("function");
  });

  test("createLogger creates a named sub-logger", async () => {
    const { createLogger } = await import("../../src/core/logger");
    const subLogger = createLogger("test-module");
    expect(subLogger).toBeDefined();
    expect(typeof subLogger.info).toBe("function");
  });

  describe("RALPHER_LOG_LEVEL parsing", () => {
    // Note: We can't easily test the actual level filtering because
    // the logger is created at module load time. These tests verify
    // the module loads correctly with different env var settings.

    test("accepts lowercase level names", () => {
      // These are valid level names
      const validLevels = ["silly", "trace", "debug", "info", "warn", "error", "fatal"];
      const levelKeys = Object.keys(LOG_LEVELS);
      // instead of hardcoding, we can use the LOG_LEVELS keys
      for (const level of validLevels) {
        expect(levelKeys.includes(level)).toBe(true);
      }
    });

    test("level name mapping is correct", () => {
      
      expect(LOG_LEVELS["silly"]).toBe(0);
      expect(LOG_LEVELS["trace"]).toBe(1);
      expect(LOG_LEVELS["debug"]).toBe(2);
      expect(LOG_LEVELS["info"]).toBe(3);
      expect(LOG_LEVELS["warn"]).toBe(4);
      expect(LOG_LEVELS["error"]).toBe(5);
      expect(LOG_LEVELS["fatal"]).toBe(6);
    });
  });

  describe("setLogLevel", () => {
    test("changes the log level", () => {
      setLogLevel("debug");
      expect(getLogLevel()).toBe("debug");
      
      setLogLevel("error");
      expect(getLogLevel()).toBe("error");
      
      setLogLevel("silly");
      expect(getLogLevel()).toBe("silly");
    });

    test("throws error for invalid log level", () => {
      expect(() => setLogLevel("invalid" as never)).toThrow("Invalid log level");
    });

    test("accepts all valid log levels", () => {
      const validLevels = ["silly", "trace", "debug", "info", "warn", "error", "fatal"] as const;
      for (const level of validLevels) {
        expect(() => setLogLevel(level)).not.toThrow();
        expect(getLogLevel()).toBe(level);
      }
    });
  });

  describe("getLogLevel", () => {
    test("returns current log level name", () => {
      setLogLevel("info");
      expect(getLogLevel()).toBe("info");
    });

    test("returns default level initially", () => {
      // After resetting in afterEach, should be at default
      setLogLevel(DEFAULT_LOG_LEVEL);
      expect(getLogLevel()).toBe(DEFAULT_LOG_LEVEL);
    });
  });

  describe("isLogLevelFromEnv", () => {
    beforeEach(() => {
      // Clear the env var for clean tests
      delete process.env["RALPHER_LOG_LEVEL"];
    });

    test("returns false when env var is not set", () => {
      expect(isLogLevelFromEnv()).toBe(false);
    });

    test("returns true when env var is set to valid level", () => {
      process.env["RALPHER_LOG_LEVEL"] = "debug";
      expect(isLogLevelFromEnv()).toBe(true);
    });

    test("returns false when env var is set to invalid level", () => {
      process.env["RALPHER_LOG_LEVEL"] = "invalid";
      expect(isLogLevelFromEnv()).toBe(false);
    });

    test("handles case-insensitive env var", () => {
      process.env["RALPHER_LOG_LEVEL"] = "DEBUG";
      expect(isLogLevelFromEnv()).toBe(true);
    });
  });
});
