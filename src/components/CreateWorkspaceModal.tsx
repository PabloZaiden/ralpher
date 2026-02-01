/**
 * CreateWorkspaceModal component for creating new workspaces.
 * Allows setting workspace name, directory, and server connection settings.
 */

import { useState, useEffect, type FormEvent } from "react";
import { Modal, Button } from "./common";
import { ServerSettingsForm } from "./ServerSettingsForm";
import { getDefaultServerSettings } from "../types/settings";
import type { ServerSettings } from "../types/settings";
import type { CreateWorkspaceRequest } from "../types/workspace";

export interface CreateWorkspaceModalProps {
  /** Whether the modal is open */
  isOpen: boolean;
  /** Callback when modal should close */
  onClose: () => void;
  /** Callback to create the workspace */
  onCreate: (request: CreateWorkspaceRequest) => Promise<boolean>;
  /** Callback to test connection */
  onTestConnection?: (settings: ServerSettings) => Promise<{ success: boolean; error?: string }>;
  /** Whether creation is in progress */
  creating?: boolean;
  /** Whether testing connection is in progress */
  testing?: boolean;
  /** Error message from workspace creation */
  error?: string | null;
  /** Whether remote-only mode is enabled (RALPHER_REMOTE_ONLY) */
  remoteOnly?: boolean;
}

/**
 * CreateWorkspaceModal provides UI for creating new workspaces with server settings.
 */
export function CreateWorkspaceModal({
  isOpen,
  onClose,
  onCreate,
  onTestConnection,
  creating = false,
  testing = false,
  error,
  remoteOnly = false,
}: CreateWorkspaceModalProps) {
  // Workspace form state
  const [name, setName] = useState("");
  const [directory, setDirectory] = useState("");
  
  // Server settings state
  const [serverSettings, setServerSettings] = useState<ServerSettings>(
    getDefaultServerSettings(remoteOnly)
  );
  const [isServerSettingsValid, setIsServerSettingsValid] = useState(true);

  // Reset form when modal opens
  useEffect(() => {
    if (isOpen) {
      setName("");
      setDirectory("");
      setServerSettings(getDefaultServerSettings(remoteOnly));
      setIsServerSettingsValid(true);
    }
  }, [isOpen, remoteOnly]);

  // Handle form submission
  async function handleSubmit(e: FormEvent) {
    e.preventDefault();

    const request: CreateWorkspaceRequest = {
      name: name.trim(),
      directory: directory.trim(),
      serverSettings,
    };

    const success = await onCreate(request);
    if (success) {
      onClose();
    }
  }

  // Handle server settings change
  function handleServerSettingsChange(settings: ServerSettings, isValid: boolean) {
    setServerSettings(settings);
    setIsServerSettingsValid(isValid);
  }

  // Validation
  const isNameValid = name.trim().length > 0;
  const isDirectoryValid = directory.trim().length > 0;
  const isValid = isNameValid && isDirectoryValid && isServerSettingsValid;

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Create Workspace"
      description="Create a new workspace with server connection settings."
      size="md"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={creating}>
            Cancel
          </Button>
          <Button
            type="submit"
            form="create-workspace-form"
            loading={creating}
            disabled={!isValid}
          >
            Create Workspace
          </Button>
        </>
      }
    >
      <form id="create-workspace-form" onSubmit={handleSubmit} className="space-y-6">
        {/* Workspace Name */}
        <div>
          <label
            htmlFor="workspace-name"
            className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1"
          >
            Workspace Name <span className="text-red-500">*</span>
          </label>
          <input
            type="text"
            id="workspace-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="My Project"
            required
            className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 placeholder:text-gray-400 dark:placeholder:text-gray-500"
          />
        </div>

        {/* Directory */}
        <div>
          <label
            htmlFor="workspace-directory"
            className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1"
          >
            Directory <span className="text-red-500">*</span>
          </label>
          <input
            type="text"
            id="workspace-directory"
            value={directory}
            onChange={(e) => setDirectory(e.target.value)}
            placeholder="/path/to/project"
            required
            className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 font-mono placeholder:text-gray-400 dark:placeholder:text-gray-500"
          />
          <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
            Must be a git repository. Directory cannot be changed after creation.
          </p>
        </div>

        {/* Server Settings Form (shared component) */}
        <ServerSettingsForm
          onChange={handleServerSettingsChange}
          onTest={onTestConnection}
          testing={testing}
          remoteOnly={remoteOnly}
        />

        {/* Error message */}
        {error && (
          <div className="p-3 rounded-md bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800">
            <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
          </div>
        )}
      </form>
    </Modal>
  );
}

export default CreateWorkspaceModal;
