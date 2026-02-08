/**
 * WorkspaceSettingsModal component for editing workspace settings.
 * Allows editing workspace name and server connection settings.
 */

import { useState, useEffect, useCallback, type FormEvent } from "react";
import { Modal, Button, Badge } from "./common";
import { ServerSettingsForm } from "./ServerSettingsForm";
import type { ServerSettings, ConnectionStatus } from "../types/settings";
import type { Workspace } from "../types/workspace";
import { createLogger } from "../lib/logger";
import { useAgentsMdOptimizer } from "../hooks/useAgentsMdOptimizer";

const log = createLogger("WorkspaceSettingsModal");

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
  
  // Server settings state
  const [serverSettings, setServerSettings] = useState<ServerSettings | null>(null);
  const [isServerSettingsValid, setIsServerSettingsValid] = useState(true);

  // Initialize form from workspace when modal opens
  useEffect(() => {
    if (isOpen && workspace) {
      setName(workspace.name);
      setServerSettings(workspace.serverSettings);
      setIsServerSettingsValid(true);
    }
  }, [isOpen, workspace]);

  // Handle form submission
  async function handleSubmit(e: FormEvent) {
    e.preventDefault();

    if (!serverSettings) return;

    log.debug("Saving workspace settings", { workspaceName: name.trim() });
    const success = await onSave(name.trim(), serverSettings);
    if (success) {
      log.trace("Workspace settings saved successfully");
      onClose();
    } else {
      log.warn("Failed to save workspace settings");
    }
  }

  // Handle server settings change
  function handleServerSettingsChange(settings: ServerSettings, isValid: boolean) {
    log.trace("Server settings changed", { mode: settings.mode, isValid });
    setServerSettings(settings);
    setIsServerSettingsValid(isValid);
  }

  // AGENTS.md optimizer
  const optimizer = useAgentsMdOptimizer();
  const [optimizeSuccess, setOptimizeSuccess] = useState<boolean | null>(null);
  const [wasAlreadyOptimized, setWasAlreadyOptimized] = useState(false);

  // Fetch AGENTS.md status when modal opens with a connected workspace
  const fetchOptimizerStatus = useCallback(async () => {
    if (isOpen && workspace && status?.connected) {
      setOptimizeSuccess(null);
      setWasAlreadyOptimized(false);
      await optimizer.fetchStatus(workspace.id);
    }
  }, [isOpen, workspace?.id, status?.connected]);

  useEffect(() => {
    fetchOptimizerStatus();
  }, [fetchOptimizerStatus]);

  // Reset optimizer state when modal closes
  useEffect(() => {
    if (!isOpen) {
      optimizer.reset();
      setOptimizeSuccess(null);
      setWasAlreadyOptimized(false);
    }
  }, [isOpen]);

  // Handle applying optimization
  async function handleOptimize() {
    if (!workspace) return;
    setOptimizeSuccess(null);
    setWasAlreadyOptimized(false);
    const result = await optimizer.optimize(workspace.id);
    if (result) {
      setOptimizeSuccess(true);
      setWasAlreadyOptimized(result.alreadyOptimized);
    }
  }

  // Validation
  const isNameValid = name.trim().length > 0;
  const isValid = isNameValid && isServerSettingsValid;

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

        {/* Server Settings Form (shared component) */}
        {serverSettings && (
          <ServerSettingsForm
            initialSettings={serverSettings}
            onChange={handleServerSettingsChange}
            onTest={onTest}
            testing={testing}
            remoteOnly={remoteOnly}
          />
        )}

        {/* AGENTS.md Optimization */}
        {workspace && status?.connected && (
          <div className="border-t border-gray-200 dark:border-gray-700 pt-6 mt-6">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300">
                AGENTS.md Optimization
              </h3>
              {optimizer.status?.analysis.isOptimized && (
                <Badge variant="success" size="sm">Optimized</Badge>
              )}
            </div>
            <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
              Add planning and progress tracking conventions to the workspace&apos;s AGENTS.md
              so Ralpher loops can track their work reliably across iterations.
            </p>

            {optimizer.error && (
              <div className="mb-3 p-3 rounded-md bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-900">
                <p className="text-sm text-red-700 dark:text-red-300">{optimizer.error}</p>
              </div>
            )}

            {optimizeSuccess && (
              <div className="mb-3 p-3 rounded-md bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-900">
                <p className="text-sm text-green-700 dark:text-green-300">
                  {wasAlreadyOptimized
                    ? "AGENTS.md is already optimized."
                    : "AGENTS.md optimized successfully."}
                </p>
              </div>
            )}

            {optimizer.status && !optimizer.status.analysis.isOptimized && (
              <div className="flex items-center gap-2 mb-3 p-3 rounded-md bg-gray-50 dark:bg-gray-900">
                <DocumentIcon className="w-4 h-4 text-gray-400 flex-shrink-0" />
                <span className="text-sm text-gray-600 dark:text-gray-400">
                  {optimizer.status.fileExists
                    ? "AGENTS.md exists but is not optimized for Ralpher."
                    : "No AGENTS.md file found. One will be created."}
                </span>
              </div>
            )}

            {optimizer.status?.analysis.updateAvailable && optimizer.status.analysis.isOptimized && (
              <div className="flex items-center gap-2 mb-3 p-3 rounded-md bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-900">
                <span className="text-sm text-blue-700 dark:text-blue-300">
                  An updated version of the Ralpher guidelines is available.
                </span>
              </div>
            )}

            <div className="flex gap-2">
              {(!optimizer.status?.analysis.isOptimized || optimizer.status?.analysis.updateAvailable) && (
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  onClick={handleOptimize}
                  loading={optimizer.loading}
                  disabled={optimizer.loading}
                >
                  <OptimizeIcon className="w-4 h-4 mr-2" />
                  {optimizer.status?.analysis.updateAvailable && optimizer.status.analysis.isOptimized
                    ? "Update AGENTS.md"
                    : "Optimize AGENTS.md"}
                </Button>
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

/**
 * Simple document icon for AGENTS.md status.
 */
function DocumentIcon({ className }: { className?: string }) {
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
        d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
      />
    </svg>
  );
}

/**
 * Simple optimize/sparkle icon.
 */
function OptimizeIcon({ className }: { className?: string }) {
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
        d="M5 3v4M3 5h4M6 17v4m-2-2h4m5-16l2.286 6.857L21 12l-5.714 2.143L13 21l-2.286-6.857L5 12l5.714-2.143L13 3z"
      />
    </svg>
  );
}

export default WorkspaceSettingsModal;
