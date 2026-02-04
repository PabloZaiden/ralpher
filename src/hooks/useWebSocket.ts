/**
 * WebSocket hook for real-time event streaming.
 * Provides connectivity to the Ralpher events API.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { log } from "../lib/logger";

export type ConnectionStatus = "connecting" | "open" | "closed" | "error";

export interface UseWebSocketOptions<T> {
  /** URL to connect to (WebSocket endpoint) */
  url: string;
  /** Whether to automatically connect on mount */
  autoConnect?: boolean;
  /** Callback when an event is received */
  onEvent?: (event: T) => void;
  /** Callback when connection status changes */
  onStatusChange?: (status: ConnectionStatus) => void;
  /** Maximum number of events to keep in history */
  maxEvents?: number;
}

export interface UseWebSocketResult<T> {
  /** Array of received events */
  events: T[];
  /** Current connection status */
  status: ConnectionStatus;
  /** Connect to the WebSocket endpoint */
  connect: () => void;
  /** Disconnect from the WebSocket endpoint */
  disconnect: () => void;
  /** Clear all stored events */
  clearEvents: () => void;
}

/**
 * Build WebSocket URL from current location.
 * Handles both HTTP->WS and HTTPS->WSS protocol conversion.
 */
function buildWebSocketUrl(path: string): string {
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${protocol}//${window.location.host}${path}`;
}

/**
 * Hook for connecting to WebSocket events endpoint.
 */
export function useWebSocket<T = unknown>(options: UseWebSocketOptions<T>): UseWebSocketResult<T> {
  const { url, autoConnect = true, onEvent, onStatusChange, maxEvents = 1000 } = options;

  const [events, setEvents] = useState<T[]>([]);
  const [status, setStatus] = useState<ConnectionStatus>("closed");
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reconnectAttemptRef = useRef(0);
  const isManualDisconnectRef = useRef(false);

  // Use refs for callbacks to avoid re-triggering effects
  const onEventRef = useRef(onEvent);
  const onStatusChangeRef = useRef(onStatusChange);
  const maxEventsRef = useRef(maxEvents);

  // Keep refs up to date
  useEffect(() => {
    onEventRef.current = onEvent;
  }, [onEvent]);

  useEffect(() => {
    onStatusChangeRef.current = onStatusChange;
  }, [onStatusChange]);

  useEffect(() => {
    maxEventsRef.current = maxEvents;
  }, [maxEvents]);

  // Update status and call callback
  const updateStatus = useCallback((newStatus: ConnectionStatus) => {
    setStatus(newStatus);
    onStatusChangeRef.current?.(newStatus);
  }, []);

  // Disconnect from WebSocket
  const disconnect = useCallback(() => {
    isManualDisconnectRef.current = true;

    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }

    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
      updateStatus("closed");
    }
  }, [updateStatus]);

  // Connect to WebSocket
  const connect = useCallback(() => {
    isManualDisconnectRef.current = false;

    // Clear any pending reconnect
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }

    // Close existing connection
    if (wsRef.current) {
      wsRef.current.close();
    }

    updateStatus("connecting");

    // Convert HTTP URL to WebSocket URL
    const wsUrl = buildWebSocketUrl(url);
    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.onopen = () => {
      reconnectAttemptRef.current = 0; // Reset reconnect attempts on successful connection
      updateStatus("open");
    };

    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data) as T & { type?: string };

        // Skip connection confirmation and pong messages
        if (data.type === "connected" || data.type === "pong") {
          return;
        }

        setEvents((prev) => {
          const newEvents = [...prev, data];
          if (newEvents.length > maxEventsRef.current) {
            return newEvents.slice(-maxEventsRef.current);
          }
          return newEvents;
        });
        onEventRef.current?.(data);
      } catch {
        log.warn("Failed to parse WebSocket message:", event.data);
      }
    };

    ws.onerror = () => {
      // Error will be followed by close, let close handler manage status
    };

    ws.onclose = () => {
      wsRef.current = null;

      // Don't reconnect if manually disconnected
      if (isManualDisconnectRef.current) {
        updateStatus("closed");
        return;
      }

      updateStatus("error");

      // Exponential backoff for reconnection (max 30 seconds)
      const backoffMs = Math.min(1000 * Math.pow(2, reconnectAttemptRef.current), 30000);
      reconnectAttemptRef.current++;

      reconnectTimeoutRef.current = setTimeout(() => {
        connect();
      }, backoffMs);
    };
  }, [url, updateStatus]);

  // Clear events
  const clearEvents = useCallback(() => {
    setEvents([]);
  }, []);

  // Auto-connect on mount, reconnect when URL changes
  useEffect(() => {
    if (autoConnect) {
      connect();
    }

    // Cleanup on unmount or URL change
    return () => {
      isManualDisconnectRef.current = true;
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
        reconnectTimeoutRef.current = null;
      }
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
    };
  }, [url, autoConnect]); // Only depend on url and autoConnect

  return {
    events,
    status,
    connect,
    disconnect,
    clearEvents,
  };
}

/**
 * Convenience hook for connecting to the global events endpoint.
 */
export function useGlobalEvents<T = unknown>(
  options?: Omit<UseWebSocketOptions<T>, "url">
): UseWebSocketResult<T> {
  return useWebSocket<T>({
    url: "/api/ws",
    ...options,
  });
}

/**
 * Convenience hook for connecting to a loop-specific events endpoint.
 */
export function useLoopEvents<T = unknown>(
  loopId: string,
  options?: Omit<UseWebSocketOptions<T>, "url">
): UseWebSocketResult<T> {
  return useWebSocket<T>({
    url: `/api/ws?loopId=${encodeURIComponent(loopId)}`,
    ...options,
  });
}
