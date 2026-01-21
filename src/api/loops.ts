/**
 * Loops API endpoints for Ralph Loops Management System.
 * Handles CRUD operations and loop control (start, stop, accept, discard).
 */

import { loopManager } from "../core/loop-manager";
import { gitService } from "../core/git-service";
import { setLastModel } from "../persistence/preferences";
import type {
  CreateLoopRequest,
  UpdateLoopRequest,
  StartLoopRequest,
  AcceptResponse,
  PushResponse,
  ErrorResponse,
  UncommittedChangesError,
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

      try {
        const loop = await loopManager.createLoop({
          name: body.name,
          directory: body.directory,
          prompt: body.prompt,
          modelProviderID: body.model?.providerID,
          modelID: body.model?.modelID,
          maxIterations: body.maxIterations,
          maxConsecutiveErrors: body.maxConsecutiveErrors,
          stopPattern: body.stopPattern,
          gitBranchPrefix: body.git?.branchPrefix,
          gitCommitPrefix: body.git?.commitPrefix,
        });

        // Save the model as last used if provided
        if (body.model?.providerID && body.model?.modelID) {
          // Fire and forget - don't block on this
          setLastModel({
            providerID: body.model.providerID,
            modelID: body.model.modelID,
          }).catch(() => {
            // Ignore errors saving preferences
          });
        }

        return Response.json(loop, { status: 201 });
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
 * Loops control routes (start, stop, accept, discard).
 */
export const loopsControlRoutes = {
  "/api/loops/:id/start": {
    /**
     * POST /api/loops/:id/start - Start a loop
     */
    async POST(req: Request & { params: { id: string } }): Promise<Response> {
      const body = await parseBody<StartLoopRequest>(req);

      try {
        await loopManager.startLoop(req.params.id, {
          handleUncommitted: body?.handleUncommitted,
        });
        return successResponse();
      } catch (error) {
        // Check for uncommitted changes error
        const err = error as Error & { code?: string; changedFiles?: string[] };
        if (err.code === "UNCOMMITTED_CHANGES") {
          const response: UncommittedChangesError = {
            error: "uncommitted_changes",
            message: err.message,
            options: ["commit", "stash", "cancel"],
            changedFiles: err.changedFiles ?? [],
          };
          return Response.json(response, { status: 409 });
        }

        // Check for common errors
        if (err.message?.includes("not found")) {
          return errorResponse("not_found", "Loop not found", 404);
        }
        if (err.message?.includes("already running")) {
          return errorResponse("already_running", err.message, 409);
        }

        return errorResponse("start_failed", String(error), 500);
      }
    },
  },

  "/api/loops/:id/stop": {
    /**
     * POST /api/loops/:id/stop - Stop a loop
     */
    async POST(req: Request & { params: { id: string } }): Promise<Response> {
      try {
        await loopManager.stopLoop(req.params.id);
        return successResponse();
      } catch (error) {
        const message = String(error);
        if (message.includes("not running")) {
          return errorResponse("not_running", "Loop is not running", 409);
        }
        return errorResponse("stop_failed", message, 500);
      }
    },
  },

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
        const diffs = await gitService.getDiffWithContent(
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

      const planPath = `${loop.config.directory}/.planning/plan.md`;
      const file = Bun.file(planPath);

      const response: FileContentResponse = {
        content: "",
        exists: false,
      };

      if (await file.exists()) {
        response.content = await file.text();
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

      const statusPath = `${loop.config.directory}/.planning/status.md`;
      const file = Bun.file(statusPath);

      const response: FileContentResponse = {
        content: "",
        exists: false,
      };

      if (await file.exists()) {
        response.content = await file.text();
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
        // Check if directory exists by trying to read it
        const glob = new Bun.Glob("*");
        const files: string[] = [];
        
        try {
          for await (const file of glob.scan({ cwd: planningDir, onlyFiles: true })) {
            files.push(file);
          }
        } catch {
          // Directory doesn't exist or can't be read
          return Response.json({
            exists: false,
            hasFiles: false,
            files: [],
            warning: "The .planning directory does not exist. Ralph Loops work best with planning documents.",
          });
        }

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
