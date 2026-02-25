/**
 * Git API endpoints for Ralph Loops Management System.
 * 
 * This module provides git-related endpoints for querying repository information.
 * All git operations use the deterministic CommandExecutor abstraction
 * (local or SSH execution providers).
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
import { errorResponse } from "./helpers";

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
 * Get a GitService configured for the current execution provider.
 * Uses deterministic command execution (local/SSH), independent of agent transport.
 * 
 * @param directory - The directory containing the git repository
 * @returns Configured GitService instance
 * @throws Error if no workspace is found for the directory
 */
async function getGitService(directory: string): Promise<GitService> {
  log.debug("Getting GitService for directory", { directory });
  // Look up the workspace by directory to get its workspaceId
  const workspace = await getWorkspaceByDirectory(directory);
  if (!workspace) {
    log.warn("No workspace found for directory", { directory });
    throw new Error(`No workspace found for directory: ${directory}`);
  }
  const executor = await backendManager.getCommandExecutorAsync(workspace.id, directory);
  log.debug("GitService created", { workspaceId: workspace.id });
  return GitService.withExecutor(executor);
}

/**
 * Validate git request: extract directory, get GitService, and verify it's a git repo.
 * Shared boilerplate for all git endpoints.
 *
 * @returns Object with git service and directory on success, or an error Response
 */
async function validateGitRequest(req: Request): Promise<
  { git: GitService; directory: string } | Response
> {
  const url = new URL(req.url);
  const directory = url.searchParams.get("directory");

  if (!directory) {
    log.warn("Missing directory parameter");
    return errorResponse("missing_parameter", "directory query parameter is required");
  }

  const git = await getGitService(directory);

  const isGitRepo = await git.isGitRepo(directory);
  if (!isGitRepo) {
    log.debug("Directory is not a git repository", { directory });
    return errorResponse("not_git_repo", "Directory is not a git repository");
  }

  return { git, directory };
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
      log.debug("GET /api/git/branches");

      try {
        const result = await validateGitRequest(req);
        if (result instanceof Response) return result;
        const { git, directory } = result;

        const branches = await git.getLocalBranches(directory);
        const currentBranch = branches.find((b) => b.current)?.name ?? "";

        const response: BranchesResponse = {
          currentBranch,
          branches,
        };

        log.debug("Branches retrieved", { directory, currentBranch, branchCount: branches.length });
        return Response.json(response);
      } catch (error) {
        log.error("Git branches error", { error: String(error) });
        return errorResponse("git_error", String(error), 500);
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
      log.debug("GET /api/git/default-branch");

      try {
        const result = await validateGitRequest(req);
        if (result instanceof Response) return result;
        const { git, directory } = result;

        const defaultBranch = await git.getDefaultBranch(directory);

        const response: DefaultBranchResponse = {
          defaultBranch,
        };

        log.debug("Default branch retrieved", { directory, defaultBranch });
        return Response.json(response);
      } catch (error) {
        log.error("Git default-branch error", { error: String(error) });
        return errorResponse("git_error", String(error), 500);
      }
    },
  },
};
