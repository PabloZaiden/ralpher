/**
 * Simple event emitter for Ralph Loops Management System.
 * A minimal pub/sub implementation (~30 lines) for internal event handling.
 * No external dependencies - uses native patterns.
 */

import type { LoopEvent } from "../types";

type EventHandler<T> = (event: T) => void;
type Unsubscribe = () => void;

/**
 * Simple typed event emitter.
 * Provides basic pub/sub functionality for loop events.
 */
export class SimpleEventEmitter<T = LoopEvent> {
  private handlers = new Set<EventHandler<T>>();

  /**
   * Subscribe to all events.
   * Returns an unsubscribe function.
   */
  subscribe(handler: EventHandler<T>): Unsubscribe {
    this.handlers.add(handler);
    return () => {
      this.handlers.delete(handler);
    };
  }

  /**
   * Emit an event to all subscribers.
   */
  emit(event: T): void {
    console.log("[EventEmitter] Emitting event:", (event as LoopEvent).type, "to", this.handlers.size, "subscribers");
    for (const handler of this.handlers) {
      try {
        handler(event);
      } catch (error) {
        // Don't let one handler's error break others
        console.error("Event handler error:", String(error));
      }
    }
  }

  /**
   * Get the number of active subscribers.
   */
  get subscriberCount(): number {
    return this.handlers.size;
  }

  /**
   * Remove all subscribers.
   */
  clear(): void {
    this.handlers.clear();
  }
}

/**
 * Global event emitter instance for loop events.
 * Used by the API to broadcast events to SSE clients.
 */
export const loopEventEmitter = new SimpleEventEmitter<LoopEvent>();

/**
 * Filtered event emitter that only passes events for a specific loop.
 */
export class FilteredEventEmitter {
  private unsubscribe: Unsubscribe | null = null;
  private handlers = new Set<EventHandler<LoopEvent>>();

  constructor(
    private source: SimpleEventEmitter<LoopEvent>,
    private loopId: string
  ) {}

  /**
   * Start listening to filtered events.
   */
  start(): void {
    if (this.unsubscribe) return;

    this.unsubscribe = this.source.subscribe((event) => {
      if ("loopId" in event && event.loopId === this.loopId) {
        for (const handler of this.handlers) {
          try {
            handler(event);
          } catch (error) {
            console.error("Filtered event handler error:", String(error));
          }
        }
      }
    });
  }

  /**
   * Stop listening to events.
   */
  stop(): void {
    if (this.unsubscribe) {
      this.unsubscribe();
      this.unsubscribe = null;
    }
  }

  /**
   * Subscribe to filtered events.
   */
  subscribe(handler: EventHandler<LoopEvent>): Unsubscribe {
    this.handlers.add(handler);
    return () => {
      this.handlers.delete(handler);
    };
  }
}

/**
 * Create a ReadableStream from the event emitter for SSE.
 * Includes periodic heartbeat to keep connection alive.
 */
export function createSSEStream(
  emitter: SimpleEventEmitter<LoopEvent>,
  loopId?: string
): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  let unsubscribe: Unsubscribe | null = null;
  let heartbeatInterval: ReturnType<typeof setInterval> | null = null;

  return new ReadableStream({
    start(controller) {
      // Send initial connection event
      try {
        controller.enqueue(encoder.encode(": connected\n\n"));
      } catch {
        // Ignore if controller is closed
      }

      // Set up heartbeat every 5 seconds to keep connection alive
      // Reduced from 15s to prevent browser/proxy timeout issues
      heartbeatInterval = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(": heartbeat\n\n"));
        } catch {
          // Controller may be closed, clean up
          if (heartbeatInterval) {
            clearInterval(heartbeatInterval);
            heartbeatInterval = null;
          }
        }
      }, 5000);

      unsubscribe = emitter.subscribe((event) => {
        // If loopId is specified, only send events for that loop
        if (loopId && "loopId" in event && event.loopId !== loopId) {
          return;
        }

        try {
          const data = `data: ${JSON.stringify(event)}\n\n`;
          console.log("[SSE] Sending event to stream:", event.type, "loopId:", loopId || "global");
          controller.enqueue(encoder.encode(data));
        } catch {
          // Controller may be closed, ignore
        }
      });
    },
    cancel() {
      if (heartbeatInterval) {
        clearInterval(heartbeatInterval);
        heartbeatInterval = null;
      }
      if (unsubscribe) {
        unsubscribe();
        unsubscribe = null;
      }
    },
  });
}
