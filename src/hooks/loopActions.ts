/**
 * Shared loop action API functions.
 * These are the actual API calls used by both useLoops and useLoop hooks.
 */

import { createLogger } from "../lib/logger";
import { appFetch } from "../lib/public-path";
import type {
  Loop,
  CreateChatRequest,
  GenerateLoopTitleRequest,
  GenerateLoopTitleResponse,
  SendChatMessageResponse,
  SshSession,
  PlanAcceptResponse,
  PortForward,
} from "../types";

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
  const response = await appFetch(url, options);

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
  log.debug(`API: ${actionName} success`, { url });
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

export interface PurgeArchivedLoopsResult {
  success: boolean;
  workspaceId: string;
  totalArchived: number;
  purgedCount: number;
  purgedLoopIds: string[];
  failures: Array<{ loopId: string; error: string }>;
}

export interface CreatePortForwardRequest {
  remotePort: number;
}

/**
 * Result of accepting a plan.
 */
export type AcceptPlanResult =
  | {
      success: true;
      mode: "start_loop";
    }
  | {
      success: true;
      mode: "open_ssh";
      sshSession: SshSession;
    }
  | {
      success: false;
    };

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
 * Generate a loop title from a prompt via the API.
 */
export async function generateLoopTitleApi(request: GenerateLoopTitleRequest): Promise<string> {
  const data = await apiCall<GenerateLoopTitleResponse>(
    "/api/loops/title",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(request),
    },
    "Generate loop title",
    (errorData) => (errorData["message"] as string | undefined) ?? (errorData["error"] as string | undefined),
  );
  return data.title;
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
 * Purge all archived loops for a workspace via the API.
 */
export async function purgeArchivedWorkspaceLoopsApi(workspaceId: string): Promise<PurgeArchivedLoopsResult> {
  const data = await apiCall<{
    workspaceId: string;
    totalArchived: number;
    purgedCount: number;
    purgedLoopIds: string[];
    failures: Array<{ loopId: string; error: string }>;
  }>(
    `/api/workspaces/${workspaceId}/archived-loops/purge`,
    { method: "POST" },
    "Purge archived loops",
  );
  return {
    success: true,
    workspaceId: data.workspaceId,
    totalArchived: data.totalArchived,
    purgedCount: data.purgedCount,
    purgedLoopIds: data.purgedLoopIds,
    failures: data.failures,
  };
}

/**
 * Fetch a loop's linked SSH session via the API.
 */
export async function getLoopSshSessionApi(loopId: string): Promise<SshSession> {
  return apiCall<SshSession>(
    `/api/loops/${loopId}/ssh-session`,
    { method: "GET" },
    "Fetch loop SSH session",
  );
}

/**
 * Get or create a loop's linked SSH session via the API.
 */
export async function getOrCreateLoopSshSessionApi(loopId: string): Promise<SshSession> {
  return apiCall<SshSession>(
    `/api/loops/${loopId}/ssh-session`,
    { method: "POST" },
    "Connect loop SSH session",
  );
}

/**
 * List a loop's forwarded ports via the API.
 */
export async function listLoopPortForwardsApi(loopId: string): Promise<PortForward[]> {
  return apiCall<PortForward[]>(
    `/api/loops/${loopId}/port-forwards`,
    { method: "GET" },
    "List loop port forwards",
  );
}

/**
 * Create a loop port forward via the API.
 */
export async function createLoopPortForwardApi(
  loopId: string,
  request: CreatePortForwardRequest,
): Promise<PortForward> {
  return apiCall<PortForward>(
    `/api/loops/${loopId}/port-forwards`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(request),
    },
    "Create loop port forward",
  );
}

/**
 * Delete a loop port forward via the API.
 */
export async function deleteLoopPortForwardApi(loopId: string, forwardId: string): Promise<boolean> {
  return apiAction(
    `/api/loops/${loopId}/port-forwards/${forwardId}`,
    "DELETE",
    "Delete loop port forward",
  );
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

export async function answerPlanQuestionApi(
  loopId: string,
  answers: string[][],
): Promise<boolean> {
  return apiActionWithBody(
    `/api/loops/${loopId}/plan/question/answer`,
    "POST",
    { answers },
    "Answer plan question",
  );
}

/**
 * Accept a plan and start the loop execution via the API.
 */
export async function acceptPlanApi(
  loopId: string,
  mode: "start_loop" | "open_ssh" = "start_loop",
): Promise<AcceptPlanResult> {
  const data = await apiCall<PlanAcceptResponse>(
    `/api/loops/${loopId}/plan/accept`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mode }),
    },
    "Accept plan",
  );
  if (data.mode === "open_ssh") {
    return {
      success: true,
      mode: data.mode,
      sshSession: data.sshSession,
    };
  }
  return {
    success: true,
    mode: data.mode,
  };
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

/**
 * Start a new feedback cycle from a restartable terminal state.
 */
export async function sendFollowUpApi(
  loopId: string,
  message: string,
  model?: { providerID: string; modelID: string },
): Promise<boolean> {
  return apiActionWithBody(
    `/api/loops/${loopId}/follow-up`,
    "POST",
    { message, model },
    "Send follow-up",
  );
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
