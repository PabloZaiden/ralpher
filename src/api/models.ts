/**
 * Models and preferences API endpoints for Ralph Loops Management System.
 * 
 * This module provides endpoints for:
 * - Fetching available AI models for a workspace
 * - Managing user preferences (last used model, last used directory)
 * 
 * Uses workspace-specific server settings to connect to the opencode backend.
 * 
 * @module api/models
 */

import { backendManager, buildConnectionConfig } from "../core/backend-manager";
import { OpenCodeBackend } from "../backends/opencode";
import { getWorkspace } from "../persistence/workspaces";
import { getLastModel, setLastModel, getLastDirectory, setLastDirectory, getMarkdownRenderingEnabled, setMarkdownRenderingEnabled, getLogLevelPreference, setLogLevelPreference, DEFAULT_LOG_LEVEL } from "../persistence/preferences";
import { getDefaultServerSettings } from "../types/settings";
import type { ModelInfo } from "../types/api";
import { createLogger, setLogLevel as setBackendLogLevel, type LogLevelName, VALID_LOG_LEVELS, isLogLevelFromEnv } from "../core/logger";
import { parseAndValidate } from "./validation";
import { errorResponse } from "./helpers";

const log = createLogger("api:models");
import {
  SetLastModelRequestSchema,
  SetLastDirectoryRequestSchema,
  SetMarkdownRenderingRequestSchema,
  SetLogLevelRequestSchema,
} from "../types/schemas";

/**
 * Result of checking if a model is enabled/connected.
 */
export interface ModelValidationResult {
  /** Whether the model is enabled and can be used */
  enabled: boolean;
  /** Error message if the model is not enabled */
  error?: string;
  /** Error code for programmatic handling */
  errorCode?: "model_not_enabled" | "model_not_found" | "provider_not_found" | "validation_failed";
}

/**
 * Check if a model is enabled (its provider is connected).
 * 
 * This function fetches the available models for a workspace and checks
 * if the specified model exists and its provider is connected.
 * 
 * To avoid mutating global connection state during validation:
 * - If a test backend is set via setBackendForTesting(), it uses that (for testing)
 * - If the workspace backend is already connected, it uses that (no side effects)
 * - Otherwise, it creates a temporary OpenCodeBackend that connects and disconnects
 *   within this function, similar to GET /api/models
 * 
 * @param workspaceId - The workspace ID to check models for
 * @param directory - The working directory path
 * @param providerID - The provider ID (e.g., "anthropic")
 * @param modelID - The model ID (e.g., "claude-sonnet-4-20250514")
 * @returns Promise with validation result
 */
export async function isModelEnabled(
  workspaceId: string,
  directory: string,
  providerID: string,
  modelID: string
): Promise<ModelValidationResult> {
  try {
    let models: ModelInfo[];
    
    // Check if a test backend is set (for testing purposes)
    const testBackend = backendManager.getTestBackend();
    if (testBackend) {
      // Use test backend directly - no connection state mutation
      if (!testBackend.isConnected()) {
        await testBackend.connect(buildConnectionConfig(getDefaultServerSettings(), directory));
      }
      models = await testBackend.getModels(directory);
    } else {
      // Check if workspace backend is already connected
      const existingBackend = backendManager.getBackend(workspaceId);
      if (existingBackend.isConnected()) {
        // Use existing connected backend - no side effects
        models = await existingBackend.getModels(directory);
      } else {
        // Create a temporary backend (similar to GET /api/models)
        // This avoids mutating global connection state
        const workspace = await getWorkspace(workspaceId);
        if (!workspace) {
          return {
            enabled: false,
            error: `Workspace not found: ${workspaceId}`,
            errorCode: "validation_failed",
          };
        }
        
        const tempBackend = new OpenCodeBackend();
        try {
          await tempBackend.connect(buildConnectionConfig(workspace.serverSettings, directory));
          models = await tempBackend.getModels(directory);
        } finally {
          // Always disconnect temporary backend
          try {
            await tempBackend.disconnect();
          } catch (disconnectError) {
            log.trace("Failed to disconnect temporary backend", { error: String(disconnectError) });
          }
        }
      }
    }

    // Check if the provider exists
    const providerModels = models.filter((m) => m.providerID === providerID);
    if (providerModels.length === 0) {
      return {
        enabled: false,
        error: `Provider not found: ${providerID}`,
        errorCode: "provider_not_found",
      };
    }

    // Check if the specific model exists
    const model = providerModels.find((m) => m.modelID === modelID);
    if (!model) {
      return {
        enabled: false,
        error: `Model not found: ${modelID}`,
        errorCode: "model_not_found",
      };
    }

    // Check if the model's provider is connected
    if (!model.connected) {
      return {
        enabled: false,
        error: "The selected model's provider is not connected. Please check your API credentials.",
        errorCode: "model_not_enabled",
      };
    }

    return { enabled: true };
  } catch (error) {
    return {
      enabled: false,
      error: `Failed to validate model: ${String(error)}`,
      errorCode: "validation_failed",
    };
  }
}

/**
 * Models API routes.
 * 
 * Provides endpoint for fetching available AI models:
 * - GET /api/models - Get available models for a workspace
 */
export const modelsRoutes = {
  "/api/models": {
    /**
     * GET /api/models - Get available AI models.
     * 
     * Fetches the list of available AI models from the opencode backend.
     * Creates a temporary connection using workspace-specific server settings.
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

      // Create a temporary backend to get models (don't reuse the global one)
      // This avoids interfering with any running loops
      const backend = new OpenCodeBackend();
      
      try {
        // Connect using workspace-specific settings
        await backend.connect(buildConnectionConfig(workspace.serverSettings, directory));

        const models = await backend.getModels(directory);
        
        // Disconnect after getting models
        await backend.disconnect();

        return Response.json(models);
      } catch (error) {
        // Make sure to disconnect on error
        try {
          await backend.disconnect();
        } catch (disconnectError) {
          log.trace("Failed to disconnect backend on error path", { error: String(disconnectError) });
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
 * - GET/PUT /api/preferences/markdown-rendering - Markdown rendering preference
 */
export const preferencesRoutes = {
  "/api/preferences/last-model": {
    /**
     * GET /api/preferences/last-model - Get the last used model.
     * 
     * Retrieves the last AI model (provider + model ID + variant) used to create a loop.
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
     * - variant (optional): Model variant (e.g., "thinking")
     * 
     * @returns Success response
     */
    async PUT(req: Request): Promise<Response> {
      const result = await parseAndValidate(SetLastModelRequestSchema, req);
      if (!result.success) {
        return result.response;
      }

      try {
        await setLastModel({
          providerID: result.data.providerID,
          modelID: result.data.modelID,
          variant: result.data.variant,
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
      const result = await parseAndValidate(SetLastDirectoryRequestSchema, req);
      if (!result.success) {
        return result.response;
      }

      try {
        await setLastDirectory(result.data.directory);

        return Response.json({ success: true });
      } catch (error) {
        return errorResponse("save_failed", String(error), 500);
      }
    },
  },

  "/api/preferences/markdown-rendering": {
    /**
     * GET /api/preferences/markdown-rendering - Get markdown rendering preference.
     * 
     * Returns whether markdown rendering is enabled (true) or disabled (false).
     * Defaults to true if not set.
     * 
     * @returns Boolean indicating if markdown rendering is enabled
     */
    async GET(): Promise<Response> {
      const enabled = await getMarkdownRenderingEnabled();
      return Response.json({ enabled });
    },

    /**
     * PUT /api/preferences/markdown-rendering - Set markdown rendering preference.
     * 
     * Enables or disables markdown rendering across the application.
     * 
     * Request Body:
     * - enabled (required): Boolean - true to enable, false to disable
     * 
     * @returns Success response
     */
    async PUT(req: Request): Promise<Response> {
      const result = await parseAndValidate(SetMarkdownRenderingRequestSchema, req);
      if (!result.success) {
        return result.response;
      }

      try {
        await setMarkdownRenderingEnabled(result.data.enabled);

        return Response.json({ success: true });
      } catch (error) {
        return errorResponse("save_failed", String(error), 500);
      }
    },
  },

  "/api/preferences/log-level": {
    /**
     * GET /api/preferences/log-level - Get log level preference.
     * 
     * Returns the current log level setting and available levels.
     * Defaults to "info" if not set.
     * 
     * @returns Object with level (current level), availableLevels array, and isFromEnv flag
     */
    async GET(): Promise<Response> {
      const level = await getLogLevelPreference();
      return Response.json({
        level,
        defaultLevel: DEFAULT_LOG_LEVEL,
        availableLevels: VALID_LOG_LEVELS,
        isFromEnv: isLogLevelFromEnv(),
      });
    },

    /**
     * PUT /api/preferences/log-level - Set log level preference.
     * 
     * Sets the log level for both frontend and backend.
     * Valid levels: silly, trace, debug, info, warn, error, fatal
     * 
     * Request Body:
     * - level (required): Log level name string
     * 
     * @returns Success response
     */
    async PUT(req: Request): Promise<Response> {
      const result = await parseAndValidate(SetLogLevelRequestSchema, req);
      if (!result.success) {
        return result.response;
      }

      const level = result.data.level;

      if (!VALID_LOG_LEVELS.includes(level as LogLevelName)) {
        return errorResponse("invalid_level", `Invalid log level: ${level}. Valid levels are: ${VALID_LOG_LEVELS.join(", ")}`);
      }

      try {
        // Save to preferences
        await setLogLevelPreference(level as LogLevelName);
        
        // Also update the backend logger in real-time
        setBackendLogLevel(level as LogLevelName);

        return Response.json({ success: true, level });
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
