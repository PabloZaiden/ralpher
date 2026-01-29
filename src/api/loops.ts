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
 * Uses the CommandExecutor abstraction which works identically for both:
 * - Spawn mode: Commands run on locally-spawned opencode server via PTY+WebSocket
 * - Connect mode: Commands run on remote opencode server via PTY+WebSocket
 * 
 * @module api/loops
 */

import { loopManager } from "../core/loop-manager";
import { backendManager } from "../core/backend-manager";
import { GitService } from "../core/git-service";
import { setLastModel } from "../persistence/preferences";
import { updateLoopState } from "../persistence/loops";
import { getReviewComments } from "../persistence/database";
import { log } from "../core/logger";
import type {
  CreateLoopRequest,
  AcceptResponse,
  PushResponse,
  ErrorResponse,
  FileContentResponse,
  AddressCommentsRequest,
  AddressCommentsResponse,
  ReviewHistoryResponse,
  GetCommentsResponse,
} from "../types/api";
import { validateCreateLoopRequest } from "../types/api";

/**
 * Safely parse JSON body from a request.
 * Returns null if the body is not valid JSON.
 * 
 * @param req - The incoming HTTP request
 * @returns Parsed body or null if parsing fails
 */
async function parseBody<T>(req: Request): Promise<T | null> {
  try {
    return await req.json() as T;
  } catch {
    return null;
  }
}

/**
 * Create a standardized error response.
 * 
 * @param error - Error code for programmatic handling
 * @param message - Human-readable error description
 * @param status - HTTP status code (default: 400)
 * @returns JSON Response with error details
 */
function errorResponse(error: string, message: string, status = 400): Response {
  const body: ErrorResponse = { error, message };
  return Response.json(body, { status });
}

/**
 * Create a standardized success response.
 * 
 * @param data - Additional data to include in the response
 * @returns JSON Response with success: true and any additional data
 */
function successResponse(data: Record<string, unknown> = {}): Response {
  return Response.json({ success: true, ...data });
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
     * @returns Array of Loop objects with config and state
     */
    async GET(): Promise<Response> {
      const loops = await loopManager.getAllLoops();
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
     * - activityTimeoutSeconds: Seconds without events before error (default: 180, min: 60)
     * - stopPattern: Regex for completion detection
     * - git: { branchPrefix, commitPrefix } for git integration
     * - baseBranch: Base branch to create loop from
     * - clearPlanningFolder: Clear .planning folder before starting
     * - planMode: Start in plan creation mode
     * - draft: Save as draft without starting
     * 
     * Errors:
     * - 400: Validation error or invalid JSON body
     * - 409: Directory has uncommitted changes
     * - 500: Loop created but failed to start
     * 
     * @returns Created Loop object with 201 status
     */
    async POST(req: Request): Promise<Response> {
      const body = await parseBody<CreateLoopRequest>(req);
      if (!body) {
        return errorResponse("invalid_body", "Request body must be valid JSON");
      }

      const validationError = validateCreateLoopRequest(body);
      if (validationError) {
        return errorResponse("validation_error", validationError);
      }

      // Create a single executor/GitService for the request to avoid duplicate setup
      let git: GitService | null = null;
      const getGitService = async (): Promise<GitService> => {
        if (!git) {
          const executor = await backendManager.getCommandExecutorAsync(body.directory);
          git = GitService.withExecutor(executor);
        }
        return git;
      };

      // Skip preflight check for drafts (drafts don't modify git)
      if (!body.draft) {
        // Preflight check: verify no uncommitted changes before creating the loop
        // This prevents creating loops that can never be started
        try {
          const gitService = await getGitService();
          const hasChanges = await gitService.hasUncommittedChanges(body.directory);

          if (hasChanges) {
            const changedFiles = await gitService.getChangedFiles(body.directory);
            
            // If planMode and clearPlanningFolder are enabled, allow uncommitted changes in .planning/ only
            const onlyPlanningChanges = body.planMode && body.clearPlanningFolder &&
              changedFiles.every((file) => file.startsWith(".planning/") || file === ".planning");
            
            if (!onlyPlanningChanges) {
              return Response.json(
                {
                  error: "uncommitted_changes",
                  message: "Directory has uncommitted changes. Please commit or stash your changes before creating a loop.",
                  changedFiles,
                },
                { status: 409 }
              );
            }
          }
        } catch (preflightError) {
          return errorResponse("preflight_failed", `Failed to check for uncommitted changes: ${String(preflightError)}`, 500);
        }
      }

      // Auto-detect default branch if baseBranch not provided
      let effectiveBaseBranch = body.baseBranch;
      if (!effectiveBaseBranch) {
        try {
          const gitService = await getGitService();
          effectiveBaseBranch = await gitService.getDefaultBranch(body.directory);
          log.debug(`Auto-detected default branch for loop: ${effectiveBaseBranch}`);
        } catch (error) {
          log.warn(`Failed to detect default branch, will fall back to current branch: ${String(error)}`);
          // Continue without baseBranch - loop engine will use current branch as fallback
        }
      }

      try {
        const loop = await loopManager.createLoop({
          directory: body.directory,
          prompt: body.prompt,
          modelProviderID: body.model?.providerID,
          modelID: body.model?.modelID,
          maxIterations: body.maxIterations,
          maxConsecutiveErrors: body.maxConsecutiveErrors,
          activityTimeoutSeconds: body.activityTimeoutSeconds,
          stopPattern: body.stopPattern,
          gitBranchPrefix: body.git?.branchPrefix,
          gitCommitPrefix: body.git?.commitPrefix,
          baseBranch: effectiveBaseBranch,
          clearPlanningFolder: body.clearPlanningFolder,
          planMode: body.planMode,
          draft: body.draft,
        });

        // Save the model as last used if provided
        if (body.model?.providerID && body.model?.modelID) {
          try {
            await setLastModel({
              providerID: body.model.providerID,
              modelID: body.model.modelID,
            });
          } catch (error) {
            log.warn(`Failed to save last model: ${String(error)}`);
          }
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
            } catch {
              // Ignore delete errors
            }
            return errorResponse("start_plan_failed", `Loop created but failed to start plan mode: ${String(startError)}`, 500);
          }
        } else {
          // Always start the loop immediately after creation (normal mode)
          // Since we pre-checked for uncommitted changes, this should succeed
          try {
            await loopManager.startLoop(loop.config.id);
            // Return the loop with updated state after starting
            const updatedLoop = await loopManager.getLoop(loop.config.id);
            return Response.json(updatedLoop ?? loop, { status: 201 });
          } catch (startError) {
            // If start fails for any reason, delete the loop to avoid orphaned idle loops
            try {
              await loopManager.deleteLoop(loop.config.id);
            } catch {
              // Ignore delete errors
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
      const loop = await loopManager.getLoop(req.params.id);
      if (!loop) {
        return errorResponse("not_found", "Loop not found", 404);
      }
      return Response.json(loop);
    },

    /**
     * PATCH /api/loops/:id - Update a loop's configuration.
     * 
     * Updates the specified fields of a loop's configuration. Can be used
     * on any loop regardless of status. Partial updates are supported.
     * 
     * Updatable fields: name, directory, prompt, model, maxIterations,
     * maxConsecutiveErrors, activityTimeoutSeconds, stopPattern, baseBranch,
     * clearPlanningFolder, planMode, git
     * 
     * @returns Updated Loop object or 404 if not found
     */
    async PATCH(req: Request & { params: { id: string } }): Promise<Response> {
      const loop = await loopManager.getLoop(req.params.id);
      if (!loop) {
        return errorResponse("not_found", "Loop not found", 404);
      }

      const body = await parseBody<Record<string, unknown>>(req);
      if (!body) {
        return errorResponse("invalid_body", "Request body must be valid JSON");
      }

      try {
        // Transform request body to match LoopConfig format
        const updates: Partial<Omit<typeof loop.config, "id" | "createdAt">> = {};
        
        if (body["name"] !== undefined) updates.name = body["name"] as string;
        if (body["directory"] !== undefined) updates.directory = body["directory"] as string;
        if (body["prompt"] !== undefined) updates.prompt = body["prompt"] as string;
        if (body["maxIterations"] !== undefined) updates.maxIterations = body["maxIterations"] as number;
        if (body["maxConsecutiveErrors"] !== undefined) updates.maxConsecutiveErrors = body["maxConsecutiveErrors"] as number;
        if (body["activityTimeoutSeconds"] !== undefined) updates.activityTimeoutSeconds = body["activityTimeoutSeconds"] as number;
        if (body["stopPattern"] !== undefined) updates.stopPattern = body["stopPattern"] as string;
        if (body["baseBranch"] !== undefined) updates.baseBranch = body["baseBranch"] as string;
        if (body["clearPlanningFolder"] !== undefined) updates.clearPlanningFolder = body["clearPlanningFolder"] as boolean;
        if (body["planMode"] !== undefined) updates.planMode = body["planMode"] as boolean;
        
        // Handle model config
        if (body["model"] !== undefined) {
          const modelBody = body["model"] as Record<string, unknown>;
          updates.model = {
            providerID: modelBody["providerID"] as string,
            modelID: modelBody["modelID"] as string,
          };
        }
        
        // Handle git config
        if (body["git"] !== undefined) {
          const gitBody = body["git"] as Record<string, unknown>;
          updates.git = {
            branchPrefix: gitBody["branchPrefix"] as string,
            commitPrefix: gitBody["commitPrefix"] as string,
          };
        }

        const updatedLoop = await loopManager.updateLoop(req.params.id, updates);
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

      const body = await parseBody<Record<string, unknown>>(req);
      if (!body) {
        return errorResponse("invalid_body", "Request body must be valid JSON");
      }

      try {
        // Transform request body to match LoopConfig format (partial updates)
        const updates: Partial<Omit<typeof loop.config, "id" | "createdAt">> = {};
        
        if (body["name"] !== undefined) updates.name = body["name"] as string;
        if (body["directory"] !== undefined) updates.directory = body["directory"] as string;
        if (body["prompt"] !== undefined) updates.prompt = body["prompt"] as string;
        if (body["maxIterations"] !== undefined) updates.maxIterations = body["maxIterations"] as number;
        if (body["maxConsecutiveErrors"] !== undefined) updates.maxConsecutiveErrors = body["maxConsecutiveErrors"] as number;
        if (body["activityTimeoutSeconds"] !== undefined) updates.activityTimeoutSeconds = body["activityTimeoutSeconds"] as number;
        if (body["stopPattern"] !== undefined) updates.stopPattern = body["stopPattern"] as string;
        if (body["baseBranch"] !== undefined) updates.baseBranch = body["baseBranch"] as string;
        if (body["clearPlanningFolder"] !== undefined) updates.clearPlanningFolder = body["clearPlanningFolder"] as boolean;
        if (body["planMode"] !== undefined) updates.planMode = body["planMode"] as boolean;
        
        // Handle model config
        if (body["model"] !== undefined) {
          const modelBody = body["model"] as Record<string, unknown>;
          updates.model = {
            providerID: modelBody["providerID"] as string,
            modelID: modelBody["modelID"] as string,
          };
        }
        
        // Handle git config
        if (body["git"] !== undefined) {
          const gitBody = body["git"] as Record<string, unknown>;
          updates.git = {
            branchPrefix: gitBody["branchPrefix"] as string,
            commitPrefix: gitBody["commitPrefix"] as string,
          };
        }

        const updatedLoop = await loopManager.updateLoop(req.params.id, updates);
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
      const loop = await loopManager.getLoop(req.params.id);
      if (!loop) {
        return errorResponse("not_found", "Loop not found", 404);
      }

      try {
        await loopManager.deleteLoop(req.params.id);
        return successResponse();
      } catch (error) {
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

        // Get comments from database
        const dbComments = getReviewComments(req.params.id);
        
        // Convert database format to API format
        const comments = dbComments.map((c) => ({
          id: c.id,
          loopId: c.loop_id,
          reviewCycle: c.review_cycle,
          commentText: c.comment_text,
          createdAt: c.created_at,
          status: c.status as "pending" | "addressed",
          addressedAt: c.addressed_at ?? undefined,
        }));
        
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
     * Performs preflight checks for uncommitted changes before starting.
     * 
     * Request Body:
     * - planMode (required): If true, start in plan mode; if false, start immediately
     * 
     * Errors:
     * - 400: Loop is not in draft status or invalid body
     * - 404: Loop not found
     * - 409: Directory has uncommitted changes
     * 
     * @returns Updated Loop object
     */
    async POST(req: Request & { params: { id: string } }): Promise<Response> {
      const body = await parseBody<{ planMode: boolean }>(req);
      if (!body || typeof body.planMode !== "boolean") {
        return errorResponse("invalid_body", "Request body must contain a 'planMode' boolean");
      }

      // Load the loop
      const loop = await loopManager.getLoop(req.params.id);
      if (!loop) {
        return errorResponse("not_found", "Loop not found", 404);
      }

      // Verify it's a draft
      if (loop.state.status !== "draft") {
        return errorResponse("not_draft", "Loop is not in draft status", 400);
      }

      // Preflight check: verify no uncommitted changes before starting
      try {
        const executor = await backendManager.getCommandExecutorAsync(loop.config.directory);
        const git = GitService.withExecutor(executor);
        const hasChanges = await git.hasUncommittedChanges(loop.config.directory);

        if (hasChanges) {
          const changedFiles = await git.getChangedFiles(loop.config.directory);
          
          // If planMode and clearPlanningFolder are enabled, allow uncommitted changes in .planning/ only
          const onlyPlanningChanges = body.planMode && loop.config.clearPlanningFolder &&
            changedFiles.every((file) => file.startsWith(".planning/") || file === ".planning");
          
          if (!onlyPlanningChanges) {
            return Response.json(
              {
                error: "uncommitted_changes",
                message: "Directory has uncommitted changes. Please commit or stash your changes before starting a loop.",
                changedFiles,
              },
              { status: 409 }
            );
          }
        }
      } catch (preflightError) {
        return errorResponse("preflight_failed", `Failed to check for uncommitted changes: ${String(preflightError)}`, 500);
      }

      // Transition draft to appropriate status before starting
      // This is necessary because engine.start() only accepts idle/stopped/planning status
      if (body.planMode) {
        try {
          // Update to planning status before starting
          loop.state.status = "planning";
          loop.state.planMode = {
            active: true,
            feedbackRounds: 0,
            planningFolderCleared: false,
          };
          await updateLoopState(req.params.id, loop.state);
          
          // Start plan mode - this will handle git setup and further state updates
          await loopManager.startPlanMode(req.params.id);
          
          // Return updated loop
          const updatedLoop = await loopManager.getLoop(req.params.id);
          return Response.json(updatedLoop ?? loop);
        } catch (startError) {
          return errorResponse("start_plan_failed", `Failed to start plan mode: ${String(startError)}`, 500);
        }
      } else {
        try {
          // Update to idle status before starting (engine will change it to "starting")
          loop.state.status = "idle";
          await updateLoopState(req.params.id, loop.state);
          
          // Start the loop immediately - this will handle git setup and state updates
          await loopManager.startLoop(req.params.id);
          
          // Return updated loop
          const updatedLoop = await loopManager.getLoop(req.params.id);
          return Response.json(updatedLoop ?? loop);
        } catch (startError) {
          return errorResponse("start_failed", `Failed to start loop: ${String(startError)}`, 500);
        }
      }
    },
  },

  "/api/loops/:id/accept": {
    /**
     * POST /api/loops/:id/accept - Accept and merge a completed loop.
     * 
     * Merges the loop's working branch into the original branch.
     * Only works for loops in completed/stopped/max_iterations/failed status.
     * After merge, the loop status changes to `merged`.
     * 
     * @returns AcceptResponse with success and mergeCommit SHA
     */
    async POST(req: Request & { params: { id: string } }): Promise<Response> {
      const result = await loopManager.acceptLoop(req.params.id);

      if (!result.success) {
        if (result.error?.includes("not found")) {
          return errorResponse("not_found", "Loop not found", 404);
        }
        return errorResponse("accept_failed", result.error ?? "Unknown error", 400);
      }

      const response: AcceptResponse = {
        success: true,
        mergeCommit: result.mergeCommit,
      };
      return Response.json(response);
    },
  },

  "/api/loops/:id/push": {
    /**
     * POST /api/loops/:id/push - Push a completed loop's branch to remote.
     * 
     * Pushes the loop's working branch to the remote repository for PR workflow.
     * Only works for loops in completed/stopped/max_iterations/failed status.
     * After push, the loop status changes to `pushed` and can receive review comments.
     * 
     * @returns PushResponse with success and remoteBranch name
     */
    async POST(req: Request & { params: { id: string } }): Promise<Response> {
      const result = await loopManager.pushLoop(req.params.id);

      if (!result.success) {
        if (result.error?.includes("not found")) {
          return errorResponse("not_found", "Loop not found", 404);
        }
        return errorResponse("push_failed", result.error ?? "Unknown error", 400);
      }

      const response: PushResponse = {
        success: true,
        remoteBranch: result.remoteBranch,
      };
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
      const result = await loopManager.discardLoop(req.params.id);

      if (!result.success) {
        if (result.error?.includes("not found")) {
          return errorResponse("not_found", "Loop not found", 404);
        }
        return errorResponse("discard_failed", result.error ?? "Unknown error", 400);
      }

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
      const result = await loopManager.purgeLoop(req.params.id);

      if (!result.success) {
        if (result.error?.includes("not found")) {
          return errorResponse("not_found", "Loop not found", 404);
        }
        return errorResponse("purge_failed", result.error ?? "Unknown error", 400);
      }

      return successResponse();
    },
  },

  "/api/loops/:id/mark-merged": {
    /**
     * POST /api/loops/:id/mark-merged - Mark a loop as merged and sync with remote.
     * 
     * Switches the repository back to the original branch, pulls latest changes
     * from the remote, deletes the working branch, and marks the loop as deleted.
     * 
     * This is useful when a loop's branch was merged externally (e.g., via GitHub PR)
     * and the user wants to sync their local environment with the merged changes.
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
      const body = await parseBody<{ prompt: string }>(req);
      if (!body || typeof body.prompt !== "string") {
        return errorResponse("invalid_body", "Request body must contain a 'prompt' string");
      }

      if (!body.prompt.trim()) {
        return errorResponse("validation_error", "Prompt cannot be empty");
      }

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

  "/api/loops/:id/plan/feedback": {
    /**
     * POST /api/loops/:id/plan/feedback - Send feedback to refine the plan.
     * 
     * Sends user feedback to the AI to refine the plan during planning phase.
     * Increments the feedback round counter. Only works for loops in planning status.
     * 
     * Request Body:
     * - feedback (required): User's feedback/comments on the plan
     * 
     * @returns Success response
     */
    async POST(req: Request & { params: { id: string } }): Promise<Response> {
      const body = await parseBody<{ feedback: string }>(req);
      if (!body || typeof body.feedback !== "string") {
        return errorResponse("invalid_body", "Request body must contain a 'feedback' string");
      }

      if (!body.feedback.trim()) {
        return errorResponse("validation_error", "Feedback cannot be empty");
      }

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
        // Get mode-appropriate git service
        const executor = await backendManager.getCommandExecutorAsync(loop.config.directory);
        const git = GitService.withExecutor(executor);

        const diffs = await git.getDiffWithContent(
          loop.config.directory,
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

      // Get mode-appropriate command executor
      const executor = await backendManager.getCommandExecutorAsync(loop.config.directory);
      const planPath = `${loop.config.directory}/.planning/plan.md`;

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

      // Get mode-appropriate command executor
      const executor = await backendManager.getCommandExecutorAsync(loop.config.directory);
      const statusPath = `${loop.config.directory}/.planning/status.md`;

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

      const planningDir = `${directory}/.planning`;
      
      try {
        // Get mode-appropriate command executor
        const executor = await backendManager.getCommandExecutorAsync(directory);

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
      const body = await parseBody<AddressCommentsRequest>(req);
      if (!body) {
        return errorResponse("invalid_body", "Request body must be valid JSON");
      }

      // Validate comments field
      if (body.comments === undefined || body.comments === null || typeof body.comments !== "string") {
        return errorResponse("validation_error", "Comments field is required and must be a string");
      }

      if (body.comments.trim() === "") {
        return errorResponse("validation_error", "Comments cannot be empty");
      }

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
          reviewCycle: result.reviewCycle,
          branch: result.branch,
          commentIds: result.commentIds,
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
            error: result.error,
          };
          return Response.json(responseBody, { status: result.error === "Loop not found" ? 404 : 400 });
        }

        const responseBody: ReviewHistoryResponse = {
          success: true,
          history: result.history,
        };
        return Response.json(responseBody);
      } catch (error) {
        return errorResponse("get_review_history_failed", String(error), 500);
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
};
