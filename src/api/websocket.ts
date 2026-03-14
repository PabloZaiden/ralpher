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
 * - loop.git.commit, loop.deleted, loop.accepted, loop.pushed, loop.discarded
 * - loop.plan.ready, loop.plan.feedback, loop.plan.accepted, loop.plan.discarded
 * - loop.todo.updated, loop.pending.updated
 * - ssh_session.created, ssh_session.updated, ssh_session.deleted, ssh_session.status
 * - ssh_session.port_forward.created, ssh_session.port_forward.updated,
 *   ssh_session.port_forward.deleted, ssh_session.port_forward.status
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
  /** Optional standalone SSH server session ID to filter session events or attach a terminal */
  sshServerSessionId?: string;
  /** Optional forwarded port ID for proxied websocket traffic */
  portForwardId?: string;
  /** Whether this socket is a terminal transport socket */
  terminalMode?: boolean;
  /** Whether this socket proxies a forwarded port websocket */
  portForwardMode?: boolean;
  /** Active terminal bridge for terminal-mode sockets */
  terminalBridge?: SshTerminalBridge;
  /** Outbound websocket for proxied forwarded-port traffic */
  proxySocket?: WebSocket;
  /** Target URL for proxied forwarded-port traffic */
  proxyTargetUrl?: string;
  /** Unsubscribe functions for event emitter cleanup */
  unsubscribers?: Array<() => void>;
}

/**
 * WebSocket message handlers for Bun.serve().
 * These handlers manage the WebSocket lifecycle and event streaming.
 */
export const websocketHandlers = {
  async startTerminalBridge(
    ws: ServerWebSocket<WebSocketData>,
    credentialToken?: string,
  ): Promise<void> {
    const { sshSessionId, sshServerSessionId } = ws.data;
    const terminalSessionId = sshSessionId ?? sshServerSessionId;
    if (!terminalSessionId || ws.data.terminalBridge) {
      return;
    }

    const bridge = new SshTerminalBridge(terminalSessionId, {
      onOutput: (chunk) => {
        try {
          ws.send(JSON.stringify({ type: "terminal.output", data: chunk }));
        } catch (sendError) {
          log.trace("Failed to send terminal output", { error: String(sendError), sshSessionId });
        }
      },
      onClipboardCopy: (text) => {
        try {
          ws.send(JSON.stringify({ type: "terminal.clipboard", text }));
        } catch (sendError) {
          log.trace("Failed to send terminal clipboard event", { error: String(sendError), sshSessionId });
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
    }, sshServerSessionId
      ? {
          sessionKind: "standalone",
          credentialToken,
        }
      : undefined);
    ws.data.terminalBridge = bridge;

    try {
      await bridge.connect();
      ws.send(JSON.stringify({
        type: "terminal.connected",
        sshSessionId: sshSessionId ?? null,
        sshServerSessionId: sshServerSessionId ?? null,
      }));
    } catch (error) {
      try {
        ws.send(JSON.stringify({ type: "terminal.error", message: String(error) }));
      } catch (sendError) {
        log.trace("Failed to send terminal startup error", {
          error: String(sendError),
          sshSessionId: terminalSessionId,
        });
      }
      await bridge.dispose();
      if (ws.data.terminalBridge === bridge) {
        ws.data.terminalBridge = undefined;
      }
    }
  },

  sendTerminalAuthError(
    ws: ServerWebSocket<WebSocketData>,
    message: string,
  ): void {
    try {
      ws.send(JSON.stringify({ type: "terminal.error", message }));
    } catch (sendError) {
      log.trace("Failed to send terminal auth error", { error: String(sendError) });
    }

    try {
      ws.close(1008, message);
    } catch (closeError) {
      log.trace("Failed to close terminal websocket after auth error", {
        error: String(closeError),
      });
    }
  },

  /**
   * Called when a WebSocket connection is opened.
   * 
   * Sets up event subscription and sends initial connection confirmation.
   * The confirmation message includes the loopId filter if one was specified.
   * 
   * @param ws - The WebSocket connection
   */
  open(ws: ServerWebSocket<WebSocketData>) {
    const {
      loopId,
      sshSessionId,
      sshServerSessionId,
      terminalMode,
      portForwardMode,
      proxyTargetUrl,
      portForwardId,
    } = ws.data;

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

    // Terminal sockets attach directly to SSH sessions and do not subscribe to app events.
    const terminalSessionId = sshSessionId ?? sshServerSessionId;
    if (terminalMode && terminalSessionId) {
      if (sshServerSessionId) {
        return;
      }

      void websocketHandlers.startTerminalBridge(ws);
      return;
    }

    if (portForwardMode && proxyTargetUrl) {
      const proxySocket = new WebSocket(proxyTargetUrl);
      proxySocket.binaryType = "arraybuffer";
      ws.data.proxySocket = proxySocket;

      proxySocket.addEventListener("message", (event) => {
        try {
          ws.send(event.data);
        } catch (sendError) {
          log.trace("Failed to send proxied websocket payload", {
            error: String(sendError),
            portForwardId,
          });
        }
      });

      proxySocket.addEventListener("close", (event) => {
        ws.close(event.code || 1000, event.reason || undefined);
      });

      proxySocket.addEventListener("error", () => {
        try {
          ws.close(1011, "Upstream websocket error");
        } catch {
          // Ignore close errors during websocket proxy cleanup.
        }
      });
      return;
    }

    // Send initial connection confirmation
    ws.send(JSON.stringify({
      type: "connected",
      loopId: loopId ?? null,
      sshSessionId: sshSessionId ?? null,
      sshServerSessionId: sshServerSessionId ?? null,
    }));

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
      const expectedSessionId = sshSessionId ?? sshServerSessionId;
      if (expectedSessionId && event.sshSessionId !== expectedSessionId) {
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
    if (ws.data.portForwardMode) {
      const proxySocket = ws.data.proxySocket;

      if (proxySocket?.readyState === WebSocket.OPEN) {
        proxySocket.send(message);
        return;
      }

      log.debug("Closing port-forward WebSocket because upstream proxy is not open", {
        portForwardId: ws.data.portForwardId,
        proxyReadyState: proxySocket ? proxySocket.readyState : "missing",
      });
      try {
        ws.close(1011, "Upstream proxy is not open");
      } catch (closeError) {
        log.debug("Error while closing WebSocket after upstream proxy failure", {
          error: String(closeError),
        });
      }
      return;
    }

    // Parse message if needed for future commands
    try {
      const data = JSON.parse(typeof message === "string" ? message : message.toString());

      if (ws.data.terminalMode && ws.data.sshServerSessionId && !ws.data.terminalBridge) {
        if (data.type === "terminal.auth") {
          const credentialToken = typeof data.credentialToken === "string"
            ? data.credentialToken.trim()
            : "";
          if (!credentialToken) {
            websocketHandlers.sendTerminalAuthError(
              ws,
              "credentialToken is required for standalone SSH terminals",
            );
            return;
          }
          void websocketHandlers.startTerminalBridge(ws, credentialToken);
          return;
        }
        if (data.type !== "ping") {
          websocketHandlers.sendTerminalAuthError(
            ws,
            "terminal.auth is required before using a standalone SSH terminal",
          );
          return;
        }
      }

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
              sshServerSessionId: ws.data.sshServerSessionId,
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

    if (ws.data.proxySocket) {
      ws.data.proxySocket.close();
      ws.data.proxySocket = undefined;
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
    if (ws.data.proxySocket) {
      ws.data.proxySocket.close();
      ws.data.proxySocket = undefined;
    }
    if (ws.data.unsubscribers) {
      for (const unsubscribe of ws.data.unsubscribers) {
        unsubscribe();
      }
      ws.data.unsubscribers = undefined;
    }
  },
};
