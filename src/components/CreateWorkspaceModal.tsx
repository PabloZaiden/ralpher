/**
 * CreateWorkspaceModal component for manual and automatic workspace creation.
 */

import { useState, useEffect, useCallback, useMemo, useRef, type FormEvent } from "react";
import { Modal, Button, PASSWORD_INPUT_PROPS } from "./common";
import { ProvisioningJobView } from "./ProvisioningJobView";
import { ServerSettingsForm } from "./ServerSettingsForm";
import { getStoredSshServerCredential } from "../lib/ssh-browser-credentials";
import type { AgentProvider, ServerSettings, SshServer } from "../types";
import type { CreateWorkspaceRequest } from "../types/workspace";
import { appFetch } from "../lib/public-path";
import { useProvisioningJob } from "../hooks/useProvisioningJob";

function getCreateWorkspaceDefaultServerSettings(): ServerSettings {
  return {
    agent: {
      provider: "copilot",
      transport: "ssh",
      hostname: "localhost",
      port: 22,
    },
  };
}

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
  /** Registered standalone SSH servers available for hostname selection */
  registeredSshServers?: SshServer[];
  /** Callback invoked when provisioning creates or reuses a workspace */
  onProvisioningSuccess?: () => Promise<void>;
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
  registeredSshServers = [],
  onProvisioningSuccess,
}: CreateWorkspaceModalProps) {
  const provisioning = useProvisioningJob();
  const defaultServerSettings = useMemo(() => getCreateWorkspaceDefaultServerSettings(), []);
  const hasActiveProvisioningJob = provisioning.activeJobId !== null;
  const lastProvisioningRefreshIdRef = useRef<string | null>(null);
  const wasOpenRef = useRef(false);

  // Workspace form state
  const [name, setName] = useState("");
  const [directory, setDirectory] = useState("");
  const [mode, setMode] = useState<"manual" | "automatic">("manual");
  const [automaticServerId, setAutomaticServerId] = useState("");
  const [automaticRepoUrl, setAutomaticRepoUrl] = useState("");
  const [automaticBasePath, setAutomaticBasePath] = useState("/workspaces");
  const [automaticProvider, setAutomaticProvider] = useState<AgentProvider>("copilot");
  const [automaticPassword, setAutomaticPassword] = useState("");
  
  // Server settings state
  const [serverSettings, setServerSettings] = useState<ServerSettings>(
    defaultServerSettings,
  );
  const [isServerSettingsValid, setIsServerSettingsValid] = useState(true);
  
  // Test connection state (managed internally)
  const [testing, setTesting] = useState(false);

  // Reset form when modal opens
  useEffect(() => {
    if (!isOpen) {
      wasOpenRef.current = false;
      return;
    }

    if (wasOpenRef.current) {
      if (hasActiveProvisioningJob) {
        setMode("automatic");
      }
      return;
    }

    wasOpenRef.current = true;
    if (hasActiveProvisioningJob) {
      setMode("automatic");
      return;
    }

    setMode("manual");
    setName("");
    setDirectory("");
    setAutomaticServerId(registeredSshServers[0]?.config.id ?? "");
    setAutomaticRepoUrl("");
    setAutomaticBasePath("/workspaces");
    setAutomaticProvider("copilot");
    setAutomaticPassword("");
    setServerSettings(defaultServerSettings);
    setIsServerSettingsValid(true);
    setTesting(false);
  }, [defaultServerSettings, hasActiveProvisioningJob, isOpen, registeredSshServers]);

  useEffect(() => {
    const jobId = provisioning.snapshot?.job.config.id ?? null;
    if (
      provisioning.snapshot?.job.state.status === "completed"
      && onProvisioningSuccess
      && jobId
      && lastProvisioningRefreshIdRef.current !== jobId
    ) {
      lastProvisioningRefreshIdRef.current = jobId;
      void onProvisioningSuccess();
    }
  }, [
    onProvisioningSuccess,
    provisioning.snapshot?.job.config.id,
    provisioning.snapshot?.job.state.status,
  ]);

  // Handle form submission
  async function handleSubmit(e: FormEvent) {
    e.preventDefault();

    if (mode === "automatic") {
      const snapshot = await provisioning.startJob({
        name: name.trim(),
        sshServerId: automaticServerId,
        repoUrl: automaticRepoUrl.trim(),
        basePath: automaticBasePath.trim(),
        provider: automaticProvider,
        password: automaticPassword,
      });
      if (snapshot) {
        setMode("automatic");
        setAutomaticPassword("");
      }
      return;
    }

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

  // Handle test connection - uses the directory from the form
  const handleTestConnection = useCallback(async (settings: ServerSettings): Promise<{ success: boolean; error?: string }> => {
    const trimmedDirectory = directory.trim();
    if (!trimmedDirectory) {
      return { success: false, error: "Please enter a directory first" };
    }

    setTesting(true);
    try {
      const res = await appFetch("/api/server-settings/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ settings, directory: trimmedDirectory }),
      });
      const result = await res.json();
      return result;
    } catch (error) {
      return { success: false, error: String(error) };
    } finally {
      setTesting(false);
    }
  }, [directory]);

  // Validation
  const isNameValid = name.trim().length > 0;
  const isDirectoryValid = directory.trim().length > 0;
  const selectedServerHasStoredCredential = automaticServerId
    ? getStoredSshServerCredential(automaticServerId) !== null
    : false;
  const isAutomaticValid = isNameValid
    && automaticServerId.trim().length > 0
    && automaticRepoUrl.trim().length > 0
    && automaticBasePath.trim().length > 0;
  const isManualValid = isNameValid && isDirectoryValid && isServerSettingsValid;
  const isValid = mode === "automatic" ? isAutomaticValid : isManualValid;
  const provisioningStatus = provisioning.snapshot?.job.state.status;
  const canReturnToAutomaticForm = provisioningStatus === "failed" || provisioningStatus === "cancelled";

  function handleBackToAutomaticForm(): void {
    const config = provisioning.snapshot?.job.config;
    if (!config) {
      provisioning.clearActiveJob();
      return;
    }

    setMode("automatic");
    setName(config.name);
    setAutomaticServerId(config.sshServerId);
    setAutomaticRepoUrl(config.repoUrl);
    setAutomaticBasePath(config.basePath);
    setAutomaticProvider(config.provider);
    setAutomaticPassword("");
    provisioning.clearActiveJob();
  }

  function handleClose(): void {
    const shouldClearProvisioning = provisioning.activeJobId
      && provisioningStatus
      && provisioningStatus !== "running"
      && provisioningStatus !== "pending";
    if (shouldClearProvisioning) {
      provisioning.clearActiveJob();
    }
    onClose();
  }

  const footer = hasActiveProvisioningJob ? (
    <>
      <Button variant="ghost" onClick={handleClose}>
        {provisioningStatus === "running" ? "Hide" : "Close"}
      </Button>
      {canReturnToAutomaticForm && (
        <Button onClick={handleBackToAutomaticForm}>
          Back
        </Button>
      )}
      {provisioningStatus === "running" && (
        <Button
          variant="danger"
          onClick={() => {
            void provisioning.cancelJob();
          }}
        >
          Cancel Job
        </Button>
      )}
    </>
  ) : (
    <>
      <Button variant="ghost" onClick={handleClose} disabled={creating || provisioning.starting}>
        Cancel
      </Button>
      <Button
        type="submit"
        form="create-workspace-form"
        loading={mode === "automatic" ? provisioning.starting : creating}
        disabled={!isValid}
      >
        {mode === "automatic" ? "Start Provisioning" : "Create Workspace"}
      </Button>
    </>
  );

  return (
    <Modal
      isOpen={isOpen}
      onClose={handleClose}
      title="Create Workspace"
      description="Create a new workspace manually with server connection settings or provision one automatically over SSH."
      size="md"
      footer={footer}
    >
      {hasActiveProvisioningJob ? (
        <ProvisioningJobView
          snapshot={provisioning.snapshot}
          logs={provisioning.logs}
          websocketStatus={provisioning.websocketStatus}
          loading={provisioning.loading}
          error={provisioning.error}
        />
      ) : (
      <form id="create-workspace-form" onSubmit={handleSubmit} className="space-y-6">
        <div className="flex gap-2">
          <button
            type="button"
            className={`rounded-md px-3 py-2 text-sm font-medium ${
              mode === "manual"
                ? "bg-blue-600 text-white"
                : "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300"
            }`}
            onClick={() => setMode("manual")}
          >
            Manual
          </button>
          <button
            type="button"
            className={`rounded-md px-3 py-2 text-sm font-medium ${
              mode === "automatic"
                ? "bg-blue-600 text-white"
                : "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300"
            }`}
            onClick={() => setMode("automatic")}
          >
            Automatic
          </button>
        </div>

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
            className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100"
          />
        </div>

        {mode === "manual" ? (
          <>
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
                className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 font-mono"
              />
              <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                Must be a git repository. Directory cannot be changed after creation.
              </p>
            </div>

            <ServerSettingsForm
              initialSettings={defaultServerSettings}
              onChange={handleServerSettingsChange}
              onTest={handleTestConnection}
              testing={testing}
              remoteOnly={remoteOnly}
              registeredSshServers={registeredSshServers}
            />
          </>
        ) : (
          <>
            <div>
              <label
                htmlFor="automatic-ssh-server"
                className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1"
              >
                Saved SSH Server <span className="text-red-500">*</span>
              </label>
              <select
                id="automatic-ssh-server"
                value={automaticServerId}
                onChange={(e) => setAutomaticServerId(e.target.value)}
                className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100"
              >
                <option value="">Select a saved SSH server</option>
                {registeredSshServers.map((server) => (
                  <option key={server.config.id} value={server.config.id}>
                    {server.config.name} ({server.config.username}@{server.config.address})
                  </option>
                ))}
              </select>
              {registeredSshServers.length === 0 && (
                <p className="mt-1 text-xs text-amber-600 dark:text-amber-400">
                  Add a saved SSH server first to use automatic workspace provisioning.
                </p>
              )}
            </div>

            <div>
              <label
                htmlFor="automatic-repo-url"
                className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1"
              >
                Git Repository URL <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                id="automatic-repo-url"
                value={automaticRepoUrl}
                onChange={(e) => setAutomaticRepoUrl(e.target.value)}
                placeholder="git@github.com:owner/repo.git"
                required
                className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 font-mono"
              />
            </div>

            <div>
              <label
                htmlFor="automatic-base-path"
                className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1"
              >
                Remote Base Path <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                id="automatic-base-path"
                value={automaticBasePath}
                onChange={(e) => setAutomaticBasePath(e.target.value)}
                placeholder="/workspaces"
                required
                className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 font-mono"
              />
            </div>

            <div>
              <label
                htmlFor="automatic-provider"
                className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1"
              >
                Provider <span className="text-red-500">*</span>
              </label>
              <select
                id="automatic-provider"
                value={automaticProvider}
                onChange={(e) => setAutomaticProvider(e.target.value as AgentProvider)}
                className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100"
              >
                <option value="copilot">copilot</option>
                <option value="opencode">opencode</option>
              </select>
            </div>

            {!selectedServerHasStoredCredential && (
              <div>
                <label
                  htmlFor="automatic-ssh-password"
                  className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1"
                >
                  SSH Password
                </label>
                <input
                  {...PASSWORD_INPUT_PROPS}
                  type="password"
                  id="automatic-ssh-password"
                  value={automaticPassword}
                  onChange={(e) => setAutomaticPassword(e.target.value)}
                  placeholder="Leave blank for key-based auth"
                  className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100"
                />
                <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                  The password is encrypted in the browser, exchanged for a short-lived token, and kept in memory only while provisioning runs.
                </p>
              </div>
            )}
          </>
        )}

        {/* Error message */}
        {(mode === "manual" ? error : provisioning.error) && (
          <div className="p-3 rounded-md bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800">
            <p className="text-sm text-red-600 dark:text-red-400">
              {mode === "manual" ? error : provisioning.error}
            </p>
          </div>
        )}
      </form>
      )}
    </Modal>
  );
}

export default CreateWorkspaceModal;
