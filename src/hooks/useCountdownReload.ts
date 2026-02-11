/**
 * Custom hook for countdown-to-reload behavior.
 *
 * Starts a countdown timer when `active` becomes true, decrementing by 1
 * each second. When the countdown reaches 0, calls `onComplete` (typically
 * window.location.reload). Returns the current countdown value and the
 * computed progress percentage.
 */

import { useCallback, useEffect, useState } from "react";

/** Duration in seconds for the reload countdown after killing the server. */
export const KILL_SERVER_COUNTDOWN_SECONDS = 15;

export interface UseCountdownReloadResult {
  /** Current countdown value in seconds */
  countdown: number;
  /** Progress percentage (100 at start, 0 at end) */
  progressPercent: number;
}

/**
 * Compute the progress bar percentage for a given countdown value.
 * Returns 100 when countdown equals total, 0 when countdown is 0.
 */
export function computeProgressPercent(countdown: number, total: number): number {
  if (total <= 0) return 0;
  return (countdown / total) * 100;
}

/**
 * Hook that manages a countdown timer. When `active` is true, the countdown
 * starts at `durationSeconds` and decrements by 1 each second. When the
 * countdown reaches 0, `onComplete` is called and the interval is cleared.
 *
 * @param active - Whether the countdown should be running
 * @param onComplete - Callback to invoke when countdown reaches 0
 * @param durationSeconds - Total countdown duration (default: KILL_SERVER_COUNTDOWN_SECONDS)
 */
export function useCountdownReload(
  active: boolean,
  onComplete: () => void,
  durationSeconds: number = KILL_SERVER_COUNTDOWN_SECONDS,
): UseCountdownReloadResult {
  const [countdown, setCountdown] = useState(durationSeconds);

  // Stabilize onComplete reference
  const onCompleteRef = useCallback(onComplete, [onComplete]);

  useEffect(() => {
    if (!active) return;

    setCountdown(durationSeconds);

    const interval = setInterval(() => {
      setCountdown((prev) => {
        const next = prev - 1;
        if (next <= 0) {
          clearInterval(interval);
          onCompleteRef();
          return 0;
        }
        return next;
      });
    }, 1000);

    return () => {
      clearInterval(interval);
    };
  }, [active, durationSeconds, onCompleteRef]);

  return {
    countdown,
    progressPercent: computeProgressPercent(countdown, durationSeconds),
  };
}
