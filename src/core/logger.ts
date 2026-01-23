/**
 * Application-wide logger using tslog.
 * 
 * Log levels (in order from lowest to highest):
 * - silly (0): Very verbose debugging
 * - trace (1): Detailed trace information
 * - debug (2): Debug messages
 * - info (3): Informational messages
 * - warn (4): Warning messages
 * - error (5): Error messages
 * - fatal (6): Fatal error messages
 * 
 * Set RALPHER_LOG_LEVEL environment variable to override the default level.
 * Valid values: silly, trace, debug, info, warn, error, fatal
 */

import { Logger, type ILogObj } from "tslog";

/**
 * Map of log level names to their numeric values.
 */
export const LOG_LEVELS: Record<string, number> = {
  silly: 0,
  trace: 1,
  debug: 2,
  info: 3,
  warn: 4,
  error: 5,
  fatal: 6,
};

/**
 * Parse the RALPHER_LOG_LEVEL environment variable.
 * Returns the numeric log level if valid, or the default (silly = 0).
 */
function getLogLevel(): number {
  const envLevel = process.env["RALPHER_LOG_LEVEL"]?.toLowerCase();
  
  if (envLevel && envLevel in LOG_LEVELS) {
    return LOG_LEVELS[envLevel]!;
  }
  
  // Default to silly (most verbose) as requested
  return LOG_LEVELS["silly"]!;
}

/**
 * The application-wide logger instance.
 * Use this for all logging throughout the application.
 */
export const log: Logger<ILogObj> = new Logger({
  name: "ralpher",
  minLevel: getLogLevel(),
});

/**
 * Create a child logger with a specific name.
 * Useful for module-specific logging.
 */
export function createLogger(name: string): Logger<ILogObj> {
  return log.getSubLogger({ name });
}
