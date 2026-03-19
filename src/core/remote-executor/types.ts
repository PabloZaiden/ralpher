/**
 * Shared types for the remote command executor.
 */

/**
 * Configuration for the command executor.
 */
export interface CommandExecutorConfig {
  /** Execution provider */
  provider?: "local" | "ssh";
  /** Base working directory */
  directory: string;
  /** SSH host (required for provider=ssh) */
  host?: string;
  /** SSH port (default 22) */
  port?: number;
  /** SSH user (optional) */
  user?: string;
  /** SSH password (optional, uses sshpass) */
  password?: string;
  /** SSH identity file path (optional) */
  identityFile?: string;
  /** Default timeout in milliseconds */
  timeoutMs?: number;
}

export type SshAuthMode = "batch" | "password";
