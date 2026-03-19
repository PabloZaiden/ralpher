/**
 * Route handler for workspace lookup by directory path.
 */

import { listWorkspacesByDirectory } from "../../persistence/workspaces";
import { createLogger } from "../../core/logger";
import {
  errorResponse,
  normalizeDirectoryPath,
  resolveWorkspaceForDirectory,
} from "../helpers";

const log = createLogger("api:workspaces");

export const byDirectoryRoutes = {
  /**
   * GET /api/workspaces/by-directory?directory=... - Get workspace by directory
   *
   * Query Parameters:
   * - directory (required): Directory path to resolve
   * - workspaceId (optional): Workspace ID used to disambiguate shared directories
   *
   * Errors:
   * - 400: Missing directory parameter or workspaceId/directory mismatch
   * - 404: No workspace found for the directory
   * - 409: Multiple workspaces use this directory and workspaceId was not provided
   * - 500: Failed to read workspace data
   */
  "/api/workspaces/by-directory": {
    async GET(req: Request) {
      const url = new URL(req.url);
      const directory = url.searchParams.get("directory");
      const workspaceId = url.searchParams.get("workspaceId");

      if (!directory) {
        return errorResponse("missing_parameter", "directory query parameter is required");
      }

      try {
        const normalizedDirectory = normalizeDirectoryPath(directory);
        if (workspaceId) {
          const workspace = await resolveWorkspaceForDirectory(normalizedDirectory, workspaceId);
          if (workspace instanceof Response) {
            return workspace;
          }
          return Response.json(workspace);
        }

        const matches = await listWorkspacesByDirectory(normalizedDirectory);
        if (matches.length === 0) {
          return errorResponse("workspace_not_found", "No workspace found for this directory", 404);
        }
        if (matches.length > 1) {
          return errorResponse(
            "ambiguous_workspace",
            "Multiple workspaces use this directory. Provide workspaceId for an unambiguous lookup.",
            409,
          );
        }
        return Response.json(matches[0]);
      } catch (error) {
        log.error("Failed to get workspace by directory:", String(error));
        return errorResponse("get_failed", `Failed to get workspace: ${String(error)}`, 500);
      }
    },
  },
};
