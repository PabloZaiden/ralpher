/**
 * CreateWorkspaceModal component for creating new workspaces.
 * Allows setting workspace name, directory, and server connection settings.
 */

import { useState, useEffect, type FormEvent } from "react";
import { Modal, Button } from "./common";
import type { ServerSettings } from "../types/settings";
import type { CreateWorkspaceRequest } from "../types/workspace";

export interface CreateWorkspaceModalProps {
  /** Whether the modal is open */
  isOpen: boolean;
  /** Callback when modal should close */
  onClose: () => void;
  /** Callback to create the workspace */
  onCreate: (request: CreateWorkspaceRequest) => Promise<boolean>;
  /** Whether creation is in progress */
  creating?: boolean;
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
  creating = false,
  error,
  remoteOnly = false,
}: CreateWorkspaceModalProps) {
  // Workspace form state
  const [name, setName] = useState("");
  const [directory, setDirectory] = useState("");
  
  // Server settings form state
  const [mode, setMode] = useState<"spawn" | "connect">(remoteOnly ? "connect" : "spawn");
  const [hostname, setHostname] = useState("localhost");
  const [port, setPort] = useState("4096");
  const [password, setPassword] = useState("");
  const [useHttps, setUseHttps] = useState(false);
  const [allowInsecure, setAllowInsecure] = useState(false);

  // Reset form when modal opens
  useEffect(() => {
    if (isOpen) {
      setName("");
      setDirectory("");
      setMode(remoteOnly ? "connect" : "spawn");
      setHostname("localhost");
      setPort("4096");
      setPassword("");
      setUseHttps(false);
      setAllowInsecure(false);
    }
  }, [isOpen, remoteOnly]);

  // Handle form submission
  async function handleSubmit(e: FormEvent) {
    e.preventDefault();

    const serverSettings: ServerSettings = {
      mode,
      useHttps: mode === "connect" ? useHttps : false,
      allowInsecure: mode === "connect" && useHttps ? allowInsecure : false,
      ...(mode === "connect" && {
        hostname: hostname.trim(),
        port: parseInt(port, 10) || 4096,
        password: password.trim() || undefined,
      }),
    };

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

  function handleModeChange(newMode: "spawn" | "connect") {
    setMode(newMode);
  }

  function handleUseHttpsChange(checked: boolean) {
    setUseHttps(checked);
    if (!checked) {
      setAllowInsecure(false);
    }
  }

  // Validation
  const isNameValid = name.trim().length > 0;
  const isDirectoryValid = directory.trim().length > 0;
  const isConnectionValid = mode === "spawn" || (hostname.trim().length > 0);
  const isValid = isNameValid && isDirectoryValid && isConnectionValid;

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

        {/* Server Mode */}
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-3">
            Server Mode
          </label>
          <div className="space-y-3">
            {/* Spawn Mode */}
            <label
              className={`flex items-start gap-3 p-4 rounded-lg border transition-colors ${
                remoteOnly
                  ? "cursor-not-allowed opacity-60 border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900"
                  : mode === "spawn"
                    ? "cursor-pointer border-blue-500 bg-blue-50 dark:bg-blue-900/20"
                    : "cursor-pointer border-gray-200 dark:border-gray-700 hover:border-gray-300 dark:hover:border-gray-600"
              }`}
            >
              <input
                type="radio"
                name="mode"
                value="spawn"
                checked={mode === "spawn"}
                onChange={() => handleModeChange("spawn")}
                disabled={remoteOnly}
                className="mt-1 h-4 w-4 border-gray-300 text-blue-600 focus:ring-blue-500 disabled:opacity-50"
              />
              <div>
                <div className={`font-medium ${remoteOnly ? "text-gray-500 dark:text-gray-500" : "text-gray-900 dark:text-gray-100"}`}>
                  Spawn Local Server
                </div>
                <div className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                  Automatically start a local OpenCode server on demand.
                  Best for local development.
                </div>
                {remoteOnly && (
                  <div className="text-xs text-amber-600 dark:text-amber-400 mt-2">
                    Disabled by RALPHER_REMOTE_ONLY environment variable
                  </div>
                )}
              </div>
            </label>

            {/* Connect Mode */}
            <label
              className={`flex items-start gap-3 p-4 rounded-lg border cursor-pointer transition-colors ${
                mode === "connect"
                  ? "border-blue-500 bg-blue-50 dark:bg-blue-900/20"
                  : "border-gray-200 dark:border-gray-700 hover:border-gray-300 dark:hover:border-gray-600"
              }`}
            >
              <input
                type="radio"
                name="mode"
                value="connect"
                checked={mode === "connect"}
                onChange={() => handleModeChange("connect")}
                className="mt-1 h-4 w-4 border-gray-300 text-blue-600 focus:ring-blue-500"
              />
              <div className="flex-1">
                <div className="font-medium text-gray-900 dark:text-gray-100">
                  Connect to Existing Server
                </div>
                <div className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                  Connect to a remote OpenCode server.
                  Use for production or shared environments.
                </div>
              </div>
            </label>
          </div>
        </div>

        {/* Connection Settings (only shown in connect mode) */}
        {mode === "connect" && (
          <div className="space-y-4 p-4 rounded-lg bg-gray-50 dark:bg-gray-900">
            <div className="flex flex-col sm:flex-row gap-4">
              <div className="flex-1">
                <label
                  htmlFor="hostname"
                  className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1"
                >
                  Hostname
                </label>
                <input
                  type="text"
                  id="hostname"
                  value={hostname}
                  onChange={(e) => setHostname(e.target.value)}
                  placeholder="localhost or remote-server.example.com"
                  required
                  className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 placeholder:text-gray-400 dark:placeholder:text-gray-500"
                />
              </div>
              <div className="w-full sm:w-28">
                <label
                  htmlFor="port"
                  className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1"
                >
                  Port
                </label>
                <input
                  type="number"
                  id="port"
                  value={port}
                  onChange={(e) => setPort(e.target.value)}
                  min="1"
                  max="65535"
                  className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100"
                />
              </div>
            </div>

            {/* Password */}
            <div>
              <label
                htmlFor="password"
                className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1"
              >
                Password (optional)
              </label>
              <input
                type="password"
                id="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Leave empty if no authentication required"
                className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 placeholder:text-gray-400 dark:placeholder:text-gray-500"
              />
              <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                Authentication token for the OpenCode server
              </p>
            </div>

            {/* HTTPS Settings */}
            <div className="space-y-3">
              <label className="flex items-center gap-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={useHttps}
                  onChange={(e) => handleUseHttpsChange(e.target.checked)}
                  className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                />
                <div>
                  <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
                    Use HTTPS
                  </span>
                  <p className="text-xs text-gray-500 dark:text-gray-400">
                    Connect using a secure HTTPS connection
                  </p>
                </div>
              </label>

              {useHttps && (
                <label className="flex items-center gap-3 cursor-pointer ml-7">
                  <input
                    type="checkbox"
                    checked={allowInsecure}
                    onChange={(e) => setAllowInsecure(e.target.checked)}
                    className="h-4 w-4 rounded border-gray-300 text-amber-600 focus:ring-amber-500"
                  />
                  <div>
                    <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
                      Allow self-signed certificates
                    </span>
                    <p className="text-xs text-amber-600 dark:text-amber-400">
                      Warning: Disables TLS certificate verification
                    </p>
                  </div>
                </label>
              )}
            </div>
          </div>
        )}

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
