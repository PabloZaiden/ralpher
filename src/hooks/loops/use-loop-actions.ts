/**
 * Loop lifecycle actions: accept, push, discard, purge, address review comments.
 */

import { useCallback } from "react";
import type { Loop } from "../../types";
import type { MessageImageAttachment } from "../../types/message-attachments";
import {
  acceptLoopApi,
  pushLoopApi,
  discardLoopApi,
  purgeLoopApi,
  purgeArchivedWorkspaceLoopsApi,
  addressReviewCommentsApi,
  type AcceptLoopResult,
  type PushLoopResult,
  type AddressCommentsResult,
  type PurgeArchivedLoopsResult,
} from "../loopActions";
import { updateBranchApi } from "../loopActions";

interface UseLoopActionsOptions {
  setError: React.Dispatch<React.SetStateAction<string | null>>;
  setLoops: React.Dispatch<React.SetStateAction<Loop[]>>;
  refreshLoop: (id: string) => Promise<void>;
}

export interface UseLoopActionsResult {
  acceptLoop: (id: string) => Promise<AcceptLoopResult>;
  pushLoop: (id: string) => Promise<PushLoopResult>;
  updateBranch: (id: string) => Promise<PushLoopResult>;
  discardLoop: (id: string) => Promise<boolean>;
  purgeLoop: (id: string) => Promise<boolean>;
  purgeArchivedWorkspaceLoops: (workspaceId: string) => Promise<PurgeArchivedLoopsResult>;
  addressReviewComments: (id: string, comments: string, attachments?: MessageImageAttachment[]) => Promise<AddressCommentsResult>;
}

export function useLoopActions({ setError, setLoops, refreshLoop }: UseLoopActionsOptions): UseLoopActionsResult {
  const acceptLoop = useCallback(async (id: string): Promise<AcceptLoopResult> => {
    try {
      const result = await acceptLoopApi(id);
      await refreshLoop(id);
      return result;
    } catch (err) {
      setError(String(err));
      return { success: false };
    }
  }, [refreshLoop, setError]);

  const pushLoop = useCallback(async (id: string): Promise<PushLoopResult> => {
    try {
      const result = await pushLoopApi(id);
      await refreshLoop(id);
      return result;
    } catch (err) {
      setError(String(err));
      return { success: false };
    }
  }, [refreshLoop, setError]);

  const updateBranch = useCallback(async (id: string): Promise<PushLoopResult> => {
    try {
      const result = await updateBranchApi(id);
      await refreshLoop(id);
      return result;
    } catch (err) {
      setError(String(err));
      return { success: false };
    }
  }, [refreshLoop, setError]);

  const discardLoop = useCallback(async (id: string): Promise<boolean> => {
    try {
      await discardLoopApi(id);
      await refreshLoop(id);
      return true;
    } catch (err) {
      setError(String(err));
      return false;
    }
  }, [refreshLoop, setError]);

  const purgeLoop = useCallback(async (id: string): Promise<boolean> => {
    try {
      await purgeLoopApi(id);
      // Remove from state immediately since purge doesn't emit a WebSocket event
      // (archived loops are removed from the system entirely)
      setLoops((prev) => prev.filter((l) => l.config.id !== id));
      return true;
    } catch (err) {
      setError(String(err));
      return false;
    }
  }, [setError, setLoops]);

  const purgeArchivedWorkspaceLoops = useCallback(async (workspaceId: string): Promise<PurgeArchivedLoopsResult> => {
    try {
      const result = await purgeArchivedWorkspaceLoopsApi(workspaceId);
      const purgedLoopIds = new Set(result.purgedLoopIds);
      setLoops((prev) => prev.filter((loop) => !purgedLoopIds.has(loop.config.id)));
      return result;
    } catch (err) {
      const message = String(err);
      setError(message);
      return {
        success: false,
        workspaceId,
        totalArchived: 0,
        purgedCount: 0,
        purgedLoopIds: [],
        failures: [],
      };
    }
  }, [setError, setLoops]);

  const addressReviewComments = useCallback(async (
    id: string,
    comments: string,
    attachments?: MessageImageAttachment[],
  ): Promise<AddressCommentsResult> => {
    try {
      const result = await addressReviewCommentsApi(id, comments, attachments);
      await refreshLoop(id);
      return result;
    } catch (err) {
      setError(String(err));
      return { success: false };
    }
  }, [refreshLoop, setError]);

  return {
    acceptLoop,
    pushLoop,
    updateBranch,
    discardLoop,
    purgeLoop,
    purgeArchivedWorkspaceLoops,
    addressReviewComments,
  };
}
