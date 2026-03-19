/**
 * WebSocket handlers for Ralph Loops Management System.
 *
 * Supports three websocket surfaces:
 * - WS /api/ws for loop events and SSH session lifecycle events
 * - WS /api/ssh-terminal for interactive SSH terminal streams
 * - forwarded-port proxy websocket upgrades under /loop/:loopId/port/:forwardId
 *
 * Features:
 * - Real-time loop and SSH session event streaming
 * - Optional loop or SSH session filtering via query parameters
 * - Ping/pong keep-alive support
 * - Automatic cleanup on disconnect
 *
 * Event Types Streamed:
 * - loop.created, loop.started, loop.completed, loop.ssh_handoff, loop.stopped, loop.error
 * - loop.iteration.start, loop.iteration.end
 * - loop.message, loop.tool_call, loop.progress, loop.log
 * - loop.git.commit, loop.deleted, loop.merged, loop.accepted, loop.pushed, loop.discarded
 * - loop.plan.ready, loop.plan.feedback, loop.plan.accepted, loop.plan.discarded
 * - loop.todo.updated, loop.pending.updated
 * - ssh_session.created, ssh_session.updated, ssh_session.deleted, ssh_session.status
 * - ssh_session.port_forward.created, ssh_session.port_forward.updated,
 *   ssh_session.port_forward.deleted, ssh_session.port_forward.status
 *
 * @module api/websocket
 */

export type { WebSocketData } from "./types";
export { startTerminalBridge, sendTerminalAuthError } from "./terminal";
export { open, close, error, activeConnections, MAX_CONNECTIONS } from "./connection";
export { message } from "./message-handler";

import { open, close, error } from "./connection";
import { message } from "./message-handler";
import { startTerminalBridge, sendTerminalAuthError } from "./terminal";

/**
 * WebSocket message handlers for Bun.serve().
 * These handlers manage the WebSocket lifecycle and event streaming.
 */
export const websocketHandlers = {
  startTerminalBridge,
  sendTerminalAuthError,
  open,
  message,
  close,
  error,
};
