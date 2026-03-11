/**
 * SSH session domain types.
 *
 * SSH sessions represent persistent remote terminal sessions backed by `tmux`
 * on an SSH-configured workspace host.
 */

/**
 * Runtime status for an SSH session.
 */
export type SshSessionStatus =
  | "ready"
  | "connecting"
  | "connected"
  | "disconnected"
  | "failed";

/**
 * Persistent SSH session configuration.
 */
export interface SshSessionConfig {
  /** Unique identifier (UUID v4) */
  id: string;
  /** Human-readable display name */
  name: string;
  /** Workspace that owns this session */
  workspaceId: string;
  /** Working directory used when creating the tmux session */
  directory: string;
  /** Remote tmux session name */
  remoteSessionName: string;
  /** ISO 8601 timestamp of when the session was created */
  createdAt: string;
  /** ISO 8601 timestamp of the last configuration update */
  updatedAt: string;
}

/**
 * Persistent SSH session runtime state.
 */
export interface SshSessionState {
  /** Current session status */
  status: SshSessionStatus;
  /** Last time a client successfully connected */
  lastConnectedAt?: string;
  /** Last recorded error message */
  error?: string;
}

/**
 * Combined SSH session object returned by the API.
 */
export interface SshSession {
  config: SshSessionConfig;
  state: SshSessionState;
}
