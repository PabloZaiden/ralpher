/**
 * Server settings types for Ralph Loops Management System.
 * Defines workspace settings for agent and deterministic execution channels.
 */

// Import and re-export ServerSettings from schema (single source of truth)
import type {
  ServerSettings,
  AgentProvider,
  AgentTransport,
} from "./schemas/workspace";
export type {
  ServerSettings,
  AgentProvider,
  AgentTransport,
};

/**
 * Get default server settings.
 * @param remoteOnly - If true, defaults to "connect" mode instead of "spawn" mode.
 *                     This should be passed from the server config (RALPHER_REMOTE_ONLY env var).
 */
export function getDefaultServerSettings(remoteOnly: boolean = false): ServerSettings {
  const defaultAgent = remoteOnly
    ? {
        provider: "opencode" as const,
        transport: "ssh" as const,
        hostname: "127.0.0.1",
        port: 22,
        username: "",
        password: "",
      }
    : {
        provider: "opencode" as const,
        transport: "stdio" as const,
      };

  return {
    agent: defaultAgent,
  };
}

/**
 * Unified workspace connection status.
 * Deterministic execution checks are derived from the selected transport.
 */
export interface ConnectionStatus {
  /** Whether workspace connection is healthy */
  connected: boolean;
  /** Selected agent provider */
  provider: AgentProvider;
  /** Selected transport */
  transport: AgentTransport;
  /** Provider capability list */
  capabilities: string[];
  /** Connected server URL, when applicable */
  serverUrl?: string;
  /** Whether target workspace directory exists */
  directoryExists?: boolean;
  /** Whether target workspace is a git repository */
  isGitRepo?: boolean;
  /** Error message if connection check failed */
  error?: string;
}
