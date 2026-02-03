/**
 * Workspace API endpoints for Ralph Loops Management System.
 * 
 * This module provides CRUD operations for workspaces:
 * - Create, read, update, and delete workspaces
 * - List workspaces with loop counts
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
} from "../persistence/workspaces";
import { backendManager } from "../core/backend-manager";
import { log } from "../core/logger";
import { getDefaultServerSettings, type ServerSettings } from "../types/settings";
import type { 
  Workspace, 
  CreateWorkspaceRequest, 
  UpdateWorkspaceRequest 
} from "../types/workspace";

/**
 * Safely parse JSON body from a request.
 * Returns null if the body is not valid JSON.
 */
async function parseBody<T>(req: Request): Promise<T | null> {
  try {
    return await req.json() as T;
  } catch {
    return null;
  }
}

/**
 * Workspace API route handlers.
 */
export const workspacesRoutes = {
  /**
   * GET /api/workspaces - List all workspaces with loop counts
   */
  "/api/workspaces": {
    async GET() {
      try {
        const workspaces = await listWorkspaces();
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
      const body = await parseBody<CreateWorkspaceRequest>(req);
      
      if (!body) {
        return Response.json(
          { message: "Invalid JSON body" },
          { status: 400 }
        );
      }

      if (!body.name || typeof body.name !== "string" || !body.name.trim()) {
        return Response.json(
          { message: "name is required and must be a non-empty string" },
          { status: 400 }
        );
      }

      if (!body.directory || typeof body.directory !== "string" || !body.directory.trim()) {
        return Response.json(
          { message: "directory is required and must be a non-empty string" },
          { status: 400 }
        );
      }

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
      try {
        const workspace = await getWorkspace(id);
        if (!workspace) {
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
      const body = await parseBody<UpdateWorkspaceRequest>(req);
      
      if (!body) {
        return Response.json(
          { message: "Invalid JSON body" },
          { status: 400 }
        );
      }

      try {
        const workspace = await updateWorkspace(id, { 
          name: body.name,
          serverSettings: body.serverSettings,
        });
        if (!workspace) {
          return Response.json(
            { message: "Workspace not found" },
            { status: 404 }
          );
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
      try {
        const result = await deleteWorkspace(id);
        if (!result.success) {
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
      const body = await parseBody<ServerSettings>(req);
      
      if (!body) {
        return Response.json(
          { message: "Invalid JSON body" },
          { status: 400 }
        );
      }

      // Validate mode
      if (body.mode !== "spawn" && body.mode !== "connect") {
        return Response.json(
          { message: "mode must be 'spawn' or 'connect'" },
          { status: 400 }
        );
      }

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
      const body = await parseBody<ServerSettings>(req);
      if (body && body.mode) {
        settings = body;
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
      try {
        const body = await parseBody<{ settings: ServerSettings; directory: string }>(req);
        if (!body || !body.settings || !body.directory) {
          return Response.json(
            { message: "Missing settings or directory in request body" },
            { status: 400 }
          );
        }

        const { settings, directory } = body;
        const result = await backendManager.testConnection(settings, directory);
        return Response.json(result);
      } catch (error) {
        log.error("Failed to test connection:", String(error));
        return Response.json(
          { success: false, error: String(error) },
          { status: 500 }
        );
      }
    },
  },
};
