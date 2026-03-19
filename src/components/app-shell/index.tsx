import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import type {
  CreateChatRequest,
  CreateLoopRequest,
} from "../../types";
import { getCreateWorkspaceDefaultServerSettings } from "../../types/settings";
import type { AgentProvider, ServerSettings } from "../../types/settings";
import type { CreateWorkspaceRequest } from "../../types/workspace";
import { createLogger } from "../../lib/logger";
import { appFetch } from "../../lib/public-path";
import { getStoredSshServerCredential } from "../../lib/ssh-browser-credentials";
import {
  useDashboardData,
  useLoopGrouping,
  useLoops,
  useProvisioningJob,
  useSshServers,
  useSshSessions,
  useToast,
  useWorkspaceServerSettings,
  useWorkspaces,
} from "../../hooks";
import { getLoopStatusLabel, getStatusLabel } from "../../utils";
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
import {
  Badge,
  Button,
  GearIcon,
  SidebarIcon,
  PASSWORD_INPUT_PROPS,
  getLoopStatusBadgeVariant,
  getSshSessionStatusBadgeVariant,
} from "../common";

// Sub-components
import {
  type ShellRoute,
  type ComposeKind,
  type SidebarSectionId,
  type SidebarSectionCollapseState,
  getSshConnectionModeLabel,
  getProvisioningStatusBadgeVariant,
  groupSidebarItemsByWorkspace,
  isDesktopShellViewport,
  loadSidebarSectionCollapseState,
  saveSidebarSectionCollapseState,
  getWorkspaceGroupCollapseKey,
} from "./shell-types";
import {
  ShellSection,
  SectionItem,
  WorkspaceGroupedSectionItems,
  EmptySection,
} from "./shell-sidebar";
import { ShellPanel, InlineField } from "./shell-panel";
import { OverviewView, WorkspaceView, SshServerView } from "./shell-views";
import { DraftLoopComposer, SshSessionComposer, SshServerComposer } from "./shell-composers";

export type { ShellRoute } from "./shell-types";

const log = createLogger("AppShell");

interface AppShellProps {
  route: ShellRoute;
  onNavigate: (route: ShellRoute) => void;
}

export function AppShell({ route, onNavigate }: AppShellProps) {
  const toast = useToast();
  const {
    loops,
    loading: loopsLoading,
    error: loopsError,
    refresh: refreshLoops,
    createLoop,
    createChat,
    purgeLoop,
    purgeArchivedWorkspaceLoops,
  } = useLoops();
  const {
    sessions,
    loading: sshSessionsLoading,
    error: sshSessionsError,
    refresh: refreshSshSessions,
    createSession,
  } = useSshSessions();
  const {
    servers,
    sessionsByServerId,
    loading: sshServersLoading,
    error: sshServersError,
    refresh: refreshSshServers,
    createServer,
    deleteServer,
    createSession: createStandaloneSession,
  } = useSshServers();
  const {
    workspaces,
    loading: workspacesLoading,
    saving: workspacesSaving,
    error: workspaceError,
    refresh: refreshWorkspaces,
    createWorkspace,
    deleteWorkspace,
    exportConfig,
    importConfig,
  } = useWorkspaces();
  const dashboardData = useDashboardData();
  const provisioning = useProvisioningJob();
  const { workspaceGroups } = useLoopGrouping(loops, workspaces);

  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const shellHeaderOffsetClassName = sidebarCollapsed
    ? "ml-14 sm:ml-16 lg:ml-[4.5rem]"
    : "ml-14 sm:ml-16 lg:ml-0";
  const initialSidebarSectionState = useMemo(() => loadSidebarSectionCollapseState(), []);
  const [collapsedSections, setCollapsedSections] = useState<SidebarSectionCollapseState>(initialSidebarSectionState.state);
  const [collapsedWorkspaceGroups, setCollapsedWorkspaceGroups] = useState<Partial<Record<string, boolean>>>({});
  const [workspaceCreateMode, setWorkspaceCreateMode] = useState<"manual" | "automatic">("manual");
  const [workspaceName, setWorkspaceName] = useState("");
  const [workspaceDirectory, setWorkspaceDirectory] = useState("");
  const [workspaceServerSettings, setWorkspaceServerSettings] = useState<ServerSettings>(() => getCreateWorkspaceDefaultServerSettings());
  const [workspaceServerSettingsValid, setWorkspaceServerSettingsValid] = useState(true);
  const [workspaceTesting, setWorkspaceTesting] = useState(false);
  const [workspaceCreateSubmitting, setWorkspaceCreateSubmitting] = useState(false);
  const [workspaceSettingsFormValid, setWorkspaceSettingsFormValid] = useState(false);
  const [workspaceArchivedLoopsPurging, setWorkspaceArchivedLoopsPurging] = useState(false);
  const [composeActionState, setComposeActionState] = useState<CreateLoopFormActionState | null>(null);
  const [automaticServerId, setAutomaticServerId] = useState("");
  const [automaticRepoUrl, setAutomaticRepoUrl] = useState("");
  const [automaticBasePath, setAutomaticBasePath] = useState("/workspaces");
  const [automaticProvider, setAutomaticProvider] = useState<AgentProvider>("copilot");
  const [automaticPassword, setAutomaticPassword] = useState("");
  const lastProvisioningRefreshIdRef = useRef<string | null>(null);

  const sshWorkspaces = useMemo(() => {
    return workspaces.filter((workspace) => workspace.serverSettings.agent.transport === "ssh");
  }, [workspaces]);

  const workspacesById = useMemo(() => {
    return new Map(workspaces.map((workspace) => [workspace.id, workspace]));
  }, [workspaces]);
  const serversById = useMemo(() => {
    return new Map(servers.map((server) => [server.config.id, server]));
  }, [servers]);
  const loopItems = useMemo(() => loops.filter((loop) => loop.config.mode !== "chat"), [loops]);
  const chatItems = useMemo(() => loops.filter((loop) => loop.config.mode === "chat"), [loops]);
  const standaloneSessions = useMemo(() => Object.values(sessionsByServerId).flat(), [sessionsByServerId]);
  const loopGroups = useMemo(() => groupSidebarItemsByWorkspace(loopItems, workspaces), [loopItems, workspaces]);
  const chatGroups = useMemo(() => groupSidebarItemsByWorkspace(chatItems, workspaces), [chatItems, workspaces]);
  const allShellSessions = useMemo(() => {
    return [
      ...sessions.map((session) => ({
        id: session.config.id,
        title: session.config.name,
        subtitle: `${workspacesById.get(session.config.workspaceId)?.name ?? "Unknown workspace"} · ${getSshConnectionModeLabel(session.config.connectionMode)}`,
        badge: session.state.status,
        badgeVariant: getSshSessionStatusBadgeVariant(session.state.status),
        createdAt: session.config.createdAt,
      })),
      ...standaloneSessions.map((session) => ({
        id: session.config.id,
        title: session.config.name,
        subtitle: `${serversById.get(session.config.sshServerId)?.config.name ?? "Unknown server"} · ${getSshConnectionModeLabel(session.config.connectionMode)}`,
        badge: session.state.status,
        badgeVariant: getSshSessionStatusBadgeVariant(session.state.status),
        createdAt: session.config.createdAt,
      })),
    ].sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  }, [serversById, sessions, standaloneSessions, workspacesById]);
  const selectedLoop = route.view === "loop"
    ? loopItems.find((loop) => loop.config.id === route.loopId) ?? null
    : null;

  const selectedWorkspace = route.view === "workspace" || route.view === "workspace-settings"
    ? workspaces.find((workspace) => workspace.id === route.workspaceId) ?? null
    : null;
  const composeWorkspace = route.view === "compose" && route.scopeId
    ? workspaces.find((workspace) => workspace.id === route.scopeId) ?? null
    : null;
  const composeServer = route.view === "compose" && route.kind === "ssh-session" && route.scopeId
    ? servers.find((server) => server.config.id === route.scopeId) ?? null
    : null;
  const selectedServer = route.view === "ssh-server"
    ? servers.find((server) => server.config.id === route.serverId) ?? null
    : null;
  const workspaceSettingsWorkspaceId = route.view === "workspace-settings"
    ? route.workspaceId
    : null;
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
  } = useWorkspaceServerSettings(workspaceSettingsWorkspaceId);
  const selectedWorkspaceArchivedLoopCount = useMemo(() => {
    if (!workspaceSettingsWorkspaceId) {
      return 0;
    }

    return workspaceGroups.find((group) => group.workspace.id === workspaceSettingsWorkspaceId)?.statusGroups.archived.length ?? 0;
  }, [workspaceGroups, workspaceSettingsWorkspaceId]);
  const selectedWorkspaceLoopCount = useMemo(() => {
    if (!workspaceSettingsWorkspaceId) {
      return 0;
    }

    return workspaceGroups.find((group) => group.workspace.id === workspaceSettingsWorkspaceId)?.loops.length ?? 0;
  }, [workspaceGroups, workspaceSettingsWorkspaceId]);

  useEffect(() => {
    if (route.view !== "compose" || (route.kind !== "loop" && route.kind !== "chat")) {
      dashboardData.resetCreateModalState();
    }
  }, [dashboardData.resetCreateModalState, route]);

  useEffect(() => {
    if (route.view !== "compose" || (route.kind !== "loop" && route.kind !== "chat")) {
      setComposeActionState(null);
    }
  }, [route.view, route.view === "compose" ? route.kind : undefined]);

  useEffect(() => {
    if (route.view !== "workspace-settings") {
      setWorkspaceSettingsFormValid(false);
    }
  }, [route.view]);

  useEffect(() => {
    setWorkspaceSettingsFormValid(false);
  }, [workspaceSettingsWorkspaceId]);

  useEffect(() => {
    if (route.view !== "compose" || route.kind !== "workspace") {
      return;
    }

    if (provisioning.activeJobId) {
      setWorkspaceCreateMode("automatic");
      return;
    }

    setWorkspaceCreateMode("manual");
    setWorkspaceName("");
    setWorkspaceDirectory("");
    setWorkspaceServerSettings(getCreateWorkspaceDefaultServerSettings());
    setWorkspaceServerSettingsValid(true);
    setWorkspaceTesting(false);
    setWorkspaceCreateSubmitting(false);
    setAutomaticServerId(servers[0]?.config.id ?? "");
    setAutomaticRepoUrl("");
    setAutomaticBasePath("/workspaces");
    setAutomaticProvider("copilot");
    setAutomaticPassword("");
  }, [provisioning.activeJobId, route, servers]);

  useEffect(() => {
    if (route.view !== "compose" || route.kind !== "workspace" || automaticServerId || !servers[0]) {
      return;
    }
    setAutomaticServerId(servers[0].config.id);
  }, [automaticServerId, route, servers]);

  useEffect(() => {
    const jobId = provisioning.snapshot?.job.config.id ?? null;
    if (
      provisioning.snapshot?.job.state.status === "completed"
      && jobId
      && lastProvisioningRefreshIdRef.current !== jobId
    ) {
      lastProvisioningRefreshIdRef.current = jobId;
      void refreshWorkspaces();
    }
  }, [provisioning.snapshot?.job.config.id, provisioning.snapshot?.job.state.status, refreshWorkspaces]);

  useEffect(() => {
    if (!initialSidebarSectionState.invalidReason) {
      return;
    }

    log.warn("Removing invalid sidebar section state", { error: initialSidebarSectionState.invalidReason });
  }, [initialSidebarSectionState.invalidReason]);

  useEffect(() => {
    saveSidebarSectionCollapseState(collapsedSections);
  }, [collapsedSections]);

  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
      return;
    }

    const mediaQuery = window.matchMedia("(min-width: 1024px)");
    const handleChange = (event: MediaQueryListEvent) => {
      if (event.matches) {
        setSidebarOpen(false);
      }
    };

    if (mediaQuery.matches) {
      setSidebarOpen(false);
    }

    mediaQuery.addEventListener("change", handleChange);
    return () => mediaQuery.removeEventListener("change", handleChange);
  }, []);

  const shellLoading = loopsLoading || sshSessionsLoading || sshServersLoading || workspacesLoading;
  const shellErrors = [loopsError, sshSessionsError, sshServersError, workspaceError].filter(Boolean);

  const navigateWithinShell = (nextRoute: ShellRoute) => {
    setSidebarOpen(false);
    onNavigate(nextRoute);
  };

  const openSidebar = () => {
    if (isDesktopShellViewport()) {
      setSidebarCollapsed(false);
      return;
    }

    setSidebarOpen(true);
  };

  const hideSidebar = () => {
    if (isDesktopShellViewport()) {
      setSidebarCollapsed(true);
      return;
    }

    setSidebarOpen(false);
  };

  function isSectionCollapsed(sectionId: SidebarSectionId): boolean {
    return collapsedSections[sectionId] ?? false;
  }

  function toggleSectionCollapsed(sectionId: SidebarSectionId) {
    setCollapsedSections((current) => ({
      ...current,
      [sectionId]: !(current[sectionId] ?? false),
    }));
  }

  function toggleWorkspaceGroupCollapsed(sectionId: SidebarSectionId, groupKey: string) {
    const collapseKey = getWorkspaceGroupCollapseKey(sectionId, groupKey);
    setCollapsedWorkspaceGroups((current) => ({
      ...current,
      [collapseKey]: !(current[collapseKey] ?? false),
    }));
  }

  function handleLoopDetailsExit() {
    navigateWithinShell({ view: "home" });
    void refreshLoops();
  }

  async function handlePurgeArchivedLoops(workspaceId: string) {
    try {
      setWorkspaceArchivedLoopsPurging(true);
      return await purgeArchivedWorkspaceLoops(workspaceId);
    } finally {
      setWorkspaceArchivedLoopsPurging(false);
    }
  }

  async function handleLoopSubmit(kind: Extract<ComposeKind, "loop" | "chat">, request: CreateLoopFormSubmitRequest) {
    const result = kind === "chat"
      ? await createChat(request as CreateChatRequest)
      : await createLoop(request as CreateLoopRequest);

    if (result.startError) {
      toast.error("Uncommitted changes blocked the new run. Resolve them and try again.");
      return false;
    }

    if (!result.loop) {
      toast.error(kind === "chat" ? "Failed to create chat" : "Failed to create loop");
      return false;
    }

    await refreshLoops();
    navigateWithinShell(
      kind === "chat"
        ? { view: "chat", chatId: result.loop.config.id }
        : { view: "loop", loopId: result.loop.config.id },
    );
    return true;
  }

  async function handleTestWorkspaceConnection(settings: ServerSettings) {
    const trimmedDirectory = workspaceDirectory.trim();
    if (!trimmedDirectory) {
      return { success: false, error: "Enter a workspace directory first." };
    }

    setWorkspaceTesting(true);
    try {
      const response = await appFetch("/api/server-settings/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ settings, directory: trimmedDirectory }),
      });
      return await response.json() as { success: boolean; error?: string };
    } catch (error) {
      return { success: false, error: String(error) };
    } finally {
      setWorkspaceTesting(false);
    }
  }

  function handleBackToAutomaticWorkspaceForm() {
    const config = provisioning.snapshot?.job.config;
    if (!config) {
      provisioning.clearActiveJob();
      return;
    }

    setWorkspaceCreateMode("automatic");
    setWorkspaceName(config.name);
    setAutomaticServerId(config.sshServerId);
    setAutomaticRepoUrl(config.repoUrl);
    setAutomaticBasePath(config.basePath);
    setAutomaticProvider(config.provider);
    setAutomaticPassword("");
    provisioning.clearActiveJob();
  }

  async function handleCreateWorkspace(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const name = workspaceName.trim();
    if (!name) {
      toast.error("Workspace name is required.");
      return;
    }

    if (workspaceCreateMode === "automatic") {
      if (!automaticServerId.trim() || !automaticRepoUrl.trim() || !automaticBasePath.trim()) {
        toast.error("Saved SSH server, repository URL, and remote base path are required.");
        return;
      }

      const snapshot = await provisioning.startJob({
        name,
        sshServerId: automaticServerId,
        repoUrl: automaticRepoUrl.trim(),
        basePath: automaticBasePath.trim(),
        provider: automaticProvider,
        password: automaticPassword,
      });
      if (snapshot) {
        setWorkspaceCreateMode("automatic");
        setAutomaticPassword("");
      }
      return;
    }

    const directory = workspaceDirectory.trim();
    if (!directory || !workspaceServerSettingsValid) {
      toast.error("Directory and valid connection settings are required.");
      return;
    }

    setWorkspaceCreateSubmitting(true);
    try {
      const request: CreateWorkspaceRequest = {
        name,
        directory,
        serverSettings: workspaceServerSettings,
      };
      const workspace = await createWorkspace(request);
      if (!workspace) {
        toast.error("Failed to create workspace");
        return;
      }
      navigateWithinShell({ view: "workspace", workspaceId: workspace.id });
    } finally {
      setWorkspaceCreateSubmitting(false);
    }
  }

  function renderComposeView(kind: ComposeKind) {
    if (kind === "loop" || kind === "chat") {
      const handleComposeCancel = () => navigateWithinShell(
        composeWorkspace ? { view: "workspace", workspaceId: composeWorkspace.id } : { view: "home" },
      );

      return (
        <ShellPanel
          eyebrow={kind === "chat" ? "Chat" : "Loop"}
          title={kind === "chat"
            ? composeWorkspace ? `Start a new chat in ${composeWorkspace.name}` : "Start a new chat"
            : composeWorkspace ? `Start a new loop in ${composeWorkspace.name}` : "Start a new loop"}
          description={composeWorkspace?.directory}
          descriptionClassName="hidden sm:inline font-mono"
          variant="compact"
          headerOffsetClassName={shellHeaderOffsetClassName}
          actions={(
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
              {kind === "loop" && composeActionState && (!composeActionState.isEditing || composeActionState.isEditingDraft) && (
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
          )}
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
            initialLoopData={composeWorkspace ? {
              directory: composeWorkspace.directory,
              prompt: "",
              workspaceId: composeWorkspace.id,
            } : null}
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
      const workspaceCreateFormId = "workspace-create-form";
      const provisioningStatus = provisioning.snapshot?.job.state.status;
      const provisionedWorkspaceId = provisioning.snapshot?.workspace?.id ?? provisioning.snapshot?.job.state.workspaceId;
      const canReturnToAutomaticForm = provisioningStatus === "failed" || provisioningStatus === "cancelled";
      const selectedServerHasStoredCredential = automaticServerId
        ? getStoredSshServerCredential(automaticServerId) !== null
        : false;
      const automaticFormValid = workspaceName.trim().length > 0
        && automaticServerId.trim().length > 0
        && automaticRepoUrl.trim().length > 0
        && automaticBasePath.trim().length > 0;
      const manualFormValid = workspaceName.trim().length > 0
        && workspaceDirectory.trim().length > 0
        && workspaceServerSettingsValid;

      return (
        <ShellPanel
          eyebrow="Workspace"
          title="Create a workspace"
          variant="compact"
          headerOffsetClassName={shellHeaderOffsetClassName}
          badges={(
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
          )}
          actions={provisioning.activeJobId ? (
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
                  onClick={() => navigateWithinShell({ view: "workspace", workspaceId: provisionedWorkspaceId })}
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
              <Button type="button" variant="ghost" size="sm" onClick={() => navigateWithinShell({ view: "home" })}>
                Cancel
              </Button>
              <Button
                type="submit"
                form={workspaceCreateFormId}
                size="sm"
                loading={workspaceCreateMode === "automatic" ? provisioning.starting : (workspaceCreateSubmitting || workspacesSaving)}
                disabled={workspaceCreateMode === "automatic" ? !automaticFormValid : !manualFormValid}
              >
                {workspaceCreateMode === "automatic" ? "Start Provisioning" : "Create Workspace"}
              </Button>
            </>
          )}
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
            <form id={workspaceCreateFormId} className="space-y-6" onSubmit={(event) => void handleCreateWorkspace(event)}>
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
                    onChange={(settings, isValid) => {
                      setWorkspaceServerSettings((current) => {
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
                    <label htmlFor="automatic-ssh-server" className="mb-1.5 block text-sm font-medium text-gray-700 dark:text-gray-300">
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
                    <label htmlFor="automatic-provider" className="mb-1.5 block text-sm font-medium text-gray-700 dark:text-gray-300">
                      Provider <span className="ml-1 text-red-500">*</span>
                    </label>
                    <select
                      id="automatic-provider"
                      value={automaticProvider}
                      onChange={(event) => setAutomaticProvider(event.target.value as AgentProvider)}
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
          onCancel={() => navigateWithinShell(
            composeWorkspace
              ? { view: "workspace", workspaceId: composeWorkspace.id }
              : composeServer
                ? { view: "ssh-server", serverId: composeServer.config.id }
                : { view: "home" },
          )}
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

  function renderMainContent() {
    if (shellLoading && route.view === "home") {
      return <div className="p-6 text-sm text-gray-500 dark:text-gray-400">Loading…</div>;
    }

    if (route.view === "loop") {
      if (!selectedLoop) {
        return shellLoading
          ? <div className="p-6 text-sm text-gray-500 dark:text-gray-400">Loading loop…</div>
          : (
            <ShellPanel eyebrow="Loop" title="Loop not found" description="The selected loop no longer exists.">
              <p className="text-sm text-gray-500 dark:text-gray-400">Use the sidebar or home button to continue.</p>
            </ShellPanel>
          );
      }

      if (selectedLoop?.state.status === "draft") {
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
          onBack={handleLoopDetailsExit}
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
          onBack={handleLoopDetailsExit}
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
          <ShellPanel eyebrow="Workspace" title="Workspace not found" description="The selected workspace no longer exists.">
            <p className="text-sm text-gray-500 dark:text-gray-400">Use the sidebar or home button to continue.</p>
          </ShellPanel>
        );
      }
      const relatedLoops = loops.filter((loop) => loop.config.workspaceId === selectedWorkspace.id);
      const relatedSessions = sessions.filter((session) => session.config.workspaceId === selectedWorkspace.id);
      return (
        <WorkspaceView
          workspace={selectedWorkspace}
          relatedLoops={relatedLoops}
          relatedSessions={relatedSessions}
          registeredSshServers={servers}
          headerOffsetClassName={shellHeaderOffsetClassName}
          onOpenSettings={() => navigateWithinShell({ view: "workspace-settings", workspaceId: selectedWorkspace.id })}
          onNavigate={navigateWithinShell}
        />
      );
    }

    if (route.view === "workspace-settings") {
      if (!selectedWorkspace) {
        return (
          <ShellPanel eyebrow="Workspace" title="Workspace not found" description="The selected workspace no longer exists.">
            <p className="text-sm text-gray-500 dark:text-gray-400">Use the sidebar or home button to continue.</p>
          </ShellPanel>
        );
      }

      return (
        <ShellPanel
          eyebrow="Workspace settings"
          title="Workspace Settings"
          description={workspaceFromHook?.directory ?? selectedWorkspace.directory}
          descriptionClassName="hidden sm:inline font-mono"
          variant="compact"
          headerOffsetClassName={shellHeaderOffsetClassName}
          actions={(
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
          )}
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
              onPurgeArchivedLoops={workspaceSettingsWorkspaceId
                ? async () => await handlePurgeArchivedLoops(workspaceSettingsWorkspaceId)
                : undefined}
              onDeleteWorkspace={workspaceSettingsWorkspaceId
                ? async () => await deleteWorkspace(workspaceSettingsWorkspaceId)
                : undefined}
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
            <div className="text-sm text-gray-500 dark:text-gray-400">Workspace settings are unavailable right now.</div>
          )}
        </ShellPanel>
      );
    }

    if (route.view === "ssh-server") {
      if (!selectedServer) {
        return (
          <ShellPanel eyebrow="SSH server" title="Server not found" description="The selected SSH server no longer exists.">
            <p className="text-sm text-gray-500 dark:text-gray-400">Use the sidebar or home button to continue.</p>
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
      return renderComposeView(route.kind);
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

  return (
    <div className="flex h-full min-h-0 overflow-hidden bg-gray-100 text-gray-950 dark:bg-neutral-950 dark:text-gray-100">
      <div
        className={[
          "fixed inset-0 z-30 bg-neutral-950/50 transition lg:hidden",
          sidebarOpen ? "opacity-100" : "pointer-events-none opacity-0",
        ].join(" ")}
        onClick={() => setSidebarOpen(false)}
      />

      <aside
        hidden={sidebarCollapsed && !sidebarOpen}
        aria-hidden={sidebarCollapsed && !sidebarOpen}
        className={[
          "fixed inset-y-0 left-0 z-40 flex w-80 max-w-[86vw] flex-col border-r border-gray-200 bg-gray-50/95 backdrop-blur transition-all duration-200 dark:border-gray-800 dark:bg-neutral-900/95 lg:relative lg:inset-auto lg:z-10 lg:max-w-none lg:shrink-0",
          sidebarOpen ? "translate-x-0" : "-translate-x-full",
          sidebarCollapsed
            ? "lg:w-0 lg:min-w-0 lg:-translate-x-full lg:overflow-hidden lg:border-r-0 lg:opacity-0 lg:pointer-events-none"
            : "lg:w-80 lg:translate-x-0 lg:opacity-100",
        ].join(" ")}
      >
        <div className="border-b border-gray-200 bg-white px-4 py-2 dark:border-gray-800 dark:bg-neutral-800">
          <div className="flex min-h-14 items-center justify-between gap-3">
            <button
              type="button"
              onClick={() => navigateWithinShell({ view: "home" })}
              className="text-xs font-semibold uppercase tracking-[0.24em] text-gray-500 transition hover:text-gray-900 dark:text-gray-400 dark:hover:text-gray-100"
            >
              Ralpher
            </button>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => navigateWithinShell({ view: "settings" })}
                aria-label="Open settings"
                aria-current={route.view === "settings" ? "page" : undefined}
                className={[
                  "inline-flex h-10 w-10 items-center justify-center rounded-xl border bg-white shadow-sm transition dark:bg-neutral-900",
                  route.view === "settings"
                    ? "border-gray-900 text-gray-900 dark:border-gray-100 dark:text-gray-100"
                    : "border-gray-200 text-gray-600 hover:border-gray-300 hover:text-gray-900 dark:border-gray-800 dark:text-gray-300 dark:hover:border-gray-700 dark:hover:text-gray-100",
                ].join(" ")}
                title="Settings"
              >
                <GearIcon size="h-5 w-5" />
              </button>
              <button
                type="button"
                onClick={hideSidebar}
                aria-label={sidebarOpen ? "Close sidebar" : "Hide sidebar"}
                className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-gray-200 bg-white text-gray-600 shadow-sm transition hover:border-gray-300 hover:text-gray-900 dark:border-gray-800 dark:bg-neutral-900 dark:text-gray-300 dark:hover:border-gray-700 dark:hover:text-gray-100"
              >
                <SidebarIcon size="h-5 w-5" />
              </button>
            </div>
          </div>
        </div>

        <div className="flex-1 space-y-6 overflow-y-auto px-3 py-4 dark-scrollbar">
          <ShellSection
            title="Workspaces"
            count={workspaces.length}
            actionLabel="New"
            onAction={() => navigateWithinShell({ view: "compose", kind: "workspace" })}
            collapsed={isSectionCollapsed("workspaces")}
            onToggle={() => toggleSectionCollapsed("workspaces")}
          >
            {workspaces.length === 0 ? (
              <EmptySection message="No workspaces yet." />
            ) : (
              workspaces.map((workspace) => (
                <SectionItem
                  key={workspace.id}
                  active={(route.view === "workspace" || route.view === "workspace-settings") && route.workspaceId === workspace.id}
                  title={workspace.name}
                  subtitle={workspace.directory}
                  onClick={() => navigateWithinShell({ view: "workspace", workspaceId: workspace.id })}
                />
              ))
            )}
          </ShellSection>

          <ShellSection
            title="Loops"
            count={loopItems.length}
            actionLabel="New"
            onAction={() => navigateWithinShell({ view: "compose", kind: "loop" })}
            collapsed={isSectionCollapsed("loops")}
            onToggle={() => toggleSectionCollapsed("loops")}
          >
            {loopItems.length === 0 ? (
              <EmptySection message="No loops yet." />
            ) : (
              <WorkspaceGroupedSectionItems
                sectionId="loops"
                groups={loopGroups}
                collapsedGroups={collapsedWorkspaceGroups}
                onToggleGroup={toggleWorkspaceGroupCollapsed}
                renderItem={(loop) => (
                  <SectionItem
                    key={loop.config.id}
                    active={route.view === "loop" && route.loopId === loop.config.id}
                    title={loop.config.name}
                    badge={getLoopStatusLabel(loop)}
                    badgeVariant={getLoopStatusBadgeVariant(loop.state.status, loop.state.planMode?.isPlanReady ?? false)}
                    onClick={() => navigateWithinShell({ view: "loop", loopId: loop.config.id })}
                  />
                )}
              />
            )}
          </ShellSection>

          <ShellSection
            title="Chats"
            count={chatItems.length}
            actionLabel="New"
            onAction={() => navigateWithinShell({ view: "compose", kind: "chat" })}
            collapsed={isSectionCollapsed("chats")}
            onToggle={() => toggleSectionCollapsed("chats")}
          >
            {chatItems.length === 0 ? (
              <EmptySection message="No chats yet." />
            ) : (
              <WorkspaceGroupedSectionItems
                sectionId="chats"
                groups={chatGroups}
                collapsedGroups={collapsedWorkspaceGroups}
                onToggleGroup={toggleWorkspaceGroupCollapsed}
                renderItem={(chat) => (
                  <SectionItem
                    key={chat.config.id}
                    active={route.view === "chat" && route.chatId === chat.config.id}
                    title={chat.config.name}
                    badge={getStatusLabel(chat.state.status, chat.state.syncState)}
                    badgeVariant={getLoopStatusBadgeVariant(chat.state.status, chat.state.planMode?.isPlanReady ?? false)}
                    onClick={() => navigateWithinShell({ view: "chat", chatId: chat.config.id })}
                  />
                )}
              />
            )}
          </ShellSection>

          <ShellSection
            title="SSH Sessions"
            count={allShellSessions.length}
            actionLabel="New"
            onAction={() => navigateWithinShell({ view: "compose", kind: "ssh-session" })}
            collapsed={isSectionCollapsed("workspace-ssh")}
            onToggle={() => toggleSectionCollapsed("workspace-ssh")}
          >
            {allShellSessions.length === 0 ? (
              <EmptySection message="No SSH sessions yet." />
            ) : (
              allShellSessions.map((session) => (
                <SectionItem
                  key={session.id}
                  active={route.view === "ssh" && route.sshSessionId === session.id}
                  title={session.title}
                  subtitle={session.subtitle}
                  badge={session.badge}
                  badgeVariant={session.badgeVariant}
                  onClick={() => navigateWithinShell({ view: "ssh", sshSessionId: session.id })}
                />
              ))
            )}
          </ShellSection>

          <ShellSection
            title="SSH servers"
            count={servers.length}
            actionLabel="New"
            onAction={() => navigateWithinShell({ view: "compose", kind: "ssh-server" })}
            collapsed={isSectionCollapsed("ssh-servers")}
            onToggle={() => toggleSectionCollapsed("ssh-servers")}
          >
            {servers.length === 0 ? (
              <EmptySection message="No standalone SSH servers registered." />
            ) : (
              servers.map((server) => {
                const serverSessions = sessionsByServerId[server.config.id] ?? [];
                return (
                  <SectionItem
                    key={server.config.id}
                    active={route.view === "ssh-server" && route.serverId === server.config.id}
                    title={server.config.name}
                    subtitle={`${server.config.username}@${server.config.address}`}
                    badge={serverSessions.length > 0 ? String(serverSessions.length) : undefined}
                    onClick={() => navigateWithinShell({ view: "ssh-server", serverId: server.config.id })}
                  />
                );
              })
            )}
          </ShellSection>

          {dashboardData.version && (
            <div className="px-1 text-[11px] leading-4 text-gray-400 dark:text-gray-500">
              v{dashboardData.version}
            </div>
          )}
        </div>
      </aside>

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
          <main className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden">
            {renderMainContent()}
          </main>
        </div>
      </div>
    </div>
  );
}

export default AppShell;
