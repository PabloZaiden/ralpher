/**
 * Action callbacks for the useLoop hook.
 * Handles all mutating operations: accept, push, discard, plan actions, etc.
 */

import { useCallback } from "react";
import type { Dispatch, SetStateAction } from "react";
import type { Loop, UpdateLoopRequest, SshSession } from "../../types";
import {
  acceptLoopApi,
  pushLoopApi,
  discardLoopApi,
  deleteLoopApi,
  purgeLoopApi,
  markMergedApi,
  setPendingPromptApi,
  clearPendingPromptApi,
  setPendingApi,
  clearPendingApi,
  sendPlanFeedbackApi,
  answerPlanQuestionApi,
  acceptPlanApi,
  discardPlanApi,
  addressReviewCommentsApi,
  updateBranchApi,
  sendFollowUpApi,
  sendChatMessageApi,
  getOrCreateLoopSshSessionApi,
  type AcceptLoopResult,
  type AcceptPlanResult,
  type PushLoopResult,
  type AddressCommentsResult,
  type SetPendingResult,
} from "../loopActions";
import { createLogger } from "../../lib/logger";
import { appFetch } from "../../lib/public-path";

const log = createLogger("useLoop");

export interface UseLoopActionsParams {
  loopId: string;
  isActiveLoop: (expectedLoopId: string) => boolean;
  ignoreStaleLoopAction: <T>(actionName: string, expectedLoopId: string, fallback: T) => T | null;
  ignoreStaleLoopError: <T>(
    actionName: string,
    expectedLoopId: string,
    fallback: T,
    error: unknown,
  ) => T | null;
  setLoop: Dispatch<SetStateAction<Loop | null>>;
  setError: Dispatch<SetStateAction<string | null>>;
  refresh: () => Promise<void>;
}

export interface UseLoopActionsResult {
  update: (request: UpdateLoopRequest) => Promise<boolean>;
  remove: () => Promise<boolean>;
  accept: () => Promise<AcceptLoopResult>;
  push: () => Promise<PushLoopResult>;
  updateBranch: () => Promise<PushLoopResult>;
  discard: () => Promise<boolean>;
  purge: () => Promise<boolean>;
  markMerged: () => Promise<boolean>;
  setPendingPrompt: (prompt: string) => Promise<boolean>;
  clearPendingPrompt: () => Promise<boolean>;
  sendPlanFeedback: (feedback: string) => Promise<boolean>;
  answerPlanQuestion: (answers: string[][]) => Promise<boolean>;
  acceptPlan: (mode?: "start_loop" | "open_ssh") => Promise<AcceptPlanResult>;
  discardPlan: () => Promise<boolean>;
  addressReviewComments: (comments: string) => Promise<AddressCommentsResult>;
  setPending: (options: {
    message?: string;
    model?: { providerID: string; modelID: string };
  }) => Promise<SetPendingResult>;
  clearPending: () => Promise<boolean>;
  sendChatMessage: (
    message: string,
    model?: { providerID: string; modelID: string },
  ) => Promise<boolean>;
  sendFollowUp: (
    message: string,
    model?: { providerID: string; modelID: string },
  ) => Promise<boolean>;
  connectViaSsh: () => Promise<SshSession | null>;
}

export function useLoopActions(params: UseLoopActionsParams): UseLoopActionsResult {
  const {
    loopId,
    isActiveLoop,
    ignoreStaleLoopAction,
    ignoreStaleLoopError,
    setLoop,
    setError,
    refresh,
  } = params;

  const update = useCallback(
    async (request: UpdateLoopRequest): Promise<boolean> => {
      const actionLoopId = loopId;
      const staleAction = ignoreStaleLoopAction("update", actionLoopId, false);
      if (staleAction !== null) {
        return staleAction;
      }
      log.debug("Updating loop", {
        loopId: actionLoopId,
        hasNameUpdate: request.name !== undefined,
      });
      try {
        const response = await appFetch(`/api/loops/${actionLoopId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(request),
        });
        if (!response.ok) {
          const errorData = await response.json();
          throw new Error(errorData.message || "Failed to update loop");
        }
        const data = (await response.json()) as Loop;
        if (!isActiveLoop(actionLoopId)) {
          return false;
        }
        setLoop(data);
        log.debug("Loop updated successfully", { loopId: actionLoopId });
        return true;
      } catch (err) {
        const staleError = ignoreStaleLoopError("update", actionLoopId, false, err);
        if (staleError !== null) {
          return staleError;
        }
        log.error("Failed to update loop", { loopId: actionLoopId, error: String(err) });
        setError(String(err));
        return false;
      }
    },
    [ignoreStaleLoopAction, ignoreStaleLoopError, isActiveLoop, loopId, setError, setLoop],
  );

  const remove = useCallback(async (): Promise<boolean> => {
    const actionLoopId = loopId;
    const staleAction = ignoreStaleLoopAction("remove", actionLoopId, false);
    if (staleAction !== null) {
      return staleAction;
    }
    log.debug("Deleting loop", { loopId: actionLoopId });
    try {
      await deleteLoopApi(actionLoopId);
      if (!isActiveLoop(actionLoopId)) {
        return false;
      }
      setLoop(null);
      log.info("Loop deleted", { loopId: actionLoopId });
      return true;
    } catch (err) {
      const staleError = ignoreStaleLoopError("remove", actionLoopId, false, err);
      if (staleError !== null) {
        return staleError;
      }
      log.error("Failed to delete loop", { loopId: actionLoopId, error: String(err) });
      setError(String(err));
      return false;
    }
  }, [ignoreStaleLoopAction, ignoreStaleLoopError, isActiveLoop, loopId, refresh, setError, setLoop]);

  const accept = useCallback(async (): Promise<AcceptLoopResult> => {
    const actionLoopId = loopId;
    const staleAction = ignoreStaleLoopAction("accept", actionLoopId, { success: false });
    if (staleAction !== null) {
      return staleAction;
    }
    log.debug("Accepting loop", { loopId: actionLoopId });
    try {
      const result = await acceptLoopApi(actionLoopId);
      await refresh();
      if (!isActiveLoop(actionLoopId)) {
        return { success: false };
      }
      log.info("Loop accepted", { loopId: actionLoopId, mergeCommit: result.mergeCommit });
      return result;
    } catch (err) {
      const staleError = ignoreStaleLoopError("accept", actionLoopId, { success: false }, err);
      if (staleError !== null) {
        return staleError;
      }
      log.error("Failed to accept loop", { loopId: actionLoopId, error: String(err) });
      setError(String(err));
      return { success: false };
    }
  }, [ignoreStaleLoopAction, ignoreStaleLoopError, isActiveLoop, loopId, refresh, setError]);

  const push = useCallback(async (): Promise<PushLoopResult> => {
    const actionLoopId = loopId;
    const staleAction = ignoreStaleLoopAction("push", actionLoopId, { success: false });
    if (staleAction !== null) {
      return staleAction;
    }
    log.debug("Pushing loop", { loopId: actionLoopId });
    try {
      const result = await pushLoopApi(actionLoopId);
      await refresh();
      if (!isActiveLoop(actionLoopId)) {
        return { success: false };
      }
      log.info("Loop pushed", { loopId: actionLoopId, remoteBranch: result.remoteBranch });
      return result;
    } catch (err) {
      const staleError = ignoreStaleLoopError("push", actionLoopId, { success: false }, err);
      if (staleError !== null) {
        return staleError;
      }
      log.error("Failed to push loop", { loopId: actionLoopId, error: String(err) });
      setError(String(err));
      return { success: false };
    }
  }, [ignoreStaleLoopAction, ignoreStaleLoopError, isActiveLoop, loopId, refresh, setError]);

  const updateBranch = useCallback(async (): Promise<PushLoopResult> => {
    const actionLoopId = loopId;
    const staleAction = ignoreStaleLoopAction("updateBranch", actionLoopId, { success: false });
    if (staleAction !== null) {
      return staleAction;
    }
    log.debug("Updating branch", { loopId: actionLoopId });
    try {
      const result = await updateBranchApi(actionLoopId);
      await refresh();
      if (!isActiveLoop(actionLoopId)) {
        return { success: false };
      }
      log.info("Branch updated", {
        loopId: actionLoopId,
        remoteBranch: result.remoteBranch,
        syncStatus: result.syncStatus,
      });
      return result;
    } catch (err) {
      const staleError = ignoreStaleLoopError("updateBranch", actionLoopId, { success: false }, err);
      if (staleError !== null) {
        return staleError;
      }
      log.error("Failed to update branch", { loopId: actionLoopId, error: String(err) });
      setError(String(err));
      return { success: false };
    }
  }, [ignoreStaleLoopAction, ignoreStaleLoopError, isActiveLoop, loopId, refresh, setError]);

  const discard = useCallback(async (): Promise<boolean> => {
    const actionLoopId = loopId;
    const staleAction = ignoreStaleLoopAction("discard", actionLoopId, false);
    if (staleAction !== null) {
      return staleAction;
    }
    log.debug("Discarding loop", { loopId: actionLoopId });
    try {
      await discardLoopApi(actionLoopId);
      await refresh();
      if (!isActiveLoop(actionLoopId)) {
        return false;
      }
      log.info("Loop discarded", { loopId: actionLoopId });
      return true;
    } catch (err) {
      const staleError = ignoreStaleLoopError("discard", actionLoopId, false, err);
      if (staleError !== null) {
        return staleError;
      }
      log.error("Failed to discard loop", { loopId: actionLoopId, error: String(err) });
      setError(String(err));
      return false;
    }
  }, [ignoreStaleLoopAction, ignoreStaleLoopError, isActiveLoop, loopId, refresh, setError]);

  const purge = useCallback(async (): Promise<boolean> => {
    const actionLoopId = loopId;
    const staleAction = ignoreStaleLoopAction("purge", actionLoopId, false);
    if (staleAction !== null) {
      return staleAction;
    }
    log.debug("Purging loop", { loopId: actionLoopId });
    try {
      await purgeLoopApi(actionLoopId);
      if (!isActiveLoop(actionLoopId)) {
        return false;
      }
      setLoop(null);
      log.info("Loop purged", { loopId: actionLoopId });
      return true;
    } catch (err) {
      const staleError = ignoreStaleLoopError("purge", actionLoopId, false, err);
      if (staleError !== null) {
        return staleError;
      }
      log.error("Failed to purge loop", { loopId: actionLoopId, error: String(err) });
      setError(String(err));
      return false;
    }
  }, [ignoreStaleLoopAction, ignoreStaleLoopError, isActiveLoop, loopId, refresh, setError, setLoop]);

  const markMerged = useCallback(async (): Promise<boolean> => {
    const actionLoopId = loopId;
    const staleAction = ignoreStaleLoopAction("markMerged", actionLoopId, false);
    if (staleAction !== null) {
      return staleAction;
    }
    log.debug("Marking loop as merged", { loopId: actionLoopId });
    try {
      await markMergedApi(actionLoopId);
      await refresh();
      if (!isActiveLoop(actionLoopId)) {
        return false;
      }
      log.info("Loop marked as merged", { loopId: actionLoopId });
      return true;
    } catch (err) {
      const staleError = ignoreStaleLoopError("markMerged", actionLoopId, false, err);
      if (staleError !== null) {
        return staleError;
      }
      log.error("Failed to mark loop as merged", { loopId: actionLoopId, error: String(err) });
      setError(String(err));
      return false;
    }
  }, [ignoreStaleLoopAction, ignoreStaleLoopError, isActiveLoop, loopId, refresh, setError]);

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

  const sendPlanFeedback = useCallback(
    async (feedback: string): Promise<boolean> => {
      const actionLoopId = loopId;
      const staleAction = ignoreStaleLoopAction("sendPlanFeedback", actionLoopId, false);
      if (staleAction !== null) {
        return staleAction;
      }
      log.debug("Sending plan feedback", {
        loopId: actionLoopId,
        feedbackLength: feedback.length,
      });
      try {
        await sendPlanFeedbackApi(actionLoopId, feedback);
        await refresh();
        if (!isActiveLoop(actionLoopId)) {
          return false;
        }
        log.debug("Plan feedback sent", { loopId: actionLoopId });
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
      log.debug("Answering plan question", {
        loopId: actionLoopId,
        answerGroups: answers.length,
      });
      try {
        await answerPlanQuestionApi(actionLoopId, answers);
        await refresh();
        if (!isActiveLoop(actionLoopId)) {
          return false;
        }
        log.debug("Plan question answered", { loopId: actionLoopId });
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
      log.debug("Accepting plan", { loopId: actionLoopId, mode });
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
    log.debug("Discarding plan", { loopId: actionLoopId });
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

  const addressReviewComments = useCallback(
    async (comments: string): Promise<AddressCommentsResult> => {
      const actionLoopId = loopId;
      const staleAction = ignoreStaleLoopAction("addressReviewComments", actionLoopId, {
        success: false,
      });
      if (staleAction !== null) {
        return staleAction;
      }
      log.debug("Addressing review comments", {
        loopId: actionLoopId,
        commentsLength: comments.length,
      });
      try {
        const result = await addressReviewCommentsApi(actionLoopId, comments);
        await refresh();
        if (!isActiveLoop(actionLoopId)) {
          return { success: false };
        }
        log.info("Review comments addressed", {
          loopId: actionLoopId,
          reviewCycle: result.reviewCycle,
        });
        return result;
      } catch (err) {
        const staleError = ignoreStaleLoopError(
          "addressReviewComments",
          actionLoopId,
          { success: false },
          err,
        );
        if (staleError !== null) {
          return staleError;
        }
        log.error("Failed to address review comments", {
          loopId: actionLoopId,
          error: String(err),
        });
        setError(String(err));
        return { success: false };
      }
    },
    [ignoreStaleLoopAction, ignoreStaleLoopError, isActiveLoop, loopId, refresh, setError],
  );

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

  const sendChatMessage = useCallback(
    async (
      message: string,
      model?: { providerID: string; modelID: string },
    ): Promise<boolean> => {
      const actionLoopId = loopId;
      const staleAction = ignoreStaleLoopAction("sendChatMessage", actionLoopId, false);
      if (staleAction !== null) {
        return staleAction;
      }
      log.debug("Sending chat message", { loopId: actionLoopId, messageLength: message.length });
      try {
        await sendChatMessageApi(actionLoopId, message, model);
        await refresh();
        if (!isActiveLoop(actionLoopId)) {
          return false;
        }
        log.debug("Chat message sent", { loopId: actionLoopId });
        return true;
      } catch (err) {
        const staleError = ignoreStaleLoopError("sendChatMessage", actionLoopId, false, err);
        if (staleError !== null) {
          return staleError;
        }
        log.error("Failed to send chat message", { loopId: actionLoopId, error: String(err) });
        setError(String(err));
        return false;
      }
    },
    [ignoreStaleLoopAction, ignoreStaleLoopError, isActiveLoop, loopId, refresh, setError],
  );

  const sendFollowUp = useCallback(
    async (
      message: string,
      model?: { providerID: string; modelID: string },
    ): Promise<boolean> => {
      const actionLoopId = loopId;
      const staleAction = ignoreStaleLoopAction("sendFollowUp", actionLoopId, false);
      if (staleAction !== null) {
        return staleAction;
      }
      log.debug("Sending terminal follow-up", {
        loopId: actionLoopId,
        messageLength: message.length,
      });
      try {
        await sendFollowUpApi(actionLoopId, message, model);
        await refresh();
        if (!isActiveLoop(actionLoopId)) {
          return false;
        }
        log.debug("Terminal follow-up sent", { loopId: actionLoopId });
        return true;
      } catch (err) {
        const staleError = ignoreStaleLoopError("sendFollowUp", actionLoopId, false, err);
        if (staleError !== null) {
          return staleError;
        }
        log.error("Failed to send terminal follow-up", {
          loopId: actionLoopId,
          error: String(err),
        });
        setError(String(err));
        return false;
      }
    },
    [ignoreStaleLoopAction, ignoreStaleLoopError, isActiveLoop, loopId, refresh, setError],
  );

  const connectViaSsh = useCallback(async (): Promise<SshSession | null> => {
    const actionLoopId = loopId;
    if (!isActiveLoop(actionLoopId)) {
      log.debug("Ignoring stale loop action", {
        actionName: "connectViaSsh",
        expectedLoopId: actionLoopId,
        activeLoopId: "(stale)",
      });
      return null;
    }
    log.debug("Connecting loop SSH session", { loopId: actionLoopId });
    try {
      const session = await getOrCreateLoopSshSessionApi(actionLoopId);
      if (!isActiveLoop(actionLoopId)) {
        return null;
      }
      return session;
    } catch (err) {
      if (!isActiveLoop(actionLoopId)) {
        log.debug("Ignoring stale loop action error", {
          actionName: "connectViaSsh",
          expectedLoopId: actionLoopId,
          activeLoopId: "(stale)",
          error: String(err),
        });
        return null;
      }
      log.error("Failed to connect loop SSH session", { loopId: actionLoopId, error: String(err) });
      setError(String(err));
      return null;
    }
  }, [isActiveLoop, loopId, setError]);

  return {
    update,
    remove,
    accept,
    push,
    updateBranch,
    discard,
    purge,
    markMerged,
    setPendingPrompt,
    clearPendingPrompt,
    sendPlanFeedback,
    answerPlanQuestion,
    acceptPlan,
    discardPlan,
    addressReviewComments,
    setPending,
    clearPending,
    sendChatMessage,
    sendFollowUp,
    connectViaSsh,
  };
}
