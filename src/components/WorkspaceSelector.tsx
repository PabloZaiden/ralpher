/**
 * WorkspaceSelector component for selecting or creating workspaces.
 * 
 * Provides a dropdown to select an existing workspace or create a new one.
 * When a workspace is selected, the directory is automatically set.
 */

import { useState, type ChangeEvent } from "react";
import type { WorkspaceWithLoopCount, CreateWorkspaceRequest } from "../types/workspace";
import { Button } from "./common";

export interface WorkspaceSelectorProps {
  /** List of available workspaces */
  workspaces: WorkspaceWithLoopCount[];
  /** Whether workspaces are loading */
  loading?: boolean;
  /** Currently selected workspace ID */
  selectedWorkspaceId?: string;
  /** Callback when workspace selection changes */
  onSelect: (workspaceId: string | null, directory: string) => void;
  /** Callback to create a new workspace */
  onCreateWorkspace: (request: CreateWorkspaceRequest) => Promise<{ id: string; directory: string } | null>;
  /** Whether creation is in progress */
  creating?: boolean;
  /** Error message from workspace operations */
  error?: string | null;
}

export function WorkspaceSelector({
  workspaces,
  loading = false,
  selectedWorkspaceId,
  onSelect,
  onCreateWorkspace,
  creating = false,
  error,
}: WorkspaceSelectorProps) {
  // State for "add new workspace" mode
  const [showAddNew, setShowAddNew] = useState(false);
  const [newWorkspaceName, setNewWorkspaceName] = useState("");
  const [newWorkspaceDirectory, setNewWorkspaceDirectory] = useState("");
  const [createError, setCreateError] = useState<string | null>(null);

  // Handle workspace selection from dropdown
  function handleWorkspaceChange(e: ChangeEvent<HTMLSelectElement>) {
    const value = e.target.value;
    
    if (value === "__add_new__") {
      setShowAddNew(true);
      // Clear selection
      onSelect(null, "");
      return;
    }
    
    setShowAddNew(false);
    
    if (value === "") {
      onSelect(null, "");
      return;
    }
    
    const workspace = workspaces.find((w) => w.id === value);
    if (workspace) {
      onSelect(workspace.id, workspace.directory);
    }
  }

  // Handle creating a new workspace
  async function handleCreateWorkspace() {
    if (!newWorkspaceName.trim() || !newWorkspaceDirectory.trim()) {
      setCreateError("Both name and directory are required");
      return;
    }
    
    setCreateError(null);
    
    const result = await onCreateWorkspace({
      name: newWorkspaceName.trim(),
      directory: newWorkspaceDirectory.trim(),
    });
    
    if (result) {
      // Select the newly created workspace
      onSelect(result.id, result.directory);
      // Reset the add new state
      setShowAddNew(false);
      setNewWorkspaceName("");
      setNewWorkspaceDirectory("");
    }
  }

  // Cancel adding new workspace
  function handleCancelAddNew() {
    setShowAddNew(false);
    setNewWorkspaceName("");
    setNewWorkspaceDirectory("");
    setCreateError(null);
  }

  if (showAddNew) {
    return (
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
            Create New Workspace
          </label>
          <button
            type="button"
            onClick={handleCancelAddNew}
            className="text-sm text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
          >
            Cancel
          </button>
        </div>
        
        <div>
          <label
            htmlFor="workspace-name"
            className="block text-sm font-medium text-gray-700 dark:text-gray-300"
          >
            Name <span className="text-red-500">*</span>
          </label>
          <input
            type="text"
            id="workspace-name"
            value={newWorkspaceName}
            onChange={(e) => setNewWorkspaceName(e.target.value)}
            placeholder="My Project"
            className="mt-1 block w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-gray-900 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 text-sm placeholder:text-gray-400 dark:placeholder:text-gray-500"
          />
        </div>
        
        <div>
          <label
            htmlFor="workspace-directory"
            className="block text-sm font-medium text-gray-700 dark:text-gray-300"
          >
            Directory <span className="text-red-500">*</span>
          </label>
          <input
            type="text"
            id="workspace-directory"
            value={newWorkspaceDirectory}
            onChange={(e) => setNewWorkspaceDirectory(e.target.value)}
            placeholder="/path/to/project"
            className="mt-1 block w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-gray-900 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 font-mono text-sm placeholder:text-gray-400 dark:placeholder:text-gray-500"
          />
          <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
            Must be a git repository
          </p>
        </div>
        
        {(createError || error) && (
          <p className="text-sm text-red-600 dark:text-red-400">
            {createError || error}
          </p>
        )}
        
        <Button
          type="button"
          onClick={handleCreateWorkspace}
          disabled={creating || !newWorkspaceName.trim() || !newWorkspaceDirectory.trim()}
          variant="primary"
          size="sm"
        >
          {creating ? "Creating..." : "Create Workspace"}
        </Button>
      </div>
    );
  }

  return (
    <div>
      <label
        htmlFor="workspace"
        className="block text-sm font-medium text-gray-700 dark:text-gray-300"
      >
        Workspace <span className="text-red-500">*</span>
      </label>
      <select
        id="workspace"
        value={selectedWorkspaceId || ""}
        onChange={handleWorkspaceChange}
        disabled={loading}
        className="mt-1 block w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-gray-900 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 text-sm disabled:opacity-50"
      >
        <option value="">
          {loading ? "Loading workspaces..." : "Select a workspace..."}
        </option>
        
        {workspaces.map((workspace) => (
          <option key={workspace.id} value={workspace.id}>
            {workspace.name} ({workspace.loopCount} loops)
          </option>
        ))}
        
        <option value="__add_new__" className="font-medium">
          + Add new workspace...
        </option>
      </select>
      
      {selectedWorkspaceId && (
        <p className="mt-1 text-xs text-gray-500 dark:text-gray-400 font-mono truncate">
          {workspaces.find((w) => w.id === selectedWorkspaceId)?.directory}
        </p>
      )}
      
      {error && (
        <p className="mt-1 text-sm text-red-600 dark:text-red-400">
          {error}
        </p>
      )}
    </div>
  );
}
