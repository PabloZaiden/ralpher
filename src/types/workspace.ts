/**
 * Workspace type definitions for Ralph Loops Management System.
 * 
 * Workspaces represent directories that contain Ralph Loops.
 * Each workspace has a unique directory path and can contain multiple loops.
 * 
 * @module types/workspace
 */

import type { ServerSettings } from "./settings";

/**
 * A workspace represents a directory that contains Ralph Loops.
 * 
 * Workspaces provide a way to group loops by directory and allow
 * for simplified loop creation via workspace selection.
 * Each workspace has its own server settings for independent operation.
 */
export interface Workspace {
  /** Unique identifier (UUID v4) */
  id: string;
  /** Human-readable workspace name */
  name: string;
  /** Absolute path to the directory (must be a git repository) */
  directory: string;
  /** Server connection settings for this workspace */
  serverSettings: ServerSettings;
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
  /** Server connection settings for this workspace */
  serverSettings: ServerSettings;
}

/**
 * Request to update an existing workspace.
 */
export interface UpdateWorkspaceRequest {
  /** New name for the workspace (optional) */
  name?: string;
  /** Updated server settings (optional) */
  serverSettings?: ServerSettings;
}

/**
 * Response for workspace list operations.
 */
export interface WorkspaceWithLoopCount extends Workspace {
  /** Number of loops in this workspace */
  loopCount: number;
}
