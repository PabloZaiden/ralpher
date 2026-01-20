/**
 * Unit tests for SimpleEventEmitter.
 */

import { test, expect, describe, beforeEach } from "bun:test";
import { SimpleEventEmitter } from "../../src/core/event-emitter";

describe("SimpleEventEmitter", () => {
  let emitter: SimpleEventEmitter<{ type: string; data: string }>;

  beforeEach(() => {
    emitter = new SimpleEventEmitter();
  });

  test("subscribes and receives events", () => {
    const received: Array<{ type: string; data: string }> = [];

    emitter.subscribe((event) => {
      received.push(event);
    });

    emitter.emit({ type: "test", data: "hello" });

    expect(received.length).toBe(1);
    expect(received[0]).toEqual({ type: "test", data: "hello" });
  });

  test("multiple subscribers receive events", () => {
    let count1 = 0;
    let count2 = 0;

    emitter.subscribe(() => count1++);
    emitter.subscribe(() => count2++);

    emitter.emit({ type: "test", data: "hello" });

    expect(count1).toBe(1);
    expect(count2).toBe(1);
  });

  test("unsubscribe stops receiving events", () => {
    let count = 0;

    const unsubscribe = emitter.subscribe(() => count++);

    emitter.emit({ type: "test", data: "1" });
    expect(count).toBe(1);

    unsubscribe();

    emitter.emit({ type: "test", data: "2" });
    expect(count).toBe(1); // Should still be 1
  });

  test("subscriberCount reflects active subscriptions", () => {
    expect(emitter.subscriberCount).toBe(0);

    const unsub1 = emitter.subscribe(() => {});
    expect(emitter.subscriberCount).toBe(1);

    const unsub2 = emitter.subscribe(() => {});
    expect(emitter.subscriberCount).toBe(2);

    unsub1();
    expect(emitter.subscriberCount).toBe(1);

    unsub2();
    expect(emitter.subscriberCount).toBe(0);
  });

  test("clear removes all subscribers", () => {
    emitter.subscribe(() => {});
    emitter.subscribe(() => {});
    expect(emitter.subscriberCount).toBe(2);

    emitter.clear();
    expect(emitter.subscriberCount).toBe(0);
  });

  test("handler errors don't break other handlers", () => {
    let receivedBySecond = false;

    emitter.subscribe(() => {
      throw new Error("First handler error");
    });

    emitter.subscribe(() => {
      receivedBySecond = true;
    });

    // Should not throw
    emitter.emit({ type: "test", data: "hello" });

    expect(receivedBySecond).toBe(true);
  });
});
