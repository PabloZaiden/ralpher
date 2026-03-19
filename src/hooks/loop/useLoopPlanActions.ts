/**
 * Plan-phase actions for the useLoop hook.
 * Handles planning interactions: feedback, questions, accept, and discard.
 */

import { useCallback } from "react";
import {
  sendPlanFeedbackApi,
  answerPlanQuestionApi,
  acceptPlanApi,
  discardPlanApi,
  type AcceptPlanResult,
} from "../loopActions";
import { createLogger } from "../../lib/logger";
import type { MessageImageAttachment } from "../../types/message-attachments";
import type { UseLoopActionsParams } from "./useLoopActions";

const log = createLogger("useLoop");

export interface UseLoopPlanActionsResult {
  sendPlanFeedback: (feedback: string, attachments?: MessageImageAttachment[]) => Promise<boolean>;
  answerPlanQuestion: (answers: string[][]) => Promise<boolean>;
  acceptPlan: (mode?: "start_loop" | "open_ssh") => Promise<AcceptPlanResult>;
  discardPlan: () => Promise<boolean>;
}

export function useLoopPlanActions(params: UseLoopActionsParams): UseLoopPlanActionsResult {
  const { loopId, isActiveLoop, ignoreStaleLoopAction, ignoreStaleLoopError, setLoop, setError, refresh } =
    params;

  const sendPlanFeedback = useCallback(
    async (feedback: string, attachments?: MessageImageAttachment[]): Promise<boolean> => {
      const actionLoopId = loopId;
      const staleAction = ignoreStaleLoopAction("sendPlanFeedback", actionLoopId, false);
      if (staleAction !== null) {
        return staleAction;
      }
      log.info("Sending plan feedback", {
        loopId: actionLoopId,
        feedbackLength: feedback.length,
      });
      try {
        await sendPlanFeedbackApi(actionLoopId, feedback, attachments);
        await refresh();
        if (!isActiveLoop(actionLoopId)) {
          return false;
        }
        log.info("Plan feedback sent", { loopId: actionLoopId });
        return true;
      } catch (err) {
        const staleError = ignoreStaleLoopError("sendPlanFeedback", actionLoopId, false, err);
        if (staleError !== null) {
          return staleError;
        }
        log.error("Failed to send plan feedback", { loopId: actionLoopId, error: String(err) });
        setError(String(err));
        return false;
      }
    },
    [ignoreStaleLoopAction, ignoreStaleLoopError, isActiveLoop, loopId, refresh, setError],
  );

  const answerPlanQuestion = useCallback(
    async (answers: string[][]): Promise<boolean> => {
      const actionLoopId = loopId;
      const staleAction = ignoreStaleLoopAction("answerPlanQuestion", actionLoopId, false);
      if (staleAction !== null) {
        return staleAction;
      }
      log.info("Answering plan question", {
        loopId: actionLoopId,
        answerGroups: answers.length,
      });
      try {
        await answerPlanQuestionApi(actionLoopId, answers);
        await refresh();
        if (!isActiveLoop(actionLoopId)) {
          return false;
        }
        log.info("Plan question answered", { loopId: actionLoopId });
        return true;
      } catch (err) {
        const staleError = ignoreStaleLoopError("answerPlanQuestion", actionLoopId, false, err);
        if (staleError !== null) {
          return staleError;
        }
        log.error("Failed to answer plan question", { loopId: actionLoopId, error: String(err) });
        setError(String(err));
        return false;
      }
    },
    [ignoreStaleLoopAction, ignoreStaleLoopError, isActiveLoop, loopId, refresh, setError],
  );

  const acceptPlan = useCallback(
    async (mode: "start_loop" | "open_ssh" = "start_loop"): Promise<AcceptPlanResult> => {
      const actionLoopId = loopId;
      const staleAction = ignoreStaleLoopAction<AcceptPlanResult>("acceptPlan", actionLoopId, {
        success: false,
      });
      if (staleAction !== null) {
        return staleAction;
      }
      log.info("Accepting plan", { loopId: actionLoopId, mode });
      try {
        const result = await acceptPlanApi(actionLoopId, mode);
        await refresh();
        if (!isActiveLoop(actionLoopId)) {
          return { success: false };
        }
        if (result.success) {
          log.info("Plan accepted", { loopId: actionLoopId, mode: result.mode });
        }
        return result;
      } catch (err) {
        const staleError = ignoreStaleLoopError<AcceptPlanResult>(
          "acceptPlan",
          actionLoopId,
          { success: false },
          err,
        );
        if (staleError !== null) {
          return staleError;
        }
        log.error("Failed to accept plan", { loopId: actionLoopId, mode, error: String(err) });
        setError(String(err));
        return { success: false };
      }
    },
    [ignoreStaleLoopAction, ignoreStaleLoopError, isActiveLoop, loopId, refresh, setError],
  );

  const discardPlan = useCallback(async (): Promise<boolean> => {
    const actionLoopId = loopId;
    const staleAction = ignoreStaleLoopAction("discardPlan", actionLoopId, false);
    if (staleAction !== null) {
      return staleAction;
    }
    log.info("Discarding plan", { loopId: actionLoopId });
    try {
      await discardPlanApi(actionLoopId);
      if (!isActiveLoop(actionLoopId)) {
        return false;
      }
      setLoop(null);
      log.info("Plan discarded", { loopId: actionLoopId });
      return true;
    } catch (err) {
      const staleError = ignoreStaleLoopError("discardPlan", actionLoopId, false, err);
      if (staleError !== null) {
        return staleError;
      }
      log.error("Failed to discard plan", { loopId: actionLoopId, error: String(err) });
      setError(String(err));
      return false;
    }
  }, [ignoreStaleLoopAction, ignoreStaleLoopError, isActiveLoop, loopId, setError, setLoop]);

  return { sendPlanFeedback, answerPlanQuestion, acceptPlan, discardPlan };
}
