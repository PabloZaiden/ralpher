/**
 * Git API endpoints for Ralph Loops Management System.
 * Provides git information for directories.
 */

import { gitService } from "../core/git-service";

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
        // Check if it's a git repo
        const isGitRepo = await gitService.isGitRepo(directory);
        if (!isGitRepo) {
          return Response.json(
            { error: "not_git_repo", message: "Directory is not a git repository" },
            { status: 400 }
          );
        }

        const branches = await gitService.getLocalBranches(directory);
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
