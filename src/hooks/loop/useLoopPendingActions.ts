/**
 * Pending/prompt actions for the useLoop hook.
 * Handles setting and clearing pending prompts and model/message values.
 */

import { useCallback } from "react";
import {
  setPendingPromptApi,
  clearPendingPromptApi,
  setPendingApi,
  clearPendingApi,
  type SetPendingResult,
} from "../loopActions";
import { createLogger } from "../../lib/logger";
import type { UseLoopActionsParams } from "./useLoopActions";

const log = createLogger("useLoop");

export interface UseLoopPendingActionsResult {
  setPendingPrompt: (prompt: string) => Promise<boolean>;
  clearPendingPrompt: () => Promise<boolean>;
  setPending: (options: {
    message?: string;
    model?: { providerID: string; modelID: string };
  }) => Promise<SetPendingResult>;
  clearPending: () => Promise<boolean>;
}

export function useLoopPendingActions(params: UseLoopActionsParams): UseLoopPendingActionsResult {
  const { loopId, isActiveLoop, ignoreStaleLoopAction, ignoreStaleLoopError, setError, refresh } =
    params;

  const setPendingPrompt = useCallback(
    async (prompt: string): Promise<boolean> => {
      const actionLoopId = loopId;
      const staleAction = ignoreStaleLoopAction("setPendingPrompt", actionLoopId, false);
      if (staleAction !== null) {
        return staleAction;
      }
      log.debug("Setting pending prompt", { loopId: actionLoopId, promptLength: prompt.length });
      try {
        await setPendingPromptApi(actionLoopId, prompt);
        await refresh();
        if (!isActiveLoop(actionLoopId)) {
          return false;
        }
        log.debug("Pending prompt set", { loopId: actionLoopId });
        return true;
      } catch (err) {
        const staleError = ignoreStaleLoopError("setPendingPrompt", actionLoopId, false, err);
        if (staleError !== null) {
          return staleError;
        }
        log.error("Failed to set pending prompt", { loopId: actionLoopId, error: String(err) });
        setError(String(err));
        return false;
      }
    },
    [ignoreStaleLoopAction, ignoreStaleLoopError, isActiveLoop, loopId, refresh, setError],
  );

  const clearPendingPrompt = useCallback(async (): Promise<boolean> => {
    const actionLoopId = loopId;
    const staleAction = ignoreStaleLoopAction("clearPendingPrompt", actionLoopId, false);
    if (staleAction !== null) {
      return staleAction;
    }
    log.debug("Clearing pending prompt", { loopId: actionLoopId });
    try {
      await clearPendingPromptApi(actionLoopId);
      await refresh();
      if (!isActiveLoop(actionLoopId)) {
        return false;
      }
      log.debug("Pending prompt cleared", { loopId: actionLoopId });
      return true;
    } catch (err) {
      const staleError = ignoreStaleLoopError("clearPendingPrompt", actionLoopId, false, err);
      if (staleError !== null) {
        return staleError;
      }
      log.error("Failed to clear pending prompt", { loopId: actionLoopId, error: String(err) });
      setError(String(err));
      return false;
    }
  }, [ignoreStaleLoopAction, ignoreStaleLoopError, isActiveLoop, loopId, refresh, setError]);

  const setPending = useCallback(
    async (options: {
      message?: string;
      model?: { providerID: string; modelID: string };
    }): Promise<SetPendingResult> => {
      const actionLoopId = loopId;
      const staleAction = ignoreStaleLoopAction("setPending", actionLoopId, { success: false });
      if (staleAction !== null) {
        return staleAction;
      }
      log.debug("Setting pending", {
        loopId: actionLoopId,
        hasMessage: options.message !== undefined,
        hasModel: options.model !== undefined,
      });
      try {
        const result = await setPendingApi(actionLoopId, options);
        await refresh();
        if (!isActiveLoop(actionLoopId)) {
          return { success: false };
        }
        log.debug("Pending values set", { loopId: actionLoopId });
        return result;
      } catch (err) {
        const staleError = ignoreStaleLoopError(
          "setPending",
          actionLoopId,
          { success: false },
          err,
        );
        if (staleError !== null) {
          return staleError;
        }
        log.error("Failed to set pending", { loopId: actionLoopId, error: String(err) });
        setError(String(err));
        return { success: false };
      }
    },
    [ignoreStaleLoopAction, ignoreStaleLoopError, isActiveLoop, loopId, refresh, setError],
  );

  const clearPending = useCallback(async (): Promise<boolean> => {
    const actionLoopId = loopId;
    const staleAction = ignoreStaleLoopAction("clearPending", actionLoopId, false);
    if (staleAction !== null) {
      return staleAction;
    }
    log.debug("Clearing pending values", { loopId: actionLoopId });
    try {
      await clearPendingApi(actionLoopId);
      await refresh();
      if (!isActiveLoop(actionLoopId)) {
        return false;
      }
      log.debug("Pending values cleared", { loopId: actionLoopId });
      return true;
    } catch (err) {
      const staleError = ignoreStaleLoopError("clearPending", actionLoopId, false, err);
      if (staleError !== null) {
        return staleError;
      }
      log.error("Failed to clear pending", { loopId: actionLoopId, error: String(err) });
      setError(String(err));
      return false;
    }
  }, [ignoreStaleLoopAction, ignoreStaleLoopError, isActiveLoop, loopId, refresh, setError]);

  return { setPendingPrompt, clearPendingPrompt, setPending, clearPending };
}
