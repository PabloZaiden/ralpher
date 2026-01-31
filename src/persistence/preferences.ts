/**
 * User preferences persistence for Ralph Loops Management System.
 * Stores user preferences in SQLite database using a key-value pattern.
 */

import { getDatabase } from "./database";
import { getDefaultServerSettings, type ServerSettings } from "../types/settings";

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
  /** Global server settings */
  serverSettings?: ServerSettings;
  /** Whether markdown rendering is enabled (defaults to true) */
  markdownRenderingEnabled?: boolean;
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
 * Get the server settings.
 * Returns default settings if not set.
 * Applies defaults for any missing fields to handle schema migrations.
 */
export async function getServerSettings(): Promise<ServerSettings> {
  const serverSettingsJson = getPreference("serverSettings");
  if (!serverSettingsJson) {
    return getDefaultServerSettings();
  }
  
  try {
    const parsed = JSON.parse(serverSettingsJson);
    const defaults = getDefaultServerSettings();
    // Merge parsed settings with defaults to ensure all required fields are present
    return {
      ...defaults,
      ...parsed,
      // Ensure boolean fields have explicit values (not undefined)
      useHttps: parsed.useHttps ?? defaults.useHttps,
      allowInsecure: parsed.allowInsecure ?? defaults.allowInsecure,
    };
  } catch {
    return getDefaultServerSettings();
  }
}

/**
 * Set the server settings.
 */
export async function setServerSettings(settings: ServerSettings): Promise<void> {
  setPreference("serverSettings", JSON.stringify(settings));
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
