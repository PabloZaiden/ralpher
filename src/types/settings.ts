/**
 * Server settings types for Ralph Loops Management System.
 * Defines global server configuration that applies to all loops.
 */

import { isRemoteOnlyMode } from "../core/config";

/**
 * Server connection mode.
 * - "spawn": Spawn a local opencode server on demand
 * - "connect": Connect to an existing remote opencode server
 */
export type ServerMode = "spawn" | "connect";

/**
 * Global server settings.
 * Persisted in preferences and used for all loop operations.
 */
export interface ServerSettings {
  /** Connection mode */
  mode: ServerMode;
  /** Hostname for connect mode */
  hostname?: string;
  /** Port for connect mode */
  port?: number;
  /** Password for connect mode (optional, stored in plain text) */
  password?: string;
  /** Whether to use HTTPS for connect mode (defaults to false if not set) */
  useHttps?: boolean;
  /** Whether to allow insecure connections (self-signed certificates) */
  allowInsecure?: boolean;
}

/**
 * Get default server settings.
 * Uses connect mode when RALPHER_REMOTE_ONLY is set, otherwise spawn mode.
 */
export function getDefaultServerSettings(): ServerSettings {
  return {
    mode: isRemoteOnlyMode() ? "connect" : "spawn",
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
