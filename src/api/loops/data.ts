/**
 * Loops data routes (diff, plan, status-file, check-planning-dir).
 *
 * Provides read access to loop data and files:
 * - GET /api/loops/:id/diff - Get git diff for loop changes
 * - GET /api/loops/:id/plan - Get .planning/plan.md content
 * - GET /api/loops/:id/status-file - Get .planning/status.md content
 * - GET /api/loops/:id/pull-request - Get PR navigation metadata for pushed loops
 * - GET /api/check-planning-dir - Check if .planning directory exists
 */

import { getLoopWorkingDirectory, loopManager } from "../../core/loop-manager";
import { backendManager } from "../../core/backend-manager";
import { GitService } from "../../core/git-service";
import type { FileContentResponse, PullRequestDestinationResponse } from "../../types/api";
import { errorResponse, normalizeDirectoryPath, resolveWorkspaceForDirectory } from "../helpers";

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
        const workDir = getLoopWorkingDirectory(loop);
        if (!workDir) {
          return errorResponse("no_worktree", "Loop is configured to use a worktree, but no worktree path is available.", 400);
        }
        const executor = await backendManager.getCommandExecutorAsync(loop.config.workspaceId, workDir);
        const git = GitService.withExecutor(executor);

        const diffs = await git.getDiffWithContent(
          workDir,
          loop.state.git.originalBranch,
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

      const workDir = getLoopWorkingDirectory(loop);
      if (!workDir) {
        return errorResponse("no_worktree", "Loop is configured to use a worktree, but no worktree path is available.", 400);
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

      const workDir = getLoopWorkingDirectory(loop);
      if (!workDir) {
        return errorResponse("no_worktree", "Loop is configured to use a worktree, but no worktree path is available.", 400);
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

  "/api/loops/:id/pull-request": {
    /**
     * GET /api/loops/:id/pull-request - Get PR navigation metadata for a loop.
     *
     * Returns an existing PR URL, a PR creation URL, or a disabled state when
     * the workspace host cannot resolve a safe destination.
     */
    async GET(req: Request & { params: { id: string } }): Promise<Response> {
      const destination = await loopManager.getPullRequestDestination(req.params.id);
      if (!destination) {
        return errorResponse("not_found", "Loop not found", 404);
      }

      const response: PullRequestDestinationResponse = destination;
      return Response.json(response);
    },
  },

  "/api/check-planning-dir": {
    /**
     * GET /api/check-planning-dir - Check if .planning directory exists.
     *
     * Checks if a directory has a .planning folder and lists its contents.
     * Useful for validating a project before creating a loop. When multiple
     * workspaces share the same directory path across different server targets,
     * callers should pass `workspaceId` to disambiguate the lookup.
     *
     * Query Parameters:
     * - directory (required): Absolute path to check
     * - workspaceId (optional): Workspace ID used to disambiguate shared directories
     *
     * Errors:
     * - 400: Missing directory parameter or workspaceId/directory mismatch
     * - 404: Workspace not found
     * - 409: Multiple workspaces use this directory and workspaceId was not provided
     * - 500: Failed to inspect the planning directory
     *
     * @returns Object with exists, hasFiles, files array, and optional warning
     */
    async GET(req: Request): Promise<Response> {
      const url = new URL(req.url);
      const directory = url.searchParams.get("directory");
      const workspaceId = url.searchParams.get("workspaceId");

      if (!directory) {
        return errorResponse("invalid_request", "directory query parameter is required", 400);
      }

      const normalizedDirectory = normalizeDirectoryPath(directory);
      const workspace = await resolveWorkspaceForDirectory(normalizedDirectory, workspaceId);
      if (workspace instanceof Response) {
        return workspace;
      }

      const planningDir = `${normalizedDirectory}/.planning`;

      try {
        // Get mode-appropriate command executor
        const executor = await backendManager.getCommandExecutorAsync(workspace.id, normalizedDirectory);

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


