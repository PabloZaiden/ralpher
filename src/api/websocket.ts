/**
 * WebSocket handler for Ralph Loops Management System.
 * 
 * Provides real-time event streaming via WebSocket connection at WS /api/ws.
 * Clients can subscribe to all loop events or filter to a specific loop.
 * 
 * Features:
 * - Real-time loop event streaming
 * - Optional loop ID filtering via query parameter
 * - Ping/pong keep-alive support
 * - Automatic cleanup on disconnect
 * 
 * Event Types Streamed:
 * - loop.created, loop.started, loop.completed, loop.stopped, loop.error
 * - loop.iteration.start, loop.iteration.end
 * - loop.message, loop.tool_call, loop.progress, loop.log
 * - loop.git.commit, loop.deleted, loop.accepted, loop.pushed, loop.discarded
 * - loop.plan.ready, loop.plan.feedback, loop.plan.accepted, loop.plan.discarded
 * - loop.todo.updated
 * 
 * @module api/websocket
 */

import type { ServerWebSocket } from "bun";
import { loopEventEmitter, sshSessionEventEmitter } from "../core/event-emitter";
import { SshTerminalBridge } from "../core/ssh-terminal-bridge";
import { createLogger } from "../core/logger";
import type { LoopEvent, SshSessionEvent } from "../types";

const log = createLogger("api:websocket");

/** Maximum number of concurrent WebSocket connections allowed */
const MAX_CONNECTIONS = 100;

/** Set of active WebSocket connections for tracking and limit enforcement */
const activeConnections = new Set<ServerWebSocket<WebSocketData>>();

/**
 * WebSocket client data attached to each connection.
 * Stored in the WebSocket's data property for per-connection state.
 */
export interface WebSocketData {
  /** Optional loop ID to filter events - only events for this loop are sent */
  loopId?: string;
  /** Optional SSH session ID to filter session events or attach a terminal */
  sshSessionId?: string;
  /** Whether this socket is a terminal transport socket */
  terminalMode?: boolean;
  /** Active terminal bridge for terminal-mode sockets */
  terminalBridge?: SshTerminalBridge;
  /** Unsubscribe functions for event emitter cleanup */
  unsubscribers?: Array<() => void>;
}

/**
 * WebSocket message handlers for Bun.serve().
 * These handlers manage the WebSocket lifecycle and event streaming.
 */
export const websocketHandlers = {
  /**
   * Called when a WebSocket connection is opened.
   * 
   * Sets up event subscription and sends initial connection confirmation.
   * The confirmation message includes the loopId filter if one was specified.
   * 
   * @param ws - The WebSocket connection
   */
  open(ws: ServerWebSocket<WebSocketData>) {
    const { loopId, sshSessionId, terminalMode } = ws.data;

    // Enforce connection limit — close oldest connection if at capacity
    if (activeConnections.size >= MAX_CONNECTIONS) {
      const oldest = activeConnections.values().next().value;
      if (oldest) {
        log.warn("WebSocket connection limit reached, closing oldest connection", {
          maxConnections: MAX_CONNECTIONS,
          activeConnections: activeConnections.size,
        });
        oldest.close(1008, "Connection limit exceeded");
      }
    }

    // Track this connection
    activeConnections.add(ws);
    log.debug("WebSocket connection opened", {
      loopId: loopId ?? "all",
      activeConnections: activeConnections.size,
    });

    // Terminal sockets attach directly to SSH/tmux and do not subscribe to app events.
    if (terminalMode && sshSessionId) {
      const bridge = new SshTerminalBridge(sshSessionId, {
        onOutput: (chunk) => {
          try {
            ws.send(JSON.stringify({ type: "terminal.output", data: chunk }));
          } catch (sendError) {
            log.trace("Failed to send terminal output", { error: String(sendError), sshSessionId });
          }
        },
        onError: (error) => {
          try {
            ws.send(JSON.stringify({ type: "terminal.error", message: String(error) }));
          } catch (sendError) {
            log.trace("Failed to send terminal error", { error: String(sendError), sshSessionId });
          }
        },
        onExit: (code, signal) => {
          try {
            ws.send(JSON.stringify({
              type: "terminal.closed",
              code,
              signal,
            }));
          } catch (sendError) {
            log.trace("Failed to send terminal close event", { error: String(sendError), sshSessionId });
          }
        },
      });
      ws.data.terminalBridge = bridge;
      void bridge.connect().then(() => {
        try {
          ws.send(JSON.stringify({ type: "terminal.connected", sshSessionId }));
        } catch (sendError) {
          log.trace("Failed to send terminal ready event", { error: String(sendError), sshSessionId });
        }
      }).catch(async (error: Error) => {
        try {
          ws.send(JSON.stringify({ type: "terminal.error", message: String(error) }));
        } catch (sendError) {
          log.trace("Failed to send terminal startup error", { error: String(sendError), sshSessionId });
        }
        await bridge.dispose();
      });
      return;
    }

    // Send initial connection confirmation
    ws.send(JSON.stringify({ type: "connected", loopId: loopId ?? null, sshSessionId: sshSessionId ?? null }));

    const loopUnsubscribe = loopEventEmitter.subscribe((event: LoopEvent) => {
      // Filter by loopId if specified
      if (loopId && "loopId" in event && event.loopId !== loopId) {
        return;
      }

      try {
        ws.send(JSON.stringify(event));
      } catch (sendError) {
        log.trace("Failed to send event to WebSocket client", { error: String(sendError) });
      }
    });

    const sshSessionUnsubscribe = sshSessionEventEmitter.subscribe((event: SshSessionEvent) => {
      if (sshSessionId && event.sshSessionId !== sshSessionId) {
        return;
      }

      try {
        ws.send(JSON.stringify(event));
      } catch (sendError) {
        log.trace("Failed to send SSH session event to WebSocket client", { error: String(sendError) });
      }
    });

    ws.data.unsubscribers = [loopUnsubscribe, sshSessionUnsubscribe];
  },

  /**
   * Called when a message is received from the client.
   * 
   * Handles ping/pong for keep-alive. Clients should send {"type":"ping"}
   * periodically to keep the connection alive; server responds with {"type":"pong"}.
   * 
   * @param ws - The WebSocket connection
   * @param message - The message content (string or Buffer)
   */
  message(ws: ServerWebSocket<WebSocketData>, message: string | Buffer) {
    // Parse message if needed for future commands
    try {
      const data = JSON.parse(typeof message === "string" ? message : message.toString());

      if (ws.data.terminalMode && ws.data.terminalBridge) {
        if (data.type === "terminal.input" && typeof data.data === "string") {
          ws.data.terminalBridge.sendInput(data.data);
          return;
        }
        if (
          data.type === "terminal.resize" &&
          typeof data.cols === "number" &&
          typeof data.rows === "number"
        ) {
          void ws.data.terminalBridge.resize(data.cols, data.rows).catch((error: Error) => {
            log.debug("Ignoring SSH terminal resize error", {
              sshSessionId: ws.data.sshSessionId,
              error: String(error),
            });
          });
          return;
        }
      }

      // Handle ping/pong for keep-alive
      if (data.type === "ping") {
        ws.send(JSON.stringify({ type: "pong" }));
      }
    } catch (parseError) {
      log.trace("Received invalid JSON from WebSocket client", { error: String(parseError) });
    }
  },

  /**
   * Called when the WebSocket connection is closed.
   * 
   * Cleans up the event subscription to prevent memory leaks.
   * 
   * @param ws - The WebSocket connection
   */
  close(ws: ServerWebSocket<WebSocketData>) {
    // Remove from active connections
    activeConnections.delete(ws);
    log.debug("WebSocket connection closed", {
      activeConnections: activeConnections.size,
    });

    if (ws.data.terminalBridge) {
      void ws.data.terminalBridge.dispose();
      ws.data.terminalBridge = undefined;
    }

    if (ws.data.unsubscribers) {
      for (const unsubscribe of ws.data.unsubscribers) {
        unsubscribe();
      }
      ws.data.unsubscribers = undefined;
    }
  },

  /**
   * Called when an error occurs on the WebSocket connection.
   * 
   * Logs the error and cleans up the event subscription.
   * 
   * @param ws - The WebSocket connection
   * @param error - The error that occurred
   */
  error(ws: ServerWebSocket<WebSocketData>, error: Error) {
    log.error("WebSocket error:", error);
    // Remove from active connections
    activeConnections.delete(ws);
    if (ws.data.terminalBridge) {
      void ws.data.terminalBridge.dispose();
      ws.data.terminalBridge = undefined;
    }
    if (ws.data.unsubscribers) {
      for (const unsubscribe of ws.data.unsubscribers) {
        unsubscribe();
      }
      ws.data.unsubscribers = undefined;
    }
  },
};
