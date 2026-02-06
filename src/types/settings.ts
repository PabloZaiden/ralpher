/**
 * Server settings types for Ralph Loops Management System.
 * Defines global server configuration that applies to all loops.
 */

// Import and re-export ServerSettings from schema (single source of truth)
import type { ServerSettings } from "./schemas/workspace";
export type { ServerSettings };

/**
 * Server connection mode.
 * - "spawn": Spawn a local opencode server on demand
 * - "connect": Connect to an existing remote opencode server
 */
export type ServerMode = "spawn" | "connect";

/**
 * Get default server settings.
 * @param remoteOnly - If true, defaults to "connect" mode instead of "spawn" mode.
 *                     This should be passed from the server config (RALPHER_REMOTE_ONLY env var).
 */
export function getDefaultServerSettings(remoteOnly: boolean = false): ServerSettings {
  return {
    mode: remoteOnly ? "connect" : "spawn",
    useHttps: false,
    allowInsecure: false,
  };
}

/**
 * Connection status information.
 * Returned by the status endpoint and used in the UI.
 */
export interface ConnectionStatus {
  /** Whether currently connected to a server */
  connected: boolean;
  /** Current mode (spawn or connect) */
  mode: ServerMode;
  /** Server URL when connected in connect mode */
  serverUrl?: string;
  /** Error message if connection failed */
  error?: string;
}
