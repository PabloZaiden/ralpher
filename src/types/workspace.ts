/**
 * Workspace type definitions for Ralph Loops Management System.
 * 
 * Workspaces represent directories that contain Ralph Loops.
 * Each workspace has a unique directory path and can contain multiple loops.
 * 
 * @module types/workspace
 */

/**
 * A workspace represents a directory that contains Ralph Loops.
 * 
 * Workspaces provide a way to group loops by directory and allow
 * for simplified loop creation via workspace selection.
 */
export interface Workspace {
  /** Unique identifier (UUID v4) */
  id: string;
  /** Human-readable workspace name */
  name: string;
  /** Absolute path to the directory (must be a git repository) */
  directory: string;
  /** ISO 8601 timestamp of when the workspace was created */
  createdAt: string;
  /** ISO 8601 timestamp of the last update */
  updatedAt: string;
}

/**
 * Request to create a new workspace.
 */
export interface CreateWorkspaceRequest {
  /** Human-readable workspace name */
  name: string;
  /** Absolute path to the directory (must be a git repository) */
  directory: string;
}

/**
 * Request to update an existing workspace.
 */
export interface UpdateWorkspaceRequest {
  /** New name for the workspace (optional) */
  name?: string;
}

/**
 * Response for workspace list operations.
 */
export interface WorkspaceWithLoopCount extends Workspace {
  /** Number of loops in this workspace */
  loopCount: number;
}
