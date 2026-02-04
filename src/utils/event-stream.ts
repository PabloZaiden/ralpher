/**
 * EventStream<T> - A simple async stream for event consumption.
 *
 * This provides a clean alternative to AsyncIterable/AsyncIterator,
 * using standard Promise-based async/await patterns.
 *
 * Usage:
 * ```typescript
 * const stream = await backend.subscribeToEvents(sessionId);
 * let event = await stream.next();
 * while (event !== null) {
 *   // handle event
 *   event = await stream.next();
 * }
 * ```
 */

import { createLogger } from "../core/logger";

const log = createLogger("EventStream");

/**
 * A simple async stream interface.
 * - `next()` returns the next item, or null when stream ends
 * - `close()` closes the stream early
 */
export interface EventStream<T> {
  /**
   * Get the next item from the stream.
   * Returns null when the stream has ended.
   */
  next(): Promise<T | null>;

  /**
   * Close the stream early (e.g., when aborting).
   */
  close(): void;
}

/**
 * Create an EventStream from a source that pushes events.
 * The producer calls `push()` for each event and `end()` when done.
 */
export function createEventStream<T>(): {
  stream: EventStream<T>;
  push: (item: T) => void;
  end: () => void;
  fail: (error: Error) => void;
} {
  const items: T[] = [];
  const waiters: Array<{
    resolve: (value: T | null) => void;
    reject: (error: Error) => void;
  }> = [];
  let ended = false;
  let closed = false;
  let error: Error | null = null;
  
  // Generate a unique ID for this stream instance for tracing
  const streamId = Math.random().toString(36).substring(2, 8);
  log.trace("Creating new event stream", { streamId });

  function push(item: T): void {
    if (ended || closed) {
      log.trace("Push ignored (stream ended/closed)", { streamId, ended, closed });
      return;
    }

    const waiter = waiters.shift();
    if (waiter) {
      log.trace("Push: resolving waiting consumer", { streamId });
      waiter.resolve(item);
    } else {
      log.trace("Push: buffering item", { streamId, bufferSize: items.length + 1 });
      items.push(item);
    }
  }

  function end(): void {
    if (ended) {
      log.trace("End ignored (already ended)", { streamId });
      return;
    }
    log.trace("Stream ending", { streamId, pendingWaiters: waiters.length });
    ended = true;

    for (const waiter of waiters) {
      waiter.resolve(null);
    }
    waiters.length = 0;
  }

  function fail(err: Error): void {
    if (ended) {
      log.trace("Fail ignored (already ended)", { streamId });
      return;
    }
    log.debug("Stream failing", { streamId, error: err.message, pendingWaiters: waiters.length });
    error = err;
    ended = true;

    for (const waiter of waiters) {
      waiter.reject(err);
    }
    waiters.length = 0;
  }

  const stream: EventStream<T> = {
    async next(): Promise<T | null> {
      if (error) {
        log.trace("Next: throwing stored error", { streamId, error: error.message });
        throw error;
      }

      if (closed) {
        log.trace("Next: returning null (stream closed)", { streamId });
        return null;
      }

      const item = items.shift();
      if (item !== undefined) {
        log.trace("Next: returning buffered item", { streamId, remainingBuffer: items.length });
        return item;
      }

      if (ended) {
        log.trace("Next: returning null (stream ended)", { streamId });
        return null;
      }

      log.trace("Next: waiting for item", { streamId, queuePosition: waiters.length + 1 });
      return new Promise<T | null>((resolve, reject) => {
        waiters.push({ resolve, reject });
      });
    },

    close(): void {
      log.trace("Stream closing", { streamId, pendingWaiters: waiters.length });
      closed = true;
      for (const waiter of waiters) {
        waiter.resolve(null);
      }
      waiters.length = 0;
    },
  };

  return { stream, push, end, fail };
}
