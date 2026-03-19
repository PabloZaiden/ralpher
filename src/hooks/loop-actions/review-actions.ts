/**
 * Review-related loop actions: address comments, send follow-up.
 */

import { apiCall, apiActionWithBody } from "./helpers";
import type { MessageImageAttachment } from "../../types/message-attachments";

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
  comments: string,
  attachments?: MessageImageAttachment[],
): Promise<AddressCommentsResult> {
  const data = await apiCall<{ reviewCycle: number; branch: string }>(
    `/api/loops/${loopId}/address-comments`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ comments, attachments }),
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
  attachments?: MessageImageAttachment[],
): Promise<boolean> {
  return apiActionWithBody(
    `/api/loops/${loopId}/follow-up`,
    "POST",
    { message, model, attachments },
    "Send follow-up",
  );
}
