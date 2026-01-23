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

  function push(item: T): void {
    if (ended || closed) return;

    const waiter = waiters.shift();
    if (waiter) {
      waiter.resolve(item);
    } else {
      items.push(item);
    }
  }

  function end(): void {
    if (ended) return;
    ended = true;

    for (const waiter of waiters) {
      waiter.resolve(null);
    }
    waiters.length = 0;
  }

  function fail(err: Error): void {
    if (ended) return;
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
        throw error;
      }

      if (closed) {
        return null;
      }

      const item = items.shift();
      if (item !== undefined) {
        return item;
      }

      if (ended) {
        return null;
      }

      return new Promise<T | null>((resolve, reject) => {
        waiters.push({ resolve, reject });
      });
    },

    close(): void {
      closed = true;
      for (const waiter of waiters) {
        waiter.resolve(null);
      }
      waiters.length = 0;
    },
  };

  return { stream, push, end, fail };
}
