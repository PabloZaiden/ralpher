import type { Loop, SshSession, Workspace } from "../../types";
import type { CreateSshSessionRequest } from "../../types/api";
import type { ServerSettings } from "../../types/settings";
import type { SshServer } from "../../types/ssh-server";
import type { WorkspaceExportData, WorkspaceImportResult } from "../../types/workspace";
import type { WorkspaceGroup } from "../../hooks/useLoopGrouping";
import type { UseDashboardDataResult } from "../../hooks/useDashboardData";
import type { UseProvisioningJobResult } from "../../hooks/useProvisioningJob";
import { getStoredSshServerCredential } from "../../lib/ssh-browser-credentials";
import { AppSettingsPanel } from "../AppSettingsModal";
import {
  CreateLoopForm,
  getComposeDraftActionLabel,
  getComposeSubmitActionLabel,
  type CreateLoopFormActionState,
  type CreateLoopFormSubmitRequest,
} from "../CreateLoopForm";
import { LoopDetails } from "../LoopDetails";
import { ProvisioningJobView } from "../ProvisioningJobView";
import { ServerSettingsForm } from "../ServerSettingsForm";
import { SshSessionDetails } from "../SshSessionDetails";
import { WorkspaceSettingsForm } from "../WorkspaceSettingsModal";
import { Badge, Button, SidebarIcon, PASSWORD_INPUT_PROPS } from "../common";
import { ShellPanel, InlineField } from "./shell-panel";
import { OverviewView, WorkspaceView, SshServerView } from "./shell-views";
import { DraftLoopComposer, SshSessionComposer, SshServerComposer } from "./shell-composers";
import type { ComposeKind, ShellRoute } from "./shell-types";
import { getProvisioningStatusBadgeVariant } from "./shell-types";
import type { UseWorkspaceCreateResult } from "./use-workspace-create";
import type { UseWorkspaceSettingsShellResult } from "./use-workspace-settings-shell";

interface ShellMainContentProps {
  route: ShellRoute;
  shellLoading: boolean;
  shellErrors: string[];
  sidebarCollapsed: boolean;
  shellHeaderOffsetClassName: string;
  openSidebar: () => void;
  navigateWithinShell: (route: ShellRoute) => void;

  // Data
  loops: Loop[];
  workspaces: Workspace[];
  sessions: SshSession[];
  servers: SshServer[];
  sessionsByServerId: Record<string, import("../../types/ssh-server").SshServerSession[]>;
  workspaceGroups: WorkspaceGroup[];
  workspacesLoading: boolean;
  workspacesSaving: boolean;
  workspaceError: string | null;

  // Selections
  selectedLoop: Loop | null;
  selectedWorkspace: Workspace | null;
  composeWorkspace: Workspace | null;
  composeServer: SshServer | null;
  selectedServer: SshServer | null;

  // Loop actions
  refreshLoops: () => Promise<void>;
  purgeLoop: (loopId: string) => Promise<boolean>;
  refreshSshSessions: () => Promise<void>;
  refreshSshServers: () => Promise<void>;
  refreshWorkspaces: () => Promise<void>;
  createSession: (request: CreateSshSessionRequest) => Promise<SshSession>;
  createStandaloneSession: (
    serverId: string,
    options?: { name?: string; connectionMode?: import("../../types").SshConnectionMode },
  ) => Promise<import("../../types/ssh-server").SshServerSession>;
  createServer: (
    request: import("../../types").CreateSshServerRequest,
    password?: string,
  ) => Promise<SshServer | null>;
  deleteServer: (id: string) => Promise<boolean>;
  deleteWorkspace: (id: string) => Promise<{ success: boolean; error?: string }>;
  exportConfig: () => Promise<WorkspaceExportData | null>;
  importConfig: (data: WorkspaceExportData) => Promise<WorkspaceImportResult | null>;

  // Dashboard data
  dashboardData: UseDashboardDataResult;

  // Compose state
  composeActionState: CreateLoopFormActionState | null;
  setComposeActionState: (state: CreateLoopFormActionState | null) => void;
  handleLoopSubmit: (
    kind: Extract<ComposeKind, "loop" | "chat">,
    request: CreateLoopFormSubmitRequest,
  ) => Promise<boolean>;

  // Workspace create
  workspaceCreate: UseWorkspaceCreateResult;

  // Workspace settings
  workspaceSettings: UseWorkspaceSettingsShellResult;

  // Provisioning
  provisioning: UseProvisioningJobResult;

  // Toast
  toast: import("../../hooks/useToast").ToastContextValue;
}

function renderComposeView(props: ShellMainContentProps, kind: ComposeKind) {
  const {
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

    const { provisioning } = props;
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
                    : workspaceCreateSubmitting || props.workspacesSaving
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
                      setAutomaticProvider(event.target.value as import("../../types/settings").AgentProvider)
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

function renderMainContent(props: ShellMainContentProps) {
  const {
    route,
    shellLoading,
    shellHeaderOffsetClassName,
    navigateWithinShell,
    loops,
    workspaces,
    sessions,
    servers,
    sessionsByServerId,
    workspaceGroups,
    workspacesLoading,
    workspaceError,
    selectedLoop,
    selectedWorkspace,
    selectedServer,
    refreshLoops,
    refreshSshSessions,
    refreshSshServers,
    refreshWorkspaces,
    purgeLoop,
    deleteServer,
    deleteWorkspace,
    dashboardData,
    workspaceSettings,
    exportConfig,
    importConfig,
    workspacesSaving,
    toast,
  } = props;

  if (shellLoading && route.view === "home") {
    return <div className="p-6 text-sm text-gray-500 dark:text-gray-400">Loading…</div>;
  }

  if (route.view === "loop") {
    if (!selectedLoop) {
      return shellLoading ? (
        <div className="p-6 text-sm text-gray-500 dark:text-gray-400">Loading loop…</div>
      ) : (
        <ShellPanel eyebrow="Loop" title="Loop not found" description="The selected loop no longer exists.">
          <p className="text-sm text-gray-500 dark:text-gray-400">
            Use the sidebar or home button to continue.
          </p>
        </ShellPanel>
      );
    }

    if (selectedLoop.state.status === "draft") {
      return (
        <DraftLoopComposer
          loop={selectedLoop}
          workspaces={workspaces}
          models={dashboardData.models}
          modelsLoading={dashboardData.modelsLoading}
          lastModel={dashboardData.lastModel}
          onWorkspaceChange={dashboardData.handleWorkspaceChange}
          planningWarning={dashboardData.planningWarning}
          branches={dashboardData.branches}
          branchesLoading={dashboardData.branchesLoading}
          currentBranch={dashboardData.currentBranch}
          defaultBranch={dashboardData.defaultBranch}
          registeredSshServers={servers}
          workspaceError={workspaceError}
          workspacesLoading={workspacesLoading}
          headerOffsetClassName={shellHeaderOffsetClassName}
          onRefresh={refreshLoops}
          onDeleteDraft={purgeLoop}
          onNavigate={navigateWithinShell}
        />
      );
    }

    return (
      <LoopDetails
        key={`loop:${route.loopId}`}
        loopId={route.loopId}
        onBack={() => {
          navigateWithinShell({ view: "home" });
          void refreshLoops();
        }}
        showBackButton={false}
        headerOffsetClassName={shellHeaderOffsetClassName}
        onSelectSshSession={(sshSessionId) => navigateWithinShell({ view: "ssh", sshSessionId })}
      />
    );
  }

  if (route.view === "chat") {
    return (
      <LoopDetails
        key={`chat:${route.chatId}`}
        loopId={route.chatId}
        onBack={() => {
          navigateWithinShell({ view: "home" });
          void refreshLoops();
        }}
        showBackButton={false}
        headerOffsetClassName={shellHeaderOffsetClassName}
        onSelectSshSession={(sshSessionId) => navigateWithinShell({ view: "ssh", sshSessionId })}
      />
    );
  }

  if (route.view === "ssh") {
    return (
      <SshSessionDetails
        sshSessionId={route.sshSessionId}
        onBack={() => {
          navigateWithinShell({ view: "home" });
          void refreshSshSessions();
          void refreshSshServers();
        }}
        showBackButton={false}
        headerOffsetClassName={shellHeaderOffsetClassName}
      />
    );
  }

  if (route.view === "workspace") {
    if (!selectedWorkspace) {
      return (
        <ShellPanel
          eyebrow="Workspace"
          title="Workspace not found"
          description="The selected workspace no longer exists."
        >
          <p className="text-sm text-gray-500 dark:text-gray-400">
            Use the sidebar or home button to continue.
          </p>
        </ShellPanel>
      );
    }
    const relatedLoops = loops.filter((loop) => loop.config.workspaceId === selectedWorkspace.id);
    const relatedSessions = sessions.filter(
      (session) => session.config.workspaceId === selectedWorkspace.id,
    );
    return (
      <WorkspaceView
        workspace={selectedWorkspace}
        relatedLoops={relatedLoops}
        relatedSessions={relatedSessions}
        registeredSshServers={servers}
        headerOffsetClassName={shellHeaderOffsetClassName}
        onOpenSettings={() =>
          navigateWithinShell({ view: "workspace-settings", workspaceId: selectedWorkspace.id })
        }
        onNavigate={navigateWithinShell}
      />
    );
  }

  if (route.view === "workspace-settings") {
    if (!selectedWorkspace) {
      return (
        <ShellPanel
          eyebrow="Workspace"
          title="Workspace not found"
          description="The selected workspace no longer exists."
        >
          <p className="text-sm text-gray-500 dark:text-gray-400">
            Use the sidebar or home button to continue.
          </p>
        </ShellPanel>
      );
    }

    const {
      workspace: workspaceFromHook,
      status: workspaceStatus,
      loading: workspaceSettingsLoading,
      error: workspaceSettingsError,
      saving: workspaceSettingsSaving,
      testing: workspaceSettingsTesting,
      resettingConnection: workspaceSettingsResetting,
      testConnection: testWorkspaceConnection,
      resetConnection: resetWorkspaceConnection,
      updateWorkspace: updateWorkspaceSettings,
      workspaceSettingsWorkspaceId,
      workspaceSettingsFormValid,
      setWorkspaceSettingsFormValid,
      workspaceArchivedLoopsPurging,
      handlePurgeArchivedLoops,
      selectedWorkspaceArchivedLoopCount,
      selectedWorkspaceLoopCount,
    } = workspaceSettings;

    return (
      <ShellPanel
        eyebrow="Workspace settings"
        title="Workspace Settings"
        description={workspaceFromHook?.directory ?? selectedWorkspace.directory}
        descriptionClassName="hidden sm:inline font-mono"
        variant="compact"
        headerOffsetClassName={shellHeaderOffsetClassName}
        actions={
          <Button
            type="submit"
            form="workspace-settings-shell-form"
            size="sm"
            loading={workspaceSettingsSaving}
            disabled={!workspaceSettingsFormValid || workspaceSettingsLoading || !workspaceFromHook}
          >
            <span className="sm:hidden">Save</span>
            <span className="hidden sm:inline">Save Changes</span>
          </Button>
        }
      >
        {workspaceSettingsError && (
          <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-900/20 dark:text-red-300">
            {workspaceSettingsError}
          </div>
        )}

        {workspaceSettingsLoading && !workspaceFromHook ? (
          <div className="text-sm text-gray-500 dark:text-gray-400">Loading workspace settings…</div>
        ) : workspaceFromHook ? (
          <WorkspaceSettingsForm
            workspace={workspaceFromHook}
            status={workspaceStatus}
            onSave={async (name, settings) => {
              const success = await updateWorkspaceSettings(name, settings);
              if (success) {
                await refreshWorkspaces();
              }
              return success;
            }}
            onTest={testWorkspaceConnection}
            onResetConnection={resetWorkspaceConnection}
            onPurgeArchivedLoops={
              workspaceSettingsWorkspaceId
                ? async () => await handlePurgeArchivedLoops(workspaceSettingsWorkspaceId)
                : undefined
            }
            onDeleteWorkspace={
              workspaceSettingsWorkspaceId
                ? async () => await deleteWorkspace(workspaceSettingsWorkspaceId)
                : undefined
            }
            purgeableLoopCount={selectedWorkspaceArchivedLoopCount}
            workspaceLoopCount={selectedWorkspaceLoopCount}
            saving={workspaceSettingsSaving}
            testing={workspaceSettingsTesting}
            resettingConnection={workspaceSettingsResetting}
            purgingPurgeableLoops={workspaceArchivedLoopsPurging}
            remoteOnly={dashboardData.remoteOnly}
            showConnectionStatus={false}
            formId="workspace-settings-shell-form"
            onSaved={() => navigateWithinShell({ view: "workspace", workspaceId: selectedWorkspace.id })}
            onDeleted={() => navigateWithinShell({ view: "home" })}
            onValidityChange={setWorkspaceSettingsFormValid}
          />
        ) : (
          <div className="text-sm text-gray-500 dark:text-gray-400">
            Workspace settings are unavailable right now.
          </div>
        )}
      </ShellPanel>
    );
  }

  if (route.view === "ssh-server") {
    if (!selectedServer) {
      return (
        <ShellPanel
          eyebrow="SSH server"
          title="Server not found"
          description="The selected SSH server no longer exists."
        >
          <p className="text-sm text-gray-500 dark:text-gray-400">
            Use the sidebar or home button to continue.
          </p>
        </ShellPanel>
      );
    }
    return (
      <SshServerView
        server={selectedServer}
        sessions={sessionsByServerId[selectedServer.config.id] ?? []}
        headerOffsetClassName={shellHeaderOffsetClassName}
        onNavigate={navigateWithinShell}
        onDeleteServer={async () => {
          const deleted = await deleteServer(selectedServer.config.id);
          if (!deleted) {
            toast.error(`Failed to delete SSH server "${selectedServer.config.name}"`);
            return false;
          }
          toast.success(`Deleted SSH server "${selectedServer.config.name}"`);
          navigateWithinShell({ view: "home" });
          return true;
        }}
      />
    );
  }

  if (route.view === "compose") {
    return renderComposeView(props, route.kind);
  }

  if (route.view === "settings") {
    return (
      <ShellPanel
        eyebrow="App settings"
        title="Settings"
        variant="compact"
        headerOffsetClassName={shellHeaderOffsetClassName}
      >
        <AppSettingsPanel
          onResetAll={dashboardData.resetAllSettings}
          resetting={dashboardData.appSettingsResetting}
          onKillServer={dashboardData.killServer}
          killingServer={dashboardData.appSettingsKilling}
          onExportConfig={exportConfig}
          onImportConfig={importConfig}
          configSaving={workspacesSaving}
        />
      </ShellPanel>
    );
  }

  return (
    <OverviewView
      loops={loops}
      servers={servers}
      sessionsByServerId={sessionsByServerId}
      workspaceGroups={workspaceGroups}
      headerOffsetClassName={shellHeaderOffsetClassName}
      onNavigate={navigateWithinShell}
    />
  );
}

export function ShellMainContent(props: ShellMainContentProps) {
  const { shellErrors, sidebarCollapsed, openSidebar } = props;

  return (
    <div className="relative flex min-w-0 min-h-0 flex-1 flex-col overflow-hidden">
      {shellErrors.length > 0 && (
        <div className="border-b border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-amber-900/50 dark:bg-amber-950/40 dark:text-amber-200 sm:px-6">
          {shellErrors.join(" · ")}
        </div>
      )}

      <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden">
        <div className="pointer-events-none absolute left-4 top-4 z-20 flex gap-3 sm:left-6 lg:left-8">
          <button
            type="button"
            onClick={openSidebar}
            aria-label="Open navigation"
            className="pointer-events-auto inline-flex h-10 w-10 items-center justify-center rounded-xl border border-gray-200 bg-white/95 text-gray-600 shadow-sm transition hover:border-gray-300 hover:text-gray-900 dark:border-gray-800 dark:bg-neutral-900/95 dark:text-gray-300 dark:hover:border-gray-700 dark:hover:text-gray-100 lg:hidden"
          >
            <SidebarIcon size="h-5 w-5" />
          </button>
          {sidebarCollapsed && (
            <button
              type="button"
              onClick={openSidebar}
              aria-label="Open sidebar"
              className="pointer-events-auto hidden h-10 w-10 items-center justify-center rounded-xl border border-gray-200 bg-white/95 text-gray-600 shadow-sm transition hover:border-gray-300 hover:text-gray-900 dark:border-gray-800 dark:bg-neutral-900/95 dark:text-gray-300 dark:hover:border-gray-700 dark:hover:text-gray-100 lg:inline-flex"
            >
              <SidebarIcon size="h-5 w-5" />
            </button>
          )}
        </div>
        <main className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden">{renderMainContent(props)}</main>
      </div>
    </div>
  );
}
