/**
 * Git-related loop actions: accept (merge), push, update-branch, mark-merged.
 */

import { apiCall, apiAction } from "./helpers";

/**
 * Result of an accept loop action.
 */
export interface AcceptLoopResult {
  success: boolean;
  mergeCommit?: string;
}

/**
 * Result of a push loop action.
 */
export interface PushLoopResult {
  success: boolean;
  remoteBranch?: string;
  /** Sync status with base branch */
  syncStatus?: "already_up_to_date" | "clean" | "conflicts_being_resolved";
}

/**
 * Accept (merge) a loop's changes via the API.
 */
export async function acceptLoopApi(loopId: string): Promise<AcceptLoopResult> {
  const data = await apiCall<{ mergeCommit: string }>(
    `/api/loops/${loopId}/accept`,
    { method: "POST" },
    "Accept loop",
  );
  return { success: true, mergeCommit: data.mergeCommit };
}

/**
 * Push a loop's branch to remote via the API.
 */
export async function pushLoopApi(loopId: string): Promise<PushLoopResult> {
  const data = await apiCall<{ remoteBranch?: string; syncStatus?: string }>(
    `/api/loops/${loopId}/push`,
    { method: "POST" },
    "Push loop",
  );
  return {
    success: true,
    remoteBranch: data.remoteBranch,
    syncStatus: data.syncStatus as PushLoopResult["syncStatus"],
  };
}

/**
 * Update a pushed loop's branch by syncing with the base branch and re-pushing.
 */
export async function updateBranchApi(loopId: string): Promise<PushLoopResult> {
  const data = await apiCall<{ remoteBranch?: string; syncStatus?: string }>(
    `/api/loops/${loopId}/update-branch`,
    { method: "POST" },
    "Update branch",
  );
  return {
    success: true,
    remoteBranch: data.remoteBranch,
    syncStatus: data.syncStatus as PushLoopResult["syncStatus"],
  };
}

/**
 * Mark a loop as merged and sync with remote via the API.
 *
 * This is useful when a loop's branch was merged externally (e.g., via GitHub PR)
 * and the user wants to preserve the loop as merged instead of treating it
 * like a deleted loop.
 */
export async function markMergedApi(loopId: string): Promise<boolean> {
  return apiAction(`/api/loops/${loopId}/mark-merged`, "POST", "Mark loop as merged");
}
