/**
 * Workspace API endpoints for Ralph Loops Management System.
 * 
 * This module provides CRUD operations for workspaces:
 * - Create, read, update, and delete workspaces
 * - List workspaces with loop counts
 * - Export and import workspace configs
 * - Get loops by workspace
 * 
 * @module api/workspaces
 */

import { 
  createWorkspace, 
  getWorkspace, 
  listWorkspaces, 
  updateWorkspace, 
  deleteWorkspace,
  getWorkspaceByDirectory,
  exportWorkspaces,
  importWorkspaces,
} from "../persistence/workspaces";
import { backendManager } from "../core/backend-manager";
import { log } from "../core/logger";
import { getDefaultServerSettings } from "../types/settings";
import type { Workspace } from "../types/workspace";
import { parseAndValidate } from "./validation";
import {
  CreateWorkspaceRequestSchema,
  UpdateWorkspaceRequestSchema,
  ServerSettingsSchema,
  TestConnectionRequestSchema,
  WorkspaceImportRequestSchema,
} from "../types/schemas";

/**
 * Workspace API route handlers.
 */
export const workspacesRoutes = {
  /**
   * GET /api/workspaces - List all workspaces with loop counts
   */
  "/api/workspaces": {
    async GET() {
      log.debug("GET /api/workspaces - Listing all workspaces");
      try {
        const workspaces = await listWorkspaces();
        log.trace("GET /api/workspaces - Retrieved workspaces", { count: workspaces.length });
        return Response.json(workspaces);
      } catch (error) {
        log.error("Failed to list workspaces:", String(error));
        return Response.json(
          { message: "Failed to list workspaces", error: String(error) },
          { status: 500 }
        );
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
          serverMode: serverSettings.mode 
        });
        
        const validation = await backendManager.validateRemoteDirectory(serverSettings, trimmedDirectory);
        
        if (!validation.success) {
          log.warn("Failed to validate remote directory", { 
            directory: trimmedDirectory, 
            error: validation.error 
          });
          return Response.json(
            { message: `Failed to validate directory: ${validation.error}` },
            { status: 400 }
          );
        }
        
        // Check if directory exists first to provide a clearer error message
        if (validation.directoryExists === false) {
          log.warn("Directory does not exist on remote server", { directory: trimmedDirectory });
          return Response.json(
            { message: "Directory does not exist on the remote server" },
            { status: 400 }
          );
        }
        
        if (!validation.isGitRepo) {
          log.warn("Directory is not a git repository", { directory: trimmedDirectory });
          return Response.json(
            { message: "Directory must be a git repository" },
            { status: 400 }
          );
        }

        // Check if a workspace already exists for this directory
        const existingWorkspace = await getWorkspaceByDirectory(trimmedDirectory);
        if (existingWorkspace) {
          return Response.json(
            { message: "A workspace already exists for this directory", existingWorkspace },
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
        return Response.json(
          { message: "Failed to create workspace", error: String(error) },
          { status: 500 }
        );
      }
    },
  },

  /**
   * GET/PUT/DELETE /api/workspaces/:id - Single workspace operations
   */
  "/api/workspaces/:id": async (req: Request & { params: { id: string } }) => {
    const { id } = req.params;
    const method = req.method;

    if (method === "GET") {
      log.trace("GET /api/workspaces/:id", { workspaceId: id });
      try {
        const workspace = await getWorkspace(id);
        if (!workspace) {
          log.debug("GET /api/workspaces/:id - Workspace not found", { workspaceId: id });
          return Response.json(
            { message: "Workspace not found" },
            { status: 404 }
          );
        }
        return Response.json(workspace);
      } catch (error) {
        log.error("Failed to get workspace:", String(error));
        return Response.json(
          { message: "Failed to get workspace", error: String(error) },
          { status: 500 }
        );
      }
    }

    if (method === "PUT") {
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
          return Response.json(
            { message: "Workspace not found" },
            { status: 404 }
          );
        }
        
        // Reset connection if server settings were updated so new config takes effect
        if (body.serverSettings) {
          await backendManager.resetWorkspaceConnection(id);
        }
        
        log.info(`Updated workspace: ${workspace.name}`);
        return Response.json(workspace);
      } catch (error) {
        log.error("Failed to update workspace:", String(error));
        return Response.json(
          { message: "Failed to update workspace", error: String(error) },
          { status: 500 }
        );
      }
    }

    if (method === "DELETE") {
      log.debug("DELETE /api/workspaces/:id", { workspaceId: id });
      try {
        const result = await deleteWorkspace(id);
        if (!result.success) {
          log.warn("DELETE /api/workspaces/:id - Failed", { workspaceId: id, reason: result.reason });
          return Response.json(
            { message: result.reason },
            { status: result.reason === "Workspace not found" ? 404 : 400 }
          );
        }
        log.info(`Deleted workspace: ${id}`);
        return Response.json({ success: true });
      } catch (error) {
        log.error("Failed to delete workspace:", String(error));
        return Response.json(
          { message: "Failed to delete workspace", error: String(error) },
          { status: 500 }
        );
      }
    }

    return Response.json(
      { message: "Method not allowed" },
      { status: 405 }
    );
  },

  /**
   * GET /api/workspaces/by-directory?directory=... - Get workspace by directory
   */
  "/api/workspaces/by-directory": {
    async GET(req: Request) {
      const url = new URL(req.url);
      const directory = url.searchParams.get("directory");
      
      if (!directory) {
        return Response.json(
          { message: "directory query parameter is required" },
          { status: 400 }
        );
      }

      try {
        const workspace = await getWorkspaceByDirectory(directory);
        if (!workspace) {
          return Response.json(
            { message: "No workspace found for this directory" },
            { status: 404 }
          );
        }
        return Response.json(workspace);
      } catch (error) {
        log.error("Failed to get workspace by directory:", String(error));
        return Response.json(
          { message: "Failed to get workspace", error: String(error) },
          { status: 500 }
        );
      }
    },
  },

  /**
   * GET /api/workspaces/:id/server-settings - Get workspace server settings
   */
  "/api/workspaces/:id/server-settings": async (req: Request & { params: { id: string } }) => {
    const { id } = req.params;
    const method = req.method;

    if (method === "GET") {
      try {
        const workspace = await getWorkspace(id);
        if (!workspace) {
          return Response.json(
            { message: "Workspace not found" },
            { status: 404 }
          );
        }
        return Response.json(workspace.serverSettings);
      } catch (error) {
        log.error("Failed to get workspace server settings:", String(error));
        return Response.json(
          { message: "Failed to get server settings", error: String(error) },
          { status: 500 }
        );
      }
    }

    if (method === "PUT") {
      const result = await parseAndValidate(ServerSettingsSchema, req);
      
      if (!result.success) {
        return result.response;
      }

      const body = result.data;

      try {
        const workspace = await updateWorkspace(id, { serverSettings: body });
        if (!workspace) {
          return Response.json(
            { message: "Workspace not found" },
            { status: 404 }
          );
        }
        
        // Reset the connection for this workspace so it picks up new settings
        await backendManager.resetWorkspaceConnection(id);
        
        log.info(`Updated server settings for workspace: ${workspace.name}`);
        return Response.json(workspace.serverSettings);
      } catch (error) {
        log.error("Failed to update workspace server settings:", String(error));
        return Response.json(
          { message: "Failed to update server settings", error: String(error) },
          { status: 500 }
        );
      }
    }

    return Response.json(
      { message: "Method not allowed" },
      { status: 405 }
    );
  },

  /**
   * GET /api/workspaces/:id/server-settings/status - Get connection status for workspace
   */
  "/api/workspaces/:id/server-settings/status": async (req: Request & { params: { id: string } }) => {
    const { id } = req.params;

    if (req.method !== "GET") {
      return Response.json(
        { message: "Method not allowed" },
        { status: 405 }
      );
    }

    try {
      const workspace = await getWorkspace(id);
      if (!workspace) {
        return Response.json(
          { message: "Workspace not found" },
          { status: 404 }
        );
      }

      const status = backendManager.getWorkspaceStatus(id);
      return Response.json(status);
    } catch (error) {
      log.error("Failed to get workspace connection status:", String(error));
      return Response.json(
        { message: "Failed to get connection status", error: String(error) },
        { status: 500 }
      );
    }
  },

  /**
   * POST /api/workspaces/:id/server-settings/test - Test connection for workspace
   */
  "/api/workspaces/:id/server-settings/test": async (req: Request & { params: { id: string } }) => {
    const { id } = req.params;

    if (req.method !== "POST") {
      return Response.json(
        { message: "Method not allowed" },
        { status: 405 }
      );
    }

    try {
      const workspace = await getWorkspace(id);
      if (!workspace) {
        return Response.json(
          { message: "Workspace not found" },
          { status: 404 }
        );
      }

      // Optionally accept settings in the body to test proposed settings
      // If no body, use the workspace's current settings
      let settings = workspace.serverSettings;
      
      // Try to parse the body - if empty or invalid JSON, use current settings
      try {
        const bodyText = await req.text();
        if (bodyText.trim()) {
          const bodyJson = JSON.parse(bodyText);
          // Only use the body if it has a mode (meaning it's a valid ServerSettings object)
          if (bodyJson && bodyJson.mode) {
            const result = ServerSettingsSchema.safeParse(bodyJson);
            if (result.success) {
              settings = result.data;
            }
            // If validation fails, just use current settings (backward compatible)
          }
        }
      } catch {
        // JSON parse error or empty body - use current settings
      }

      const result = await backendManager.testConnection(settings, workspace.directory);
      return Response.json(result);
    } catch (error) {
      log.error("Failed to test workspace connection:", String(error));
      return Response.json(
        { message: "Failed to test connection", error: String(error) },
        { status: 500 }
      );
    }
  },

  /**
   * POST /api/workspaces/:id/server-settings/reset - Reset connection for workspace
   */
  "/api/workspaces/:id/server-settings/reset": async (req: Request & { params: { id: string } }) => {
    const { id } = req.params;

    if (req.method !== "POST") {
      return Response.json(
        { message: "Method not allowed" },
        { status: 405 }
      );
    }

    try {
      const workspace = await getWorkspace(id);
      if (!workspace) {
        return Response.json(
          { message: "Workspace not found" },
          { status: 404 }
        );
      }

      await backendManager.resetWorkspaceConnection(id);
      log.info(`Reset connection for workspace: ${workspace.name}`);
      return Response.json({ success: true });
    } catch (error) {
      log.error("Failed to reset workspace connection:", String(error));
      return Response.json(
        { message: "Failed to reset connection", error: String(error) },
        { status: 500 }
      );
    }
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
        return Response.json(
          { message: "Failed to export workspaces", error: String(error) },
          { status: 500 }
        );
      }
    },
  },

  /**
   * POST /api/workspaces/import - Import workspace configs from JSON
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

      try {
        const importResult = await importWorkspaces(data);
        log.info("Workspace import complete", { created: importResult.created, skipped: importResult.skipped });
        return Response.json(importResult);
      } catch (error) {
        log.error("Failed to import workspaces:", String(error));
        return Response.json(
          { message: "Failed to import workspaces", error: String(error) },
          { status: 500 }
        );
      }
    },
  },
};
