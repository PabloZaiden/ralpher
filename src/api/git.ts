/**
 * Git API endpoints for Ralph Loops Management System.
 * 
 * This module provides git-related endpoints for querying repository information.
 * All git operations use the CommandExecutor abstraction which works identically
 * for both spawn and connect modes via PTY+WebSocket.
 * 
 * Endpoints:
 * - GET /api/git/branches - Get all local branches for a directory
 * 
 * @module api/git
 */

import { backendManager } from "../core/backend-manager";
import { GitService } from "../core/git-service";

/**
 * Branch information returned by the API.
 */
export interface BranchInfo {
  /** Branch name (e.g., "main", "feature/auth") */
  name: string;
  /** Whether this is the currently checked out branch */
  current: boolean;
}

/**
 * Response for GET /api/git/branches endpoint.
 */
export interface BranchesResponse {
  /** Name of the currently checked out branch */
  currentBranch: string;
  /** All local branches in the repository */
  branches: BranchInfo[];
}

/**
 * Get a GitService configured for the current backend mode.
 * Uses PTY+WebSocket for command execution in both spawn and connect modes.
 * 
 * @param directory - The directory containing the git repository
 * @returns Configured GitService instance
 */
async function getGitService(directory: string): Promise<GitService> {
  const executor = await backendManager.getCommandExecutorAsync(directory);
  return GitService.withExecutor(executor);
}

/**
 * Git API routes.
 * 
 * Provides endpoints for git repository information:
 * - GET /api/git/branches - List all local branches
 */
export const gitRoutes = {
  /**
   * GET /api/git/branches - Get all local branches for a directory.
   * 
   * Returns the list of local branches and identifies which one is current.
   * Validates that the directory is a git repository.
   * 
   * Query Parameters:
   * - directory (required): Path to the git repository
   * 
   * Errors:
   * - 400: Missing directory parameter or not a git repo
   * - 500: Git command error
   * 
   * @returns BranchesResponse with currentBranch and branches array
   */
  "/api/git/branches": {
    async GET(req: Request): Promise<Response> {
      const url = new URL(req.url);
      const directory = url.searchParams.get("directory");

      if (!directory) {
        return Response.json(
          { error: "missing_parameter", message: "directory query parameter is required" },
          { status: 400 }
        );
      }

      try {
        // Get mode-appropriate git service
        const git = await getGitService(directory);

        // Check if it's a git repo
        const isGitRepo = await git.isGitRepo(directory);
        if (!isGitRepo) {
          return Response.json(
            { error: "not_git_repo", message: "Directory is not a git repository" },
            { status: 400 }
          );
        }

        const branches = await git.getLocalBranches(directory);
        const currentBranch = branches.find((b) => b.current)?.name ?? "";

        const response: BranchesResponse = {
          currentBranch,
          branches,
        };

        return Response.json(response);
      } catch (error) {
        return Response.json(
          { error: "git_error", message: String(error) },
          { status: 500 }
        );
      }
    },
  },
};
