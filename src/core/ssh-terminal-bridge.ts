/**
 * Interactive SSH terminal bridge used by terminal websocket connections.
 * @see ./ssh-bridge/ for the implementation sub-modules.
 */

export type { SshTerminalBridgeOptions, SshTerminalBridgeConnectOptions } from "./ssh-bridge";
export { buildAttachCommand, SshTerminalBridge } from "./ssh-bridge";
