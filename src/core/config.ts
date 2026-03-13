/**
 * Application configuration helpers.
 * Reads configuration from environment variables.
 */

import type { AppConfig } from "../types/api";

/**
 * Check if the application is running in remote-only mode.
 * When enabled, spawning local servers is disabled and only
 * connecting to remote servers is allowed.
 * 
 * Set RALPHER_REMOTE_ONLY=true, 1, or yes to enable.
 */
export function isRemoteOnlyMode(): boolean {
  const value = process.env["RALPHER_REMOTE_ONLY"]?.toLowerCase();
  return value === "true" || value === "1" || value === "yes";
}

/**
 * Get the current application configuration.
 */
export function getAppConfig(): AppConfig {
  return {
    remoteOnly: isRemoteOnlyMode(),
  };
}
