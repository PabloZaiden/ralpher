/**
 * Frontend logger using tslog for browser environment.
 * 
 * This module provides a unified logging interface for the frontend that mirrors
 * the backend logger API. It uses tslog which supports both Node.js and Browser.
 * 
 * Log levels (from most to least verbose):
 * - silly (0): Very verbose debugging
 * - trace (1): Detailed trace information
 * - debug (2): Debug messages
 * - info (3): Informational messages (DEFAULT)
 * - warn (4): Warning messages
 * - error (5): Error messages
 * - fatal (6): Fatal error messages
 * 
 * Usage:
 * ```typescript
 * import { log, createLogger } from "../lib/logger";
 * 
 * // Use the main logger
 * log.info("Application started");
 * log.debug("Debug info", { data: someData });
 * 
 * // Create a component-specific logger
 * const componentLog = createLogger("MyComponent");
 * componentLog.info("Component initialized");
 * ```
 */

import { Logger, type ILogObj } from "tslog";

/**
 * Valid log level name type.
 */
export type LogLevelName = "silly" | "trace" | "debug" | "info" | "warn" | "error" | "fatal";

/**
 * Map of log level names to their numeric values.
 */
export const LOG_LEVELS: Record<LogLevelName, number> = {
  silly: 0,
  trace: 1,
  debug: 2,
  info: 3,
  warn: 4,
  error: 5,
  fatal: 6,
};

/**
 * Map of numeric values to log level names.
 */
export const LOG_LEVEL_NAMES: Record<number, LogLevelName> = {
  0: "silly",
  1: "trace",
  2: "debug",
  3: "info",
  4: "warn",
  5: "error",
  6: "fatal",
};

/**
 * Default log level when no preference is set.
 */
export const DEFAULT_LOG_LEVEL: LogLevelName = "info";

/**
 * The frontend logger instance.
 * Configured for browser environment with pretty output.
 */
export const log: Logger<ILogObj> = new Logger({
  name: "ralpher-ui",
  minLevel: LOG_LEVELS[DEFAULT_LOG_LEVEL],
  type: "pretty",
  // Browser-specific settings
  prettyLogTemplate: "{{yyyy}}-{{mm}}-{{dd}} {{hh}}:{{MM}}:{{ss}}\t{{logLevelName}}\t{{name}}\t",
  prettyLogTimeZone: "local",
  stylePrettyLogs: true,
});

/**
 * Create a child logger with a specific name.
 * Useful for component-specific logging.
 * 
 * @param name - The name for the sub-logger (e.g., "Dashboard", "CreateLoopForm")
 * @returns A new Logger instance that inherits settings from the parent
 */
export function createLogger(name: string): Logger<ILogObj> {
  return log.getSubLogger({ name });
}

/**
 * Set the log level at runtime.
 * Updates the logger's minLevel setting dynamically.
 * 
 * @param level - The log level name (silly, trace, debug, info, warn, error, fatal)
 */
export function setLogLevel(level: LogLevelName): void {
  if (!(level in LOG_LEVELS)) {
    throw new Error(`Invalid log level: ${level}. Valid levels are: ${Object.keys(LOG_LEVELS).join(", ")}`);
  }
  log.settings.minLevel = LOG_LEVELS[level];
}

/**
 * Get the current log level name.
 * 
 * @returns The current log level name
 */
export function getLogLevel(): LogLevelName {
  const numericLevel = log.settings.minLevel;
  return LOG_LEVEL_NAMES[numericLevel] ?? DEFAULT_LOG_LEVEL;
}

/**
 * List of all available log levels with descriptions.
 * Useful for UI dropdowns.
 */
export const LOG_LEVEL_OPTIONS: Array<{ value: LogLevelName; label: string; description: string }> = [
  { value: "silly", label: "Silly", description: "Very verbose debugging" },
  { value: "trace", label: "Trace", description: "Detailed trace information" },
  { value: "debug", label: "Debug", description: "Debug messages" },
  { value: "info", label: "Info", description: "Informational messages" },
  { value: "warn", label: "Warn", description: "Warning messages" },
  { value: "error", label: "Error", description: "Error messages" },
  { value: "fatal", label: "Fatal", description: "Fatal error messages" },
];
