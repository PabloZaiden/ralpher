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
import { GitService } from "../core/git-service";
import { log } from "../core/logger";
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
 * Get a GitService configured for the current backend mode.
 * Uses PTY+WebSocket for command execution in both spawn and connect modes.
 */
async function getGitService(directory: string): Promise<GitService> {
  const executor = await backendManager.getCommandExecutorAsync(directory);
  return GitService.withExecutor(executor);
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

      // Trim name and directory to prevent whitespace issues
      const trimmedName = body.name.trim();
      const trimmedDirectory = body.directory.trim();

      try {
        // Check if directory is a valid git repository
        const gitService = await getGitService(trimmedDirectory);
        const isGitRepo = await gitService.isGitRepo(trimmedDirectory);
        if (!isGitRepo) {
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
        const workspace = await updateWorkspace(id, { name: body.name });
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
};
