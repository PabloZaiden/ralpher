/**
 * Tests for the useCountdownReload hook and computeProgressPercent utility.
 *
 * Uses @testing-library/react's renderHook with manual setInterval/clearInterval
 * mocking to exercise the actual production hook code deterministically.
 */

import { describe, test, expect, beforeEach, afterEach, mock } from "bun:test";
import { renderHook, act } from "@testing-library/react";
import {
  useCountdownReload,
  computeProgressPercent,
  KILL_SERVER_COUNTDOWN_SECONDS,
} from "@/hooks/useCountdownReload";

// ─── computeProgressPercent (pure function) ──────────────────────────────────

describe("computeProgressPercent", () => {
  test("returns 100 when countdown equals total", () => {
    expect(computeProgressPercent(15, 15)).toBe(100);
  });

  test("returns 0 when countdown is 0", () => {
    expect(computeProgressPercent(0, 15)).toBe(0);
  });

  test("returns 50 at the midpoint", () => {
    expect(computeProgressPercent(7.5, 15)).toBeCloseTo(50, 2);
  });

  test("returns correct intermediate values", () => {
    // 10 out of 15 = 66.67%
    expect(computeProgressPercent(10, 15)).toBeCloseTo(66.67, 1);
    // 5 out of 15 = 33.33%
    expect(computeProgressPercent(5, 15)).toBeCloseTo(33.33, 1);
    // 1 out of 15 = 6.67%
    expect(computeProgressPercent(1, 15)).toBeCloseTo(6.67, 1);
    // 14 out of 15 = 93.33%
    expect(computeProgressPercent(14, 15)).toBeCloseTo(93.33, 1);
  });

  test("returns 0 when total is 0 (edge case)", () => {
    expect(computeProgressPercent(5, 0)).toBe(0);
  });

  test("returns 0 when total is negative (edge case)", () => {
    expect(computeProgressPercent(5, -1)).toBe(0);
  });
});

// ─── KILL_SERVER_COUNTDOWN_SECONDS constant ──────────────────────────────────

describe("KILL_SERVER_COUNTDOWN_SECONDS", () => {
  test("equals 15", () => {
    expect(KILL_SERVER_COUNTDOWN_SECONDS).toBe(15);
  });

  test("is a positive integer", () => {
    expect(Number.isInteger(KILL_SERVER_COUNTDOWN_SECONDS)).toBe(true);
    expect(KILL_SERVER_COUNTDOWN_SECONDS).toBeGreaterThan(0);
  });
});

// ─── useCountdownReload hook ─────────────────────────────────────────────────

describe("useCountdownReload", () => {
  // Store interval callbacks so we can manually trigger ticks
  let intervalCallbacks: Map<number, () => void>;
  let nextIntervalId: number;
  let originalSetInterval: typeof globalThis.setInterval;
  let originalClearInterval: typeof globalThis.clearInterval;
  let clearedIntervals: Set<number>;

  beforeEach(() => {
    intervalCallbacks = new Map();
    clearedIntervals = new Set();
    nextIntervalId = 1;

    originalSetInterval = globalThis.setInterval;
    originalClearInterval = globalThis.clearInterval;

    // Replace setInterval with a controllable version
    globalThis.setInterval = ((callback: () => void, _ms?: number) => {
      const id = nextIntervalId++;
      intervalCallbacks.set(id, callback);
      return id as unknown as ReturnType<typeof setInterval>;
    }) as typeof globalThis.setInterval;

    // Replace clearInterval to track cleared intervals
    globalThis.clearInterval = ((id: number) => {
      clearedIntervals.add(id);
      intervalCallbacks.delete(id);
    }) as typeof globalThis.clearInterval;
  });

  afterEach(() => {
    globalThis.setInterval = originalSetInterval;
    globalThis.clearInterval = originalClearInterval;
  });

  /** Simulate one tick of all active intervals */
  function tick(times = 1) {
    for (let i = 0; i < times; i++) {
      // Copy the callbacks since the map may be mutated during iteration
      const callbacks = [...intervalCallbacks.values()];
      act(() => {
        for (const cb of callbacks) {
          cb();
        }
      });
    }
  }

  test("returns initial countdown equal to duration when inactive", () => {
    const onComplete = mock(() => {});
    const { result } = renderHook(() => useCountdownReload(false, onComplete, 10));

    expect(result.current.countdown).toBe(10);
    expect(result.current.progressPercent).toBe(100);
    expect(onComplete).not.toHaveBeenCalled();
  });

  test("defaults to KILL_SERVER_COUNTDOWN_SECONDS when no duration provided", () => {
    const onComplete = mock(() => {});
    const { result } = renderHook(() => useCountdownReload(false, onComplete));

    expect(result.current.countdown).toBe(KILL_SERVER_COUNTDOWN_SECONDS);
  });

  test("does not create interval when active is false", () => {
    const onComplete = mock(() => {});
    renderHook(() => useCountdownReload(false, onComplete, 5));

    expect(intervalCallbacks.size).toBe(0);
  });

  test("creates interval when active is true", () => {
    const onComplete = mock(() => {});
    renderHook(() => useCountdownReload(true, onComplete, 5));

    expect(intervalCallbacks.size).toBe(1);
  });

  test("starts countdown when active becomes true", () => {
    const onComplete = mock(() => {});
    const { result } = renderHook(() => useCountdownReload(true, onComplete, 5));

    // Initially at 5
    expect(result.current.countdown).toBe(5);
    expect(result.current.progressPercent).toBe(100);

    // Tick once
    tick();
    expect(result.current.countdown).toBe(4);
    expect(result.current.progressPercent).toBe(80);

    // Tick again
    tick();
    expect(result.current.countdown).toBe(3);
    expect(result.current.progressPercent).toBe(60);
  });

  test("calls onComplete when countdown reaches 0", () => {
    const onComplete = mock(() => {});
    const { result } = renderHook(() => useCountdownReload(true, onComplete, 3));

    // Tick through all 3 seconds
    tick(); // 2
    tick(); // 1
    tick(); // 0

    expect(result.current.countdown).toBe(0);
    expect(result.current.progressPercent).toBe(0);
    expect(onComplete).toHaveBeenCalledTimes(1);
  });

  test("does not call onComplete before countdown reaches 0", () => {
    const onComplete = mock(() => {});
    renderHook(() => useCountdownReload(true, onComplete, 5));

    // Only tick 3 out of 5 seconds
    tick(3);
    expect(onComplete).not.toHaveBeenCalled();
  });

  test("clears interval when countdown reaches 0", () => {
    const onComplete = mock(() => {});
    renderHook(() => useCountdownReload(true, onComplete, 2));

    // Tick to 0
    tick(2);

    expect(clearedIntervals.size).toBeGreaterThan(0);
    expect(intervalCallbacks.size).toBe(0);
  });

  test("stops decrementing after reaching 0", () => {
    const onComplete = mock(() => {});
    const { result } = renderHook(() => useCountdownReload(true, onComplete, 2));

    // Tick to 0
    tick(2);

    expect(result.current.countdown).toBe(0);
    expect(onComplete).toHaveBeenCalledTimes(1);

    // No more callbacks should exist, so additional ticks are no-ops
    tick(3);
    expect(result.current.countdown).toBe(0);
    expect(onComplete).toHaveBeenCalledTimes(1);
  });

  test("cleans up interval on unmount", () => {
    const onComplete = mock(() => {});
    const { result, unmount } = renderHook(() => useCountdownReload(true, onComplete, 10));

    // Tick a bit
    tick(2);
    expect(result.current.countdown).toBe(8);

    // Unmount the hook — should clear the interval
    unmount();

    expect(clearedIntervals.size).toBeGreaterThan(0);
    expect(intervalCallbacks.size).toBe(0);
  });

  test("resets countdown when active transitions from false to true", () => {
    const onComplete = mock(() => {});
    const { result, rerender } = renderHook(
      ({ active }) => useCountdownReload(active, onComplete, 5),
      { initialProps: { active: false } },
    );

    expect(result.current.countdown).toBe(5);
    expect(intervalCallbacks.size).toBe(0);

    // Activate
    rerender({ active: true });
    expect(intervalCallbacks.size).toBe(1);

    tick(2);
    expect(result.current.countdown).toBe(3);
  });

  test("progress bar percentage matches expected values at each second", () => {
    const onComplete = mock(() => {});
    const duration = 5;
    const { result } = renderHook(() => useCountdownReload(true, onComplete, duration));

    // Check concrete expected values at each second
    const expectedValues = [
      { countdown: 5, percent: 100 },
      { countdown: 4, percent: 80 },
      { countdown: 3, percent: 60 },
      { countdown: 2, percent: 40 },
      { countdown: 1, percent: 20 },
      { countdown: 0, percent: 0 },
    ];

    // Verify initial state (t=0)
    expect(result.current.countdown).toBe(expectedValues[0]!.countdown);
    expect(result.current.progressPercent).toBe(expectedValues[0]!.percent);

    // Verify each subsequent tick
    for (let i = 1; i < expectedValues.length; i++) {
      tick();
      expect(result.current.countdown).toBe(expectedValues[i]!.countdown);
      expect(result.current.progressPercent).toBe(expectedValues[i]!.percent);
    }
  });
});
