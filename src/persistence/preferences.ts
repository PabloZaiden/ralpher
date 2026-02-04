/**
 * User preferences persistence for Ralph Loops Management System.
 * Stores user preferences in SQLite database using a key-value pattern.
 * 
 * Note: Server settings are now stored per-workspace, not globally.
 * See src/persistence/workspaces.ts for workspace-specific server settings.
 */

import { getDatabase } from "./database";

/**
 * Valid log level names.
 */
export type LogLevelName = "silly" | "trace" | "debug" | "info" | "warn" | "error" | "fatal";

/**
 * Default log level when no preference is set.
 */
export const DEFAULT_LOG_LEVEL: LogLevelName = "info";

/**
 * User preferences structure.
 */
export interface UserPreferences {
  /** Last used model selection */
  lastModel?: {
    providerID: string;
    modelID: string;
  };
  /** Last used working directory for loop creation */
  lastDirectory?: string;
  /** Whether markdown rendering is enabled (defaults to true) */
  markdownRenderingEnabled?: boolean;
  /** Log level for both frontend and backend (defaults to "info") */
  logLevel?: LogLevelName;
}

/**
 * Get a preference value by key.
 */
function getPreference(key: string): string | null {
  const db = getDatabase();
  const stmt = db.prepare("SELECT value FROM preferences WHERE key = ?");
  const row = stmt.get(key) as { value: string } | null;
  return row?.value ?? null;
}

/**
 * Set a preference value by key.
 */
function setPreference(key: string, value: string): void {
  const db = getDatabase();
  const stmt = db.prepare("INSERT OR REPLACE INTO preferences (key, value) VALUES (?, ?)");
  stmt.run(key, value);
}

/**
 * Get the last used model.
 */
export async function getLastModel(): Promise<UserPreferences["lastModel"]> {
  const lastModelJson = getPreference("lastModel");
  if (!lastModelJson) {
    return undefined;
  }
  
  try {
    return JSON.parse(lastModelJson);
  } catch {
    return undefined;
  }
}

/**
 * Set the last used model.
 */
export async function setLastModel(model: {
  providerID: string;
  modelID: string;
}): Promise<void> {
  setPreference("lastModel", JSON.stringify(model));
}

/**
 * Get the last used working directory.
 */
export async function getLastDirectory(): Promise<string | undefined> {
  return getPreference("lastDirectory") ?? undefined;
}

/**
 * Set the last used working directory.
 */
export async function setLastDirectory(directory: string): Promise<void> {
  setPreference("lastDirectory", directory);
}

/**
 * Get whether markdown rendering is enabled.
 * Defaults to true if not set.
 */
export async function getMarkdownRenderingEnabled(): Promise<boolean> {
  const value = getPreference("markdownRenderingEnabled");
  if (value === null) {
    return true; // Default to enabled
  }
  return value === "true";
}

/**
 * Set whether markdown rendering is enabled.
 */
export async function setMarkdownRenderingEnabled(enabled: boolean): Promise<void> {
  setPreference("markdownRenderingEnabled", String(enabled));
}

/**
 * Valid log levels for validation.
 */
const VALID_LOG_LEVELS: LogLevelName[] = ["silly", "trace", "debug", "info", "warn", "error", "fatal"];

/**
 * Get the log level preference.
 * Defaults to "info" if not set.
 */
export async function getLogLevelPreference(): Promise<LogLevelName> {
  const value = getPreference("logLevel");
  if (value === null) {
    return DEFAULT_LOG_LEVEL;
  }
  // Validate the stored value is a valid log level
  if (VALID_LOG_LEVELS.includes(value as LogLevelName)) {
    return value as LogLevelName;
  }
  return DEFAULT_LOG_LEVEL;
}

/**
 * Set the log level preference.
 */
export async function setLogLevelPreference(level: LogLevelName): Promise<void> {
  // Validate the level before storing
  if (!VALID_LOG_LEVELS.includes(level)) {
    throw new Error(`Invalid log level: ${level}. Valid levels are: ${VALID_LOG_LEVELS.join(", ")}`);
  }
  setPreference("logLevel", level);
}
