/**
 * Models and preferences API endpoints for Ralph Loops Management System.
 * Handles model listing and user preferences.
 */

import { OpenCodeBackend } from "../backends/opencode";
import { getLastModel, setLastModel } from "../persistence/preferences";
import type { ErrorResponse } from "../types/api";

/**
 * Helper to create error response.
 */
function errorResponse(error: string, message: string, status = 400): Response {
  const body: ErrorResponse = { error, message };
  return Response.json(body, { status });
}

/**
 * Models API routes.
 */
export const modelsRoutes = {
  "/api/models": {
    /**
     * GET /api/models - Get available models
     * Query params:
     *   - directory: working directory (required)
     */
    async GET(req: Request): Promise<Response> {
      const url = new URL(req.url);
      const directory = url.searchParams.get("directory");

      if (!directory) {
        return errorResponse("missing_directory", "directory query parameter is required");
      }

      // Create a temporary backend connection to get models
      const backend = new OpenCodeBackend();
      
      try {
        // Connect in spawn mode to get models
        await backend.connect({
          mode: "spawn",
          directory,
        });

        const models = await backend.getModels(directory);
        
        // Disconnect after getting models
        await backend.disconnect();

        return Response.json(models);
      } catch (error) {
        // Make sure to disconnect on error
        try {
          await backend.disconnect();
        } catch {
          // Ignore disconnect errors
        }
        return errorResponse("models_failed", String(error), 500);
      }
    },
  },
};

/**
 * Preferences API routes.
 */
export const preferencesRoutes = {
  "/api/preferences/last-model": {
    /**
     * GET /api/preferences/last-model - Get last used model
     */
    async GET(): Promise<Response> {
      const lastModel = await getLastModel();
      return Response.json(lastModel ?? null);
    },

    /**
     * PUT /api/preferences/last-model - Set last used model
     */
    async PUT(req: Request): Promise<Response> {
      try {
        const body = await req.json() as { providerID: string; modelID: string };
        
        if (!body.providerID || !body.modelID) {
          return errorResponse("invalid_body", "providerID and modelID are required");
        }

        await setLastModel({
          providerID: body.providerID,
          modelID: body.modelID,
        });

        return Response.json({ success: true });
      } catch (error) {
        return errorResponse("save_failed", String(error), 500);
      }
    },
  },
};

/**
 * All models and preferences routes combined.
 */
export const modelsAndPreferencesRoutes = {
  ...modelsRoutes,
  ...preferencesRoutes,
};
