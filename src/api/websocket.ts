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
import { loopEventEmitter } from "../core/event-emitter";
import { createLogger } from "../core/logger";
import type { LoopEvent } from "../types";

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
  /** Unsubscribe function for event emitter cleanup */
  unsubscribe?: () => void;
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
    const { loopId } = ws.data;

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

    // Send initial connection confirmation
    ws.send(JSON.stringify({ type: "connected", loopId: loopId ?? null }));

    // Subscribe to events
    const unsubscribe = loopEventEmitter.subscribe((event: LoopEvent) => {
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

    // Store unsubscribe function for cleanup
    ws.data.unsubscribe = unsubscribe;
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

    // Unsubscribe from events
    if (ws.data.unsubscribe) {
      ws.data.unsubscribe();
      ws.data.unsubscribe = undefined;
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
    // Cleanup subscription
    if (ws.data.unsubscribe) {
      ws.data.unsubscribe();
      ws.data.unsubscribe = undefined;
    }
  },
};
