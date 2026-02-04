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
import { getWorkspaceByDirectory } from "../persistence/workspaces";
import type { BranchInfo } from "../types";
import { createLogger } from "../core/logger";

const log = createLogger("api:git");

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
 * Response for GET /api/git/default-branch endpoint.
 */
export interface DefaultBranchResponse {
  /** The repository's default branch (e.g., "main", "master") */
  defaultBranch: string;
}

/**
 * Get a GitService configured for the current backend mode.
 * Uses PTY+WebSocket for command execution in both spawn and connect modes.
 * 
 * @param directory - The directory containing the git repository
 * @returns Configured GitService instance
 * @throws Error if no workspace is found for the directory
 */
async function getGitService(directory: string): Promise<GitService> {
  log.trace("Getting GitService for directory", { directory });
  // Look up the workspace by directory to get its workspaceId
  const workspace = await getWorkspaceByDirectory(directory);
  if (!workspace) {
    log.warn("No workspace found for directory", { directory });
    throw new Error(`No workspace found for directory: ${directory}`);
  }
  const executor = await backendManager.getCommandExecutorAsync(workspace.id, directory);
  log.trace("GitService created", { workspaceId: workspace.id });
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

      log.debug("GET /api/git/branches", { directory });

      if (!directory) {
        log.warn("Missing directory parameter");
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
          log.debug("Directory is not a git repository", { directory });
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

        log.trace("Branches retrieved", { directory, currentBranch, branchCount: branches.length });
        return Response.json(response);
      } catch (error) {
        log.error("Git branches error", { directory, error: String(error) });
        return Response.json(
          { error: "git_error", message: String(error) },
          { status: 500 }
        );
      }
    },
  },

  /**
   * GET /api/git/default-branch - Get the repository's default branch.
   * 
   * Returns the default branch for the repository (typically "main" or "master").
   * Uses detection strategy: origin/HEAD → main → master → current branch.
   * 
   * Query Parameters:
   * - directory (required): Path to the git repository
   * 
   * Errors:
   * - 400: Missing directory parameter or not a git repo
   * - 500: Git command error
   * 
   * @returns DefaultBranchResponse with defaultBranch
   */
  "/api/git/default-branch": {
    async GET(req: Request): Promise<Response> {
      const url = new URL(req.url);
      const directory = url.searchParams.get("directory");

      log.debug("GET /api/git/default-branch", { directory });

      if (!directory) {
        log.warn("Missing directory parameter");
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
          log.debug("Directory is not a git repository", { directory });
          return Response.json(
            { error: "not_git_repo", message: "Directory is not a git repository" },
            { status: 400 }
          );
        }

        const defaultBranch = await git.getDefaultBranch(directory);

        const response: DefaultBranchResponse = {
          defaultBranch,
        };

        log.trace("Default branch retrieved", { directory, defaultBranch });
        return Response.json(response);
      } catch (error) {
        log.error("Git default-branch error", { directory, error: String(error) });
        return Response.json(
          { error: "git_error", message: String(error) },
          { status: 500 }
        );
      }
    },
  },
};
