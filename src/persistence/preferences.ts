/**
 * User preferences persistence for Ralph Loops Management System.
 * Stores user preferences like last used model selection and server settings.
 */

import { join } from "path";
import { getDataDir } from "./paths";
import { DEFAULT_SERVER_SETTINGS, type ServerSettings } from "../types/settings";

/**
 * User preferences structure.
 */
export interface UserPreferences {
  /** Last used model selection */
  lastModel?: {
    providerID: string;
    modelID: string;
  };
  /** Global server settings */
  serverSettings?: ServerSettings;
}

/**
 * Get the path to the preferences file.
 */
export function getPreferencesFilePath(): string {
  return join(getDataDir(), "preferences.json");
}

/**
 * Load user preferences from disk.
 * Returns default preferences if file doesn't exist.
 */
export async function loadPreferences(): Promise<UserPreferences> {
  const filePath = getPreferencesFilePath();
  const file = Bun.file(filePath);

  if (!(await file.exists())) {
    return {};
  }

  try {
    const content = await file.text();
    return JSON.parse(content) as UserPreferences;
  } catch {
    // Return empty preferences if file is corrupted
    return {};
  }
}

/**
 * Save user preferences to disk.
 */
export async function savePreferences(prefs: UserPreferences): Promise<void> {
  const filePath = getPreferencesFilePath();
  await Bun.write(filePath, JSON.stringify(prefs, null, 2));
}

/**
 * Get the last used model.
 */
export async function getLastModel(): Promise<UserPreferences["lastModel"]> {
  const prefs = await loadPreferences();
  return prefs.lastModel;
}

/**
 * Set the last used model.
 */
export async function setLastModel(model: {
  providerID: string;
  modelID: string;
}): Promise<void> {
  const prefs = await loadPreferences();
  prefs.lastModel = model;
  await savePreferences(prefs);
}

/**
 * Get the server settings.
 * Returns default settings if not set.
 */
export async function getServerSettings(): Promise<ServerSettings> {
  const prefs = await loadPreferences();
  return prefs.serverSettings ?? DEFAULT_SERVER_SETTINGS;
}

/**
 * Set the server settings.
 */
export async function setServerSettings(settings: ServerSettings): Promise<void> {
  const prefs = await loadPreferences();
  prefs.serverSettings = settings;
  await savePreferences(prefs);
}
