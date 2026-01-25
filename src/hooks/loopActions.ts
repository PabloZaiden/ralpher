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
