/**
 * WorkspaceSettingsModal component for editing workspace settings.
 * Allows editing workspace name and server connection settings.
 */

import { useState, useEffect, type FormEvent } from "react";
import { Modal, Button, Badge } from "./common";
import type { ServerSettings, ConnectionStatus } from "../types/settings";
import type { Workspace } from "../types/workspace";

export interface WorkspaceSettingsModalProps {
  /** Whether the modal is open */
  isOpen: boolean;
  /** Callback when modal should close */
  onClose: () => void;
  /** The workspace being edited */
  workspace: Workspace | null;
  /** Current connection status for the workspace */
  status: ConnectionStatus | null;
  /** Callback to save workspace (name and server settings) */
  onSave: (name: string, settings: ServerSettings) => Promise<boolean>;
  /** Callback to test connection */
  onTest: (settings: ServerSettings) => Promise<{ success: boolean; error?: string }>;
  /** Callback to reset connection for this workspace */
  onResetConnection?: () => Promise<boolean>;
  /** Whether saving is in progress */
  saving?: boolean;
  /** Whether testing is in progress */
  testing?: boolean;
  /** Whether resetting connection is in progress */
  resettingConnection?: boolean;
  /** Whether remote-only mode is enabled (RALPHER_REMOTE_ONLY) */
  remoteOnly?: boolean;
}

/**
 * WorkspaceSettingsModal provides UI for editing workspace and server connection settings.
 */
export function WorkspaceSettingsModal({
  isOpen,
  onClose,
  workspace,
  status,
  onSave,
  onTest,
  onResetConnection,
  saving = false,
  testing = false,
  resettingConnection = false,
  remoteOnly = false,
}: WorkspaceSettingsModalProps) {
  // Workspace name state
  const [name, setName] = useState("");
  
  // Server settings form state
  const [mode, setMode] = useState<"spawn" | "connect">("spawn");
  const [hostname, setHostname] = useState("localhost");
  const [port, setPort] = useState("4096");
  const [password, setPassword] = useState("");
  const [useHttps, setUseHttps] = useState(false);
  const [allowInsecure, setAllowInsecure] = useState(false);
  const [testResult, setTestResult] = useState<{ success: boolean; error?: string } | null>(null);

  // Initialize form from workspace when modal opens
  useEffect(() => {
    if (isOpen && workspace) {
      setName(workspace.name);
      
      const settings = workspace.serverSettings;
      // If remote-only mode is enabled, force connect mode
      const initialMode = remoteOnly ? "connect" : settings.mode;
      setMode(initialMode);
      setHostname(settings.hostname ?? "localhost");
      setPort(String(settings.port ?? 4096));
      setPassword(settings.password ?? "");
      setUseHttps(settings.useHttps ?? false);
      setAllowInsecure(settings.allowInsecure ?? false);
      setTestResult(null);
    }
  }, [isOpen, workspace, remoteOnly]);

  // Handle form submission
  async function handleSubmit(e: FormEvent) {
    e.preventDefault();

    const newSettings: ServerSettings = {
      mode,
      useHttps: mode === "connect" ? useHttps : false,
      allowInsecure: mode === "connect" && useHttps ? allowInsecure : false,
      ...(mode === "connect" && {
        hostname: hostname.trim(),
        port: parseInt(port, 10) || 4096,
        password: password.trim() || undefined,
      }),
    };

    const success = await onSave(name.trim(), newSettings);
    if (success) {
      onClose();
    }
  }

  // Handle test connection
  async function handleTest() {
    setTestResult(null);
    
    const testSettings: ServerSettings = {
      mode,
      useHttps: mode === "connect" ? useHttps : false,
      allowInsecure: mode === "connect" && useHttps ? allowInsecure : false,
      ...(mode === "connect" && {
        hostname: hostname.trim(),
        port: parseInt(port, 10) || 4096,
        password: password.trim() || undefined,
      }),
    };

    const result = await onTest(testSettings);
    setTestResult(result);
  }

  function handleModeChange(newMode: "spawn" | "connect") {
    setMode(newMode);
    setTestResult(null);
  }

  function handleHostnameChange(value: string) {
    setHostname(value);
    setTestResult(null);
  }

  function handlePortChange(value: string) {
    setPort(value);
    setTestResult(null);
  }

  function handlePasswordChange(value: string) {
    setPassword(value);
    setTestResult(null);
  }

  function handleUseHttpsChange(checked: boolean) {
    setUseHttps(checked);
    // Reset allowInsecure if HTTPS is disabled
    if (!checked) {
      setAllowInsecure(false);
    }
    setTestResult(null);
  }

  function handleAllowInsecureChange(checked: boolean) {
    setAllowInsecure(checked);
    setTestResult(null);
  }

  // Validation
  const isNameValid = name.trim().length > 0;
  const isConnectionValid = mode === "spawn" || (hostname.trim().length > 0);
  const isValid = isNameValid && isConnectionValid;

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Workspace Settings"
      description={workspace ? `Edit settings for "${workspace.name}"` : "Edit workspace settings"}
      size="md"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button
            type="submit"
            form="workspace-settings-form"
            loading={saving}
            disabled={!isValid}
          >
            Save Changes
          </Button>
        </>
      }
    >
      <form id="workspace-settings-form" onSubmit={handleSubmit} className="space-y-6">
        {/* Workspace Name */}
        <div>
          <label
            htmlFor="workspace-name"
            className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1"
          >
            Workspace Name
          </label>
          <input
            type="text"
            id="workspace-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="My Workspace"
            required
            className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 placeholder:text-gray-400 dark:placeholder:text-gray-500"
          />
        </div>

        {/* Directory (read-only) */}
        {workspace && (
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              Directory
            </label>
            <div className="w-full rounded-md border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-600 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-400 font-mono">
              {workspace.directory}
            </div>
            <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
              Directory cannot be changed after workspace creation
            </p>
          </div>
        )}

        {/* Connection Status */}
        <div className="flex items-center gap-2 p-3 rounded-md bg-gray-50 dark:bg-gray-900">
          <span className="text-sm text-gray-600 dark:text-gray-400">Connection Status:</span>
          {status?.connected ? (
            <Badge variant="success">Connected</Badge>
          ) : status?.error ? (
            <Badge variant="error">Error</Badge>
          ) : (
            <Badge variant="warning">Idle</Badge>
          )}
          {status?.error && (
            <span className="text-xs text-red-600 dark:text-red-400 truncate flex-1">
              {status.error}
            </span>
          )}
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
                  onChange={(e) => handleHostnameChange(e.target.value)}
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
                  onChange={(e) => handlePortChange(e.target.value)}
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
                onChange={(e) => handlePasswordChange(e.target.value)}
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
                    onChange={(e) => handleAllowInsecureChange(e.target.checked)}
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

            {/* Test Connection Button */}
            <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3 sm:gap-4">
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={handleTest}
                loading={testing}
                disabled={!hostname.trim()}
              >
                Test Connection
              </Button>
              
              {/* Test Result */}
              {testResult && (
                <div className="flex items-center gap-2">
                  {testResult.success ? (
                    <>
                      <CheckIcon className="w-5 h-5 text-green-500 flex-shrink-0" />
                      <span className="text-sm text-green-600 dark:text-green-400">
                        Connection successful
                      </span>
                    </>
                  ) : (
                    <>
                      <XIcon className="w-5 h-5 text-red-500 flex-shrink-0" />
                      <span className="text-sm text-red-600 dark:text-red-400 break-words">
                        {testResult.error ?? "Connection failed"}
                      </span>
                    </>
                  )}
                </div>
              )}
            </div>
          </div>
        )}

        {/* Reset Connection */}
        {onResetConnection && (
          <div className="border-t border-gray-200 dark:border-gray-700 pt-6 mt-6">
            <div className="p-4 rounded-lg border border-amber-200 dark:border-amber-900 bg-amber-50 dark:bg-amber-900/20">
              <h3 className="text-sm font-medium text-amber-800 dark:text-amber-200 mb-2">
                Troubleshooting
              </h3>
              <p className="text-sm text-amber-700 dark:text-amber-300 mb-4">
                If the connection appears stuck or not responding, reset the connection for this workspace.
                Running loops will be stopped and can be resumed.
              </p>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={onResetConnection}
                loading={resettingConnection}
              >
                <RefreshIcon className="w-4 h-4 mr-2" />
                Reset Connection
              </Button>
            </div>
          </div>
        )}
      </form>
    </Modal>
  );
}

/**
 * Simple check icon.
 */
function CheckIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={2}
    >
      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
    </svg>
  );
}

/**
 * Simple X icon.
 */
function XIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={2}
    >
      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
    </svg>
  );
}

/**
 * Simple refresh icon.
 */
function RefreshIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={2}
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
      />
    </svg>
  );
}

export default WorkspaceSettingsModal;
