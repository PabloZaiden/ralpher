/**
 * Hook for managing workspaces.
 * Provides CRUD operations for workspaces and fetches workspace list.
 */

import { useCallback, useEffect, useState } from "react";
import type { Workspace, WorkspaceWithLoopCount, CreateWorkspaceRequest } from "../types/workspace";

export interface UseWorkspacesResult {
  /** List of workspaces with loop counts */
  workspaces: WorkspaceWithLoopCount[];
  /** Whether workspaces are being loaded */
  loading: boolean;
  /** Error message if any */
  error: string | null;
  /** Whether a create/update/delete operation is in progress */
  saving: boolean;
  /** Refresh the workspaces list */
  refresh: () => Promise<void>;
  /** Create a new workspace */
  createWorkspace: (request: CreateWorkspaceRequest) => Promise<Workspace | null>;
  /** Update a workspace */
  updateWorkspace: (id: string, name: string) => Promise<Workspace | null>;
  /** Delete a workspace (only if it has no loops) */
  deleteWorkspace: (id: string) => Promise<{ success: boolean; error?: string }>;
  /** Get workspace by directory */
  getWorkspaceByDirectory: (directory: string) => Promise<Workspace | null>;
}

/**
 * Hook for managing workspaces.
 * Provides CRUD operations for workspaces.
 */
export function useWorkspaces(): UseWorkspacesResult {
  const [workspaces, setWorkspaces] = useState<WorkspaceWithLoopCount[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // Fetch all workspaces
  const fetchWorkspaces = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const response = await fetch("/api/workspaces");
      if (!response.ok) {
        throw new Error(`Failed to fetch workspaces: ${response.statusText}`);
      }
      const data = (await response.json()) as WorkspaceWithLoopCount[];
      setWorkspaces(data);
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  // Create a new workspace
  const createWorkspace = useCallback(async (request: CreateWorkspaceRequest): Promise<Workspace | null> => {
    try {
      setSaving(true);
      setError(null);
      const response = await fetch("/api/workspaces", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(request),
      });

      if (!response.ok) {
        const errorData = await response.json() as { message?: string; existingWorkspace?: Workspace };
        // If workspace already exists, return it
        if (response.status === 409 && errorData.existingWorkspace) {
          return errorData.existingWorkspace;
        }
        throw new Error(errorData.message || "Failed to create workspace");
      }

      const workspace = (await response.json()) as Workspace;
      // Refresh the list to include the new workspace
      await fetchWorkspaces();
      return workspace;
    } catch (err) {
      setError(String(err));
      return null;
    } finally {
      setSaving(false);
    }
  }, [fetchWorkspaces]);

  // Update a workspace
  const updateWorkspace = useCallback(async (id: string, name: string): Promise<Workspace | null> => {
    try {
      setSaving(true);
      setError(null);
      const response = await fetch(`/api/workspaces/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });

      if (!response.ok) {
        const errorData = await response.json() as { message?: string };
        throw new Error(errorData.message || "Failed to update workspace");
      }

      const workspace = (await response.json()) as Workspace;
      // Refresh the list to include the updated workspace
      await fetchWorkspaces();
      return workspace;
    } catch (err) {
      setError(String(err));
      return null;
    } finally {
      setSaving(false);
    }
  }, [fetchWorkspaces]);

  // Delete a workspace
  const deleteWorkspace = useCallback(async (id: string): Promise<{ success: boolean; error?: string }> => {
    try {
      setSaving(true);
      setError(null);
      const response = await fetch(`/api/workspaces/${id}`, {
        method: "DELETE",
      });

      if (!response.ok) {
        const errorData = await response.json() as { message?: string };
        return { success: false, error: errorData.message || "Failed to delete workspace" };
      }

      // Refresh the list to exclude the deleted workspace
      await fetchWorkspaces();
      return { success: true };
    } catch (err) {
      setError(String(err));
      return { success: false, error: String(err) };
    } finally {
      setSaving(false);
    }
  }, [fetchWorkspaces]);

  // Get workspace by directory
  const getWorkspaceByDirectory = useCallback(async (directory: string): Promise<Workspace | null> => {
    try {
      const response = await fetch(`/api/workspaces/by-directory?directory=${encodeURIComponent(directory)}`);
      if (!response.ok) {
        if (response.status === 404) {
          return null;
        }
        throw new Error(`Failed to get workspace: ${response.statusText}`);
      }
      return (await response.json()) as Workspace;
    } catch (err) {
      console.error("Failed to get workspace by directory:", err);
      return null;
    }
  }, []);

  // Initial fetch
  useEffect(() => {
    fetchWorkspaces();
  }, [fetchWorkspaces]);

  return {
    workspaces,
    loading,
    error,
    saving,
    refresh: fetchWorkspaces,
    createWorkspace,
    updateWorkspace,
    deleteWorkspace,
    getWorkspaceByDirectory,
  };
}
