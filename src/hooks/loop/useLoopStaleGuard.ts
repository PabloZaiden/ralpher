/**
 * Stale-request guard for the useLoop hook.
 * Prevents state updates from in-flight requests that belong to a previous loopId.
 */

import { useCallback, useRef } from "react";
import { createLogger } from "../../lib/logger";

const log = createLogger("useLoop");

export interface UseLoopStaleGuardResult {
  activeLoopIdRef: React.MutableRefObject<string>;
  isActiveLoop: (expectedLoopId: string) => boolean;
  ignoreStaleLoopAction: <T>(actionName: string, expectedLoopId: string, fallback: T) => T | null;
  ignoreStaleLoopError: <T>(
    actionName: string,
    expectedLoopId: string,
    fallback: T,
    error: unknown,
  ) => T | null;
}

export function useLoopStaleGuard(loopId: string): UseLoopStaleGuardResult {
  const activeLoopIdRef = useRef(loopId);
  activeLoopIdRef.current = loopId;

  const isActiveLoop = useCallback((expectedLoopId: string): boolean => {
    return activeLoopIdRef.current === expectedLoopId;
  }, []);

  const ignoreStaleLoopAction = useCallback(
    <T,>(actionName: string, expectedLoopId: string, fallback: T): T | null => {
      if (isActiveLoop(expectedLoopId)) {
        return null;
      }
      log.debug("Ignoring stale loop action", {
        actionName,
        expectedLoopId,
        activeLoopId: activeLoopIdRef.current,
      });
      return fallback;
    },
    [isActiveLoop],
  );

  const ignoreStaleLoopError = useCallback(
    <T,>(
      actionName: string,
      expectedLoopId: string,
      fallback: T,
      error: unknown,
    ): T | null => {
      if (isActiveLoop(expectedLoopId)) {
        return null;
      }
      log.debug("Ignoring stale loop action error", {
        actionName,
        expectedLoopId,
        activeLoopId: activeLoopIdRef.current,
        error: String(error),
      });
      return fallback;
    },
    [isActiveLoop],
  );

  return { activeLoopIdRef, isActiveLoop, ignoreStaleLoopAction, ignoreStaleLoopError };
}
