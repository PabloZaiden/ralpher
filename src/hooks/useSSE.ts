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
  const updateStatus = useCallback((newStatus: SSEStatus) => {
    setStatus(newStatus);
    onStatusChangeRef.current?.(newStatus);
  }, []);

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

    // Use withCredentials to ensure cookies are sent (needed for auth proxies)
    const eventSource = new EventSource(url, { withCredentials: true });
    eventSourceRef.current = eventSource;

    eventSource.onopen = () => {
      updateStatus("open");
    };

    eventSource.onmessage = (messageEvent) => {
      // Skip comment/heartbeat messages (they start with ":")
      // EventSource doesn't fire onmessage for comments, but just in case
      if (!messageEvent.data || messageEvent.data.trim() === "") {
        return;
      }

      try {
        const data = JSON.parse(messageEvent.data) as T;
        setEvents((prev) => {
          const newEvents = [...prev, data];
          // Trim to maxEvents
          if (newEvents.length > maxEventsRef.current) {
            return newEvents.slice(-maxEventsRef.current);
          }
          return newEvents;
        });
        onEventRef.current?.(data);
      } catch {
        // Ignore parse errors (could be comments or malformed data)
        console.warn("Failed to parse SSE event:", messageEvent.data);
      }
    };

    eventSource.onerror = () => {
      // EventSource goes to CONNECTING state automatically on error
      // Only set error if it's truly closed
      if (eventSource.readyState === EventSource.CLOSED) {
        updateStatus("error");
      } else if (eventSource.readyState === EventSource.CONNECTING) {
        updateStatus("connecting");
      }
    };
  }, [url, updateStatus]);

  // Clear events
  const clearEvents = useCallback(() => {
    setEvents([]);
  }, []);

  // Auto-connect on mount, reconnect only when URL changes
  useEffect(() => {
    if (autoConnect) {
      connect();
    }

    // Cleanup on unmount or URL change
    return () => {
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
        eventSourceRef.current = null;
      }
    };
  }, [url, autoConnect]); // Only depend on url and autoConnect, not connect/disconnect

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
