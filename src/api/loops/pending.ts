/**
 * Loop pending prompt and follow-up routes.
 *
 * - PUT/DELETE /api/loops/:id/pending-prompt - Modify the next iteration's prompt
 * - POST/DELETE /api/loops/:id/pending      - Set or clear pending message and/or model
 * - POST /api/loops/:id/follow-up           - Start a new feedback cycle from a terminal state
 */

import { loopManager } from "../../core/loop-manager";
import { parseAndValidate } from "../validation";
import { errorResponse, successResponse } from "../helpers";
import {
  PendingPromptRequestSchema,
  SetPendingRequestSchema,
  FollowUpRequestSchema,
} from "../../types/schemas";
import { validateEnabledModelForLoop } from "./helpers";

export const loopsPendingRoutes = {
  "/api/loops/:id/pending-prompt": {
    /**
     * PUT /api/loops/:id/pending-prompt - Set the pending prompt for next iteration.
     *
     * Sets a custom prompt that will be used for the next iteration only.
     * The prompt replaces the default config.prompt for one iteration.
     * Only works while the loop is active.
     *
     * Request Body:
     * - prompt (required): The prompt text for the next iteration
     *
     * @returns Success response
     */
    async PUT(req: Request & { params: { id: string } }): Promise<Response> {
      // Parse and validate request body using Zod schema
      const validation = await parseAndValidate(PendingPromptRequestSchema, req);
      if (!validation.success) {
        return validation.response;
      }
      const body = validation.data;

      const result = await loopManager.setPendingPrompt(req.params.id, body.prompt);

      if (!result.success) {
        if (result.error?.includes("not found")) {
          return errorResponse("not_found", "Loop not found", 404);
        }
        if (result.error?.includes("not running")) {
          return errorResponse("not_running", result.error, 409);
        }
        return errorResponse("set_pending_prompt_failed", result.error ?? "Unknown error", 400);
      }

      return successResponse();
    },

    /**
     * DELETE /api/loops/:id/pending-prompt - Clear the pending prompt.
     *
     * Removes the pending prompt so the next iteration uses the default
     * config.prompt instead. Only works while the loop is active.
     *
     * @returns Success response
     */
    async DELETE(req: Request & { params: { id: string } }): Promise<Response> {
      const result = await loopManager.clearPendingPrompt(req.params.id);

      if (!result.success) {
        if (result.error?.includes("not found")) {
          return errorResponse("not_found", "Loop not found", 404);
        }
        if (result.error?.includes("not running")) {
          return errorResponse("not_running", result.error, 409);
        }
        return errorResponse("clear_pending_prompt_failed", result.error ?? "Unknown error", 400);
      }

      return successResponse();
    },
  },

  "/api/loops/:id/pending": {
    /**
     * POST /api/loops/:id/pending - Set pending message and/or model for next iteration.
     *
     * Queues a message and/or model change. By default (`immediate: true`), running
     * ACP-backed loops prefer staying on the active session and applying the pending
     * values on the very next iteration without interrupting the current turn. If the
     * backend cannot support that flow, it falls back to interrupting the current
     * iteration. Set `immediate: false` to wait for the current iteration to complete.
     * Works for active loops (running, waiting, planning, starting) and can also
     * jumpstart loops in supported stopped states (completed, stopped, failed, max_iterations).
     *
     * Request Body:
     * - message (optional): Message to queue for next iteration
     * - model (optional): { providerID, modelID } for model change
     * - immediate (optional, default: true): If true, interrupt current iteration
     *   and apply pending values immediately. If false, wait for current iteration.
     *
     * At least one of message or model must be provided.
     *
     * @returns Success response
     */
    async POST(req: Request & { params: { id: string } }): Promise<Response> {
      // Parse and validate request body using Zod schema
      const validation = await parseAndValidate(SetPendingRequestSchema, req);
      if (!validation.success) {
        return validation.response;
      }
      const body = validation.data;

      // At least one of message or model must be provided
      if (body.message === undefined && body.model === undefined) {
        return errorResponse("validation_error", "At least one of 'message' or 'model' must be provided");
      }

      // Trim message if provided and validate non-empty
      let trimmedMessage: string | undefined;
      if (body.message !== undefined) {
        trimmedMessage = body.message.trim();
        if (trimmedMessage === "") {
          return errorResponse("validation_error", "'message' must be a non-empty string");
        }
      }

      // Validate model is enabled before allowing the change
      if (body.model !== undefined) {
        const modelError = await validateEnabledModelForLoop(req.params.id, body.model);
        if (modelError) {
          return modelError;
        }
      }

      // Default to immediate: true (Zod already validated the type)
      const immediate = body.immediate ?? true;

      let result: { success: boolean; error?: string };
      if (immediate) {
        // Inject immediately by aborting current iteration
        result = await loopManager.injectPending(req.params.id, {
          message: trimmedMessage,
          model: body.model,
        });
      } else {
        // Queue for next natural iteration
        result = await loopManager.setPending(req.params.id, {
          message: trimmedMessage,
          model: body.model,
        });
      }

      if (!result.success) {
        if (result.error?.includes("not found")) {
          return errorResponse("not_found", "Loop not found", 404);
        }
        if (result.error?.includes("not running") || result.error?.includes("not in an active state")) {
          return errorResponse("not_running", result.error, 409);
        }
        return errorResponse("set_pending_failed", result.error ?? "Unknown error", 400);
      }

      return successResponse();
    },

    /**
     * DELETE /api/loops/:id/pending - Clear all pending values (message and model).
     *
     * Removes any queued message and model change. Only works for active loops.
     *
     * @returns Success response
     */
    async DELETE(req: Request & { params: { id: string } }): Promise<Response> {
      const result = await loopManager.clearPending(req.params.id);

      if (!result.success) {
        if (result.error?.includes("not found")) {
          return errorResponse("not_found", "Loop not found", 404);
        }
        if (result.error?.includes("not running") || result.error?.includes("not in an active state")) {
          return errorResponse("not_running", result.error, 409);
        }
        return errorResponse("clear_pending_failed", result.error ?? "Unknown error", 400);
      }

      return successResponse();
    },
  },

  "/api/loops/:id/follow-up": {
    /**
     * POST /api/loops/:id/follow-up - Start a new feedback cycle from a restartable terminal state.
     */
    async POST(req: Request & { params: { id: string } }): Promise<Response> {
      const validation = await parseAndValidate(FollowUpRequestSchema, req);
      if (!validation.success) {
        return validation.response;
      }
      const body = validation.data;

      if (body.model !== undefined) {
        const modelError = await validateEnabledModelForLoop(req.params.id, body.model);
        if (modelError) {
          return modelError;
        }
      }

      const result = await loopManager.sendFollowUp(req.params.id, {
        message: body.message.trim(),
        model: body.model,
      });
      if (!result.success) {
        if (result.error?.includes("not found")) {
          return errorResponse("not_found", "Loop not found", 404);
        }
        return errorResponse("invalid_state", result.error ?? "Loop cannot accept a terminal follow-up", 400);
      }

      return successResponse();
    },
  },
};
