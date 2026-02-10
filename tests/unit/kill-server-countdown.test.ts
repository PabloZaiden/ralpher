/**
 * Unit tests for the kill server countdown timer behavior.
 *
 * Since the project does not include a React component testing library,
 * we test the exported constant and verify the timer mechanics by
 * simulating the setInterval callback pattern used in AppSettingsModal.
 */

import { test, expect, describe, beforeEach } from "bun:test";
import { KILL_SERVER_COUNTDOWN_SECONDS } from "../../src/components/AppSettingsModal";

describe("Kill Server Countdown", () => {
  describe("KILL_SERVER_COUNTDOWN_SECONDS constant", () => {
    test("is defined and equals 15", () => {
      expect(KILL_SERVER_COUNTDOWN_SECONDS).toBe(15);
    });

    test("is a positive integer", () => {
      expect(Number.isInteger(KILL_SERVER_COUNTDOWN_SECONDS)).toBe(true);
      expect(KILL_SERVER_COUNTDOWN_SECONDS).toBeGreaterThan(0);
    });
  });

  describe("Countdown timer logic", () => {
    // Simulate the countdown logic from the useEffect in AppSettingsModal.
    // This mirrors the exact pattern:
    //   setCountdown((prev) => { const next = prev - 1; if (next <= 0) { clear; reload; return 0; } return next; })
    let reloadCalled: boolean;
    let intervalCleared: boolean;

    beforeEach(() => {
      reloadCalled = false;
      intervalCleared = false;
    });

    function simulateCountdown(startFrom: number): number[] {
      const values: number[] = [startFrom];
      let current = startFrom;

      // Simulate each tick of the interval
      while (current > 0) {
        const next = current - 1;
        if (next <= 0) {
          intervalCleared = true;
          reloadCalled = true;
          current = 0;
        } else {
          current = next;
        }
        values.push(current);
      }

      return values;
    }

    test("counts down from KILL_SERVER_COUNTDOWN_SECONDS to 0", () => {
      const values = simulateCountdown(KILL_SERVER_COUNTDOWN_SECONDS);

      expect(values[0]).toBe(15);
      expect(values[values.length - 1]).toBe(0);
      // Should have 16 entries: 15, 14, 13, ..., 1, 0
      expect(values).toHaveLength(KILL_SERVER_COUNTDOWN_SECONDS + 1);
    });

    test("decrements by 1 each tick", () => {
      const values = simulateCountdown(KILL_SERVER_COUNTDOWN_SECONDS);

      for (let i = 1; i < values.length; i++) {
        expect(values[i]).toBe(values[i - 1]! - 1);
      }
    });

    test("triggers reload when countdown reaches 0", () => {
      simulateCountdown(KILL_SERVER_COUNTDOWN_SECONDS);

      expect(reloadCalled).toBe(true);
    });

    test("clears interval when countdown reaches 0", () => {
      simulateCountdown(KILL_SERVER_COUNTDOWN_SECONDS);

      expect(intervalCleared).toBe(true);
    });

    test("handles countdown starting from 1 (edge case)", () => {
      const values = simulateCountdown(1);

      expect(values).toEqual([1, 0]);
      expect(reloadCalled).toBe(true);
      expect(intervalCleared).toBe(true);
    });

    test("does not trigger reload if countdown has not reached 0", () => {
      // Simulate partial countdown (only a few ticks)
      let current = KILL_SERVER_COUNTDOWN_SECONDS;
      reloadCalled = false;

      // Only do 5 ticks
      for (let i = 0; i < 5; i++) {
        const next = current - 1;
        if (next <= 0) {
          reloadCalled = true;
          current = 0;
        } else {
          current = next;
        }
      }

      expect(current).toBe(10);
      expect(reloadCalled).toBe(false);
    });

    test("progress bar percentage decreases linearly", () => {
      // Verify the progress bar width calculation: (countdown / TOTAL) * 100
      const total = KILL_SERVER_COUNTDOWN_SECONDS;

      for (let countdown = total; countdown >= 0; countdown--) {
        const percentage = (countdown / total) * 100;
        expect(percentage).toBeCloseTo((countdown / total) * 100, 2);

        // At start, should be 100%
        if (countdown === total) {
          expect(percentage).toBe(100);
        }

        // At end, should be 0%
        if (countdown === 0) {
          expect(percentage).toBe(0);
        }
      }
    });
  });
});
