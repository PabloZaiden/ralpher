/**
 * Application-wide logger using tslog.
 * 
 * Log levels (in order from most to least verbose):
 * - silly (0): Very verbose debugging
 * - trace (1): Detailed trace information
 * - debug (2): Debug messages
 * - info (3): Informational messages (DEFAULT)
 * - warn (4): Warning messages
 * - error (5): Error messages
 * - fatal (6): Fatal error messages
 * 
 * Priority order for log level:
 * 1. RALPHER_LOG_LEVEL environment variable (highest priority)
 * 2. Saved preference in database (applied on startup)
 * 3. Default: "info" (level 3)
 * 
 * Valid values: silly, trace, debug, info, warn, error, fatal
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
 * Default log level when no preference or environment variable is set.
 */
export const DEFAULT_LOG_LEVEL: LogLevelName = "info";

/**
 * Get the initial log level from environment variable.
 * Returns the numeric log level if valid, or the default (info = 3).
 */
function getInitialLogLevel(): number {
  const envLevel = process.env["RALPHER_LOG_LEVEL"]?.toLowerCase();
  
  if (envLevel && envLevel in LOG_LEVELS) {
    return LOG_LEVELS[envLevel as LogLevelName];
  }
  
  // Default to info
  return LOG_LEVELS[DEFAULT_LOG_LEVEL];
}

/**
 * The application-wide logger instance.
 * Use this for all logging throughout the application.
 */
export const log: Logger<ILogObj> = new Logger({
  name: "ralpher",
  minLevel: getInitialLogLevel(),
});

/**
 * Create a child logger with a specific name.
 * Useful for module-specific logging.
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
 * Check if the log level was set via environment variable.
 * Used to determine if the env var should take precedence over saved preferences.
 * 
 * @returns true if RALPHER_LOG_LEVEL environment variable is set
 */
export function isLogLevelFromEnv(): boolean {
  const envLevel = process.env["RALPHER_LOG_LEVEL"]?.toLowerCase();
  return envLevel !== undefined && envLevel in LOG_LEVELS;
}
