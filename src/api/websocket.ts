/**
 * WebSocket handler for Ralph Loops Management System.
 * Provides real-time event streaming via WebSocket connection.
 */

import type { ServerWebSocket } from "bun";
import { loopEventEmitter } from "../core/event-emitter";
import { log } from "../core/logger";
import type { LoopEvent } from "../types";

/**
 * WebSocket client data attached to each connection.
 */
export interface WebSocketData {
  /** Optional loop ID to filter events */
  loopId?: string;
  /** Unsubscribe function for event emitter */
  unsubscribe?: () => void;
}

/**
 * Handle WebSocket upgrade requests.
 * Extracts optional loopId query parameter for filtering.
 */
export function handleWebSocketUpgrade(req: Request, server: { upgrade: (req: Request, options?: { data?: WebSocketData }) => boolean }): Response | undefined {
  const url = new URL(req.url);
  const loopId = url.searchParams.get("loopId") ?? undefined;

  const upgraded = server.upgrade(req, {
    data: { loopId } as WebSocketData,
  });

  if (upgraded) {
    // Return undefined to indicate successful upgrade
    return undefined;
  }

  // Upgrade failed
  return new Response("WebSocket upgrade failed", { status: 400 });
}

/**
 * WebSocket message handlers for Bun.serve().
 */
export const websocketHandlers = {
  /**
   * Called when a WebSocket connection is opened.
   */
  open(ws: ServerWebSocket<WebSocketData>) {
    const { loopId } = ws.data;

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
      } catch {
        // Connection may be closed, ignore
      }
    });

    // Store unsubscribe function for cleanup
    ws.data.unsubscribe = unsubscribe;

    // Start heartbeat to keep connection alive
    // Note: Bun handles ping/pong automatically, but we send app-level heartbeats too
  },

  /**
   * Called when a message is received from the client.
   * Currently we don't expect client messages, but this enables future bidirectional communication.
   */
  message(ws: ServerWebSocket<WebSocketData>, message: string | Buffer) {
    // Parse message if needed for future commands
    try {
      const data = JSON.parse(typeof message === "string" ? message : message.toString());
      
      // Handle ping/pong for keep-alive
      if (data.type === "ping") {
        ws.send(JSON.stringify({ type: "pong" }));
      }
    } catch {
      // Ignore invalid JSON
    }
  },

  /**
   * Called when the WebSocket connection is closed.
   */
  close(ws: ServerWebSocket<WebSocketData>) {
    // Unsubscribe from events
    if (ws.data.unsubscribe) {
      ws.data.unsubscribe();
      ws.data.unsubscribe = undefined;
    }
  },

  /**
   * Called when an error occurs.
   */
  error(ws: ServerWebSocket<WebSocketData>, error: Error) {
    log.error("WebSocket error:", error);
    // Cleanup
    if (ws.data.unsubscribe) {
      ws.data.unsubscribe();
      ws.data.unsubscribe = undefined;
    }
  },
};
