/**
 * Loops API endpoints for Ralph Loops Management System.
 * 
 * This module provides comprehensive CRUD operations and lifecycle control for Ralph Loops:
 * - CRUD: Create, read, update, and delete loops
 * - Control: Accept, push, discard, and purge completed loops
 * - Plan Mode: Create, review, and accept plans before execution
 * - Review: Address reviewer comments on pushed/merged loops
 * - Data: Access loop diffs, plans, and status files
 * 
 * Uses the CommandExecutor abstraction over the configured execution channel:
 * - local provider: commands run on the Ralpher host
 * - ssh provider: commands run on the remote workspace host
 * 
 * @module api/loops
 */

import { loopManager } from "../core/loop-manager";
import { backendManager } from "../core/backend-manager";
import { GitService } from "../core/git-service";
import { getWorkspaceByDirectory, getWorkspace, touchWorkspace } from "../persistence/workspaces";
import { createLogger } from "../core/logger";

const log = createLogger("api:loops");
import { isModelEnabled } from "./models";
import type {
  AcceptResponse,
  PushResponse,
  FileContentResponse,
  AddressCommentsResponse,
  ReviewHistoryResponse,
  GetCommentsResponse,
  SendChatMessageResponse,
} from "../types/api";
import { parseAndValidate } from "./validation";
import { errorResponse, successResponse } from "./helpers";
import type { LoopConfig, Loop } from "../types/loop";
import type { z } from "zod";
import {
  CreateLoopRequestSchema,
  UpdateLoopRequestSchema,
  StartDraftRequestSchema,
  PendingPromptRequestSchema,
  SetPendingRequestSchema,
  PlanFeedbackRequestSchema,
  AddressCommentsRequestSchema,
  CreateChatRequestSchema,
  SendChatMessageRequestSchema,
} from "../types/schemas";

/**
 * Transform a validated update request body into LoopConfig updates and apply them.
 * Shared by PATCH and PUT handlers to eliminate duplication.
 *
 * @returns Response with the updated loop or an error response
 */
async function applyLoopUpdates(
  loopId: string,
  body: z.infer<typeof UpdateLoopRequestSchema>,
  currentLoop: Loop,
): Promise<Response> {
  try {
    const updates: Partial<Omit<LoopConfig, "id" | "createdAt">> = {};

    if (body.name !== undefined) {
      const trimmedName = body.name.trim();
      if (trimmedName === "") {
        return errorResponse("validation_error", "Name cannot be empty");
      }
      updates.name = trimmedName;
    }
    if (body.directory !== undefined) updates.directory = body.directory;
    if (body.prompt !== undefined) updates.prompt = body.prompt;
    if (body.maxIterations !== undefined) updates.maxIterations = body.maxIterations;
    if (body.maxConsecutiveErrors !== undefined) updates.maxConsecutiveErrors = body.maxConsecutiveErrors;
    if (body.activityTimeoutSeconds !== undefined) updates.activityTimeoutSeconds = body.activityTimeoutSeconds;
    if (body.stopPattern !== undefined) updates.stopPattern = body.stopPattern;
    if (body.baseBranch !== undefined) updates.baseBranch = body.baseBranch;
    if (body.clearPlanningFolder !== undefined) updates.clearPlanningFolder = body.clearPlanningFolder;
    if (body.planMode !== undefined) updates.planMode = body.planMode;

    if (body.model !== undefined) {
      updates.model = {
        providerID: body.model.providerID,
        modelID: body.model.modelID,
        variant: body.model.variant,
      };
    }

    if (body.git !== undefined) {
      updates.git = {
        branchPrefix: body.git.branchPrefix ?? currentLoop.config.git.branchPrefix,
        commitScope: body.git.commitScope ?? currentLoop.config.git.commitScope,
      };
    }

    const updatedLoop = await loopManager.updateLoop(loopId, updates);
    return Response.json(updatedLoop);
  } catch (error) {
    const errorMessage = String(error);
    if (error instanceof Error) {
      const code = (error as Error & { code?: string }).code;
      const status = (error as Error & { status?: number }).status;
      if (code === "BASE_BRANCH_IMMUTABLE") {
        return errorResponse("base_branch_immutable", errorMessage, status ?? 409);
      }
    }
    return errorResponse("update_failed", errorMessage, 500);
  }
}

/**
 * Loops CRUD routes.
 * 
 * Provides endpoints for creating, reading, updating, and deleting loops:
 * - GET /api/loops - List all loops
 * - POST /api/loops - Create a new loop (auto-starts unless draft mode)
 * - GET /api/loops/:id - Get a specific loop
 * - PATCH /api/loops/:id - Update any loop's configuration
 * - PUT /api/loops/:id - Update a draft loop's configuration
 * - DELETE /api/loops/:id - Delete a loop
 * - GET /api/loops/:id/comments - Get all review comments for a loop
 */
export const loopsCrudRoutes = {
  "/api/loops": {
    /**
     * GET /api/loops - List all loops.
     * 
     * Returns all loops with their configurations and current states.
     * Loops are returned regardless of status (idle, running, completed, etc.).
     * 
     * Query Parameters:
     * - mode (optional): Filter by mode ("loop" or "chat")
     * 
     * @returns Array of Loop objects with config and state
     */
    async GET(req: Request): Promise<Response> {
      log.debug("GET /api/loops - Listing all loops");
      let loops = await loopManager.getAllLoops();

      // Apply optional mode filter
      const url = new URL(req.url);
      const modeFilter = url.searchParams.get("mode");
      if (modeFilter === "loop" || modeFilter === "chat") {
        loops = loops.filter((loop) => loop.config.mode === modeFilter);
      }

      log.trace("GET /api/loops - Retrieved loops", { count: loops.length, modeFilter });
      return Response.json(loops);
    },

    /**
     * POST /api/loops - Create a new loop.
     * 
     * Creates a new Ralph Loop with the specified configuration. The loop is
     * automatically started unless `draft: true` is specified.
     * 
     * The loop name is automatically generated from the prompt using AI.
     * 
     * Request Body Fields:
     * - directory (required): Absolute path to working directory
     * - prompt (required): Task prompt/PRD
     * - model: { providerID, modelID } for AI model selection
     * - maxIterations: Maximum iterations (unlimited if not set)
     * - maxConsecutiveErrors: Max identical errors before failsafe (default: 10)
     * - activityTimeoutSeconds: Seconds without events before error (default: 900, min: 60)
     * - stopPattern: Regex for completion detection
     * - git: { branchPrefix, commitScope } for git integration
     * - baseBranch: Base branch to create loop from
     * - clearPlanningFolder: Clear .planning folder before starting
     * - planMode: Start in plan creation mode
     * - draft: Save as draft without starting
     * 
      * Errors:
      * - 400: Validation error or invalid JSON body
      * - 500: Loop created but failed to start
     * 
     * @returns Created Loop object with 201 status
     */
    async POST(req: Request): Promise<Response> {
      log.debug("POST /api/loops - Creating new loop");
      
      // Parse and validate request body using Zod schema
      const validation = await parseAndValidate(CreateLoopRequestSchema, req);
      if (!validation.success) {
        log.warn("POST /api/loops - Validation error");
        return validation.response;
      }
      const body = validation.data;
      
      log.trace("POST /api/loops - Request validated", { 
        workspaceId: body.workspaceId, 
        planMode: body.planMode, 
        draft: body.draft,
        hasModel: !!body.model 
      });

      // Resolve workspaceId to directory - workspaceId is required
      const workspace = await getWorkspace(body.workspaceId);
      if (!workspace) {
        return errorResponse("workspace_not_found", `Workspace not found: ${body.workspaceId}`, 404);
      }
      const directory = workspace.directory;
      const workspaceId = body.workspaceId;
      
      // Touch workspace to update last used timestamp
      await touchWorkspace(workspace.id);

      // Create a single executor/GitService for the request to avoid duplicate setup
      let git: GitService | null = null;
      const getGitService = async (): Promise<GitService> => {
        if (!git) {
          const executor = await backendManager.getCommandExecutorAsync(workspaceId, directory!);
          git = GitService.withExecutor(executor);
        }
        return git;
      };

      // With worktrees, each loop operates in its own isolated directory.
      // No need to check for uncommitted changes or active loops in the main repo.

      // Validate model is enabled if provided
      // All loops (including drafts) require a connected model to ensure valid configurations
      // NOTE: This is done AFTER body validation to avoid backend connection costs
      // for requests that will be rejected anyway (invalid body, missing fields)
      if (body.model?.providerID && body.model?.modelID) {
        const modelValidation = await isModelEnabled(
          workspaceId,
          directory,
          body.model.providerID,
          body.model.modelID
        );
        if (!modelValidation.enabled) {
          return errorResponse(
            modelValidation.errorCode ?? "model_not_enabled",
            modelValidation.error ?? "The selected model is not available"
          );
        }
      }

      // Auto-detect default branch if baseBranch not provided
      let effectiveBaseBranch = body.baseBranch;
      if (!effectiveBaseBranch) {
        try {
          const gitService = await getGitService();
          effectiveBaseBranch = await gitService.getDefaultBranch(directory);
          log.debug(`Auto-detected default branch for loop: ${effectiveBaseBranch}`);
        } catch (error) {
          log.warn(`Failed to detect default branch, will fall back to current branch: ${String(error)}`);
          // Continue without baseBranch - loop engine will use current branch as fallback
        }
      }

      try {
        const loop = await loopManager.createLoop({
          directory,
          prompt: body.prompt,
          workspaceId,
          modelProviderID: body.model?.providerID,
          modelID: body.model?.modelID,
          modelVariant: body.model?.variant,
          maxIterations: body.maxIterations,
          maxConsecutiveErrors: body.maxConsecutiveErrors,
          activityTimeoutSeconds: body.activityTimeoutSeconds,
          stopPattern: body.stopPattern,
          gitBranchPrefix: body.git?.branchPrefix,
          gitCommitScope: body.git?.commitScope,
          baseBranch: effectiveBaseBranch,
          clearPlanningFolder: body.clearPlanningFolder,
          planMode: body.planMode,
          draft: body.draft,
        });

        // Save the model as last used if provided
        if (body.model?.providerID && body.model?.modelID) {
          await loopManager.saveLastUsedModel({
            providerID: body.model.providerID,
            modelID: body.model.modelID,
            variant: body.model.variant,
          });
        }

        // If draft mode is enabled, return the loop without starting
        if (body.draft) {
          return Response.json(loop, { status: 201 });
        }

        // If plan mode is enabled, start the plan mode session
        // Otherwise, start the loop immediately
        if (body.planMode) {
          try {
              await loopManager.startPlanMode(loop.config.id);
              // Return the loop with updated state after starting plan mode
              const updatedLoop = await loopManager.getLoop(loop.config.id);
              return Response.json(updatedLoop ?? loop, { status: 201 });
            } catch (startError) {
              // If start fails, delete the loop to avoid orphaned idle loops
              try {
                await loopManager.deleteLoop(loop.config.id);
              } catch (deleteError) {
                log.warn("Failed to clean up loop after start failure", { loopId: loop.config.id, error: String(deleteError) });
              }
              return errorResponse("start_plan_failed", `Loop created but failed to start plan mode: ${String(startError)}`, 500);
            }
        } else {
          // Always start the loop immediately after creation (normal mode)
          try {
            await loopManager.startLoop(loop.config.id);
            // Return the loop with updated state after starting
            const updatedLoop = await loopManager.getLoop(loop.config.id);
            return Response.json(updatedLoop ?? loop, { status: 201 });
          } catch (startError) {
            // If start fails for any reason, delete the loop to avoid orphaned idle loops
            try {
              await loopManager.deleteLoop(loop.config.id);
            } catch (deleteError) {
              log.warn("Failed to clean up loop after start failure", { loopId: loop.config.id, error: String(deleteError) });
            }
            return errorResponse("start_failed", `Loop created but failed to start: ${String(startError)}`, 500);
          }
        }
      } catch (error) {
        return errorResponse("create_failed", String(error), 500);
      }
    },
  },

  "/api/loops/:id": {
    /**
     * GET /api/loops/:id - Get a specific loop by ID.
     * 
     * Returns the full loop object including configuration and current state.
     * 
     * @returns Loop object or 404 if not found
     */
    async GET(req: Request & { params: { id: string } }): Promise<Response> {
      log.trace("GET /api/loops/:id", { loopId: req.params.id });
      const loop = await loopManager.getLoop(req.params.id);
      if (!loop) {
        log.debug("GET /api/loops/:id - Loop not found", { loopId: req.params.id });
        return errorResponse("not_found", "Loop not found", 404);
      }
      return Response.json(loop);
    },

    /**
     * PATCH /api/loops/:id - Update a loop's configuration.
     * 
     * Updates the specified fields of a loop's configuration. Cannot be used
     * on running or starting loops — stop the loop first. Partial updates are supported.
     * 
     * Updatable fields: name, directory, prompt, model, maxIterations,
     * maxConsecutiveErrors, activityTimeoutSeconds, stopPattern, baseBranch,
     * clearPlanningFolder, planMode, git
     * 
     * @returns Updated Loop object or 404 if not found
     */
    async PATCH(req: Request & { params: { id: string } }): Promise<Response> {
      log.debug("PATCH /api/loops/:id", { loopId: req.params.id });
      const loop = await loopManager.getLoop(req.params.id);
      if (!loop) {
        log.debug("PATCH /api/loops/:id - Loop not found", { loopId: req.params.id });
        return errorResponse("not_found", "Loop not found", 404);
      }

      // Parse and validate request body using Zod schema
      const validation = await parseAndValidate(UpdateLoopRequestSchema, req);
      if (!validation.success) {
        return validation.response;
      }

      return applyLoopUpdates(req.params.id, validation.data, loop);
    },

    /**
     * PUT /api/loops/:id - Update a draft loop's configuration.
     * 
     * Updates the specified fields of a draft loop's configuration.
     * Only works for loops in `draft` status. Use PATCH for other statuses.
     * Partial updates are supported.
     * 
     * @returns Updated Loop object, 404 if not found, or 400 if not a draft
     */
    async PUT(req: Request & { params: { id: string } }): Promise<Response> {
      const loop = await loopManager.getLoop(req.params.id);
      if (!loop) {
        return errorResponse("not_found", "Loop not found", 404);
      }

      // Only allow PUT for draft loops
      if (loop.state.status !== "draft") {
        return errorResponse("not_draft", "Only draft loops can be updated via PUT", 400);
      }

      // Parse and validate request body using Zod schema
      const validation = await parseAndValidate(UpdateLoopRequestSchema, req);
      if (!validation.success) {
        return validation.response;
      }

      log.debug("PUT /api/loops/:id - Request body", { 
        loopId: req.params.id,
        hasPrompt: validation.data.prompt !== undefined,
        promptLength: typeof validation.data.prompt === "string" ? validation.data.prompt.length : 0,
        promptPreview: typeof validation.data.prompt === "string" ? validation.data.prompt.slice(0, 50) : null,
      });

      return applyLoopUpdates(req.params.id, validation.data, loop);
    },

    /**
     * DELETE /api/loops/:id - Delete a loop.
     * 
     * Deletes a loop and its associated resources. For loops with git branches,
     * use discard or purge endpoints instead for proper cleanup.
     * 
     * @returns Success response or 404 if not found
     */
    async DELETE(req: Request & { params: { id: string } }): Promise<Response> {
      log.debug("DELETE /api/loops/:id", { loopId: req.params.id });
      const loop = await loopManager.getLoop(req.params.id);
      if (!loop) {
        log.debug("DELETE /api/loops/:id - Loop not found", { loopId: req.params.id });
        return errorResponse("not_found", "Loop not found", 404);
      }

      try {
        await loopManager.deleteLoop(req.params.id);
        log.info("DELETE /api/loops/:id - Loop deleted", { loopId: req.params.id });
        return successResponse();
      } catch (error) {
        log.error("DELETE /api/loops/:id - Delete failed", { loopId: req.params.id, error: String(error) });
        return errorResponse("delete_failed", String(error), 500);
      }
    },
  },

  "/api/loops/:id/comments": {
    /**
     * GET /api/loops/:id/comments - Get all review comments for a loop.
     * 
     * Returns all review comments submitted for a loop across all review cycles.
     * Comments include their status (pending/addressed) and timestamps.
     * 
     * @returns GetCommentsResponse with array of ReviewComment objects
     */
    async GET(req: Request & { params: { id: string } }): Promise<Response> {
      try {
        // Check if loop exists
        const loop = await loopManager.getLoop(req.params.id);
        if (!loop) {
          return errorResponse("not_found", "Loop not found", 404);
        }

        // Get comments from database via LoopManager
        const comments = loopManager.getReviewComments(req.params.id);
        
        const responseBody: GetCommentsResponse = {
          success: true,
          comments,
        };
        return Response.json(responseBody);
      } catch (error) {
        return errorResponse("get_comments_failed", String(error), 500);
      }
    },
  },
};

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
        const errorType = body.planMode ? "start_plan_failed" : "start_failed";
        const errorMsg = body.planMode
          ? `Failed to start plan mode: ${String(startError)}`
          : `Failed to start loop: ${String(startError)}`;
        return errorResponse(errorType, errorMsg, 500);
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
     * Removes the loop from the database entirely. Only works for loops
     * in final states (merged, pushed, deleted).
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

  "/api/loops/:id/mark-merged": {
    /**
     * POST /api/loops/:id/mark-merged - Mark an externally merged loop as deleted.
     * 
     * Transitions the loop to `deleted` status, clears reviewMode.addressable,
     * and disconnects the backend. With worktrees, no branch switching, pulling,
     * or branch deletion is needed — the worktree isolates everything.
     * Branch and worktree cleanup happens in purgeLoop().
     * 
     * This is useful when a loop's branch was merged externally (e.g., via GitHub PR)
     * and the user wants to clean up the loop.
     * 
     * Only works for loops in final states (pushed, merged, completed, max_iterations, deleted).
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
     * Only works for running loops.
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
     * config.prompt instead. Only works for running loops.
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
     * Queues a message and/or model change. By default (immediate: true), the current
     * iteration is interrupted and the pending values are applied immediately in a new
     * iteration. Set immediate: false to wait for the current iteration to complete.
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
        const loop = await loopManager.getLoop(req.params.id);
        if (!loop) {
          return errorResponse("not_found", "Loop not found", 404);
        }

        const modelValidation = await isModelEnabled(
          loop.config.workspaceId,
          loop.config.directory,
          body.model.providerID,
          body.model.modelID
        );
        if (!modelValidation.enabled) {
          return errorResponse(
            modelValidation.errorCode ?? "model_not_enabled",
            modelValidation.error ?? "The selected model is not available"
          );
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
     * POST /api/loops/:id/plan/accept - Accept the plan and start execution.
     * 
     * Accepts the current plan and transitions the loop from planning status
     * to running. The loop will begin executing the accepted plan.
     * Only works for loops in planning status.
     * 
     * @returns Success response
     */
    async POST(req: Request & { params: { id: string } }): Promise<Response> {
      try {
        await loopManager.acceptPlan(req.params.id);
        return successResponse();
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

/**
 * Loops data routes (diff, plan, status-file, check-planning-dir).
 * 
 * Provides read access to loop data and files:
 * - GET /api/loops/:id/diff - Get git diff for loop changes
 * - GET /api/loops/:id/plan - Get .planning/plan.md content
 * - GET /api/loops/:id/status-file - Get .planning/status.md content
 * - GET /api/check-planning-dir - Check if .planning directory exists
 */
export const loopsDataRoutes = {
  "/api/loops/:id/diff": {
    /**
     * GET /api/loops/:id/diff - Get git diff for a loop's changes.
     * 
     * Returns file diffs comparing the loop's working branch to the original branch.
     * Each diff includes path, status, additions, deletions, and patch content.
     * 
     * @returns Array of FileDiff objects
     */
    async GET(req: Request & { params: { id: string } }): Promise<Response> {
      const loop = await loopManager.getLoop(req.params.id);
      if (!loop) {
        return errorResponse("not_found", "Loop not found", 404);
      }

      if (!loop.state.git) {
        return errorResponse("no_git_branch", "No git branch was created for this loop", 400);
      }

      try {
        // Every loop must operate in its own worktree -- no fallback to config.directory
        const workDir = loop.state.git.worktreePath;
        if (!workDir) {
          return errorResponse("no_worktree", "Loop has no worktree path. Every loop must operate in its own worktree.", 400);
        }
        const executor = await backendManager.getCommandExecutorAsync(loop.config.workspaceId, workDir);
        const git = GitService.withExecutor(executor);

        const diffs = await git.getDiffWithContent(
          workDir,
          loop.state.git.originalBranch
        );
        return Response.json(diffs);
      } catch (error) {
        return errorResponse("diff_failed", String(error), 500);
      }
    },
  },

  "/api/loops/:id/plan": {
    /**
     * GET /api/loops/:id/plan - Get .planning/plan.md content.
     * 
     * Reads the plan.md file from the loop's .planning directory.
     * Returns the file content and whether the file exists.
     * 
     * @returns FileContentResponse with content and exists flag
     */
    async GET(req: Request & { params: { id: string } }): Promise<Response> {
      const loop = await loopManager.getLoop(req.params.id);
      if (!loop) {
        return errorResponse("not_found", "Loop not found", 404);
      }

      const workDir = loop.state.git?.worktreePath;
      if (!workDir) {
        return errorResponse("no_worktree", "Loop has no worktree path. Every loop must operate in its own worktree.", 400);
      }

      const executor = await backendManager.getCommandExecutorAsync(loop.config.workspaceId, workDir);
      const planPath = `${workDir}/.planning/plan.md`;

      const response: FileContentResponse = {
        content: "",
        exists: false,
      };

      const content = await executor.readFile(planPath);
      if (content !== null) {
        response.content = content;
        response.exists = true;
      }

      return Response.json(response);
    },
  },

  "/api/loops/:id/status-file": {
    /**
     * GET /api/loops/:id/status-file - Get .planning/status.md content.
     * 
     * Reads the status.md file from the loop's .planning directory.
     * Returns the file content and whether the file exists.
     * 
     * @returns FileContentResponse with content and exists flag
     */
    async GET(req: Request & { params: { id: string } }): Promise<Response> {
      const loop = await loopManager.getLoop(req.params.id);
      if (!loop) {
        return errorResponse("not_found", "Loop not found", 404);
      }

      const workDir = loop.state.git?.worktreePath;
      if (!workDir) {
        return errorResponse("no_worktree", "Loop has no worktree path. Every loop must operate in its own worktree.", 400);
      }

      const executor = await backendManager.getCommandExecutorAsync(loop.config.workspaceId, workDir);
      const statusPath = `${workDir}/.planning/status.md`;

      const response: FileContentResponse = {
        content: "",
        exists: false,
      };

      const content = await executor.readFile(statusPath);
      if (content !== null) {
        response.content = content;
        response.exists = true;
      }

      return Response.json(response);
    },
  },

  "/api/check-planning-dir": {
    /**
     * GET /api/check-planning-dir - Check if .planning directory exists.
     * 
     * Checks if a directory has a .planning folder and lists its contents.
     * Useful for validating a project before creating a loop.
     * 
     * Query Parameters:
     * - directory (required): Absolute path to check
     * 
     * @returns Object with exists, hasFiles, files array, and optional warning
     */
    async GET(req: Request): Promise<Response> {
      const url = new URL(req.url);
      const directory = url.searchParams.get("directory");

      if (!directory) {
        return errorResponse("invalid_request", "directory query parameter is required", 400);
      }

      // Look up workspace by directory to get workspaceId
      const workspace = await getWorkspaceByDirectory(directory);
      if (!workspace) {
        return errorResponse("workspace_not_found", `No workspace found for directory: ${directory}`, 404);
      }

      const planningDir = `${directory}/.planning`;
      
      try {
        // Get mode-appropriate command executor
        const executor = await backendManager.getCommandExecutorAsync(workspace.id, directory);

        // Check if directory exists
        const exists = await executor.directoryExists(planningDir);
        
        if (!exists) {
          return Response.json({
            exists: false,
            hasFiles: false,
            files: [],
            warning: "The .planning directory does not exist. Ralph Loops work best with planning documents.",
          });
        }

        // List files in the directory
        const files = await executor.listDirectory(planningDir);

        if (files.length === 0) {
          return Response.json({
            exists: true,
            hasFiles: false,
            files: [],
            warning: "The .planning directory is empty. Consider adding plan.md and status.md files.",
          });
        }

        return Response.json({
          exists: true,
          hasFiles: true,
          files,
        });
      } catch (error) {
        return errorResponse("check_failed", String(error), 500);
      }
    },
  },
};

/**
 * Loops review routes - handle review comments after push/merge.
 * 
 * These endpoints allow addressing reviewer feedback on completed loops:
 * - POST /api/loops/:id/address-comments - Start addressing reviewer comments
 * - GET /api/loops/:id/review-history - Get review history for a loop
 */
export const loopsReviewRoutes = {
  "/api/loops/:id/address-comments": {
    /**
     * POST /api/loops/:id/address-comments - Start addressing reviewer comments.
     * 
     * Creates a new review cycle and restarts the loop to address the provided
     * reviewer comments. The loop will work on addressing the feedback.
     * Only works for loops in pushed or merged status that aren't already running.
     * 
     * Request Body:
     * - comments (required): Reviewer's comments to address
     * 
     * @returns AddressCommentsResponse with reviewCycle, branch, and commentIds
     */
    async POST(req: Request & { params: { id: string } }): Promise<Response> {
      // Parse and validate request body using Zod schema
      const validation = await parseAndValidate(AddressCommentsRequestSchema, req);
      if (!validation.success) {
        return validation.response;
      }
      const body = validation.data;

      try {
        const result = await loopManager.addressReviewComments(req.params.id, body.comments);
        
        if (!result.success) {
          // Map error messages to status codes
          const errorMsg = result.error ?? "Unknown error";
          let status = 400;
          
          if (errorMsg.includes("not found")) {
            status = 404;
          } else if (errorMsg.includes("already running")) {
            status = 409;
          }
          
          const responseBody: AddressCommentsResponse = {
            success: false,
            error: errorMsg,
          };
          return Response.json(responseBody, { status });
        }

        const responseBody: AddressCommentsResponse = {
          success: true,
          reviewCycle: result.reviewCycle!,
          branch: result.branch!,
          commentIds: result.commentIds!,
        };
        return Response.json(responseBody);
      } catch (error) {
        const responseBody: AddressCommentsResponse = {
          success: false,
          error: String(error),
        };
        return Response.json(responseBody, { status: 500 });
      }
    },
  },

  "/api/loops/:id/review-history": {
    /**
     * GET /api/loops/:id/review-history - Get review history for a loop.
     * 
     * Returns the review history including addressability, completion action,
     * number of review cycles, and list of review branches created.
     * 
     * @returns ReviewHistoryResponse with history object
     */
    async GET(req: Request & { params: { id: string } }): Promise<Response> {
      try {
        const result = await loopManager.getReviewHistory(req.params.id);
        
        if (!result.success) {
          const responseBody: ReviewHistoryResponse = {
            success: false,
            error: result.error!,
          };
          return Response.json(responseBody, { status: result.error === "Loop not found" ? 404 : 400 });
        }

        const responseBody: ReviewHistoryResponse = {
          success: true,
          history: result.history!,
        };
        return Response.json(responseBody);
      } catch (error) {
        return errorResponse("get_review_history_failed", String(error), 500);
      }
    },
  },
};

/**
 * Chat routes for interactive chat sessions.
 *
 * Chats are loops with `mode: "chat"` — they share the same DB, state machine,
 * and post-completion actions (push, merge, accept, discard). The difference is
 * in how they execute: single-turn, user-driven message injection instead of
 * autonomous multi-iteration loops.
 *
 * - POST /api/loops/chat - Create a new interactive chat
 * - POST /api/loops/:id/chat - Send a message to an existing chat
 */
export const loopsChatRoutes = {
  "/api/loops/chat": {
    /**
     * POST /api/loops/chat - Create a new interactive chat.
     *
     * Creates a chat (loop with mode "chat") and starts it immediately.
     * The chat is ready to receive messages via POST /api/loops/:id/chat.
     *
     * Request Body Fields:
     * - workspaceId (required): Workspace to create the chat in
     * - prompt (required): Initial message to send to the AI
     * - model: { providerID, modelID, variant } for AI model selection
     * - baseBranch: Base branch to create chat from
     * - git: { branchPrefix, commitScope } for git integration
     *
     * Errors:
     * - 400: Validation error or invalid JSON body
     * - 404: Workspace not found
     * - 500: Chat created but failed to start
     *
     * @returns Created Loop object (with mode "chat") with 201 status
     */
    async POST(req: Request): Promise<Response> {
      log.debug("POST /api/loops/chat - Creating new chat");

      // Parse and validate request body
      const validation = await parseAndValidate(CreateChatRequestSchema, req);
      if (!validation.success) {
        log.warn("POST /api/loops/chat - Validation error");
        return validation.response;
      }
      const body = validation.data;

      // Resolve workspace
      const workspace = await getWorkspace(body.workspaceId);
      if (!workspace) {
        return errorResponse("workspace_not_found", `Workspace not found: ${body.workspaceId}`, 404);
      }
      const directory = workspace.directory;
      const workspaceId = body.workspaceId;

      // Touch workspace to update last used timestamp
      await touchWorkspace(workspace.id);

      // Validate model is enabled if provided
      if (body.model?.providerID && body.model?.modelID) {
        const modelValidation = await isModelEnabled(
          workspaceId,
          directory,
          body.model.providerID,
          body.model.modelID
        );
        if (!modelValidation.enabled) {
          return errorResponse(
            modelValidation.errorCode ?? "model_not_enabled",
            modelValidation.error ?? "The selected model is not available"
          );
        }
      }

      // Auto-detect default branch if baseBranch not provided
      let effectiveBaseBranch = body.baseBranch;
      if (!effectiveBaseBranch) {
        try {
          const executor = await backendManager.getCommandExecutorAsync(workspaceId, directory);
          const git = GitService.withExecutor(executor);
          effectiveBaseBranch = await git.getDefaultBranch(directory);
          log.debug(`Auto-detected default branch for chat: ${effectiveBaseBranch}`);
        } catch (error) {
          log.warn(`Failed to detect default branch for chat, will fall back to current branch: ${String(error)}`);
        }
      }

      try {
        const chat = await loopManager.createChat({
          directory,
          prompt: body.prompt,
          workspaceId,
          modelProviderID: body.model?.providerID,
          modelID: body.model?.modelID,
          modelVariant: body.model?.variant,
          gitBranchPrefix: body.git?.branchPrefix,
          gitCommitScope: body.git?.commitScope,
          baseBranch: effectiveBaseBranch,
        });

        // Save the model as last used if provided
        if (body.model?.providerID && body.model?.modelID) {
          await loopManager.saveLastUsedModel({
            providerID: body.model.providerID,
            modelID: body.model.modelID,
            variant: body.model.variant,
          });
        }

        return Response.json(chat, { status: 201 });
      } catch (error) {
        return errorResponse("create_chat_failed", String(error), 500);
      }
    },
  },

  "/api/loops/:id/chat": {
    /**
     * POST /api/loops/:id/chat - Send a message to an interactive chat.
     *
     * Injects a user message into the chat. If the AI is currently responding,
     * the current generation is aborted and the message is applied immediately
     * in a new iteration. If the AI is idle (previous turn completed), a new
     * single-turn iteration is started.
     *
     * Returns immediately after setting up the injection — does not wait for
     * the AI to finish responding.
     *
     * Request Body:
     * - message (required): The user's message
     * - model (optional): { providerID, modelID, variant } to override model for this turn
     *
     * Errors:
     * - 400: Validation error, not a chat, or invalid state
     * - 404: Loop not found
     * - 500: Internal error
     *
     * @returns SendChatMessageResponse with success and loopId
     */
    async POST(req: Request & { params: { id: string } }): Promise<Response> {
      log.debug("POST /api/loops/:id/chat - Sending chat message", { loopId: req.params.id });

      // Parse and validate request body
      const validation = await parseAndValidate(SendChatMessageRequestSchema, req);
      if (!validation.success) {
        return validation.response;
      }
      const body = validation.data;

      // Validate model is enabled if provided
      if (body.model?.providerID && body.model?.modelID) {
        const loop = await loopManager.getLoop(req.params.id);
        if (!loop) {
          return errorResponse("not_found", "Loop not found", 404);
        }

        const modelValidation = await isModelEnabled(
          loop.config.workspaceId,
          loop.config.directory,
          body.model.providerID,
          body.model.modelID
        );
        if (!modelValidation.enabled) {
          return errorResponse(
            modelValidation.errorCode ?? "model_not_enabled",
            modelValidation.error ?? "The selected model is not available"
          );
        }
      }

      try {
        await loopManager.sendChatMessage(
          req.params.id,
          body.message,
          body.model ? {
            providerID: body.model.providerID,
            modelID: body.model.modelID,
            variant: body.model.variant,
          } : undefined,
        );

        const response: SendChatMessageResponse = {
          success: true,
          loopId: req.params.id,
        };
        return Response.json(response);
      } catch (error) {
        const errorMsg = String(error);
        if (errorMsg.includes("not found")) {
          return errorResponse("not_found", errorMsg, 404);
        }
        if (errorMsg.includes("not a chat")) {
          return errorResponse("not_chat", errorMsg, 400);
        }
        if (errorMsg.includes("Cannot send chat message")) {
          return errorResponse("invalid_state", errorMsg, 400);
        }
        return errorResponse("send_chat_message_failed", errorMsg, 500);
      }
    },
  },
};

/**
 * All loops routes combined.
 */
export const loopsRoutes = {
  ...loopsCrudRoutes,
  ...loopsControlRoutes,
  ...loopsDataRoutes,
  ...loopsReviewRoutes,
  ...loopsChatRoutes,
};
