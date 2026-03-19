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

import { loopManager } from "../../core/loop-manager";
import { backendManager } from "../../core/backend-manager";
import { GitService } from "../../core/git-service";
import { getWorkspace, touchWorkspace } from "../../persistence/workspaces";
import { createLogger } from "../../core/logger";
import { isModelEnabled } from "../models";
import type { GetCommentsResponse } from "../../types/api";
import { parseAndValidate } from "../validation";
import { errorResponse, successResponse } from "../helpers";
import type { LoopConfig, Loop } from "../../types/loop";
import type { z } from "zod";
import {
  CreateLoopRequestSchema,
  GenerateLoopTitleRequestSchema,
  UpdateLoopRequestSchema,
} from "../../types/schemas";
import { startErrorResponse } from "./helpers";

const log = createLogger("api:loops");

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
    if (body.useWorktree !== undefined) updates.useWorktree = body.useWorktree;
    if (body.clearPlanningFolder !== undefined) updates.clearPlanningFolder = body.clearPlanningFolder;
    if (body.planMode !== undefined) updates.planMode = body.planMode;
    if (body.planModeAutoReply !== undefined) updates.planModeAutoReply = body.planModeAutoReply;

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
      if (code === "USE_WORKTREE_IMMUTABLE") {
        return errorResponse("use_worktree_immutable", errorMessage, status ?? 409);
      }
    }
    return errorResponse("update_failed", errorMessage, 500);
  }
}

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

      log.debug("GET /api/loops - Retrieved loops", { count: loops.length, modeFilter });
      return Response.json(loops);
    },

    /**
     * POST /api/loops - Create a new loop.
     *
     * Creates a new Ralph Loop with the specified configuration. The loop is
     * automatically started unless `draft: true` is specified.
     *
     * The loop name is supplied by the client. The dashboard may generate a
     * suggested name up front, but this endpoint receives the final value.
     *
     * Request Body Fields:
     * - name (required): Human-readable loop name
     * - workspaceId (required): Workspace to create the loop in
     * - prompt (required): Task prompt/PRD
     * - model: { providerID, modelID } for AI model selection
     * - useWorktree (required): Whether to use a dedicated git worktree
     * - maxIterations: Maximum iterations (unlimited if not set)
     * - maxConsecutiveErrors: Max identical errors before failsafe (default: 10)
     * - activityTimeoutSeconds: Seconds without events before error (default: 900, min: 60)
     * - stopPattern: Regex for completion detection
     * - git: { branchPrefix, commitScope } for git integration
     * - baseBranch: Base branch to create loop from
     * - clearPlanningFolder: Clear .planning folder before starting
     * - planMode: Start in plan creation mode
     * - planModeAutoReply: Whether planning-mode ACP questions auto-answer
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

      log.debug("POST /api/loops - Request validated", {
        name: body.name,
        workspaceId: body.workspaceId,
        planMode: body.planMode,
        draft: body.draft,
        hasModel: !!body.model,
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
          body.model.modelID,
        );
        if (!modelValidation.enabled) {
          return errorResponse(
            modelValidation.errorCode ?? "model_not_enabled",
            modelValidation.error ?? "The selected model is not available",
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
          name: body.name,
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
          useWorktree: body.useWorktree,
          clearPlanningFolder: body.clearPlanningFolder,
          planMode: body.planMode,
          planModeAutoReply: body.planModeAutoReply,
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
            return startErrorResponse(startError, "start_plan_failed", "Loop created but failed to start plan mode");
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
            return startErrorResponse(startError, "start_failed", "Loop created but failed to start");
          }
        }
      } catch (error) {
        return errorResponse("create_failed", String(error), 500);
      }
    },
  },

  "/api/loops/title": {
    async POST(req: Request): Promise<Response> {
      const validation = await parseAndValidate(GenerateLoopTitleRequestSchema, req);
      if (!validation.success) {
        return validation.response;
      }

      const workspace = await getWorkspace(validation.data.workspaceId);
      if (!workspace) {
        return errorResponse("workspace_not_found", `Workspace not found: ${validation.data.workspaceId}`, 404);
      }

      await touchWorkspace(workspace.id);

      try {
        const title = await loopManager.generateLoopTitle({
          workspaceId: workspace.id,
          directory: workspace.directory,
          prompt: validation.data.prompt,
        });
        return Response.json({ title });
      } catch (error) {
        return errorResponse("title_generation_failed", String(error), 500);
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
      log.debug("GET /api/loops/:id", { loopId: req.params.id });
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
