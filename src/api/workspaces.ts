/**
 * Workspace API endpoints for Ralph Loops Management System.
 * 
 * This module provides CRUD operations for workspaces:
 * - Create, read, update, and delete workspaces
 * - List workspaces
 * - Export and import workspace configs
 * - Get loops by workspace
 * 
 * @module api/workspaces
 */

import { 
  createWorkspace, 
  listWorkspaces, 
  updateWorkspace, 
  deleteWorkspace,
  getWorkspaceByDirectory,
  exportWorkspaces,
} from "../persistence/workspaces";
import { backendManager } from "../core/backend-manager";
import { createLogger } from "../core/logger";

const log = createLogger("api:workspaces");
import { getDefaultServerSettings } from "../types/settings";
import type { Workspace, WorkspaceImportResult } from "../types/workspace";
import type { WorkspaceExportData } from "../types/schemas";
import { parseAndValidate } from "./validation";
import { requireWorkspace, errorResponse } from "./helpers";
import {
  CreateWorkspaceRequestSchema,
  UpdateWorkspaceRequestSchema,
  ServerSettingsSchema,
  TestConnectionRequestSchema,
  WorkspaceImportRequestSchema,
} from "../types/schemas";

/**
 * Import workspaces with directory validation.
 * Each workspace's directory is validated on the remote server (via backendManager)
 * before being created. Workspaces that fail validation are reported as "failed"
 * in the result details, rather than silently creating invalid entries.
 *
 * This mirrors the validation enforced by POST /api/workspaces.
 */
async function importWorkspacesWithValidation(
  data: WorkspaceExportData
): Promise<WorkspaceImportResult> {
  log.debug("Importing workspaces with validation", { count: data.workspaces.length });

  const result: WorkspaceImportResult = {
    created: 0,
    skipped: 0,
    failed: 0,
    details: [],
  };

  for (const config of data.workspaces) {
    // Check if a workspace with this directory already exists
    const existing = await getWorkspaceByDirectory(config.directory);
    if (existing) {
      log.debug("Skipping workspace import - directory already exists", {
        name: config.name,
        directory: config.directory,
        existingId: existing.id,
      });
      result.skipped++;
      result.details.push({
        name: config.name,
        directory: config.directory,
        status: "skipped",
        reason: `A workspace already exists for directory: ${config.directory}`,
      });
      continue;
    }

    // Validate directory on the remote server (same validation as POST /api/workspaces)
    const serverSettings = config.serverSettings ?? getDefaultServerSettings();
    try {
      const validation = await backendManager.validateRemoteDirectory(
        serverSettings,
        config.directory,
      );

      if (!validation.success) {
        log.warn("Import: failed to validate remote directory", {
          name: config.name,
          directory: config.directory,
          error: validation.error,
        });
        result.failed++;
        result.details.push({
          name: config.name,
          directory: config.directory,
          status: "failed",
          reason: `Failed to validate directory: ${validation.error}`,
        });
        continue;
      }

      if (validation.directoryExists === false) {
        log.warn("Import: directory does not exist on remote server", {
          name: config.name,
          directory: config.directory,
        });
        result.failed++;
        result.details.push({
          name: config.name,
          directory: config.directory,
          status: "failed",
          reason: "Directory does not exist on the remote server",
        });
        continue;
      }

      if (!validation.isGitRepo) {
        log.warn("Import: directory is not a git repository", {
          name: config.name,
          directory: config.directory,
        });
        result.failed++;
        result.details.push({
          name: config.name,
          directory: config.directory,
          status: "failed",
          reason: "Directory is not a git repository",
        });
        continue;
      }
    } catch (error) {
      log.warn("Import: unexpected error during directory validation", {
        name: config.name,
        directory: config.directory,
        error: String(error),
      });
      result.failed++;
      result.details.push({
        name: config.name,
        directory: config.directory,
        status: "failed",
        reason: `Validation error: ${String(error)}`,
      });
      continue;
    }

    // Validation passed — create the workspace
    const now = new Date().toISOString();
    const workspace: Workspace = {
      id: crypto.randomUUID(),
      name: config.name,
      directory: config.directory,
      serverSettings,
      createdAt: now,
      updatedAt: now,
    };

    await createWorkspace(workspace);
    result.created++;
    result.details.push({
      name: config.name,
      directory: config.directory,
      status: "created",
    });
  }

  log.info("Workspaces imported with validation", {
    created: result.created,
    skipped: result.skipped,
    failed: result.failed,
  });
  return result;
}

/**
 * Workspace API route handlers.
 */
export const workspacesRoutes = {
  /**
   * GET /api/workspaces - List all workspaces
   */
  "/api/workspaces": {
    async GET() {
      log.debug("GET /api/workspaces - Listing all workspaces");
      try {
        const workspaces = await listWorkspaces();
        log.debug("GET /api/workspaces - Retrieved workspaces", { count: workspaces.length });
        return Response.json(workspaces);
      } catch (error) {
        log.error("Failed to list workspaces:", String(error));
        return errorResponse("list_failed", `Failed to list workspaces: ${String(error)}`, 500);
      }
    },

    /**
     * POST /api/workspaces - Create a new workspace
     */
    async POST(req: Request) {
      log.debug("POST /api/workspaces - Creating new workspace");
      const result = await parseAndValidate(CreateWorkspaceRequestSchema, req);
      
      if (!result.success) {
        log.warn("POST /api/workspaces - Validation failed");
        return result.response;
      }

      const body = result.data;

      // Validate serverSettings - use default if not provided
      const serverSettings = body.serverSettings ?? getDefaultServerSettings();

      // Trim name and directory to prevent whitespace issues
      const trimmedName = body.name.trim();
      const trimmedDirectory = body.directory.trim();

      try {
        // Validate directory is a git repository on the remote server
        log.debug("Validating workspace directory on remote server", { 
          directory: trimmedDirectory, 
          name: trimmedName,
          agentProvider: serverSettings.agent.provider,
          agentTransport: serverSettings.agent.transport,
        });
        
        const validation = await backendManager.validateRemoteDirectory(serverSettings, trimmedDirectory);
        
        if (!validation.success) {
          log.warn("Failed to validate remote directory", { 
            directory: trimmedDirectory, 
            error: validation.error 
          });
          return errorResponse("validation_failed", `Failed to validate directory: ${validation.error}`);
        }
        
        // Check if directory exists first to provide a clearer error message
        if (validation.directoryExists === false) {
          log.warn("Directory does not exist on remote server", { directory: trimmedDirectory });
          return errorResponse("directory_not_found", "Directory does not exist on the remote server");
        }
        
        if (!validation.isGitRepo) {
          log.warn("Directory is not a git repository", { directory: trimmedDirectory });
          return errorResponse("not_git_repo", "Directory must be a git repository");
        }

        // Check if a workspace already exists for this directory
        const existingWorkspace = await getWorkspaceByDirectory(trimmedDirectory);
        if (existingWorkspace) {
          return Response.json(
            { error: "duplicate_workspace", message: "A workspace already exists for this directory", existingWorkspace },
            { status: 409 }
          );
        }

        const now = new Date().toISOString();
        const workspace: Workspace = {
          id: crypto.randomUUID(),
          name: trimmedName,
          directory: trimmedDirectory,
          serverSettings,
          createdAt: now,
          updatedAt: now,
        };

        await createWorkspace(workspace);
        log.info(`Created workspace: ${workspace.name} (${workspace.directory})`);
        
        return Response.json(workspace, { status: 201 });
      } catch (error) {
        log.error("Failed to create workspace:", String(error));
        return errorResponse("create_failed", `Failed to create workspace: ${String(error)}`, 500);
      }
    },
  },

  /**
   * GET/PUT/DELETE /api/workspaces/:id - Single workspace operations
   */
  "/api/workspaces/:id": {
    async GET(req: Request & { params: { id: string } }) {
      const { id } = req.params;
      log.debug("GET /api/workspaces/:id", { workspaceId: id });
      try {
        const result = await requireWorkspace(id);
        if (result instanceof Response) {
          log.debug("GET /api/workspaces/:id - Workspace not found", { workspaceId: id });
          return result;
        }
        return Response.json(result);
      } catch (error) {
        log.error("Failed to get workspace:", String(error));
        return errorResponse("get_failed", `Failed to get workspace: ${String(error)}`, 500);
      }
    },

    async PUT(req: Request & { params: { id: string } }) {
      const { id } = req.params;
      log.debug("PUT /api/workspaces/:id", { workspaceId: id });
      const result = await parseAndValidate(UpdateWorkspaceRequestSchema, req);
      
      if (!result.success) {
        log.warn("PUT /api/workspaces/:id - Validation failed", { workspaceId: id });
        return result.response;
      }

      const body = result.data;

      try {
        const workspace = await updateWorkspace(id, { 
          name: body.name,
          serverSettings: body.serverSettings,
        });
        if (!workspace) {
          log.debug("PUT /api/workspaces/:id - Workspace not found", { workspaceId: id });
          return errorResponse("workspace_not_found", "Workspace not found", 404);
        }
        
        // Reset connection if server settings were updated so new config takes effect
        if (body.serverSettings) {
          await backendManager.resetWorkspaceConnection(id);
        }
        
        log.info(`Updated workspace: ${workspace.name}`);
        return Response.json(workspace);
      } catch (error) {
        log.error("Failed to update workspace:", String(error));
        return errorResponse("update_failed", `Failed to update workspace: ${String(error)}`, 500);
      }
    },

    async DELETE(req: Request & { params: { id: string } }) {
      const { id } = req.params;
      log.debug("DELETE /api/workspaces/:id", { workspaceId: id });
      try {
        const result = await deleteWorkspace(id);
        if (!result.success) {
          log.warn("DELETE /api/workspaces/:id - Failed", { workspaceId: id, reason: result.reason });
          const reason = result.reason ?? "Delete failed";
          const errorCode = reason === "Workspace not found" ? "workspace_not_found" : "delete_failed";
          const status = reason === "Workspace not found" ? 404 : 400;
          return errorResponse(errorCode, reason, status);
        }
        log.info(`Deleted workspace: ${id}`);
        return Response.json({ success: true });
      } catch (error) {
        log.error("Failed to delete workspace:", String(error));
        return errorResponse("delete_failed", `Failed to delete workspace: ${String(error)}`, 500);
      }
    },
  },

  /**
   * GET /api/workspaces/by-directory?directory=... - Get workspace by directory
   */
  "/api/workspaces/by-directory": {
    async GET(req: Request) {
      const url = new URL(req.url);
      const directory = url.searchParams.get("directory");
      
      if (!directory) {
        return errorResponse("missing_parameter", "directory query parameter is required");
      }

      try {
        const workspace = await getWorkspaceByDirectory(directory);
        if (!workspace) {
          return errorResponse("workspace_not_found", "No workspace found for this directory", 404);
        }
        return Response.json(workspace);
      } catch (error) {
        log.error("Failed to get workspace by directory:", String(error));
        return errorResponse("get_failed", `Failed to get workspace: ${String(error)}`, 500);
      }
    },
  },

  /**
   * GET /api/workspaces/:id/server-settings - Get workspace server settings
   */
  "/api/workspaces/:id/server-settings": {
    async GET(req: Request & { params: { id: string } }) {
      const { id } = req.params;
      try {
        const result = await requireWorkspace(id);
        if (result instanceof Response) return result;
        return Response.json(result.serverSettings);
      } catch (error) {
        log.error("Failed to get workspace server settings:", String(error));
        return errorResponse("get_settings_failed", `Failed to get server settings: ${String(error)}`, 500);
      }
    },

    async PUT(req: Request & { params: { id: string } }) {
      const { id } = req.params;
      const result = await parseAndValidate(ServerSettingsSchema, req);
      
      if (!result.success) {
        return result.response;
      }

      const body = result.data;

      try {
        const workspace = await updateWorkspace(id, { serverSettings: body });
        if (!workspace) {
          return errorResponse("workspace_not_found", "Workspace not found", 404);
        }
        
        // Reset the connection for this workspace so it picks up new settings
        await backendManager.resetWorkspaceConnection(id);
        
        log.info(`Updated server settings for workspace: ${workspace.name}`);
        return Response.json(workspace.serverSettings);
      } catch (error) {
        log.error("Failed to update workspace server settings:", String(error));
        return errorResponse("update_settings_failed", `Failed to update server settings: ${String(error)}`, 500);
      }
    },
  },

  /**
   * GET /api/workspaces/:id/server-settings/status - Get connection status for workspace
   */
  "/api/workspaces/:id/server-settings/status": {
    async GET(req: Request & { params: { id: string } }) {
      const { id } = req.params;
      try {
        const result = await requireWorkspace(id);
        if (result instanceof Response) return result;

        const status = await backendManager.getWorkspaceStatus(id);
        return Response.json(status);
      } catch (error) {
        log.error("Failed to get workspace connection status:", String(error));
        return errorResponse("status_failed", `Failed to get connection status: ${String(error)}`, 500);
      }
    },
  },

  /**
   * POST /api/workspaces/:id/server-settings/test - Test connection for workspace
   */
  "/api/workspaces/:id/server-settings/test": {
    async POST(req: Request & { params: { id: string } }) {
      const { id } = req.params;
      try {
        const workspace = await requireWorkspace(id);
        if (workspace instanceof Response) return workspace;

        // Optionally accept settings in the body to test proposed settings
        // If no body, use the workspace's current settings
        let settings = workspace.serverSettings;
        
        const bodyText = await req.text();
        if (bodyText.trim()) {
          let bodyJson: unknown;
          try {
            bodyJson = JSON.parse(bodyText);
          } catch {
            return errorResponse("invalid_json", "Request body must be valid JSON", 400);
          }

          // Allow "{}" as shorthand for "use current settings".
          if (
            typeof bodyJson === "object"
            && bodyJson !== null
            && !Array.isArray(bodyJson)
            && Object.keys(bodyJson).length === 0
          ) {
            settings = workspace.serverSettings;
          } else {
            const parsedSettings = ServerSettingsSchema.safeParse(bodyJson);
            if (!parsedSettings.success) {
              const firstIssue = parsedSettings.error.issues[0]?.message ?? "Invalid server settings";
              return errorResponse("validation_error", firstIssue, 400);
            }
            settings = parsedSettings.data;
          }
        }

        const result = await backendManager.testConnection(settings, workspace.directory);
        return Response.json(result);
      } catch (error) {
        log.error("Failed to test workspace connection:", String(error));
        return errorResponse("test_failed", `Failed to test connection: ${String(error)}`, 500);
      }
    },
  },

  /**
   * POST /api/workspaces/:id/server-settings/reset - Reset connection for workspace
   */
  "/api/workspaces/:id/server-settings/reset": {
    async POST(req: Request & { params: { id: string } }) {
      const { id } = req.params;
      try {
        const workspace = await requireWorkspace(id);
        if (workspace instanceof Response) return workspace;

        await backendManager.resetWorkspaceConnection(id);
        log.info(`Reset connection for workspace: ${workspace.name}`);
        return Response.json({ success: true });
      } catch (error) {
        log.error("Failed to reset workspace connection:", String(error));
        return errorResponse("reset_failed", `Failed to reset connection: ${String(error)}`, 500);
      }
    },
  },

  /**
   * POST /api/server-settings/test - Test connection without requiring a workspace
   * Used by the create workspace modal to test connection before creating the workspace.
   * Expects { settings: ServerSettings, directory: string } in the body.
   */
  "/api/server-settings/test": {
    async POST(req: Request) {
      const result = await parseAndValidate(TestConnectionRequestSchema, req);
      if (!result.success) {
        return result.response;
      }

      const { settings, directory } = result.data;
      
      try {
        const testResult = await backendManager.testConnection(settings, directory);
        return Response.json(testResult);
      } catch (error) {
        log.error("Failed to test connection:", String(error));
        return Response.json(
          { success: false, error: String(error) },
          { status: 500 }
        );
      }
    },
  },

  /**
   * GET /api/workspaces/export - Export all workspace configs as JSON
   */
  "/api/workspaces/export": {
    async GET() {
      log.debug("GET /api/workspaces/export - Exporting workspace configs");
      try {
        const exportData = await exportWorkspaces();
        return Response.json(exportData);
      } catch (error) {
        log.error("Failed to export workspaces:", String(error));
        return errorResponse("export_failed", `Failed to export workspaces: ${String(error)}`, 500);
      }
    },
  },

  /**
   * POST /api/workspaces/import - Import workspace configs from JSON
   * Validates each workspace's directory on the remote server before creating it.
   * Reports per-entry results (created, skipped, failed).
   */
  "/api/workspaces/import": {
    async POST(req: Request) {
      log.debug("POST /api/workspaces/import - Importing workspace configs");
      const result = await parseAndValidate(WorkspaceImportRequestSchema, req);
      
      if (!result.success) {
        log.warn("POST /api/workspaces/import - Validation failed");
        return result.response;
      }

      const data = result.data;

      // Normalize inputs (trim whitespace from name and directory) before passing
      // to the persistence layer, consistent with POST /api/workspaces behavior.
      const normalizedData = {
        ...data,
        workspaces: data.workspaces.map((ws) => ({
          ...ws,
          name: ws.name.trim(),
          directory: ws.directory.trim(),
        })),
      };

      try {
        // Validate each workspace's directory on the remote server before importing
        const importResult = await importWorkspacesWithValidation(normalizedData);
        log.info("Workspace import complete", {
          created: importResult.created,
          skipped: importResult.skipped,
          failed: importResult.failed,
        });
        return Response.json(importResult);
      } catch (error) {
        log.error("Failed to import workspaces:", String(error));
        return errorResponse("import_failed", `Failed to import workspaces: ${String(error)}`, 500);
      }
    },
  },
};
