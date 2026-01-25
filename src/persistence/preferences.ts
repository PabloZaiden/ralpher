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
 * Delete a preference by key.
 */
function deletePreference(key: string): void {
  const db = getDatabase();
  const stmt = db.prepare("DELETE FROM preferences WHERE key = ?");
  stmt.run(key);
}

/**
 * Load user preferences from database.
 * Returns default preferences if no preferences are stored.
 */
export async function loadPreferences(): Promise<UserPreferences> {
  const prefs: UserPreferences = {};
  
  const lastModelJson = getPreference("lastModel");
  if (lastModelJson) {
    try {
      prefs.lastModel = JSON.parse(lastModelJson);
    } catch {
      // Ignore invalid JSON
    }
  }
  
  const lastDirectory = getPreference("lastDirectory");
  if (lastDirectory) {
    prefs.lastDirectory = lastDirectory;
  }
  
  const serverSettingsJson = getPreference("serverSettings");
  if (serverSettingsJson) {
    try {
      prefs.serverSettings = JSON.parse(serverSettingsJson);
    } catch {
      // Ignore invalid JSON
    }
  }
  
  return prefs;
}

/**
 * Save user preferences to database.
 */
export async function savePreferences(prefs: UserPreferences): Promise<void> {
  if (prefs.lastModel) {
    setPreference("lastModel", JSON.stringify(prefs.lastModel));
  } else {
    deletePreference("lastModel");
  }
  
  if (prefs.lastDirectory) {
    setPreference("lastDirectory", prefs.lastDirectory);
  } else {
    deletePreference("lastDirectory");
  }
  
  if (prefs.serverSettings) {
    setPreference("serverSettings", JSON.stringify(prefs.serverSettings));
  } else {
    deletePreference("serverSettings");
  }
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
 */
export async function getServerSettings(): Promise<ServerSettings> {
  const serverSettingsJson = getPreference("serverSettings");
  if (!serverSettingsJson) {
    return getDefaultServerSettings();
  }
  
  try {
    return JSON.parse(serverSettingsJson);
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
