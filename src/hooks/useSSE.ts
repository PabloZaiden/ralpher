/**
 * SSE (Server-Sent Events) hook using native EventSource API.
 * Provides real-time event streaming from the server.
 */

import { useCallback, useEffect, useRef, useState } from "react";

export type SSEStatus = "connecting" | "open" | "closed" | "error";

export interface UseSSEOptions<T> {
  /** URL to connect to */
  url: string;
  /** Whether to automatically connect on mount */
  autoConnect?: boolean;
  /** Callback when an event is received */
  onEvent?: (event: T) => void;
  /** Callback when connection status changes */
  onStatusChange?: (status: SSEStatus) => void;
  /** Maximum number of events to keep in history */
  maxEvents?: number;
}

export interface UseSSEResult<T> {
  /** Array of received events */
  events: T[];
  /** Current connection status */
  status: SSEStatus;
  /** Connect to the SSE endpoint */
  connect: () => void;
  /** Disconnect from the SSE endpoint */
  disconnect: () => void;
  /** Clear all stored events */
  clearEvents: () => void;
}

/**
 * Hook for connecting to Server-Sent Events endpoints.
 * Uses the native EventSource API.
 */
export function useSSE<T = unknown>(options: UseSSEOptions<T>): UseSSEResult<T> {
  const { url, autoConnect = true, onEvent, onStatusChange, maxEvents = 1000 } = options;

  const [events, setEvents] = useState<T[]>([]);
  const [status, setStatus] = useState<SSEStatus>("closed");
  const eventSourceRef = useRef<EventSource | null>(null);

  // Update status and call callback
  const updateStatus = useCallback(
    (newStatus: SSEStatus) => {
      setStatus(newStatus);
      onStatusChange?.(newStatus);
    },
    [onStatusChange]
  );

  // Disconnect from SSE
  const disconnect = useCallback(() => {
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
      eventSourceRef.current = null;
      updateStatus("closed");
    }
  }, [updateStatus]);

  // Connect to SSE
  const connect = useCallback(() => {
    // Close existing connection
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
    }

    updateStatus("connecting");

    const eventSource = new EventSource(url);
    eventSourceRef.current = eventSource;

    eventSource.onopen = () => {
      updateStatus("open");
    };

    eventSource.onmessage = (messageEvent) => {
      try {
        const data = JSON.parse(messageEvent.data) as T;
        setEvents((prev) => {
          const newEvents = [...prev, data];
          // Trim to maxEvents
          if (newEvents.length > maxEvents) {
            return newEvents.slice(-maxEvents);
          }
          return newEvents;
        });
        onEvent?.(data);
      } catch {
        // Ignore parse errors
        console.warn("Failed to parse SSE event:", messageEvent.data);
      }
    };

    eventSource.onerror = () => {
      updateStatus("error");
      // EventSource will automatically try to reconnect
    };
  }, [url, maxEvents, onEvent, updateStatus]);

  // Clear events
  const clearEvents = useCallback(() => {
    setEvents([]);
  }, []);

  // Auto-connect on mount
  useEffect(() => {
    if (autoConnect) {
      connect();
    }

    // Cleanup on unmount
    return () => {
      disconnect();
    };
  }, [autoConnect, connect, disconnect]);

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
export function useGlobalSSE<T = unknown>(
  options?: Omit<UseSSEOptions<T>, "url">
): UseSSEResult<T> {
  return useSSE<T>({
    url: "/api/events",
    ...options,
  });
}

/**
 * Convenience hook for connecting to a loop-specific events endpoint.
 */
export function useLoopSSE<T = unknown>(
  loopId: string,
  options?: Omit<UseSSEOptions<T>, "url">
): UseSSEResult<T> {
  return useSSE<T>({
    url: `/api/loops/${loopId}/events`,
    ...options,
  });
}
