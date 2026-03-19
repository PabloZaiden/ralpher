import type { SshSession, SshConnectionMode, Workspace } from "../../types";
import type { CreateSshSessionRequest, CreateSshServerRequest } from "../../types/api";
import type { SshServer, SshServerSession } from "../../types/ssh-server";
import type { UseDashboardDataResult } from "../../hooks/useDashboardData";
import type { UseProvisioningJobResult } from "../../hooks/useProvisioningJob";
import { getStoredSshServerCredential } from "../../lib/ssh-browser-credentials";
import {
  CreateLoopForm,
  getComposeDraftActionLabel,
  getComposeSubmitActionLabel,
  type CreateLoopFormActionState,
  type CreateLoopFormSubmitRequest,
} from "../CreateLoopForm";
import { ProvisioningJobView } from "../ProvisioningJobView";
import { ServerSettingsForm } from "../ServerSettingsForm";
import type { ServerSettings } from "../../types/settings";
import { Badge, Button, PASSWORD_INPUT_PROPS } from "../common";
import { ShellPanel, InlineField } from "./shell-panel";
import { SshSessionComposer, SshServerComposer } from "./shell-composers";
import type { ComposeKind, ShellRoute } from "./shell-types";
import { getProvisioningStatusBadgeVariant } from "./shell-types";
import type { UseWorkspaceCreateResult } from "./use-workspace-create";

interface ComposeViewProps {
  kind: ComposeKind;
  composeWorkspace: Workspace | null;
  composeServer: SshServer | null;
  shellHeaderOffsetClassName: string;
  navigateWithinShell: (route: ShellRoute) => void;
  composeActionState: CreateLoopFormActionState | null;
  setComposeActionState: (state: CreateLoopFormActionState | null) => void;
  handleLoopSubmit: (
    kind: Extract<ComposeKind, "loop" | "chat">,
    request: CreateLoopFormSubmitRequest,
  ) => Promise<boolean>;
  dashboardData: UseDashboardDataResult;
  workspaces: Workspace[];
  workspacesLoading: boolean;
  workspaceError: string | null;
  servers: SshServer[];
  workspaceCreate: UseWorkspaceCreateResult;
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  sessions: SshSession[];
  createSession: (request: CreateSshSessionRequest) => Promise<SshSession>;
  createStandaloneSession: (
    serverId: string,
    options?: { name?: string; connectionMode?: SshConnectionMode },
  ) => Promise<SshServerSession>;
  createServer: (request: CreateSshServerRequest, password?: string) => Promise<SshServer | null>;
  provisioning: UseProvisioningJobResult;
  workspacesSaving: boolean;
}

export function ComposeView(props: ComposeViewProps) {
  const {
    kind,
    composeWorkspace,
    composeServer,
    shellHeaderOffsetClassName,
    navigateWithinShell,
    composeActionState,
    setComposeActionState,
    handleLoopSubmit,
    dashboardData,
    workspaces,
    workspacesLoading,
    workspaceError,
    servers,
    workspaceCreate,
    sessions: _sessions,
    createSession,
    createStandaloneSession,
    createServer,
    provisioning,
    workspacesSaving,
  } = props;

  const sshWorkspaces = workspaces.filter(
    (workspace) => workspace.serverSettings.agent.transport === "ssh",
  );

  if (kind === "loop" || kind === "chat") {
    const handleComposeCancel = () =>
      navigateWithinShell(
        composeWorkspace ? { view: "workspace", workspaceId: composeWorkspace.id } : { view: "home" },
      );

    return (
      <ShellPanel
        eyebrow={kind === "chat" ? "Chat" : "Loop"}
        title={
          kind === "chat"
            ? composeWorkspace
              ? `Start a new chat in ${composeWorkspace.name}`
              : "Start a new chat"
            : composeWorkspace
              ? `Start a new loop in ${composeWorkspace.name}`
              : "Start a new loop"
        }
        description={composeWorkspace?.directory}
        descriptionClassName="hidden sm:inline font-mono"
        variant="compact"
        headerOffsetClassName={shellHeaderOffsetClassName}
        actions={
          <>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={composeActionState?.onCancel ?? handleComposeCancel}
              disabled={composeActionState?.isSubmitting}
            >
              Cancel
            </Button>
            {kind === "loop" &&
              composeActionState &&
              (!composeActionState.isEditing || composeActionState.isEditingDraft) && (
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  onClick={composeActionState.onSaveAsDraft}
                  aria-label={getComposeDraftActionLabel(composeActionState.isEditingDraft)}
                  disabled={!composeActionState.canSaveDraft}
                  loading={composeActionState.isSubmitting}
                >
                  {getComposeDraftActionLabel(composeActionState.isEditingDraft)}
                </Button>
              )}
            {composeActionState && (
              <Button
                type="button"
                size="sm"
                onClick={composeActionState.onSubmit}
                disabled={!composeActionState.canSubmit}
                loading={composeActionState.isSubmitting}
              >
                {getComposeSubmitActionLabel({
                  isChatMode: kind === "chat",
                  isEditing: composeActionState.isEditing,
                })}
              </Button>
            )}
          </>
        }
      >
        <CreateLoopForm
          key={`${kind}:${composeWorkspace?.id ?? "none"}`}
          mode={kind}
          onSubmit={(request) => handleLoopSubmit(kind, request)}
          onCancel={handleComposeCancel}
          closeOnSuccess={false}
          models={dashboardData.models}
          modelsLoading={dashboardData.modelsLoading}
          lastModel={dashboardData.lastModel}
          onWorkspaceChange={dashboardData.handleWorkspaceChange}
          planningWarning={dashboardData.planningWarning}
          branches={dashboardData.branches}
          branchesLoading={dashboardData.branchesLoading}
          currentBranch={dashboardData.currentBranch}
          defaultBranch={dashboardData.defaultBranch}
          initialLoopData={
            composeWorkspace
              ? {
                  directory: composeWorkspace.directory,
                  prompt: "",
                  workspaceId: composeWorkspace.id,
                }
              : null
          }
          workspaces={workspaces}
          workspacesLoading={workspacesLoading}
          workspaceError={workspaceError}
          registeredSshServers={servers}
          renderActions={setComposeActionState}
        />
      </ShellPanel>
    );
  }

  if (kind === "workspace") {
    const {
      workspaceCreateMode,
      setWorkspaceCreateMode,
      workspaceName,
      setWorkspaceName,
      workspaceDirectory,
      setWorkspaceDirectory,
      workspaceServerSettings,
      setWorkspaceServerSettings,
      workspaceServerSettingsValid,
      setWorkspaceServerSettingsValid,
      workspaceTesting,
      workspaceCreateSubmitting,
      automaticServerId,
      setAutomaticServerId,
      automaticRepoUrl,
      setAutomaticRepoUrl,
      automaticBasePath,
      setAutomaticBasePath,
      automaticProvider,
      setAutomaticProvider,
      automaticPassword,
      setAutomaticPassword,
      handleCreateWorkspace,
      handleTestWorkspaceConnection,
      handleBackToAutomaticWorkspaceForm,
    } = workspaceCreate;

    const workspaceCreateFormId = "workspace-create-form";
    const provisioningStatus = provisioning.snapshot?.job.state.status;
    const provisionedWorkspaceId =
      provisioning.snapshot?.workspace?.id ?? provisioning.snapshot?.job.state.workspaceId;
    const canReturnToAutomaticForm =
      provisioningStatus === "failed" || provisioningStatus === "cancelled";
    const selectedServerHasStoredCredential = automaticServerId
      ? getStoredSshServerCredential(automaticServerId) !== null
      : false;
    const automaticFormValid =
      workspaceName.trim().length > 0 &&
      automaticServerId.trim().length > 0 &&
      automaticRepoUrl.trim().length > 0 &&
      automaticBasePath.trim().length > 0;
    const manualFormValid =
      workspaceName.trim().length > 0 &&
      workspaceDirectory.trim().length > 0 &&
      workspaceServerSettingsValid;

    // Suppress unused
    void provisioning;

    return (
      <ShellPanel
        eyebrow="Workspace"
        title="Create a workspace"
        variant="compact"
        headerOffsetClassName={shellHeaderOffsetClassName}
        badges={
          <>
            <Badge variant={workspaceCreateMode === "automatic" ? "info" : "default"} size="sm">
              {workspaceCreateMode === "automatic" ? "Automatic" : "Manual"}
            </Badge>
            {provisioningStatus && (
              <Badge variant={getProvisioningStatusBadgeVariant(provisioningStatus)} size="sm">
                {provisioningStatus}
              </Badge>
            )}
          </>
        }
        actions={
          provisioning.activeJobId ? (
            <>
              {canReturnToAutomaticForm && (
                <Button type="button" size="sm" onClick={handleBackToAutomaticWorkspaceForm}>
                  Back to Automatic Form
                </Button>
              )}
              {provisionedWorkspaceId && provisioningStatus === "completed" && (
                <Button
                  type="button"
                  size="sm"
                  onClick={() =>
                    navigateWithinShell({ view: "workspace", workspaceId: provisionedWorkspaceId })
                  }
                >
                  Open Workspace
                </Button>
              )}
              {(provisioningStatus === "running" || provisioningStatus === "pending") && (
                <Button
                  type="button"
                  size="sm"
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
              <Button
                type="button"
                size="sm"
                variant={workspaceCreateMode === "manual" ? "primary" : "secondary"}
                onClick={() => setWorkspaceCreateMode("manual")}
              >
                Manual
              </Button>
              <Button
                type="button"
                size="sm"
                variant={workspaceCreateMode === "automatic" ? "primary" : "secondary"}
                onClick={() => setWorkspaceCreateMode("automatic")}
              >
                Automatic
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => navigateWithinShell({ view: "home" })}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                form={workspaceCreateFormId}
                size="sm"
                loading={
                  workspaceCreateMode === "automatic"
                    ? provisioning.starting
                    : workspaceCreateSubmitting || workspacesSaving
                }
                disabled={workspaceCreateMode === "automatic" ? !automaticFormValid : !manualFormValid}
              >
                {workspaceCreateMode === "automatic" ? "Start Provisioning" : "Create Workspace"}
              </Button>
            </>
          )
        }
      >
        {provisioning.activeJobId ? (
          <div className="space-y-6">
            <ProvisioningJobView
              snapshot={provisioning.snapshot}
              logs={provisioning.logs}
              websocketStatus={provisioning.websocketStatus}
              loading={provisioning.loading}
              error={provisioning.error}
            />
          </div>
        ) : (
          <form
            id={workspaceCreateFormId}
            className="space-y-6"
            onSubmit={(event) => handleCreateWorkspace(event)}
          >
            <InlineField
              id="workspace-name"
              label="Workspace name"
              value={workspaceName}
              onChange={setWorkspaceName}
              placeholder="Main repository"
              required
            />

            {workspaceCreateMode === "manual" ? (
              <>
                <InlineField
                  id="workspace-directory"
                  label="Directory"
                  value={workspaceDirectory}
                  onChange={setWorkspaceDirectory}
                  placeholder="/workspaces/project"
                  required
                  help="Absolute path on the selected workspace host."
                />
                <ServerSettingsForm
                  initialSettings={workspaceServerSettings}
                  onChange={(settings: ServerSettings, isValid: boolean) => {
                    setWorkspaceServerSettings((current: ServerSettings) => {
                      return JSON.stringify(current) === JSON.stringify(settings) ? current : settings;
                    });
                    setWorkspaceServerSettingsValid(isValid);
                  }}
                  onTest={handleTestWorkspaceConnection}
                  testing={workspaceTesting}
                  remoteOnly={dashboardData.remoteOnly}
                  registeredSshServers={servers}
                />
              </>
            ) : (
              <div className="space-y-4">
                <div>
                  <label
                    htmlFor="automatic-ssh-server"
                    className="mb-1.5 block text-sm font-medium text-gray-700 dark:text-gray-300"
                  >
                    Saved SSH server <span className="ml-1 text-red-500">*</span>
                  </label>
                  <select
                    id="automatic-ssh-server"
                    value={automaticServerId}
                    onChange={(event) => setAutomaticServerId(event.target.value)}
                    className="block w-full rounded-xl border border-gray-300 bg-white px-3 py-2.5 text-sm text-gray-900 shadow-sm outline-none transition focus:border-gray-500 focus:ring-2 focus:ring-gray-300 dark:border-gray-700 dark:bg-neutral-800 dark:text-gray-100 dark:focus:border-gray-500 dark:focus:ring-gray-700"
                  >
                    <option value="">Select a saved SSH server</option>
                    {servers.map((server) => (
                      <option key={server.config.id} value={server.config.id}>
                        {server.config.name} ({server.config.username}@{server.config.address})
                      </option>
                    ))}
                  </select>
                  {servers.length === 0 && (
                    <p className="mt-1 text-xs text-amber-600 dark:text-amber-400">
                      Register a saved SSH server first to use automatic workspace provisioning.
                    </p>
                  )}
                </div>

                <InlineField
                  id="automatic-repo-url"
                  label="Git repository URL"
                  value={automaticRepoUrl}
                  onChange={setAutomaticRepoUrl}
                  placeholder="git@github.com:owner/repo.git"
                  required
                  help="Repository to clone on the remote host."
                />

                <InlineField
                  id="automatic-base-path"
                  label="Remote base path"
                  value={automaticBasePath}
                  onChange={setAutomaticBasePath}
                  placeholder="/workspaces"
                  required
                  help="Parent directory where the repo should be cloned."
                />

                <div>
                  <label
                    htmlFor="automatic-provider"
                    className="mb-1.5 block text-sm font-medium text-gray-700 dark:text-gray-300"
                  >
                    Provider <span className="ml-1 text-red-500">*</span>
                  </label>
                  <select
                    id="automatic-provider"
                    value={automaticProvider}
                    onChange={(event) =>
                      setAutomaticProvider(
                        event.target.value as import("../../types/settings").AgentProvider,
                      )
                    }
                    className="block w-full rounded-xl border border-gray-300 bg-white px-3 py-2.5 text-sm text-gray-900 shadow-sm outline-none transition focus:border-gray-500 focus:ring-2 focus:ring-gray-300 dark:border-gray-700 dark:bg-neutral-800 dark:text-gray-100 dark:focus:border-gray-500 dark:focus:ring-gray-700"
                  >
                    <option value="copilot">copilot</option>
                    <option value="opencode">opencode</option>
                  </select>
                </div>

                {!selectedServerHasStoredCredential && (
                  <InlineField
                    id="automatic-ssh-password"
                    label="SSH password"
                    value={automaticPassword}
                    onChange={setAutomaticPassword}
                    placeholder="Leave blank for key-based auth"
                    type="password"
                    help="Stored encrypted in this client to start provisioning when password auth is required."
                    inputProps={PASSWORD_INPUT_PROPS}
                  />
                )}
              </div>
            )}

            {provisioning.error && (
              <div className="rounded-md border border-red-200 bg-red-50 p-3 dark:border-red-800 dark:bg-red-900/20">
                <p className="text-sm text-red-600 dark:text-red-400">{provisioning.error}</p>
              </div>
            )}
          </form>
        )}
      </ShellPanel>
    );
  }

  if (kind === "ssh-session") {
    return (
      <SshSessionComposer
        workspaces={sshWorkspaces}
        servers={servers}
        initialWorkspaceId={composeWorkspace?.id}
        initialServerId={composeServer?.config.id}
        headerOffsetClassName={shellHeaderOffsetClassName}
        onCancel={() =>
          navigateWithinShell(
            composeWorkspace
              ? { view: "workspace", workspaceId: composeWorkspace.id }
              : composeServer
                ? { view: "ssh-server", serverId: composeServer.config.id }
                : { view: "home" },
          )
        }
        onNavigate={navigateWithinShell}
        onCreateWorkspaceSession={createSession}
        onCreateStandaloneSession={createStandaloneSession}
      />
    );
  }

  return (
    <SshServerComposer
      headerOffsetClassName={shellHeaderOffsetClassName}
      onCancel={() => navigateWithinShell({ view: "home" })}
      onNavigate={navigateWithinShell}
      onCreateServer={createServer}
    />
  );
}

// Re-export the workspacesSaving prop type for ComposeView (workspace kind needs it)
export type { ComposeViewProps };