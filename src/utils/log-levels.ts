/**
 * Shared log level constants and types.
 *
 * This module is the single source of truth for log level definitions,
 * used by both the backend logger (src/core/logger.ts) and the
 * frontend logger (src/lib/logger.ts).
 */

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
 * Array of valid log level names.
 * Single source of truth for log level validation.
 */
export const VALID_LOG_LEVELS: LogLevelName[] = Object.keys(LOG_LEVELS) as LogLevelName[];

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
 * Default log level when no preference or environment variable is set.
 */
export const DEFAULT_LOG_LEVEL: LogLevelName = "info";
