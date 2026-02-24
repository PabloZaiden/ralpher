/**
 * Server settings types for Ralph Loops Management System.
 * Defines workspace settings for agent and deterministic execution channels.
 */

// Import and re-export ServerSettings from schema (single source of truth)
import type {
  ServerSettings,
  AgentProvider,
  AgentTransport,
  ExecutionProvider,
} from "./schemas/workspace";
export type {
  ServerSettings,
  AgentProvider,
  AgentTransport,
  ExecutionProvider,
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
        transport: "tcp" as const,
        hostname: "127.0.0.1",
        port: 4096,
        useHttps: false,
        allowInsecure: false,
      }
    : {
        provider: "opencode" as const,
        transport: "stdio" as const,
        useHttps: false,
        allowInsecure: false,
      };

  const defaultExecution = remoteOnly
    ? {
        provider: "ssh" as const,
        host: "127.0.0.1",
        port: 22,
        user: "",
        workspaceRoot: "/workspaces",
      }
    : {
        provider: "local" as const,
        workspaceRoot: "",
      };

  return {
    agent: defaultAgent,
    execution: defaultExecution,
  };
}

/**
 * Agent channel status.
 */
export interface AgentConnectionStatus {
  /** Whether currently connected to the configured agent endpoint */
  connected: boolean;
  /** Selected agent provider */
  provider: AgentProvider;
  /** Selected agent transport */
  transport: AgentTransport;
  /** Provider capability list */
  capabilities: string[];
  /** Connected server URL, when applicable */
  serverUrl?: string;
  /** Error message if connection check failed */
  error?: string;
}

/**
 * Deterministic execution channel status.
 */
export interface ExecutionConnectionStatus {
  /** Whether execution provider is reachable */
  connected: boolean;
  /** Selected execution provider */
  provider: ExecutionProvider;
  /** Whether target workspace directory exists */
  directoryExists?: boolean;
  /** Whether target workspace is a git repository */
  isGitRepo?: boolean;
  /** Error message if execution check failed */
  error?: string;
}

/**
 * Combined status returned by workspace status endpoint.
 */
export interface ConnectionStatus {
  agent: AgentConnectionStatus;
  execution: ExecutionConnectionStatus;
  /** Top-level error for backward-compatible UI fallback */
  error?: string;
}
