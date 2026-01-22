/**
 * Git API endpoints for Ralph Loops Management System.
 * Provides git information for directories.
 * 
 * Uses the CommandExecutor abstraction to support both:
 * - Spawn mode: Git commands run locally via Bun.$
 * - Connect mode: Git commands run remotely via PTY+WebSocket
 */

import { backendManager } from "../core/backend-manager";
import { GitService } from "../core/git-service";

/**
 * Branch information returned by the API.
 */
export interface BranchInfo {
  /** Branch name */
  name: string;
  /** Whether this is the current branch */
  current: boolean;
}

/**
 * Response for GET /api/git/branches
 */
export interface BranchesResponse {
  /** Current branch name */
  currentBranch: string;
  /** All local branches */
  branches: BranchInfo[];
}

/**
 * Get a GitService configured for the current backend mode.
 * In spawn mode, uses local execution.
 * In connect mode, uses remote execution via PTY+WebSocket.
 */
function getGitService(directory: string): GitService {
  const executor = backendManager.getCommandExecutor(directory);
  return GitService.withExecutor(executor);
}

export const gitRoutes = {
  /**
   * GET /api/git/branches
   * Get all local branches for a directory.
   * Query param: directory (required)
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
        const git = getGitService(directory);

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
