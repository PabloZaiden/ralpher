/**
 * Models listing API route.
 *
 * - GET /api/models - Get available AI models for a workspace
 *
 * @module api/models/models-routes
 */

import { getWorkspace } from "../../persistence/workspaces";
import { errorResponse } from "../helpers";
import { getModelsForWorkspace } from "./model-discovery";

/**
 * Models API routes.
 */
export const modelsRoutes = {
  "/api/models": {
    /**
     * GET /api/models - Get available AI models.
     *
     * Fetches the list of available AI models using provider-aware discovery.
     *
     * Query Parameters:
     * - directory (required): Working directory path for model context
     * - workspaceId (required): Workspace ID to use for server settings
     *
     * @returns Array of ModelInfo objects with provider and model details
     */
    async GET(req: Request): Promise<Response> {
      const url = new URL(req.url);
      const directory = url.searchParams.get("directory");
      const workspaceId = url.searchParams.get("workspaceId");

      if (!directory) {
        return errorResponse("missing_directory", "directory query parameter is required");
      }

      if (!workspaceId) {
        return errorResponse("missing_workspace_id", "workspaceId query parameter is required");
      }

      // Get workspace-specific server settings
      const workspace = await getWorkspace(workspaceId);
      if (!workspace) {
        return errorResponse("workspace_not_found", `Workspace not found: ${workspaceId}`, 404);
      }

      try {
        const models = await getModelsForWorkspace(workspaceId, directory, workspace);
        return Response.json(models);
      } catch (error) {
        return errorResponse("models_failed", String(error), 500);
      }
    },
  },
};
