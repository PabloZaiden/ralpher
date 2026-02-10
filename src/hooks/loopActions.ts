/**
 * Shared loop action API functions.
 * These are the actual API calls used by both useLoops and useLoop hooks.
 */

import { createLogger } from "../lib/logger";

const log = createLogger("loopActions");

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
  log.debug("API: Accept loop", { loopId });
  const response = await fetch(`/api/loops/${loopId}/accept`, {
    method: "POST",
  });

  if (!response.ok) {
    const errorData = await response.json();
    log.error("API: Accept loop failed", { loopId, error: errorData.message });
    throw new Error(errorData.message || "Failed to accept loop");
  }

  const data = await response.json();
  log.trace("API: Accept loop success", { loopId, mergeCommit: data.mergeCommit });
  return { success: true, mergeCommit: data.mergeCommit };
}

/**
 * Push a loop's branch to remote via the API.
 */
export async function pushLoopApi(loopId: string): Promise<PushLoopResult> {
  log.debug("API: Push loop", { loopId });
  const response = await fetch(`/api/loops/${loopId}/push`, {
    method: "POST",
  });

  if (!response.ok) {
    const errorData = await response.json();
    log.error("API: Push loop failed", { loopId, error: errorData.message });
    throw new Error(errorData.message || "Failed to push loop");
  }

  const data = await response.json();
  log.trace("API: Push loop success", { loopId, remoteBranch: data.remoteBranch, syncStatus: data.syncStatus });
  return { success: true, remoteBranch: data.remoteBranch, syncStatus: data.syncStatus };
}

/**
 * Discard a loop's changes via the API.
 */
export async function discardLoopApi(loopId: string): Promise<boolean> {
  log.debug("API: Discard loop", { loopId });
  const response = await fetch(`/api/loops/${loopId}/discard`, {
    method: "POST",
  });

  if (!response.ok) {
    const errorData = await response.json();
    log.error("API: Discard loop failed", { loopId, error: errorData.message });
    throw new Error(errorData.message || "Failed to discard loop");
  }

  log.trace("API: Discard loop success", { loopId });
  return true;
}

/**
 * Delete a loop via the API.
 */
export async function deleteLoopApi(loopId: string): Promise<boolean> {
  log.debug("API: Delete loop", { loopId });
  const response = await fetch(`/api/loops/${loopId}`, {
    method: "DELETE",
  });

  if (!response.ok) {
    const errorData = await response.json();
    log.error("API: Delete loop failed", { loopId, error: errorData.message });
    throw new Error(errorData.message || "Failed to delete loop");
  }

  log.trace("API: Delete loop success", { loopId });
  return true;
}

/**
 * Purge a loop (permanently delete) via the API.
 */
export async function purgeLoopApi(loopId: string): Promise<boolean> {
  log.debug("API: Purge loop", { loopId });
  const response = await fetch(`/api/loops/${loopId}/purge`, {
    method: "POST",
  });

  if (!response.ok) {
    const errorData = await response.json();
    log.error("API: Purge loop failed", { loopId, error: errorData.message });
    throw new Error(errorData.message || "Failed to purge loop");
  }

  log.trace("API: Purge loop success", { loopId });
  return true;
}

/**
 * Mark a loop as merged and sync with remote via the API.
 * 
 * Switches the repository back to the original branch, pulls latest changes
 * from the remote, deletes the working branch, and marks the loop as deleted.
 * 
 * This is useful when a loop's branch was merged externally (e.g., via GitHub PR)
 * and the user wants to sync their local environment with the merged changes.
 */
export async function markMergedApi(loopId: string): Promise<boolean> {
  log.debug("API: Mark loop merged", { loopId });
  const response = await fetch(`/api/loops/${loopId}/mark-merged`, {
    method: "POST",
  });

  if (!response.ok) {
    const errorData = await response.json();
    log.error("API: Mark loop merged failed", { loopId, error: errorData.message });
    throw new Error(errorData.message || "Failed to mark loop as merged");
  }

  log.trace("API: Mark loop merged success", { loopId });
  return true;
}

/**
 * Set a pending prompt for a loop via the API.
 */
export async function setPendingPromptApi(
  loopId: string,
  prompt: string
): Promise<boolean> {
  log.debug("API: Set pending prompt", { loopId, promptLength: prompt.length });
  const response = await fetch(`/api/loops/${loopId}/pending-prompt`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ prompt }),
  });

  if (!response.ok) {
    const errorData = await response.json();
    log.error("API: Set pending prompt failed", { loopId, error: errorData.message });
    throw new Error(errorData.message || "Failed to set pending prompt");
  }

  log.trace("API: Set pending prompt success", { loopId });
  return true;
}

/**
 * Clear the pending prompt for a loop via the API.
 */
export async function clearPendingPromptApi(loopId: string): Promise<boolean> {
  log.debug("API: Clear pending prompt", { loopId });
  const response = await fetch(`/api/loops/${loopId}/pending-prompt`, {
    method: "DELETE",
  });

  if (!response.ok) {
    const errorData = await response.json();
    log.error("API: Clear pending prompt failed", { loopId, error: errorData.message });
    throw new Error(errorData.message || "Failed to clear pending prompt");
  }

  log.trace("API: Clear pending prompt success", { loopId });
  return true;
}

/**
 * Send feedback to refine a plan via the API.
 */
export async function sendPlanFeedbackApi(
  loopId: string,
  feedback: string
): Promise<boolean> {
  log.debug("API: Send plan feedback", { loopId, feedbackLength: feedback.length });
  const response = await fetch(`/api/loops/${loopId}/plan/feedback`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ feedback }),
  });

  if (!response.ok) {
    const errorData = await response.json();
    log.error("API: Send plan feedback failed", { loopId, error: errorData.message });
    throw new Error(errorData.message || "Failed to send plan feedback");
  }

  log.trace("API: Send plan feedback success", { loopId });
  return true;
}

/**
 * Accept a plan and start the loop execution via the API.
 */
export async function acceptPlanApi(loopId: string): Promise<boolean> {
  log.debug("API: Accept plan", { loopId });
  const response = await fetch(`/api/loops/${loopId}/plan/accept`, {
    method: "POST",
  });

  if (!response.ok) {
    const errorData = await response.json();
    log.error("API: Accept plan failed", { loopId, error: errorData.message });
    throw new Error(errorData.message || "Failed to accept plan");
  }

  log.trace("API: Accept plan success", { loopId });
  return true;
}

/**
 * Discard a plan and delete the loop via the API.
 */
export async function discardPlanApi(loopId: string): Promise<boolean> {
  log.debug("API: Discard plan", { loopId });
  const response = await fetch(`/api/loops/${loopId}/plan/discard`, {
    method: "POST",
  });

  if (!response.ok) {
    const errorData = await response.json();
    log.error("API: Discard plan failed", { loopId, error: errorData.message });
    throw new Error(errorData.message || "Failed to discard plan");
  }

  log.trace("API: Discard plan success", { loopId });
  return true;
}

/**
 * Result of setting pending values.
 */
export interface SetPendingResult {
  success: boolean;
}

/**
 * Set pending message and/or model for a loop via the API.
 * These values will be used for the next iteration instead of the default.
 */
export async function setPendingApi(
  loopId: string,
  options: { message?: string; model?: { providerID: string; modelID: string } }
): Promise<SetPendingResult> {
  log.debug("API: Set pending values", { 
    loopId, 
    hasMessage: !!options.message, 
    hasModel: !!options.model 
  });
  const response = await fetch(`/api/loops/${loopId}/pending`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(options),
  });

  if (!response.ok) {
    const errorData = await response.json();
    log.error("API: Set pending values failed", { loopId, error: errorData.message });
    throw new Error(errorData.message || "Failed to set pending values");
  }

  log.trace("API: Set pending values success", { loopId });
  return { success: true };
}

/**
 * Clear all pending values (message and model) for a loop via the API.
 */
export async function clearPendingApi(loopId: string): Promise<boolean> {
  log.debug("API: Clear pending values", { loopId });
  const response = await fetch(`/api/loops/${loopId}/pending`, {
    method: "DELETE",
  });

  if (!response.ok) {
    const errorData = await response.json();
    log.error("API: Clear pending values failed", { loopId, error: errorData.message });
    throw new Error(errorData.message || "Failed to clear pending values");
  }

  log.trace("API: Clear pending values success", { loopId });
  return true;
}

/**
 * Result of an address comments action.
 */
export interface AddressCommentsResult {
  success: boolean;
  reviewCycle?: number;
  branch?: string;
}

/**
 * Address reviewer comments on a pushed/merged loop via the API.
 */
export async function addressReviewCommentsApi(
  loopId: string,
  comments: string
): Promise<AddressCommentsResult> {
  log.debug("API: Address review comments", { loopId, commentsLength: comments.length });
  const response = await fetch(`/api/loops/${loopId}/address-comments`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ comments }),
  });

  if (!response.ok) {
    const errorData = await response.json();
    // Handle both error shapes:
    // - ErrorResponse: { error: string, message: string } (validation errors)
    // - AddressCommentsResponse: { success: false, error: string } (logical failures)
    log.error("API: Address review comments failed", { loopId, error: errorData.message || errorData.error });
    throw new Error(errorData.message || errorData.error || "Failed to address comments");
  }

  const data = await response.json();
  log.trace("API: Address review comments success", { loopId, reviewCycle: data.reviewCycle, branch: data.branch });
  return {
    success: true,
    reviewCycle: data.reviewCycle,
    branch: data.branch,
  };
}
