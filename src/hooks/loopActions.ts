/**
 * Shared loop action API functions.
 * These are the actual API calls used by both useLoops and useLoop hooks.
 */

import { createLogger } from "../lib/logger";
import type { Loop, CreateChatRequest, SendChatMessageResponse } from "../types";

const log = createLogger("loopActions");

/**
 * Generic API call helper that eliminates boilerplate across loop action functions.
 *
 * Handles: fetch, error checking, JSON parsing, logging, and error throwing.
 *
 * @param url - API endpoint URL
 * @param options - Fetch options (method, body, etc.)
 * @param actionName - Human-readable action name for logging and error messages
 * @param extractError - Optional custom error extractor from error response data
 * @returns Parsed JSON response data
 */
async function apiCall<T = unknown>(
  url: string,
  options: RequestInit,
  actionName: string,
  extractError?: (data: Record<string, unknown>) => string | undefined,
): Promise<T> {
  log.debug(`API: ${actionName}`, { url });
  const response = await fetch(url, options);

  if (!response.ok) {
    const errorData = await response.json();
    const errorMessage = extractError
      ? extractError(errorData as Record<string, unknown>)
      : (errorData as Record<string, unknown>)["message"] as string | undefined;
    const finalMessage = errorMessage || `Failed to ${actionName.toLowerCase()}`;
    log.error(`API: ${actionName} failed`, { url, error: finalMessage });
    throw new Error(finalMessage);
  }

  const data = await response.json() as T;
  log.trace(`API: ${actionName} success`, { url });
  return data;
}

/**
 * Shortcut for a simple API call that returns true on success.
 * Used for actions that don't need response body data.
 */
async function apiAction(
  url: string,
  method: string,
  actionName: string,
): Promise<boolean> {
  await apiCall(url, { method }, actionName);
  return true;
}

/**
 * Shortcut for an API call with a JSON body that returns true on success.
 */
async function apiActionWithBody(
  url: string,
  method: string,
  body: unknown,
  actionName: string,
): Promise<boolean> {
  await apiCall(
    url,
    {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    },
    actionName,
  );
  return true;
}

// ─── Result types ─────────────────────────────────────────────────────────────

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
 * Result of setting pending values.
 */
export interface SetPendingResult {
  success: boolean;
}

/**
 * Result of an address comments action.
 */
export interface AddressCommentsResult {
  success: boolean;
  reviewCycle?: number;
  branch?: string;
}

// ─── API functions ────────────────────────────────────────────────────────────

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
 * Discard a loop's changes via the API.
 */
export async function discardLoopApi(loopId: string): Promise<boolean> {
  return apiAction(`/api/loops/${loopId}/discard`, "POST", "Discard loop");
}

/**
 * Delete a loop via the API.
 */
export async function deleteLoopApi(loopId: string): Promise<boolean> {
  return apiAction(`/api/loops/${loopId}`, "DELETE", "Delete loop");
}

/**
 * Purge a loop (permanently delete) via the API.
 */
export async function purgeLoopApi(loopId: string): Promise<boolean> {
  return apiAction(`/api/loops/${loopId}/purge`, "POST", "Purge loop");
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
  return apiAction(`/api/loops/${loopId}/mark-merged`, "POST", "Mark loop as merged");
}

/**
 * Set a pending prompt for a loop via the API.
 */
export async function setPendingPromptApi(
  loopId: string,
  prompt: string,
): Promise<boolean> {
  return apiActionWithBody(
    `/api/loops/${loopId}/pending-prompt`,
    "PUT",
    { prompt },
    "Set pending prompt",
  );
}

/**
 * Clear the pending prompt for a loop via the API.
 */
export async function clearPendingPromptApi(loopId: string): Promise<boolean> {
  return apiAction(`/api/loops/${loopId}/pending-prompt`, "DELETE", "Clear pending prompt");
}

/**
 * Send feedback to refine a plan via the API.
 */
export async function sendPlanFeedbackApi(
  loopId: string,
  feedback: string,
): Promise<boolean> {
  return apiActionWithBody(
    `/api/loops/${loopId}/plan/feedback`,
    "POST",
    { feedback },
    "Send plan feedback",
  );
}

/**
 * Accept a plan and start the loop execution via the API.
 */
export async function acceptPlanApi(loopId: string): Promise<boolean> {
  return apiAction(`/api/loops/${loopId}/plan/accept`, "POST", "Accept plan");
}

/**
 * Discard a plan and delete the loop via the API.
 */
export async function discardPlanApi(loopId: string): Promise<boolean> {
  return apiAction(`/api/loops/${loopId}/plan/discard`, "POST", "Discard plan");
}

/**
 * Set pending message and/or model for a loop via the API.
 * These values will be used for the next iteration instead of the default.
 */
export async function setPendingApi(
  loopId: string,
  options: { message?: string; model?: { providerID: string; modelID: string } },
): Promise<SetPendingResult> {
  await apiCall(
    `/api/loops/${loopId}/pending`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(options),
    },
    "Set pending values",
  );
  return { success: true };
}

/**
 * Clear all pending values (message and model) for a loop via the API.
 */
export async function clearPendingApi(loopId: string): Promise<boolean> {
  return apiAction(`/api/loops/${loopId}/pending`, "DELETE", "Clear pending values");
}

/**
 * Address reviewer comments on a pushed/merged loop via the API.
 */
export async function addressReviewCommentsApi(
  loopId: string,
  comments: string,
): Promise<AddressCommentsResult> {
  const data = await apiCall<{ reviewCycle: number; branch: string }>(
    `/api/loops/${loopId}/address-comments`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ comments }),
    },
    "Address comments",
    // Handle both error shapes:
    // - ErrorResponse: { error: string, message: string } (validation errors)
    // - AddressCommentsResponse: { success: false, error: string } (logical failures)
    (errorData) => (errorData["message"] as string) || (errorData["error"] as string),
  );
  return {
    success: true,
    reviewCycle: data.reviewCycle,
    branch: data.branch,
  };
}

// ─── Chat API functions ───────────────────────────────────────────────────────

/**
 * Create a new interactive chat via the API.
 */
export async function createChatApi(request: CreateChatRequest): Promise<Loop> {
  return apiCall<Loop>(
    "/api/loops/chat",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(request),
    },
    "Create chat",
  );
}

/**
 * Send a message to an interactive chat via the API.
 * Returns immediately after injection — does not wait for AI response.
 */
export async function sendChatMessageApi(
  loopId: string,
  message: string,
  model?: { providerID: string; modelID: string },
): Promise<SendChatMessageResponse> {
  return apiCall<SendChatMessageResponse>(
    `/api/loops/${loopId}/chat`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message, model }),
    },
    "Send chat message",
  );
}
