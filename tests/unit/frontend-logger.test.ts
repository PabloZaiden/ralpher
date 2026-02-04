/**
 * Tests for the frontend logger module.
 */

import { describe, test, expect, afterEach } from "bun:test";
import { 
  log, 
  createLogger, 
  setLogLevel, 
  getLogLevel, 
  LOG_LEVELS, 
  LOG_LEVEL_OPTIONS,
  DEFAULT_LOG_LEVEL 
} from "../../src/lib/logger";

describe("Frontend Logger", () => {
  afterEach(() => {
    // Reset logger to default level after each test
    setLogLevel(DEFAULT_LOG_LEVEL);
  });

  test("log instance is defined and has all log methods", () => {
    expect(log).toBeDefined();
    expect(typeof log.silly).toBe("function");
    expect(typeof log.trace).toBe("function");
    expect(typeof log.debug).toBe("function");
    expect(typeof log.info).toBe("function");
    expect(typeof log.warn).toBe("function");
    expect(typeof log.error).toBe("function");
    expect(typeof log.fatal).toBe("function");
  });

  test("createLogger creates a named sub-logger", () => {
    const componentLog = createLogger("TestComponent");
    expect(componentLog).toBeDefined();
    expect(typeof componentLog.info).toBe("function");
    expect(typeof componentLog.debug).toBe("function");
  });

  describe("LOG_LEVELS", () => {
    test("contains all valid level mappings", () => {
      expect(LOG_LEVELS["silly"]).toBe(0);
      expect(LOG_LEVELS["trace"]).toBe(1);
      expect(LOG_LEVELS["debug"]).toBe(2);
      expect(LOG_LEVELS["info"]).toBe(3);
      expect(LOG_LEVELS["warn"]).toBe(4);
      expect(LOG_LEVELS["error"]).toBe(5);
      expect(LOG_LEVELS["fatal"]).toBe(6);
    });
  });

  describe("LOG_LEVEL_OPTIONS", () => {
    test("contains all log levels with labels and descriptions", () => {
      expect(LOG_LEVEL_OPTIONS).toHaveLength(7);
      
      const levels = LOG_LEVEL_OPTIONS.map(opt => opt.value);
      expect(levels).toContain("silly");
      expect(levels).toContain("trace");
      expect(levels).toContain("debug");
      expect(levels).toContain("info");
      expect(levels).toContain("warn");
      expect(levels).toContain("error");
      expect(levels).toContain("fatal");
      
      // Each option should have label and description
      for (const option of LOG_LEVEL_OPTIONS) {
        expect(option.label).toBeDefined();
        expect(option.description).toBeDefined();
        expect(typeof option.label).toBe("string");
        expect(typeof option.description).toBe("string");
      }
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
      setLogLevel("warn");
      expect(getLogLevel()).toBe("warn");
    });

    test("returns default level after reset", () => {
      setLogLevel(DEFAULT_LOG_LEVEL);
      expect(getLogLevel()).toBe(DEFAULT_LOG_LEVEL);
    });
  });

  describe("DEFAULT_LOG_LEVEL", () => {
    test("is set to info", () => {
      expect(DEFAULT_LOG_LEVEL).toBe("info");
    });
  });
});
