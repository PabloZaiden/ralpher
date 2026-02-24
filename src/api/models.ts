/**
 * Models and preferences API endpoints for Ralph Loops Management System.
 * 
 * This module provides endpoints for:
 * - Fetching available AI models for a workspace
 * - Managing user preferences (last used model, last used directory)
 * 
 * Uses workspace-specific server settings and provider-aware discovery routing.
 * 
 * @module api/models
 */

import { backendManager, buildConnectionConfig } from "../core/backend-manager";
import { getWorkspace } from "../persistence/workspaces";
import { getLastModel, setLastModel, getLastDirectory, setLastDirectory, getMarkdownRenderingEnabled, setMarkdownRenderingEnabled, getLogLevelPreference, setLogLevelPreference, DEFAULT_LOG_LEVEL, getDashboardViewMode, setDashboardViewMode } from "../persistence/preferences";
import type { ServerSettings } from "../types/settings";
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
  SetDashboardViewModeRequestSchema,
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
 * Parse supported model IDs from `copilot --help` output.
 */
function parseCopilotModelChoices(helpText: string): string[] {
  const modelFlagIndex = helpText.indexOf("--model <model>");
  if (modelFlagIndex < 0) {
    return [];
  }

  const afterModelFlag = helpText.slice(modelFlagIndex + 1);
  const nextOptionOffset = afterModelFlag.search(/\n\s{2,}--[a-z0-9-]+/i);
  const endIndex = nextOptionOffset >= 0
    ? modelFlagIndex + 1 + nextOptionOffset
    : helpText.length;
  const modelSection = helpText.slice(modelFlagIndex, endIndex);

  const modelIds = Array.from(modelSection.matchAll(/"([^"]+)"/g))
    .map((match) => match[1]?.trim() ?? "")
    .filter((modelId) => modelId.length > 0);

  return Array.from(new Set(modelIds));
}

/**
 * Build ModelInfo rows for Copilot CLI-discovered models.
 */
function mapCopilotModelInfo(modelIds: string[]): ModelInfo[] {
  return modelIds.map((modelId) => ({
    providerID: "copilot",
    providerName: "Copilot",
    modelID: modelId,
    modelName: modelId,
    connected: true,
  }));
}

/**
 * Discover models through the execution channel using the Copilot CLI.
 */
async function getCopilotModelsViaExecution(
  workspaceId: string,
  directory: string,
): Promise<ModelInfo[]> {
  const executor = await backendManager.getCommandExecutorAsync(workspaceId, directory);
  const result = await executor.exec("copilot", ["--help"], { cwd: directory });

  if (!result.success) {
    throw new Error(
      `Failed to query Copilot models via copilot --help: ${result.stderr || result.stdout || `exit code ${result.exitCode}`}`,
    );
  }

  const modelIds = parseCopilotModelChoices(`${result.stdout}\n${result.stderr}`);
  if (modelIds.length === 0) {
    throw new Error(
      "Could not parse model choices from copilot --help output",
    );
  }

  return mapCopilotModelInfo(modelIds);
}

/**
 * Discover models via the configured agent backend (OpenCode path).
 */
async function getAgentBackendModels(
  workspaceId: string,
  directory: string,
  settings: ServerSettings,
): Promise<ModelInfo[]> {
  const testBackend = backendManager.getTestBackend();
  if (testBackend) {
    if (!testBackend.isConnected()) {
      await testBackend.connect(buildConnectionConfig(settings, directory));
    }
    return await testBackend.getModels(directory);
  }

  const existingBackend = backendManager.getBackend(workspaceId);
  if (existingBackend.isConnected()) {
    return await existingBackend.getModels(directory);
  }

  const tempBackend = backendManager.createBackend(settings);
  try {
    await tempBackend.connect(buildConnectionConfig(settings, directory));
    return await tempBackend.getModels(directory);
  } finally {
    try {
      await tempBackend.disconnect();
    } catch (disconnectError) {
      log.trace("Failed to disconnect temporary backend", { error: String(disconnectError) });
    }
  }
}

/**
 * Discover models for a workspace using provider-aware routing.
 */
async function getModelsForWorkspace(
  workspaceId: string,
  directory: string,
  workspaceOverride?: Awaited<ReturnType<typeof getWorkspace>>,
): Promise<ModelInfo[]> {
  const workspace = workspaceOverride ?? await getWorkspace(workspaceId);
  if (!workspace) {
    throw new Error(`Workspace not found: ${workspaceId}`);
  }

  const settings = workspace.serverSettings;
  if (settings.agent.provider === "copilot") {
    return await getCopilotModelsViaExecution(workspaceId, directory);
  }
  return await getAgentBackendModels(workspaceId, directory, settings);
}

/**
 * Check if a model is enabled (its provider is connected).
 * 
 * This function fetches the available models for a workspace and checks
 * if the specified model exists and its provider is connected.
 * 
 * Discovery is provider-aware:
 * - `copilot`: model list comes from Copilot CLI via execution channel
 * - other providers: model list comes from the configured agent backend
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
    const models = await getModelsForWorkspace(workspaceId, directory);

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

  "/api/preferences/dashboard-view-mode": {
    /**
     * GET /api/preferences/dashboard-view-mode - Get dashboard view mode preference.
     * 
     * Returns the current dashboard view mode ("rows" or "cards").
     * Defaults to "rows" if not set.
     * 
     * @returns Object with mode property
     */
    async GET(): Promise<Response> {
      const mode = await getDashboardViewMode();
      return Response.json({ mode });
    },

    /**
     * PUT /api/preferences/dashboard-view-mode - Set dashboard view mode preference.
     * 
     * Sets the dashboard view mode.
     * 
     * Request Body:
     * - mode (required): "rows" or "cards"
     * 
     * @returns Success response
     */
    async PUT(req: Request): Promise<Response> {
      const result = await parseAndValidate(SetDashboardViewModeRequestSchema, req);
      if (!result.success) {
        return result.response;
      }

      try {
        await setDashboardViewMode(result.data.mode);
        return Response.json({ success: true, mode: result.data.mode });
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
