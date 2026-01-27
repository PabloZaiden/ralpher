/**
 * Models and preferences API endpoints for Ralph Loops Management System.
 * 
 * This module provides endpoints for:
 * - Fetching available AI models for a directory
 * - Managing user preferences (last used model, last used directory)
 * 
 * Uses the global backend manager settings to connect to the opencode backend.
 * 
 * @module api/models
 */

import { backendManager } from "../core/backend-manager";
import { OpenCodeBackend } from "../backends/opencode";
import { getLastModel, setLastModel, getLastDirectory, setLastDirectory } from "../persistence/preferences";
import type { ErrorResponse } from "../types/api";

/**
 * Create a standardized error response.
 * 
 * @param error - Error code for programmatic handling
 * @param message - Human-readable error description
 * @param status - HTTP status code (default: 400)
 * @returns JSON Response with error details
 */
function errorResponse(error: string, message: string, status = 400): Response {
  const body: ErrorResponse = { error, message };
  return Response.json(body, { status });
}

/**
 * Models API routes.
 * 
 * Provides endpoint for fetching available AI models:
 * - GET /api/models - Get available models for a directory
 */
export const modelsRoutes = {
  "/api/models": {
    /**
     * GET /api/models - Get available AI models.
     * 
     * Fetches the list of available AI models from the opencode backend.
     * Creates a temporary connection to avoid interfering with running loops.
     * 
     * Query Parameters:
     * - directory (required): Working directory path for model context
     * 
     * @returns Array of ModelInfo objects with provider and model details
     */
    async GET(req: Request): Promise<Response> {
      const url = new URL(req.url);
      const directory = url.searchParams.get("directory");

      if (!directory) {
        return errorResponse("missing_directory", "directory query parameter is required");
      }

      // Create a temporary backend to get models (don't reuse the global one)
      // This avoids interfering with any running loops
      const backend = new OpenCodeBackend();
      
      try {
        // Connect using global settings
        await backend.connect(backendManager.getConnectionConfig(directory));

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
 * 
 * Provides endpoints for managing user preferences:
 * - GET/PUT /api/preferences/last-model - Last used AI model
 * - GET/PUT /api/preferences/last-directory - Last used working directory
 */
export const preferencesRoutes = {
  "/api/preferences/last-model": {
    /**
     * GET /api/preferences/last-model - Get the last used model.
     * 
     * Retrieves the last AI model (provider + model ID) used to create a loop.
     * Used to pre-populate the model selector in the UI.
     * 
     * @returns ModelConfig object or null if none set
     */
    async GET(): Promise<Response> {
      const lastModel = await getLastModel();
      return Response.json(lastModel ?? null);
    },

    /**
     * PUT /api/preferences/last-model - Set the last used model.
     * 
     * Saves the model selection so it can be pre-populated next time.
     * Automatically called when creating a loop with a model.
     * 
     * Request Body:
     * - providerID (required): Provider ID (e.g., "anthropic")
     * - modelID (required): Model ID (e.g., "claude-sonnet-4-20250514")
     * 
     * @returns Success response
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

  "/api/preferences/last-directory": {
    /**
     * GET /api/preferences/last-directory - Get the last used working directory.
     * 
     * Retrieves the last working directory used to create a loop.
     * Used to pre-populate the directory field in the UI.
     * 
     * @returns Directory path string or null if none set
     */
    async GET(): Promise<Response> {
      const lastDirectory = await getLastDirectory();
      return Response.json(lastDirectory ?? null);
    },

    /**
     * PUT /api/preferences/last-directory - Set the last used working directory.
     * 
     * Saves the working directory so it can be pre-populated next time.
     * 
     * Request Body:
     * - directory (required): Absolute path to the directory
     * 
     * @returns Success response
     */
    async PUT(req: Request): Promise<Response> {
      try {
        const body = await req.json() as { directory: string };
        
        if (!body.directory) {
          return errorResponse("invalid_body", "directory is required");
        }

        await setLastDirectory(body.directory);

        return Response.json({ success: true });
      } catch (error) {
        return errorResponse("save_failed", String(error), 500);
      }
    },
  },
};

/**
 * All models and preferences routes combined.
 * Can be spread into the main API routes object.
 */
export const modelsAndPreferencesRoutes = {
  ...modelsRoutes,
  ...preferencesRoutes,
};
