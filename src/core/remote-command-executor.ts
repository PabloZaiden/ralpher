/**
 * Command executor for deterministic local/SSH command and file operations.
 * Uses direct process execution and does not depend on any agent SDK transport.
 *
 * Re-exports from sub-modules in ./remote-executor/
 */

export type { CommandExecutorConfig, SshAuthMode } from "./remote-executor/types";
export { buildSshRemoteShellCommand, buildSshCommandArgs } from "./remote-executor/ssh-helpers";
export { CommandExecutorImpl } from "./remote-executor/executor";
