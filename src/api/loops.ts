/**
 * Loops API endpoints for Ralph Loops Management System.
 * Handles CRUD operations and loop control (start, stop, accept, discard).
 * 
 * Uses the CommandExecutor abstraction which works identically for both:
 * - Spawn mode: Commands run on locally-spawned opencode server via PTY+WebSocket
 * - Connect mode: Commands run on remote opencode server via PTY+WebSocket
 */

import { loopManager } from "../core/loop-manager";
import { backendManager } from "../core/backend-manager";
import { GitService } from "../core/git-service";
import { setLastModel } from "../persistence/preferences";
import { log } from "../core/logger";
import type {
  CreateLoopRequest,
  UpdateLoopRequest,
  AcceptResponse,
  PushResponse,
  ErrorResponse,
  FileContentResponse,
} from "../types/api";
import { validateCreateLoopRequest } from "../types/api";

/**
 * Helper to parse JSON body safely.
 */
async function parseBody<T>(req: Request): Promise<T | null> {
  try {
    return await req.json() as T;
  } catch {
    return null;
  }
}

/**
 * Helper to create error response.
 */
function errorResponse(error: string, message: string, status = 400): Response {
  const body: ErrorResponse = { error, message };
  return Response.json(body, { status });
}

/**
 * Helper to create success response.
 */
function successResponse(data: Record<string, unknown> = {}): Response {
  return Response.json({ success: true, ...data });
}

/**
 * Loops CRUD routes.
 */
export const loopsCrudRoutes = {
  "/api/loops": {
    /**
     * GET /api/loops - List all loops
     */
    async GET(): Promise<Response> {
      const loops = await loopManager.getAllLoops();
      return Response.json(loops);
    },

    /**
     * POST /api/loops - Create a new loop
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

      // Preflight check: verify no uncommitted changes before creating the loop
      // This prevents creating loops that can never be started
      try {
        const executor = await backendManager.getCommandExecutorAsync(body.directory);
        const git = GitService.withExecutor(executor);
        const hasChanges = await git.hasUncommittedChanges(body.directory);

        if (hasChanges) {
          const changedFiles = await git.getChangedFiles(body.directory);
          
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

      try {
        const loop = await loopManager.createLoop({
          name: body.name,
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
          baseBranch: body.baseBranch,
          clearPlanningFolder: body.clearPlanningFolder,
          planMode: body.planMode,
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
     * GET /api/loops/:id - Get a specific loop
     */
    async GET(req: Request & { params: { id: string } }): Promise<Response> {
      const loop = await loopManager.getLoop(req.params.id);
      if (!loop) {
        return errorResponse("not_found", "Loop not found", 404);
      }
      return Response.json(loop);
    },

    /**
     * PATCH /api/loops/:id - Update a loop
     */
    async PATCH(req: Request & { params: { id: string } }): Promise<Response> {
      const body = await parseBody<UpdateLoopRequest>(req);
      if (!body) {
        return errorResponse("invalid_body", "Request body must be valid JSON");
      }

      try {
        // Transform the request to match the expected type
        // git needs special handling since UpdateLoopRequest has Partial<GitConfig>
        const { git, ...rest } = body;
        const updates: Record<string, unknown> = { ...rest };
        
        // If git is provided, we need to get the existing config and merge
        if (git !== undefined) {
          const existingLoop = await loopManager.getLoop(req.params.id);
          if (existingLoop) {
            updates["git"] = { ...existingLoop.config.git, ...git };
          }
        }

        const loop = await loopManager.updateLoop(req.params.id, updates);
        if (!loop) {
          return errorResponse("not_found", "Loop not found", 404);
        }
        return Response.json(loop);
      } catch (error) {
        return errorResponse("update_failed", String(error), 500);
      }
    },

    /**
     * DELETE /api/loops/:id - Delete a loop
     */
    async DELETE(req: Request & { params: { id: string } }): Promise<Response> {
      const deleted = await loopManager.deleteLoop(req.params.id);
      if (!deleted) {
        return errorResponse("not_found", "Loop not found", 404);
      }
      return successResponse();
    },
  },
};

/**
 * Loops control routes (accept, discard, push, etc.).
 * Note: Start functionality is handled automatically during loop creation.
 */
export const loopsControlRoutes = {
  "/api/loops/:id/accept": {
    /**
     * POST /api/loops/:id/accept - Accept and merge a completed loop
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
     * POST /api/loops/:id/push - Push a completed loop's branch to remote
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
     * POST /api/loops/:id/discard - Discard a loop (delete git branch)
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
     * POST /api/loops/:id/purge - Permanently delete a merged or deleted loop
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

  "/api/loops/:id/pending-prompt": {
    /**
     * PUT /api/loops/:id/pending-prompt - Set the pending prompt for next iteration
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
     * DELETE /api/loops/:id/pending-prompt - Clear the pending prompt
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
     * POST /api/loops/:id/plan/feedback - Send feedback to refine the plan
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
     * POST /api/loops/:id/plan/accept - Accept the plan and start execution
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
        return errorResponse("accept_failed", errorMsg, 500);
      }
    },
  },

  "/api/loops/:id/plan/discard": {
    /**
     * POST /api/loops/:id/plan/discard - Discard the plan and delete the loop
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
 * Loops data routes (messages, logs, diff, plan, status-file).
 */
export const loopsDataRoutes = {
  "/api/loops/:id/diff": {
    /**
     * GET /api/loops/:id/diff - Get git diff for a loop
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
     * GET /api/loops/:id/plan - Get plan.md content
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
     * GET /api/loops/:id/status-file - Get status.md content
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
     * GET /api/check-planning-dir?directory=<path> - Check if .planning directory exists and has files
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
 * All loops routes combined.
 */
export const loopsRoutes = {
  ...loopsCrudRoutes,
  ...loopsControlRoutes,
  ...loopsDataRoutes,
};
