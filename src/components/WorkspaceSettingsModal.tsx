/**
 * Workspace settings form and legacy modal wrapper.
 */

import { useState, useEffect, type FormEvent } from "react";
import { Modal, Button, Badge, ConfirmModal } from "./common";
import { ServerSettingsForm } from "./ServerSettingsForm";
import type { ServerSettings, ConnectionStatus } from "../types/settings";
import type { Workspace } from "../types/workspace";
import { createLogger } from "../lib/logger";
import { useAgentsMdOptimizer } from "../hooks/useAgentsMdOptimizer";
import { useToast, type PurgeArchivedLoopsResult } from "../hooks";

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
  /** Callback to purge all archived loops for the workspace */
  onPurgeArchivedLoops?: () => Promise<PurgeArchivedLoopsResult>;
  /** Callback to delete the workspace */
  onDeleteWorkspace?: () => Promise<{ success: boolean; error?: string }>;
  /** Number of archived loops for the selected workspace */
  archivedLoopCount?: number;
  /** Total number of loops/chats still assigned to the selected workspace */
  workspaceLoopCount?: number;
  /** Whether saving is in progress */
  saving?: boolean;
  /** Whether testing is in progress */
  testing?: boolean;
  /** Whether resetting connection is in progress */
  resettingConnection?: boolean;
  /** Whether purging archived loops is in progress */
  purgingArchivedLoops?: boolean;
  /** Whether remote-only mode is enabled (RALPHER_REMOTE_ONLY) */
  remoteOnly?: boolean;
}

/**
 * Shared workspace settings form used by both the shell page and the legacy modal wrapper.
 */
export interface WorkspaceSettingsFormProps {
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
  /** Callback to purge all archived loops for the workspace */
  onPurgeArchivedLoops?: () => Promise<PurgeArchivedLoopsResult>;
  /** Callback to delete the workspace */
  onDeleteWorkspace?: () => Promise<{ success: boolean; error?: string }>;
  /** Number of archived loops for the selected workspace */
  archivedLoopCount?: number;
  /** Total number of loops/chats still assigned to the selected workspace */
  workspaceLoopCount?: number;
  /** Whether saving is in progress */
  saving?: boolean;
  /** Whether testing is in progress */
  testing?: boolean;
  /** Whether resetting connection is in progress */
  resettingConnection?: boolean;
  /** Whether purging archived loops is in progress */
  purgingArchivedLoops?: boolean;
  /** Whether remote-only mode is enabled (RALPHER_REMOTE_ONLY) */
  remoteOnly?: boolean;
  /** Whether to render the inline connection status summary */
  showConnectionStatus?: boolean;
  /** Form id for external submit buttons */
  formId?: string;
  /** Called after a successful save */
  onSaved?: () => void;
  /** Called after a successful delete */
  onDeleted?: () => void;
  /** Reports current form validity */
  onValidityChange?: (isValid: boolean) => void;
}

export function WorkspaceSettingsForm({
  workspace,
  status,
  onSave,
  onTest,
  onResetConnection,
  onPurgeArchivedLoops,
  onDeleteWorkspace,
  archivedLoopCount = 0,
  workspaceLoopCount = 0,
  saving = false,
  testing = false,
  resettingConnection = false,
  purgingArchivedLoops = false,
  remoteOnly = false,
  showConnectionStatus = true,
  formId = "workspace-settings-form",
  onSaved,
  onDeleted,
  onValidityChange,
}: WorkspaceSettingsFormProps) {
  const toast = useToast();
  // Workspace name state
  const [name, setName] = useState("");

  // Server settings state
  const [serverSettings, setServerSettings] = useState<ServerSettings | null>(null);
  const [isServerSettingsValid, setIsServerSettingsValid] = useState(true);

  // Initialize form from workspace when the selected workspace changes
  useEffect(() => {
    if (workspace) {
      setName(workspace.name);
      setServerSettings(workspace.serverSettings);
      setIsServerSettingsValid(true);
      return;
    }

    setName("");
    setServerSettings(null);
    setIsServerSettingsValid(true);
  }, [workspace]);

  // Handle form submission
  async function handleSubmit(e: FormEvent) {
    e.preventDefault();

    if (!serverSettings) return;

    log.debug("Saving workspace settings", { workspaceName: name.trim() });
    const success = await onSave(name.trim(), serverSettings);
    if (success) {
      log.debug("Workspace settings saved successfully");
      onSaved?.();
    } else {
      log.warn("Failed to save workspace settings");
    }
  }

  // Handle server settings change
  function handleServerSettingsChange(settings: ServerSettings, isValid: boolean) {
    log.debug("Server settings changed", {
      provider: settings.agent.provider,
      transport: settings.agent.transport,
      isValid,
    });
    setServerSettings(settings);
    setIsServerSettingsValid(isValid);
  }

  // AGENTS.md optimizer
  const {
    status: optimizerStatus,
    loading: optimizerLoading,
    error: optimizerError,
    fetchStatus: fetchOptimizerStatus,
    optimize: optimizeAgentsMd,
    reset: resetOptimizer,
  } = useAgentsMdOptimizer();
  const [optimizeSuccess, setOptimizeSuccess] = useState<boolean | null>(null);
  const [wasAlreadyOptimized, setWasAlreadyOptimized] = useState(false);
  const [showPurgeArchivedConfirm, setShowPurgeArchivedConfirm] = useState(false);
  const [showDeleteWorkspaceConfirm, setShowDeleteWorkspaceConfirm] = useState(false);
  const [purgeArchivedResult, setPurgeArchivedResult] = useState<PurgeArchivedLoopsResult | null>(null);
  const [purgeArchivedError, setPurgeArchivedError] = useState<string | null>(null);
  const [deletingWorkspace, setDeletingWorkspace] = useState(false);

  useEffect(() => {
    setOptimizeSuccess(null);
    setWasAlreadyOptimized(false);
    setShowPurgeArchivedConfirm(false);
    setShowDeleteWorkspaceConfirm(false);
    setPurgeArchivedResult(null);
    setPurgeArchivedError(null);
    setDeletingWorkspace(false);

    if (!workspace) {
      resetOptimizer();
      return;
    }

    void fetchOptimizerStatus(workspace.id);
    return () => {
      resetOptimizer();
    };
  }, [fetchOptimizerStatus, resetOptimizer, workspace]);

  // Handle applying optimization
  async function handleOptimize() {
    if (!workspace) return;
    setOptimizeSuccess(null);
    setWasAlreadyOptimized(false);
    const result = await optimizeAgentsMd(workspace.id);
    if (result) {
      setOptimizeSuccess(true);
      setWasAlreadyOptimized(result.alreadyOptimized);
    }
  }

  async function handlePurgeArchivedLoops() {
    if (!workspace || !onPurgeArchivedLoops) {
      return;
    }

    setPurgeArchivedResult(null);
    setPurgeArchivedError(null);
    try {
      const result = await onPurgeArchivedLoops();
      if (!result.success) {
        setShowPurgeArchivedConfirm(false);
        setPurgeArchivedError("Failed to purge archived loops.");
        return;
      }

      setPurgeArchivedResult(result);
      setShowPurgeArchivedConfirm(false);
    } catch (error) {
      setShowPurgeArchivedConfirm(false);
      setPurgeArchivedError(`Failed to purge archived loops: ${String(error)}`);
    }
  }

  async function handleDeleteWorkspace() {
    if (!workspace || !onDeleteWorkspace) {
      return;
    }

    setDeletingWorkspace(true);
    try {
      const result = await onDeleteWorkspace();
      setShowDeleteWorkspaceConfirm(false);
      if (!result.success) {
        toast.error(result.error || "Failed to delete workspace");
        return;
      }

      toast.success(`Deleted workspace "${workspace.name}"`);
      onDeleted?.();
    } catch (error) {
      setShowDeleteWorkspaceConfirm(false);
      toast.error(String(error));
    } finally {
      setDeletingWorkspace(false);
    }
  }

  // Validation
  const isNameValid = name.trim().length > 0;
  const isValid = isNameValid && isServerSettingsValid;
  const deleteWorkspaceDisabled = saving || deletingWorkspace || workspaceLoopCount > 0;

  useEffect(() => {
    onValidityChange?.(isValid);
  }, [isValid, onValidityChange]);

  return (
    <>
      <form id={formId} onSubmit={handleSubmit} className="space-y-6">
        {/* Workspace Name */}
        <div>
          <label
            htmlFor={`${formId}-workspace-name`}
            className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300"
          >
            Workspace Name
          </label>
          <input
            type="text"
            id={`${formId}-workspace-name`}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="My Workspace"
            required
            className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-gray-600 dark:bg-neutral-700 dark:text-gray-100"
          />
        </div>

        {/* Directory (read-only) */}
        {workspace && (
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">
              Directory
            </label>
            <div className="w-full break-all rounded-md border border-gray-200 bg-gray-50 px-3 py-2 text-sm font-mono text-gray-600 dark:border-gray-700 dark:bg-neutral-800 dark:text-gray-400">
              {workspace.directory}
            </div>
            <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
              Directory cannot be changed after workspace creation
            </p>
          </div>
        )}

        {showConnectionStatus && (
          <div className="flex items-center gap-2 rounded-md bg-gray-50 p-3 dark:bg-neutral-900">
            <span className="text-sm text-gray-600 dark:text-gray-400">Connection Status:</span>
            {status?.connected ? (
              <Badge variant="success">Connected</Badge>
            ) : status?.error ? (
              <Badge variant="error">Error</Badge>
            ) : (
              <Badge variant="warning">Idle</Badge>
            )}
            {status && (
              <span className="text-xs text-gray-500 dark:text-gray-400">
                {status.provider}/{status.transport}
              </span>
            )}
          </div>
        )}

        {status?.error && (
          <div className="-mt-3 break-words text-xs text-red-600 dark:text-red-400">
            {status.error}
          </div>
        )}

        {/* Server Settings Form (shared component) */}
        {serverSettings && workspace && (
          <ServerSettingsForm
            initialSettings={workspace.serverSettings}
            onChange={handleServerSettingsChange}
            onTest={onTest}
            testing={testing}
            remoteOnly={remoteOnly}
          />
        )}

        {/* AGENTS.md Optimization */}
        {workspace && (
          <div className="border-t border-gray-200 dark:border-gray-700 pt-6 mt-6">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300">
                AGENTS.md Optimization
              </h3>
              {optimizerStatus?.analysis.isOptimized && (
                <Badge variant="success" size="sm">Optimized</Badge>
              )}
            </div>
            <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
              Add planning and progress tracking conventions to the workspace&apos;s AGENTS.md
              so Ralpher loops can track their work reliably across iterations.
            </p>

            {/* Loading state during initial fetch (may involve on-demand connection) */}
            {optimizerLoading && !optimizerStatus && (
              <div className="flex items-center gap-2 mb-3 p-3 rounded-md bg-gray-50 dark:bg-neutral-900">
                <LoadingSpinner className="w-4 h-4 text-gray-400 flex-shrink-0" />
                <span className="text-sm text-gray-600 dark:text-gray-400">
                  Checking AGENTS.md status...
                </span>
              </div>
            )}

            {optimizerError && (
              <div className="mb-3 p-3 rounded-md bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-900">
                <p className="text-sm text-red-700 dark:text-red-300">{optimizerError}</p>
                <button
                  type="button"
                  onClick={() => {
                    if (workspace) {
                      void fetchOptimizerStatus(workspace.id);
                    }
                  }}
                  disabled={optimizerLoading || !workspace}
                  className="mt-2 text-xs font-medium text-red-700 dark:text-red-300 hover:text-red-800 dark:hover:text-red-200 underline disabled:opacity-50"
                >
                  Retry
                </button>
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

            {optimizerStatus && !optimizerStatus.analysis.isOptimized && (
              <div className="flex items-center gap-2 mb-3 p-3 rounded-md bg-gray-50 dark:bg-neutral-900">
                <DocumentIcon className="w-4 h-4 text-gray-400 flex-shrink-0" />
                <span className="text-sm text-gray-600 dark:text-gray-400">
                  {optimizerStatus.fileExists
                    ? "AGENTS.md exists but is not optimized for Ralpher."
                    : "No AGENTS.md file found. One will be created."}
                </span>
              </div>
            )}

            {optimizerStatus?.analysis.updateAvailable && optimizerStatus.analysis.isOptimized && (
              <div className="flex items-center gap-2 mb-3 p-3 rounded-md bg-blue-50 dark:bg-neutral-900/40 border border-blue-200 dark:border-gray-700">
                <span className="text-sm text-blue-700 dark:text-blue-300">
                  An updated version of the Ralpher guidelines is available.
                </span>
              </div>
            )}

            <div className="flex gap-2">
              {(!optimizerStatus?.analysis.isOptimized || optimizerStatus?.analysis.updateAvailable) && !optimizerError && (
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  onClick={handleOptimize}
                  loading={optimizerLoading}
                  disabled={optimizerLoading || !optimizerStatus}
                >
                  <OptimizeIcon className="w-4 h-4 mr-2" />
                  {optimizerStatus?.analysis.updateAvailable && optimizerStatus.analysis.isOptimized
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

        {/* Archived loops purge */}
        {workspace && onPurgeArchivedLoops && (
          <div className="border-t border-gray-200 dark:border-gray-700 pt-6 mt-6">
            <div className="p-4 rounded-lg border border-red-200 dark:border-red-900 bg-red-50 dark:bg-red-900/20">
              <div className="flex items-center justify-between gap-3 mb-2">
                <h3 className="text-sm font-medium text-red-800 dark:text-red-200">
                  Archived Loops
                </h3>
                <Badge variant={archivedLoopCount > 0 ? "warning" : "default"} size="sm">
                  {archivedLoopCount} archived
                </Badge>
              </div>
              <p className="text-sm text-red-700 dark:text-red-300 mb-4">
                Permanently delete all archived loops for this workspace. This removes their loop data and cannot be undone.
              </p>

              {purgeArchivedError && (
                <div className="mb-3 p-3 rounded-md bg-red-100 dark:bg-red-950/40 border border-red-200 dark:border-red-900">
                  <p className="text-sm text-red-700 dark:text-red-300">{purgeArchivedError}</p>
                </div>
              )}

              {purgeArchivedResult && (
                <div className={`mb-3 p-3 rounded-md border ${
                  purgeArchivedResult.failures.length > 0
                    ? "bg-amber-50 dark:bg-amber-900/20 border-amber-200 dark:border-amber-900"
                    : "bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-900"
                }`}>
                  <p className={`text-sm ${
                    purgeArchivedResult.failures.length > 0
                      ? "text-amber-700 dark:text-amber-300"
                      : "text-green-700 dark:text-green-300"
                  }`}>
                    {purgeArchivedResult.totalArchived === 0
                      ? "No archived loops were found for this workspace."
                      : purgeArchivedResult.failures.length > 0
                        ? `Purged ${purgeArchivedResult.purgedCount} of ${purgeArchivedResult.totalArchived} archived loops.`
                        : `Purged ${purgeArchivedResult.purgedCount} archived loops.`}
                  </p>
                  {purgeArchivedResult.failures.length > 0 && (
                    <p className="mt-1 text-xs text-amber-700 dark:text-amber-300">
                      Failed loop IDs: {purgeArchivedResult.failures.map((failure) => failure.loopId).join(", ")}
                    </p>
                  )}
                </div>
              )}

              <Button
                type="button"
                variant="danger"
                size="sm"
                onClick={() => setShowPurgeArchivedConfirm(true)}
                disabled={purgingArchivedLoops || archivedLoopCount === 0}
                loading={purgingArchivedLoops}
              >
                <TrashIcon className="w-4 h-4 mr-2" />
                Purge Archived Loops
              </Button>
            </div>
          </div>
        )}

        {workspace && onDeleteWorkspace && (
          <div className="border-t border-gray-200 dark:border-gray-700 pt-6 mt-6">
            <div className="p-4 rounded-lg border border-red-200 dark:border-red-900 bg-red-50 dark:bg-red-900/20">
              <h3 className="text-sm font-medium text-red-800 dark:text-red-200 mb-2">
                Delete Workspace
              </h3>
              <p className="text-sm text-red-700 dark:text-red-300 mb-4">
                {workspaceLoopCount > 0
                  ? `Delete the remaining ${workspaceLoopCount} loop${workspaceLoopCount === 1 ? "" : "s"} or chat${workspaceLoopCount === 1 ? "" : "s"} in this workspace before removing it from Ralpher.`
                  : "Remove this workspace from Ralpher now that it no longer contains loops or chats."}
                {" "}This only removes the workspace record and does not delete files on disk.
              </p>
              <Button
                type="button"
                variant="danger"
                size="sm"
                onClick={() => setShowDeleteWorkspaceConfirm(true)}
                loading={deletingWorkspace}
                disabled={deleteWorkspaceDisabled}
              >
                <TrashIcon className="w-4 h-4 mr-2" />
                Delete Workspace
              </Button>
            </div>
          </div>
        )}
      </form>

      <ConfirmModal
        isOpen={showPurgeArchivedConfirm}
        onClose={() => setShowPurgeArchivedConfirm(false)}
        onConfirm={handlePurgeArchivedLoops}
        title="Purge Archived Loops"
        message={`Are you sure you want to permanently delete all ${archivedLoopCount} archived loops for "${workspace?.name ?? "this workspace"}"? This cannot be undone.`}
        confirmLabel="Purge All"
        loading={purgingArchivedLoops}
        variant="danger"
      />

      <ConfirmModal
        isOpen={showDeleteWorkspaceConfirm}
        onClose={() => setShowDeleteWorkspaceConfirm(false)}
        onConfirm={handleDeleteWorkspace}
        title="Delete Workspace"
        message={`Are you sure you want to delete workspace "${workspace?.name ?? "this workspace"}"? This only removes it from Ralpher and does not delete files on disk.`}
        confirmLabel="Delete"
        loading={deletingWorkspace}
        variant="danger"
      />
    </>
  );
}

/**
 * Legacy modal wrapper for workspace settings in the old dashboard flow.
 */
export function WorkspaceSettingsModal({
  isOpen,
  onClose,
  ...props
}: WorkspaceSettingsModalProps) {
  const [isValid, setIsValid] = useState(false);

  useEffect(() => {
    if (!isOpen) {
      setIsValid(false);
    }
  }, [isOpen]);

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Workspace Settings"
      description={props.workspace ? `Edit settings for "${props.workspace.name}"` : "Edit workspace settings"}
      size="md"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={props.saving}>
            Cancel
          </Button>
          <Button
            type="submit"
            form="workspace-settings-modal-form"
            loading={props.saving}
            disabled={!isValid}
          >
            Save Changes
          </Button>
        </>
      }
    >
      <WorkspaceSettingsForm
        {...props}
        formId="workspace-settings-modal-form"
        onSaved={onClose}
        onDeleted={onClose}
        onValidityChange={setIsValid}
      />
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
 * Simple loading spinner for async operations.
 */
function LoadingSpinner({ className }: { className?: string }) {
  return (
    <svg
      className={`${className ?? ""} animate-spin`}
      fill="none"
      viewBox="0 0 24 24"
    >
      <circle
        className="opacity-25"
        cx="12"
        cy="12"
        r="10"
        stroke="currentColor"
        strokeWidth="4"
      />
      <path
        className="opacity-75"
        fill="currentColor"
        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
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

function TrashIcon({ className }: { className?: string }) {
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
        d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6M9 7V4a1 1 0 011-1h4a1 1 0 011 1v3M4 7h16"
      />
    </svg>
  );
}

export default WorkspaceSettingsModal;
