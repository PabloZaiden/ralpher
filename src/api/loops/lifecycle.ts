/**
 * Loops control routes (accept, discard, push, draft/start, plan, pending-prompt, mark-merged).
 *
 * Note: Loops are automatically started during creation (unless draft mode is used).
 * These endpoints control loop lifecycle after creation:
 * - POST /api/loops/:id/draft/start - Start a draft loop
 * - POST /api/loops/:id/accept - Accept and merge a completed loop
 * - POST /api/loops/:id/push - Push branch to remote for PR workflow
 * - POST /api/loops/:id/discard - Discard and delete git branch
 * - POST /api/loops/:id/purge - Permanently delete from storage
 * - POST /api/loops/:id/mark-merged - Mark as merged and sync with remote
 * - PUT/DELETE /api/loops/:id/pending-prompt - Modify next iteration prompt
 * - POST /api/loops/:id/plan/feedback - Send feedback on plan
 * - POST /api/loops/:id/plan/accept - Accept plan and start execution
 * - POST /api/loops/:id/plan/discard - Discard plan and delete loop
 */

import { loopManager } from "../../core/loop-manager";
import { sshSessionManager } from "../../core/ssh-session-manager";
import { portForwardManager } from "../../core/port-forward-manager";
import { createLogger } from "../../core/logger";
import type { AcceptResponse, PushResponse, PlanAcceptResponse } from "../../types/api";
import { parseAndValidate, validateRequest } from "../validation";
import { errorResponse, successResponse } from "../helpers";
import type { z } from "zod";
import {
  StartDraftRequestSchema,
  PendingPromptRequestSchema,
  SetPendingRequestSchema,
  PlanFeedbackRequestSchema,
  PlanAcceptRequestSchema,
  AnswerPlanQuestionRequestSchema,
  FollowUpRequestSchema,
  CreatePortForwardRequestSchema,
} from "../../types/schemas";
import { validateEnabledModelForLoop, startErrorResponse } from "./helpers";

const log = createLogger("api:loops");

function mapLoopSshSessionError(error: unknown): Response {
  const message = String(error);
  if (message.includes("Loop not found")) {
    return errorResponse("not_found", "Loop not found", 404);
  }
  if (
    message.includes("ssh transport")
    || message.includes("dtach is not available")
    || message.includes("Loop working directory is not available")
  ) {
    return errorResponse("invalid_session_configuration", message, 400);
  }
  return errorResponse("ssh_session_error", message, 500);
}

function mapLoopPortForwardError(error: unknown): Response {
  const message = error instanceof Error ? error.message : String(error);
  if (message.includes("Loop not found")) {
    return errorResponse("not_found", "Loop not found", 404);
  }
  if (message.includes("Port forward not found")) {
    return errorResponse("not_found", "Port forward not found", 404);
  }
  if (message.includes("already being forwarded for this workspace")) {
    return errorResponse("duplicate_port_forward", message, 409);
  }
  if (message.includes("ssh transport")) {
    return errorResponse("invalid_port_forward_configuration", message, 400);
  }
  return errorResponse("port_forward_error", message, 500);
}

export const loopsControlRoutes = {
  "/api/loops/:id/draft/start": {
    /**
     * POST /api/loops/:id/draft/start - Start a draft loop.
     *
     * Transitions a draft loop to either planning mode or immediate execution.
     * Each loop operates in its own worktree, so no uncommitted-changes checks are needed.
     *
     * Request Body:
     * - planMode (required): If true, start in plan mode; if false, start immediately
     *
     * Errors:
     * - 400: Loop is not in draft status or invalid body
     * - 404: Loop not found
     *
     * @returns Updated Loop object
     */
    async POST(req: Request & { params: { id: string } }): Promise<Response> {
      // Parse and validate request body using Zod schema
      const validation = await parseAndValidate(StartDraftRequestSchema, req);
      if (!validation.success) {
        return validation.response;
      }
      const body = validation.data;

      // Load the loop
      const loop = await loopManager.getLoop(req.params.id);
      if (!loop) {
        return errorResponse("not_found", "Loop not found", 404);
      }

      // Verify it's a draft
      if (loop.state.status !== "draft") {
        return errorResponse("not_draft", "Loop is not in draft status", 400);
      }

      // With worktrees, each loop operates in its own isolated directory.
      // No need to check for active loops or uncommitted changes.

      // Delegate the draft → start transition to LoopManager
      try {
        const updatedLoop = await loopManager.startDraft(req.params.id, {
          planMode: body.planMode,
        });
        return Response.json(updatedLoop);
      } catch (startError) {
        return startErrorResponse(
          startError,
          body.planMode ? "start_plan_failed" : "start_failed",
          body.planMode ? "Failed to start plan mode" : "Failed to start loop",
        );
      }
    },
  },

  "/api/loops/:id/accept": {
    /**
     * POST /api/loops/:id/accept - Accept and merge a completed loop.
     *
     * Merges the loop's working branch into the original branch.
     * Only works for loops in completed or max_iterations status.
     * After merge, the loop status changes to `merged`.
     *
     * @returns AcceptResponse with success and mergeCommit SHA
     */
    async POST(req: Request & { params: { id: string } }): Promise<Response> {
      log.debug("POST /api/loops/:id/accept", { loopId: req.params.id });
      const result = await loopManager.acceptLoop(req.params.id);

      if (!result.success) {
        log.warn("POST /api/loops/:id/accept - Failed", { loopId: req.params.id, error: result.error });
        if (result.error?.includes("not found")) {
          return errorResponse("not_found", "Loop not found", 404);
        }
        return errorResponse("accept_failed", result.error ?? "Unknown error", 400);
      }

      log.info("POST /api/loops/:id/accept - Loop accepted", { loopId: req.params.id, mergeCommit: result.mergeCommit });
      const response: AcceptResponse = {
        success: true,
        mergeCommit: result.mergeCommit!,
      };
      return Response.json(response);
    },
  },

  "/api/loops/:id/push": {
    /**
     * POST /api/loops/:id/push - Push a completed loop's branch to remote.
     *
     * Pushes the loop's working branch to the remote repository for PR workflow.
     * Only works for loops in completed or max_iterations status.
     * After push, the loop status changes to `pushed` and can receive review comments.
     *
     * @returns PushResponse with success and remoteBranch name
     */
    async POST(req: Request & { params: { id: string } }): Promise<Response> {
      log.debug("POST /api/loops/:id/push", { loopId: req.params.id });
      const result = await loopManager.pushLoop(req.params.id);

      if (!result.success) {
        log.warn("POST /api/loops/:id/push - Failed", { loopId: req.params.id, error: result.error });
        if (result.error?.includes("not found")) {
          return errorResponse("not_found", "Loop not found", 404);
        }
        return errorResponse("push_failed", result.error ?? "Unknown error", 400);
      }

      log.info("POST /api/loops/:id/push - Loop pushed", { loopId: req.params.id, remoteBranch: result.remoteBranch, syncStatus: result.syncStatus });
      const syncStatus = result.syncStatus ?? "already_up_to_date";
      let response: PushResponse;
      if (syncStatus === "conflicts_being_resolved") {
        response = { success: true, syncStatus };
      } else {
        response = { success: true, remoteBranch: result.remoteBranch!, syncStatus };
      }
      return Response.json(response);
    },
  },

  "/api/loops/:id/update-branch": {
    /**
     * POST /api/loops/:id/update-branch - Update a pushed loop's branch by syncing with the base branch.
     *
     * Pulls and merges from the base branch into the working branch, then re-pushes.
     * Only works for loops in `pushed` status.
     * If the merge is clean, pushes immediately and the loop remains in `pushed` status.
     * If there are conflicts, starts a conflict resolution engine and auto-pushes on completion.
     *
     * @returns PushResponse with success and sync status
     */
    async POST(req: Request & { params: { id: string } }): Promise<Response> {
      log.debug("POST /api/loops/:id/update-branch", { loopId: req.params.id });
      const result = await loopManager.updateBranch(req.params.id);

      if (!result.success) {
        log.warn("POST /api/loops/:id/update-branch - Failed", { loopId: req.params.id, error: result.error });
        if (result.error?.includes("not found")) {
          return errorResponse("not_found", "Loop not found", 404);
        }
        return errorResponse("update_branch_failed", result.error ?? "Unknown error", 400);
      }

      log.info("POST /api/loops/:id/update-branch - Branch updated", { loopId: req.params.id, remoteBranch: result.remoteBranch, syncStatus: result.syncStatus });
      const syncStatus = result.syncStatus ?? "already_up_to_date";
      let response: PushResponse;
      if (syncStatus === "conflicts_being_resolved") {
        response = { success: true, syncStatus };
      } else {
        response = { success: true, remoteBranch: result.remoteBranch!, syncStatus };
      }
      return Response.json(response);
    },
  },

  "/api/loops/:id/discard": {
    /**
     * POST /api/loops/:id/discard - Discard a loop and delete its git branch.
     *
     * Deletes the loop's working branch and marks the loop as deleted.
     * After discard, the loop can be purged to permanently remove it.
     *
     * @returns Success response
     */
    async POST(req: Request & { params: { id: string } }): Promise<Response> {
      log.debug("POST /api/loops/:id/discard", { loopId: req.params.id });
      const result = await loopManager.discardLoop(req.params.id);

      if (!result.success) {
        log.warn("POST /api/loops/:id/discard - Failed", { loopId: req.params.id, error: result.error });
        if (result.error?.includes("not found")) {
          return errorResponse("not_found", "Loop not found", 404);
        }
        return errorResponse("discard_failed", result.error ?? "Unknown error", 400);
      }

      log.info("POST /api/loops/:id/discard - Loop discarded", { loopId: req.params.id });
      return successResponse();
    },
  },

  "/api/loops/:id/purge": {
    /**
     * POST /api/loops/:id/purge - Permanently delete a loop from storage.
     *
     * Removes the loop from the database entirely. Drafts are removed immediately.
     * Other loops only work in final states (merged, pushed, deleted).
     *
     * @returns Success response
     */
    async POST(req: Request & { params: { id: string } }): Promise<Response> {
      log.debug("POST /api/loops/:id/purge", { loopId: req.params.id });
      const result = await loopManager.purgeLoop(req.params.id);

      if (!result.success) {
        log.warn("POST /api/loops/:id/purge - Failed", { loopId: req.params.id, error: result.error });
        if (result.error?.includes("not found")) {
          return errorResponse("not_found", "Loop not found", 404);
        }
        return errorResponse("purge_failed", result.error ?? "Unknown error", 400);
      }

      log.info("POST /api/loops/:id/purge - Loop purged", { loopId: req.params.id });

      return successResponse();
    },
  },

  "/api/loops/:id/ssh-session": {
    async GET(req: Request & { params: { id: string } }): Promise<Response> {
      try {
        const loop = await loopManager.getLoop(req.params.id);
        if (!loop) {
          return errorResponse("not_found", "Loop not found", 404);
        }

        const session = await sshSessionManager.getSessionByLoopId(req.params.id);
        if (!session) {
          return errorResponse("not_found", "SSH session not found for loop", 404);
        }

        return Response.json(session);
      } catch (error) {
        log.error("GET /api/loops/:id/ssh-session - Failed", {
          loopId: req.params.id,
          error: String(error),
        });
        return mapLoopSshSessionError(error);
      }
    },

    async POST(req: Request & { params: { id: string } }): Promise<Response> {
      try {
        const session = await sshSessionManager.getOrCreateLoopSession(req.params.id);
        return Response.json(session);
      } catch (error) {
        log.error("POST /api/loops/:id/ssh-session - Failed", {
          loopId: req.params.id,
          error: String(error),
        });
        return mapLoopSshSessionError(error);
      }
    },
  },

  "/api/loops/:id/port-forwards": {
    async GET(req: Request & { params: { id: string } }): Promise<Response> {
      try {
        const loop = await loopManager.getLoop(req.params.id);
        if (!loop) {
          return errorResponse("not_found", "Loop not found", 404);
        }

        const forwards = await portForwardManager.listLoopPortForwards(req.params.id);
        return Response.json(forwards);
      } catch (error) {
        log.error("GET /api/loops/:id/port-forwards - Failed", {
          loopId: req.params.id,
          error: String(error),
        });
        return mapLoopPortForwardError(error);
      }
    },

    async POST(req: Request & { params: { id: string } }): Promise<Response> {
      const validation = await parseAndValidate(CreatePortForwardRequestSchema, req);
      if (!validation.success) {
        return validation.response;
      }

      try {
        const forward = await portForwardManager.createLoopPortForward({
          loopId: req.params.id,
          remotePort: validation.data.remotePort,
        });
        return Response.json(forward, { status: 201 });
      } catch (error) {
        log.error("POST /api/loops/:id/port-forwards - Failed", {
          loopId: req.params.id,
          error: String(error),
        });
        return mapLoopPortForwardError(error);
      }
    },
  },

  "/api/loops/:id/port-forwards/:forwardId": {
    async DELETE(req: Request & { params: { id: string; forwardId: string } }): Promise<Response> {
      try {
        const forward = await portForwardManager.getPortForward(req.params.forwardId);
        if (!forward || forward.config.loopId !== req.params.id) {
          return errorResponse("not_found", "Port forward not found", 404);
        }

        await portForwardManager.deletePortForward(req.params.forwardId);
        return successResponse();
      } catch (error) {
        log.error("DELETE /api/loops/:id/port-forwards/:forwardId - Failed", {
          loopId: req.params.id,
          forwardId: req.params.forwardId,
          error: String(error),
        });
        return mapLoopPortForwardError(error);
      }
    },
  },

  "/api/loops/:id/mark-merged": {
    /**
     * POST /api/loops/:id/mark-merged - Mark an externally merged loop as merged.
     *
     * Transitions the loop to `merged` status, clears reviewMode.addressable,
     * and disconnects the backend. Because loops may run in dedicated worktrees,
     * cleanup is deferred to the normal purge/discard flow instead of assuming
     * immediate branch teardown here.
     *
     * This is useful when a loop's branch was merged externally (e.g., via GitHub PR)
     * and the user wants to sync the loop's status with that merged result.
     *
     * Only works for loops in final states (pushed, merged, completed, max_iterations).
     *
     * @returns Success response
     */
    async POST(req: Request & { params: { id: string } }): Promise<Response> {
      const result = await loopManager.markMerged(req.params.id);

      if (!result.success) {
        if (result.error?.includes("not found")) {
          return errorResponse("not_found", "Loop not found", 404);
        }
        return errorResponse("mark_merged_failed", result.error ?? "Unknown error", 400);
      }

      return successResponse();
    },
  },

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

  "/api/loops/:id/plan/feedback": {
    /**
     * POST /api/loops/:id/plan/feedback - Send feedback to refine the plan.
     *
     * Sends user feedback to the AI to refine the plan during planning phase.
     * If the AI is currently generating, the session is aborted immediately and
     * the feedback is injected into the next iteration. If the AI is idle (plan
     * was ready), a new plan iteration is started.
     *
     * Increments the feedback round counter. Only works for loops in planning status.
     * Returns immediately after setting up the injection — does not wait for
     * the iteration to complete.
     *
     * Request Body:
     * - feedback (required): User's feedback/comments on the plan
     *
     * @returns Success response
     */
    async POST(req: Request & { params: { id: string } }): Promise<Response> {
      // Parse and validate request body using Zod schema
      const validation = await parseAndValidate(PlanFeedbackRequestSchema, req);
      if (!validation.success) {
        return validation.response;
      }
      const body = validation.data;

      try {
        await loopManager.sendPlanFeedback(req.params.id, body.feedback);
        return successResponse();
      } catch (error) {
        const errorMsg = String(error);
        if (errorMsg.includes("not running") || errorMsg.includes("not found")) {
          return errorResponse("not_running", errorMsg, 409);
        }
        if (errorMsg.includes("not in planning status")) {
          return errorResponse("not_planning", errorMsg, 400);
        }
        return errorResponse("feedback_failed", errorMsg, 500);
      }
    },
  },

  "/api/loops/:id/plan/accept": {
    /**
     * POST /api/loops/:id/plan/accept - Accept the plan and either start execution or open SSH.
     *
     * Accepts the current plan and transitions the loop from planning status
     * to running or completed, depending on the chosen acceptance mode.
     * Only works for loops in planning status.
     *
     * @returns Success response
     */
    async POST(req: Request & { params: { id: string } }): Promise<Response> {
      try {
        const bodyText = await req.text();
        let body: z.infer<typeof PlanAcceptRequestSchema> = {};

        if (bodyText.trim()) {
          let bodyJson: unknown;
          try {
            bodyJson = JSON.parse(bodyText);
          } catch {
            return errorResponse("invalid_json", "Request body must be valid JSON", 400);
          }

          const validationResult = validateRequest(PlanAcceptRequestSchema, bodyJson);
          if (!validationResult.success) {
            return validationResult.response;
          }
          body = validationResult.data;
        }

        const result = await loopManager.acceptPlan(req.params.id, {
          mode: body.mode,
        });
        const response: PlanAcceptResponse = result.mode === "open_ssh"
          ? { success: true, mode: result.mode, sshSession: result.sshSession }
          : { success: true, mode: result.mode };
        return Response.json(response);
      } catch (error) {
        const errorMsg = String(error);
        if (errorMsg.includes("not running")) {
          return errorResponse("not_running", errorMsg, 409);
        }
        if (errorMsg.includes("not in planning status")) {
          return errorResponse("not_planning", errorMsg, 400);
        }
        if (errorMsg.includes("Plan is not ready yet")) {
          return errorResponse("plan_not_ready", errorMsg, 400);
        }
        return errorResponse("accept_failed", errorMsg, 500);
      }
    },
  },

  "/api/loops/:id/plan/question/answer": {
    async POST(req: Request & { params: { id: string } }): Promise<Response> {
      const validation = await parseAndValidate(AnswerPlanQuestionRequestSchema, req);
      if (!validation.success) {
        return validation.response;
      }

      try {
        await loopManager.answerPendingPlanQuestion(req.params.id, validation.data.answers);
        return successResponse();
      } catch (error) {
        const errorMsg = String(error);
        if (errorMsg.includes("There is no pending plan question")) {
          return errorResponse("no_pending_plan_question", errorMsg, 409);
        }
        if (errorMsg.includes("not in planning status")) {
          return errorResponse("not_planning", errorMsg, 400);
        }
        if (errorMsg.includes("Expected ")) {
          return errorResponse("invalid_question_answer", errorMsg, 400);
        }
        return errorResponse("answer_plan_question_failed", errorMsg, 500);
      }
    },
  },

  "/api/loops/:id/plan/discard": {
    /**
     * POST /api/loops/:id/plan/discard - Discard the plan and delete the loop.
     *
     * Discards the plan and deletes the loop entirely. This is a shortcut
     * for discarding during plan review without executing anything.
     *
     * @returns Success response
     */
    async POST(req: Request & { params: { id: string } }): Promise<Response> {
      try {
        const deleted = await loopManager.discardPlan(req.params.id);
        if (!deleted) {
          return errorResponse("not_found", "Loop not found", 404);
        }
        return successResponse();
      } catch (error) {
        return errorResponse("discard_failed", String(error), 500);
      }
    },
  },
};
