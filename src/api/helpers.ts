/**
 * Shared API helper functions.
 *
 * This module provides common utilities used across API route handlers
 * to reduce code duplication and ensure consistent response formatting.
 *
 * @module api/helpers
 */

import type { ErrorResponse } from "../types/api";
import type { Workspace } from "../types/workspace";
import { getWorkspace, listWorkspacesByDirectory } from "../persistence/workspaces";

/**
 * Create a standardized error response.
 *
 * @param error - Error code for programmatic handling
 * @param message - Human-readable error description
 * @param status - HTTP status code (default: 400)
 * @returns JSON Response with error details
 */
export function errorResponse(error: string, message: string, status = 400): Response {
  const body: ErrorResponse = { error, message };
  return Response.json(body, { status });
}

/**
 * Create a standardized success response.
 *
 * @param data - Additional data to include in the response
 * @returns JSON Response with success: true and any additional data
 */
export function successResponse(data: Record<string, unknown> = {}): Response {
  return Response.json({ success: true, ...data });
}

/**
 * Normalize a directory string received through API inputs.
 */
export function normalizeDirectoryPath(directory: string): string {
  return directory.trim();
}

/**
 * Look up a workspace by ID and return it, or return a 404 error response.
 *
 * This helper eliminates the repeated pattern of:
 *   const workspace = await getWorkspace(id);
 *   if (!workspace) { return Response.json({ message: "Workspace not found" }, { status: 404 }); }
 *
 * @param workspaceId - The workspace ID to look up
 * @returns Either the workspace object, or a 404 Response
 */
export async function requireWorkspace(
  workspaceId: string,
): Promise<Workspace | Response> {
  const workspace = await getWorkspace(workspaceId);
  if (!workspace) {
    return errorResponse("workspace_not_found", "Workspace not found", 404);
  }
  return workspace;
}

/**
 * Resolve a workspace for a request that includes a directory and optional workspaceId.
 * Uses workspaceId when provided, otherwise requires the directory lookup to be unambiguous.
 */
export async function resolveWorkspaceForDirectory(
  directory: string,
  workspaceId?: string | null,
): Promise<Workspace | Response> {
  const normalizedDirectory = normalizeDirectoryPath(directory);

  if (workspaceId) {
    const workspace = await getWorkspace(workspaceId);
    if (!workspace) {
      return errorResponse("workspace_not_found", "Workspace not found", 404);
    }
    if (normalizeDirectoryPath(workspace.directory) !== normalizedDirectory) {
      return errorResponse(
        "workspace_directory_mismatch",
        "workspaceId does not match the requested directory",
        400,
      );
    }
    return workspace;
  }

  const matches = await listWorkspacesByDirectory(normalizedDirectory);
  if (matches.length === 0) {
    return errorResponse(
      "workspace_not_found",
      `No workspace found for directory: ${normalizedDirectory}`,
      404,
    );
  }
  if (matches.length > 1) {
    return errorResponse(
      "ambiguous_workspace",
      "Multiple workspaces use this directory. Provide workspaceId to disambiguate.",
      409,
    );
  }

  return matches[0]!;
}
