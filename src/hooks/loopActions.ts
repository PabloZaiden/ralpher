/**
 * Shared loop action API functions.
 * These are the actual API calls used by both useLoops and useLoop hooks.
 */

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
}

/**
 * Accept (merge) a loop's changes via the API.
 */
export async function acceptLoopApi(loopId: string): Promise<AcceptLoopResult> {
  const response = await fetch(`/api/loops/${loopId}/accept`, {
    method: "POST",
  });

  if (!response.ok) {
    const errorData = await response.json();
    throw new Error(errorData.message || "Failed to accept loop");
  }

  const data = await response.json();
  return { success: true, mergeCommit: data.mergeCommit };
}

/**
 * Push a loop's branch to remote via the API.
 */
export async function pushLoopApi(loopId: string): Promise<PushLoopResult> {
  const response = await fetch(`/api/loops/${loopId}/push`, {
    method: "POST",
  });

  if (!response.ok) {
    const errorData = await response.json();
    throw new Error(errorData.message || "Failed to push loop");
  }

  const data = await response.json();
  return { success: true, remoteBranch: data.remoteBranch };
}

/**
 * Discard a loop's changes via the API.
 */
export async function discardLoopApi(loopId: string): Promise<boolean> {
  const response = await fetch(`/api/loops/${loopId}/discard`, {
    method: "POST",
  });

  if (!response.ok) {
    const errorData = await response.json();
    throw new Error(errorData.message || "Failed to discard loop");
  }

  return true;
}

/**
 * Delete a loop via the API.
 */
export async function deleteLoopApi(loopId: string): Promise<boolean> {
  const response = await fetch(`/api/loops/${loopId}`, {
    method: "DELETE",
  });

  if (!response.ok) {
    const errorData = await response.json();
    throw new Error(errorData.message || "Failed to delete loop");
  }

  return true;
}

/**
 * Purge a loop (permanently delete) via the API.
 */
export async function purgeLoopApi(loopId: string): Promise<boolean> {
  const response = await fetch(`/api/loops/${loopId}/purge`, {
    method: "POST",
  });

  if (!response.ok) {
    const errorData = await response.json();
    throw new Error(errorData.message || "Failed to purge loop");
  }

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
  const response = await fetch(`/api/loops/${loopId}/mark-merged`, {
    method: "POST",
  });

  if (!response.ok) {
    const errorData = await response.json();
    throw new Error(errorData.message || "Failed to mark loop as merged");
  }

  return true;
}

/**
 * Set a pending prompt for a loop via the API.
 */
export async function setPendingPromptApi(
  loopId: string,
  prompt: string
): Promise<boolean> {
  const response = await fetch(`/api/loops/${loopId}/pending-prompt`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ prompt }),
  });

  if (!response.ok) {
    const errorData = await response.json();
    throw new Error(errorData.message || "Failed to set pending prompt");
  }

  return true;
}

/**
 * Clear the pending prompt for a loop via the API.
 */
export async function clearPendingPromptApi(loopId: string): Promise<boolean> {
  const response = await fetch(`/api/loops/${loopId}/pending-prompt`, {
    method: "DELETE",
  });

  if (!response.ok) {
    const errorData = await response.json();
    throw new Error(errorData.message || "Failed to clear pending prompt");
  }

  return true;
}

/**
 * Send feedback to refine a plan via the API.
 */
export async function sendPlanFeedbackApi(
  loopId: string,
  feedback: string
): Promise<boolean> {
  const response = await fetch(`/api/loops/${loopId}/plan/feedback`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ feedback }),
  });

  if (!response.ok) {
    const errorData = await response.json();
    throw new Error(errorData.message || "Failed to send plan feedback");
  }

  return true;
}

/**
 * Accept a plan and start the loop execution via the API.
 */
export async function acceptPlanApi(loopId: string): Promise<boolean> {
  const response = await fetch(`/api/loops/${loopId}/plan/accept`, {
    method: "POST",
  });

  if (!response.ok) {
    const errorData = await response.json();
    throw new Error(errorData.message || "Failed to accept plan");
  }

  return true;
}

/**
 * Discard a plan and delete the loop via the API.
 */
export async function discardPlanApi(loopId: string): Promise<boolean> {
  const response = await fetch(`/api/loops/${loopId}/plan/discard`, {
    method: "POST",
  });

  if (!response.ok) {
    const errorData = await response.json();
    throw new Error(errorData.message || "Failed to discard plan");
  }

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
    throw new Error(errorData.message || errorData.error || "Failed to address comments");
  }

  const data = await response.json();
  return {
    success: true,
    reviewCycle: data.reviewCycle,
    branch: data.branch,
  };
}
