/**
 * Dashboard component showing all loops in a grid view.
 */

import { useState, useCallback, useEffect } from "react";
import type { UncommittedChangesError, ModelInfo, HealthResponse, BranchInfo } from "../types";
import { useLoops, useWorkspaces, useToast } from "../hooks";
import { Button, Modal, CollapsibleSection } from "./common";
import { LoopCard } from "./LoopCard";
import { CreateLoopForm, type CreateLoopFormActionState } from "./CreateLoopForm";
import { AppSettingsModal } from "./AppSettingsModal";
import { WorkspaceSettingsModal } from "./WorkspaceSettingsModal";
import { CreateWorkspaceModal } from "./CreateWorkspaceModal";
import { useWorkspaceServerSettings } from "../hooks";
import { createLogger } from "../lib/logger";

// Create a named logger for this component
const log = createLogger("Dashboard");
import {
  AcceptLoopModal,
  AddressCommentsModal,
  DeleteLoopModal,
  PurgeLoopModal,
  UncommittedChangesModal,
  RenameLoopModal,
} from "./LoopModals";
import { isAwaitingFeedback, isLoopPlanReady } from "../utils";

export interface DashboardProps {
  /** Callback when a loop is selected */
  onSelectLoop?: (loopId: string) => void;
}

export function Dashboard({ onSelectLoop }: DashboardProps) {
  const toast = useToast();
  const {
    loops,
    loading,
    error,
    connectionStatus,
    refresh,
    createLoop,
    deleteLoop,
    acceptLoop,
    pushLoop,
    purgeLoop,
    addressReviewComments,
    updateLoop,
  } = useLoops();

  // App settings state (reset functions)
  const [appSettingsResetting, setAppSettingsResetting] = useState(false);
  const [appSettingsKilling, setAppSettingsKilling] = useState(false);

  // Reset all settings function
  const resetAllSettings = useCallback(async () => {
    setAppSettingsResetting(true);
    try {
      const response = await fetch("/api/settings/reset-all", { method: "POST" });
      if (!response.ok) {
        toast.error("Failed to reset settings");
      }
      return response.ok;
    } catch (error) {
      log.error("Failed to reset settings:", error);
      toast.error("Failed to reset settings");
      return false;
    } finally {
      setAppSettingsResetting(false);
    }
  }, []);

  // Kill server function (for container restart)
  const killServer = useCallback(async () => {
    setAppSettingsKilling(true);
    try {
      const response = await fetch("/api/server/kill", { method: "POST" });
      if (!response.ok) {
        log.error("Failed to kill server: HTTP", response.status);
        toast.error("Failed to kill server");
      }
      return response.ok;
    } catch (error) {
      log.error("Failed to kill server:", error);
      toast.error("Failed to kill server");
      return false;
    } finally {
      setAppSettingsKilling(false);
    }
  }, []);

  // Workspace state
  const {
    workspaces,
    loading: workspacesLoading,
    saving: workspaceCreating,
    error: workspaceError,
    createWorkspace,
    deleteWorkspace,
    refresh: refreshWorkspaces,
    exportConfig,
    importConfig,
  } = useWorkspaces();
  const [showServerSettingsModal, setShowServerSettingsModal] = useState(false);
  // Create workspace modal state
  const [showCreateWorkspaceModal, setShowCreateWorkspaceModal] = useState(false);
  // Workspace settings modal state
  const [workspaceSettingsModal, setWorkspaceSettingsModal] = useState<{ open: boolean; workspaceId: string | null }>({
    open: false,
    workspaceId: null,
  });
  // remoteOnly is kept for WorkspaceSettingsModal
  const [remoteOnly, setRemoteOnly] = useState(false);
  const [version, setVersion] = useState<string | null>(null);

  // Workspace server settings hook for the workspace being edited
  // IMPORTANT: Use 'workspace' from this hook for fresh data from API, not from workspaces.find()
  const {
    workspace: workspaceFromHook,
    status: workspaceStatus,
    saving: workspaceSettingsSaving,
    testing: workspaceSettingsTesting,
    resettingConnection: workspaceSettingsResetting,
    testConnection: testWorkspaceConnection,
    resetConnection: resetWorkspaceConnection,
    updateWorkspace: updateWorkspaceSettings,
  } = useWorkspaceServerSettings(workspaceSettingsModal.workspaceId);

  // Fetch app config on mount to get remote-only status
  useEffect(() => {
    fetch("/api/config")
      .then((res) => res.json())
      .then((config: { remoteOnly: boolean }) => {
        setRemoteOnly(config.remoteOnly);
      })
      .catch(() => {
        // Ignore errors, default to false
      });
  }, []);

  // Fetch version on mount
  useEffect(() => {
    fetch("/api/health")
      .then((res) => res.json())
      .then((data: HealthResponse) => {
        setVersion(data.version);
      })
      .catch(() => {
        // Ignore errors
      });
  }, []);

  const [showCreateModal, setShowCreateModal] = useState(false);
  const [editDraftId, setEditDraftId] = useState<string | null>(null);
  const [deleteModal, setDeleteModal] = useState<{ open: boolean; loopId: string | null }>({
    open: false,
    loopId: null,
  });
  const [acceptModal, setAcceptModal] = useState<{ open: boolean; loopId: string | null }>({
    open: false,
    loopId: null,
  });
  const [purgeModal, setPurgeModal] = useState<{ open: boolean; loopId: string | null }>({
    open: false,
    loopId: null,
  });
  const [addressCommentsModal, setAddressCommentsModal] = useState<{ open: boolean; loopId: string | null }>({
    open: false,
    loopId: null,
  });
  const [uncommittedModal, setUncommittedModal] = useState<{
    open: boolean;
    loopId: string | null;
    error: UncommittedChangesError | null;
  }>({
    open: false,
    loopId: null,
    error: null,
  });
  const [renameModal, setRenameModal] = useState<{ open: boolean; loopId: string | null }>({
    open: false,
    loopId: null,
  });

  // State for create loop form actions (for rendering in modal footer)
  const [formActionState, setFormActionState] = useState<CreateLoopFormActionState | null>(null);

  // Model selection state
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [modelsLoading, setModelsLoading] = useState(false);
  const [lastModel, setLastModel] = useState<{ providerID: string; modelID: string } | null>(null);
  const [modelsWorkspaceId, setModelsWorkspaceId] = useState<string | null>(null);

  // Planning directory check state
  const [planningWarning, setPlanningWarning] = useState<string | null>(null);

  // Branch selection state
  const [branches, setBranches] = useState<BranchInfo[]>([]);
  const [branchesLoading, setBranchesLoading] = useState(false);
  const [currentBranch, setCurrentBranch] = useState("");
  const [defaultBranch, setDefaultBranch] = useState("");

  // Fetch last model on mount
  useEffect(() => {
    async function fetchLastModel() {
      try {
        const response = await fetch("/api/preferences/last-model");
        if (response.ok) {
          const data = await response.json();
          setLastModel(data);
        }
      } catch {
        // Ignore errors
      }
    }
    fetchLastModel();
  }, []);

  // Fetch models when directory changes
  const fetchModels = useCallback(async (directory: string, workspaceId: string | null) => {
    if (!directory || !workspaceId) {
      setModels([]);
      return;
    }

    setModelsLoading(true);
    try {
      const response = await fetch(`/api/models?directory=${encodeURIComponent(directory)}&workspaceId=${encodeURIComponent(workspaceId)}`);
      if (response.ok) {
        const data = await response.json() as ModelInfo[];
        setModels(data);
      } else {
        setModels([]);
      }
    } catch {
      setModels([]);
    } finally {
      setModelsLoading(false);
    }
  }, []);

  // Check planning directory when directory changes
  const checkPlanningDir = useCallback(async (directory: string) => {
    if (!directory) {
      setPlanningWarning(null);
      return;
    }

    try {
      const response = await fetch(`/api/check-planning-dir?directory=${encodeURIComponent(directory)}`);
      if (response.ok) {
        const data = await response.json();
        setPlanningWarning(data.warning ?? null);
      } else {
        setPlanningWarning(null);
      }
    } catch {
      setPlanningWarning(null);
    }
  }, []);

  // Fetch branches when directory changes
  const fetchBranches = useCallback(async (directory: string) => {
    if (!directory) {
      setBranches([]);
      setCurrentBranch("");
      return;
    }

    setBranchesLoading(true);
    try {
      const response = await fetch(`/api/git/branches?directory=${encodeURIComponent(directory)}`);
      if (response.ok) {
        const data = await response.json();
        setBranches(data.branches ?? []);
        setCurrentBranch(data.currentBranch ?? "");
      } else {
        setBranches([]);
        setCurrentBranch("");
      }
    } catch {
      setBranches([]);
      setCurrentBranch("");
    } finally {
      setBranchesLoading(false);
    }
  }, []);

  // Fetch default branch when directory changes
  const fetchDefaultBranch = useCallback(async (directory: string) => {
    if (!directory) {
      setDefaultBranch("");
      return;
    }

    try {
      const response = await fetch(`/api/git/default-branch?directory=${encodeURIComponent(directory)}`);
      if (response.ok) {
        const data = await response.json();
        setDefaultBranch(data.defaultBranch ?? "");
      } else {
        setDefaultBranch("");
      }
    } catch {
      setDefaultBranch("");
    }
  }, []);

  // Handle workspace change from form
  // Fetch branches, models, and check planning dir based on workspace's directory
  const handleWorkspaceChange = useCallback((workspaceId: string | null, directory: string) => {
    log.debug('handleWorkspaceChange called', { 
      workspaceId, 
      directory,
      modelsWorkspaceId
    });
    if (workspaceId !== modelsWorkspaceId) {
      log.debug('Workspace changed, fetching data...');
      setModelsWorkspaceId(workspaceId);
      
      // Use the directory passed from the form (already looked up from WorkspaceSelector)
      log.debug('Using directory from parameter:', directory);
      
      fetchModels(directory, workspaceId);
      fetchBranches(directory);
      fetchDefaultBranch(directory);
      checkPlanningDir(directory);
    } else {
      log.debug('Workspace unchanged, skipping fetch');
    }
  }, [modelsWorkspaceId, fetchModels, checkPlanningDir, fetchBranches, fetchDefaultBranch]);

  // Reset model state when modal closes
  const handleCloseCreateModal = useCallback(() => {
    setShowCreateModal(false);
    setEditDraftId(null);
    setModels([]);
    setModelsWorkspaceId(null);
    setPlanningWarning(null);
    setBranches([]);
    setCurrentBranch("");
    setDefaultBranch("");
  }, []);

  // Handle edit draft
  const handleEditDraft = useCallback((loopId: string) => {
    setEditDraftId(loopId);
    setShowCreateModal(true);
  }, []);

  // Handle delete
  async function handleDelete() {
    if (!deleteModal.loopId) return;
    await deleteLoop(deleteModal.loopId);
    await refresh(); // Refresh loops to update React state
    setDeleteModal({ open: false, loopId: null });
  }

  // Handle accept
  async function handleAccept() {
    if (!acceptModal.loopId) return;
    await acceptLoop(acceptModal.loopId);
    setAcceptModal({ open: false, loopId: null });
  }

  // Handle push
  async function handlePush() {
    if (!acceptModal.loopId) return;
    await pushLoop(acceptModal.loopId);
    setAcceptModal({ open: false, loopId: null });
  }

  // Handle purge
  async function handlePurge() {
    if (!purgeModal.loopId) return;
    await purgeLoop(purgeModal.loopId);
    setPurgeModal({ open: false, loopId: null });
  }

  // Handle address comments
  async function handleAddressComments(comments: string) {
    if (!addressCommentsModal.loopId) return;
    try {
      const result = await addressReviewComments(addressCommentsModal.loopId, comments);
      if (!result.success) {
        throw new Error("Failed to address comments");
      }
      setAddressCommentsModal({ open: false, loopId: null });
    } catch (error) {
      log.error("Failed to address comments:", error);
      toast.error("Failed to address review comments");
    }
  }

  // Helper function to group loops by status.
  // Pre-computes plan readiness once per loop to avoid duplicate calls to isLoopPlanReady
  // (which performs structured logging) across multiple filter passes.
  const groupLoopsByStatus = (loopsToGroup: typeof loops) => {
    // Compute plan readiness once per loop to avoid duplicate trace log entries
    const planReadySet = new Set(
      loopsToGroup.filter((loop) => isLoopPlanReady(loop)).map((loop) => loop.config.id)
    );

    return {
      draft: loopsToGroup.filter((loop) => loop.state.status === "draft"),
      active: loopsToGroup.filter(
        (loop) =>
          loop.state.status === "running" ||
          loop.state.status === "waiting" ||
          loop.state.status === "starting"
      ),
      needsReview: loopsToGroup.filter((loop) => planReadySet.has(loop.config.id)),
      planning: loopsToGroup.filter(
        (loop) => loop.state.status === "planning" && !planReadySet.has(loop.config.id)
      ),
      completed: loopsToGroup.filter((loop) => loop.state.status === "completed"),
      awaitingFeedback: loopsToGroup.filter((loop) =>
        isAwaitingFeedback(loop.state.status, loop.state.reviewMode?.addressable)
      ),
      archived: loopsToGroup.filter(
        (loop) =>
          loop.state.status === "deleted" ||
          ((loop.state.status === "merged" || loop.state.status === "pushed") &&
            !isAwaitingFeedback(loop.state.status, loop.state.reviewMode?.addressable))
      ),
      other: loopsToGroup.filter(
        (loop) =>
          !["draft", "running", "waiting", "starting", "completed", "merged", "pushed", "deleted", "planning"].includes(
            loop.state.status
          )
      ),
    };
  };

  // Group loops by workspace first, then by status within each workspace
  const workspaceGroups = workspaces.map((workspace) => {
    const workspaceLoops = loops.filter((loop) => loop.config.workspaceId === workspace.id);
    return {
      workspace,
      loops: workspaceLoops,
      statusGroups: groupLoopsByStatus(workspaceLoops),
    };
  });

  // Unassigned loops (no workspace)
  const unassignedLoops = loops.filter((loop) => !loop.config.workspaceId);
  const unassignedStatusGroups = groupLoopsByStatus(unassignedLoops);

  // Status section key type for compile-time safety
  type StatusSectionKey = keyof ReturnType<typeof groupLoopsByStatus>;

  // Section configuration: defines order, labels, and default collapsed state
  const sectionConfig: Array<{
    key: StatusSectionKey;
    label: string;
    defaultCollapsed: boolean;
  }> = [
    { key: "active", label: "Active", defaultCollapsed: false },
    { key: "needsReview", label: "Needs Review", defaultCollapsed: false },
    { key: "planning", label: "Planning", defaultCollapsed: false },
    { key: "completed", label: "Completed", defaultCollapsed: false },
    { key: "awaitingFeedback", label: "Awaiting Feedback", defaultCollapsed: false },
    { key: "other", label: "Other", defaultCollapsed: false },
    { key: "draft", label: "Drafts", defaultCollapsed: false },
    { key: "archived", label: "Archived", defaultCollapsed: true },
  ];

  // Explicit action props type for LoopCard (excludes 'loop' which is always provided separately)
  interface LoopCardActions {
    onClick?: () => void;
    onAccept?: () => void;
    onDelete?: () => void;
    onPurge?: () => void;
    onAddressComments?: () => void;
    onRename?: () => void;
  }

  // Helper to get LoopCard action props based on section type.
  // Returns a typed object matching LoopCardProps action callbacks.
  function getLoopCardActions(sectionKey: StatusSectionKey, loopId: string): LoopCardActions {
    const actions: LoopCardActions = {
      onRename: () => setRenameModal({ open: true, loopId }),
    };

    // onClick: drafts use edit, everything else uses select
    if (sectionKey === "draft") {
      actions.onClick = () => handleEditDraft(loopId);
    } else {
      actions.onClick = () => onSelectLoop?.(loopId);
    }

    // onAccept: completed and other sections
    if (sectionKey === "completed" || sectionKey === "other") {
      actions.onAccept = () => setAcceptModal({ open: true, loopId });
    }

    // onDelete: draft, active, planning, needsReview, completed, and other sections
    if (sectionKey === "draft" || sectionKey === "active" || sectionKey === "planning" || sectionKey === "needsReview" || sectionKey === "completed" || sectionKey === "other") {
      actions.onDelete = () => setDeleteModal({ open: true, loopId });
    }

    // onPurge: awaitingFeedback and archived sections
    if (sectionKey === "awaitingFeedback" || sectionKey === "archived") {
      actions.onPurge = () => setPurgeModal({ open: true, loopId });
    }

    // onAddressComments: awaitingFeedback section only
    if (sectionKey === "awaitingFeedback") {
      actions.onAddressComments = () => setAddressCommentsModal({ open: true, loopId });
    }

    return actions;
  }

  // Renders status sections for a given set of status groups
  function renderStatusSections(
    statusGroups: ReturnType<typeof groupLoopsByStatus>,
    keyPrefix: string,
  ) {
    return sectionConfig.map(({ key, label, defaultCollapsed }) => {
      const sectionLoops = statusGroups[key];
      if (sectionLoops.length === 0) return null;

      return (
        <CollapsibleSection
          key={`${keyPrefix}-${key}`}
          title={label}
          count={sectionLoops.length}
          defaultCollapsed={defaultCollapsed}
          idPrefix={`${keyPrefix}-${key}`}
        >
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 gap-4">
            {sectionLoops.map((loop) => (
              <LoopCard
                key={loop.config.id}
                loop={loop}
                {...getLoopCardActions(key, loop.config.id)}
              />
            ))}
          </div>
        </CollapsibleSection>
      );
    });
  }

  return (
    <div className="h-full flex flex-col overflow-hidden bg-gray-50 dark:bg-gray-900">
      {/* Header */}
      <header className="bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 flex-shrink-0 safe-area-top">
        <div className="px-4 sm:px-6 lg:px-8 py-3 sm:py-4">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div className="flex items-center justify-between sm:justify-start gap-2 sm:gap-4">
              <h1 className="text-xl sm:text-2xl font-bold text-gray-900 dark:text-gray-100">
                Ralpher
                {version && (
                  <span className="ml-2 text-xs font-normal text-gray-500 dark:text-gray-400">
                    v{version}
                  </span>
                )}
              </h1>
              {/* App Settings Button */}
              <button
                type="button"
                onClick={() => setShowServerSettingsModal(true)}
                className="flex items-center gap-2 px-2 sm:px-3 py-1 sm:py-1.5 text-xs sm:text-sm rounded-md bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors"
                title="App Settings"
              >
                <span className="text-gray-500 dark:text-gray-400 font-medium hidden sm:inline">Settings</span>
                <GearIcon />
              </button>
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              {/* WebSocket Status indicator - Ralpher connection */}
              <div className="flex items-center gap-2 text-xs sm:text-sm px-2 sm:px-3 py-1 sm:py-1.5 rounded-md bg-gray-100 dark:bg-gray-800">
                <span className="text-gray-500 dark:text-gray-400 font-medium hidden sm:inline">Ralpher:</span>
                <span
                  className={`h-2 w-2 rounded-full ${
                    connectionStatus === "open"
                      ? "bg-green-500"
                      : connectionStatus === "connecting"
                      ? "bg-yellow-500"
                      : "bg-red-500"
                  }`}
                />
                <span className="text-gray-700 dark:text-gray-300">
                  {connectionStatus === "open"
                    ? "Connected"
                    : connectionStatus === "connecting"
                    ? "Connecting..."
                    : "Disconnected"}
                </span>
              </div>
              <Button 
                variant="secondary" 
                onClick={() => setShowCreateWorkspaceModal(true)} 
                className="flex-1 sm:flex-none"
              >
                New Workspace
              </Button>
              <Button onClick={() => setShowCreateModal(true)} className="flex-1 sm:flex-none">
                New Loop
              </Button>
            </div>
          </div>
        </div>
      </header>

      {/* Main content */}
      <main className="flex-1 min-h-0 overflow-auto px-4 sm:px-6 lg:px-8 py-8 safe-area-bottom">
        {/* Error display */}
        {error && (
          <div className="mb-6 rounded-md bg-red-50 dark:bg-red-900/20 p-4">
            <p className="text-sm text-red-800 dark:text-red-300">{error}</p>
          </div>
        )}

        {/* Loading state */}
        {loading && loops.length === 0 && (
          <div className="flex items-center justify-center py-12">
            <div className="animate-spin rounded-full h-8 w-8 border-2 border-blue-500 border-t-transparent" />
          </div>
        )}

        {/* Empty state - no loops at all */}
        {!loading && loops.length === 0 && (
          <div className="text-center py-12">
            <div className="text-gray-400 dark:text-gray-500 mb-4">
              <svg
                className="mx-auto h-12 w-12"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={1.5}
                  d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
                />
              </svg>
            </div>
            <h3 className="text-lg font-medium text-gray-900 dark:text-gray-100">
              No loops yet
            </h3>
            <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
              Click "New Loop" to create your first Ralph Loop.
            </p>
          </div>
        )}

        {/* Workspace-grouped loop sections */}
        {workspaceGroups.map(({ workspace, loops: workspaceLoops, statusGroups }) => {
          if (workspaceLoops.length === 0) return null;
          
          return (
            <div key={workspace.id} className="mb-10">
              {/* Workspace header - responsive layout */}
              <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-3 mb-4 pb-2 border-b border-gray-200 dark:border-gray-700">
                {/* Primary: Icon + Name + Settings */}
                <div className="flex items-center gap-2 min-w-0">
                  <svg className="w-5 h-5 text-gray-500 dark:text-gray-400 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
                  </svg>
                  <h2 className="text-xl font-bold text-gray-900 dark:text-gray-100 truncate">
                    {workspace.name}
                  </h2>
                  <button
                    type="button"
                    onClick={() => setWorkspaceSettingsModal({ open: true, workspaceId: workspace.id })}
                    className="p-1 text-gray-400 hover:text-gray-600 dark:text-gray-500 dark:hover:text-gray-300 transition-colors"
                    title="Workspace Settings"
                  >
                    <WorkspaceGearIcon />
                  </button>
                </div>
                {/* Secondary: Path + Loop count */}
                <div className="flex items-center gap-2 min-w-0 sm:flex-1">
                  <span className="text-sm text-gray-500 dark:text-gray-400 truncate" title={workspace.directory}>
                    {workspace.directory}
                  </span>
                  <span className="text-sm text-gray-400 dark:text-gray-500 flex-shrink-0">
                    ({workspaceLoops.length} {workspaceLoops.length === 1 ? "loop" : "loops"})
                  </span>
                </div>
              </div>

              {/* Status sections within workspace */}
              <div className="space-y-6 pl-2">
                {renderStatusSections(statusGroups, `workspace-${workspace.id}`)}
              </div>
            </div>
          );
        })}

        {/* Unassigned loops section */}
        {unassignedLoops.length > 0 && (
          <div className="mb-10">
            {/* Unassigned header */}
            <div className="flex items-center gap-3 mb-4 pb-2 border-b border-gray-200 dark:border-gray-700">
              <div className="flex items-center gap-2">
                <svg className="w-5 h-5 text-gray-400 dark:text-gray-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                <h2 className="text-xl font-bold text-gray-900 dark:text-gray-100">
                  Unassigned
                </h2>
              </div>
              <span className="text-sm text-gray-400 dark:text-gray-500">
                ({unassignedLoops.length} {unassignedLoops.length === 1 ? "loop" : "loops"})
              </span>
            </div>

            {/* Status sections within unassigned */}
            <div className="space-y-6 pl-2">
              {renderStatusSections(unassignedStatusGroups, "unassigned")}
            </div>
          </div>
        )}

        {/* Empty workspaces section - show workspaces with no loops that can be deleted */}
        {workspaceGroups.filter(g => g.loops.length === 0).length > 0 && (
          <div className="mb-10">
            <div className="flex items-center gap-3 mb-4 pb-2 border-b border-gray-200 dark:border-gray-700">
              <h2 className="text-lg font-semibold text-gray-700 dark:text-gray-300">
                Empty Workspaces
              </h2>
            </div>
            <div className="flex flex-wrap gap-2">
              {workspaceGroups
                .filter(g => g.loops.length === 0)
                .map(({ workspace }) => (
                  <div key={workspace.id} className="flex items-center gap-2 px-3 py-2 bg-gray-100 dark:bg-gray-800 rounded-md">
                    <span className="text-sm text-gray-700 dark:text-gray-300">{workspace.name}</span>
                    <button
                      type="button"
                      onClick={() => setWorkspaceSettingsModal({ open: true, workspaceId: workspace.id })}
                      className="p-1 text-gray-400 hover:text-gray-600 dark:text-gray-500 dark:hover:text-gray-300 transition-colors"
                      title="Workspace Settings"
                    >
                      <WorkspaceGearIcon />
                    </button>
                    <button
                      onClick={async () => {
                        if (confirm(`Delete workspace "${workspace.name}"?`)) {
                          const result = await deleteWorkspace(workspace.id);
                          if (!result.success) {
                            toast.error(result.error || "Failed to delete workspace");
                          }
                        }
                      }}
                      className="p-1 text-gray-400 hover:text-red-500 dark:text-gray-500 dark:hover:text-red-400 transition-colors"
                      title="Delete empty workspace"
                    >
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                  </div>
                ))}
            </div>
          </div>
        )}
      </main>

      {/* Create/Edit loop modal */}
      {(() => {
        const editLoop = editDraftId ? loops.find((l) => l.config.id === editDraftId) : null;
        const isEditing = !!editLoop;
        const isEditingDraft = editLoop?.state.status === "draft";
        
        // Transform Loop to initialLoopData format
        const initialLoopData = editLoop ? {
          name: editLoop.config.name,
          directory: editLoop.config.directory,
          prompt: editLoop.config.prompt,
          model: editLoop.config.model,
          maxIterations: editLoop.config.maxIterations,
          maxConsecutiveErrors: editLoop.config.maxConsecutiveErrors,
          activityTimeoutSeconds: editLoop.config.activityTimeoutSeconds,
          baseBranch: editLoop.config.baseBranch,
          clearPlanningFolder: editLoop.config.clearPlanningFolder,
          planMode: editLoop.config.planMode ?? false,
          workspaceId: editLoop.config.workspaceId,
        } : null;
        
        return (
          <Modal
            isOpen={showCreateModal}
            onClose={handleCloseCreateModal}
            title={isEditing ? "Edit Draft Loop" : "Create New Loop"}
            description={isEditing ? "Update your draft loop configuration." : "Configure a new Ralph Loop for autonomous AI development."}
            size="lg"
            footer={formActionState && (
              <>
                {/* Left side - Save as Draft / Update Draft button */}
                {(!formActionState.isEditing || formActionState.isEditingDraft) && (
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={formActionState.onSaveAsDraft}
                    disabled={formActionState.isSubmitting || !formActionState.canSaveDraft}
                    loading={formActionState.isSubmitting}
                    className="sm:mr-auto"
                  >
                    {formActionState.isEditingDraft ? "Update Draft" : "Save as Draft"}
                  </Button>
                )}
                
                {/* Right side - Cancel and Create/Start buttons */}
                <Button
                  type="button"
                  variant="ghost"
                  onClick={formActionState.onCancel}
                  disabled={formActionState.isSubmitting}
                >
                  Cancel
                </Button>
                <Button 
                  type="button"
                  onClick={formActionState.onSubmit} 
                  loading={formActionState.isSubmitting}
                  disabled={!formActionState.canSubmit}
                >
                  {formActionState.isEditing 
                    ? (formActionState.planMode ? "Start Plan" : "Start Loop")
                    : (formActionState.planMode ? "Create Plan" : "Create Loop")
                  }
                </Button>
              </>
            )}
          >
            <CreateLoopForm
              key={isEditing ? editLoop.config.id : "create-new"}
              editLoopId={isEditing ? editLoop.config.id : undefined}
              initialLoopData={initialLoopData}
              isEditingDraft={isEditingDraft}
              renderActions={setFormActionState}
              onSubmit={async (request) => {
                // If editing a draft
                if (isEditing) {
                  // If draft flag is set, this is an "Update Draft" action
                  if (request.draft) {
                    try {
                      const response = await fetch(`/api/loops/${editLoop.config.id}`, {
                        method: "PUT",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify(request),
                      });
                      
                      if (!response.ok) {
                        const error = await response.json();
                        log.error("Failed to update draft:", error);
                        toast.error("Failed to update draft");
                        return false;
                      }
                      
                      // Refresh loops to update React state with new data
                      await refresh();
                      
                      // Success - close modal
                      return true;
                    } catch (error) {
                      log.error("Failed to update draft:", error);
                      toast.error("Failed to update draft");
                      return false;
                    }
                  }
                  
                  // Otherwise, this is a "Start Loop" action - transition draft to execution
                  try {
                    const startResponse = await fetch(`/api/loops/${editLoop.config.id}/draft/start`, {
                      method: "POST",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({ planMode: request.planMode ?? false }),
                    });
                    
                    if (!startResponse.ok) {
                      const error = await startResponse.json();
                      
                      // Check for uncommitted changes error
                      if (error.error === "uncommitted_changes") {
                        setUncommittedModal({
                          open: true,
                          loopId: editLoop.config.id,
                          error: error.message,
                        });
                        return true; // Close the modal, uncommitted modal will show
                      }
                      
                      log.error("Failed to start draft:", error);
                      toast.error("Failed to start loop");
                      return false;
                    }
                    
                    // Refresh loops to update React state
                    await refresh();
                    
                    // Success - close modal
                    return true;
                  } catch (error) {
                    log.error("Failed to start draft:", error);
                    toast.error("Failed to start loop");
                    return false;
                  }
                }
                
                // Otherwise, create a new loop
                const result = await createLoop(request);
                
                // Handle uncommitted changes error first
                if (result.startError) {
                  setUncommittedModal({
                    open: true,
                    loopId: result.loop?.config.id ?? null,
                    error: result.startError,
                  });
                  return true; // Consider this handled (modal will close)
                }
                
                // Handle success case
                if (result.loop) {
                  // Refresh loops list to show the new loop
                  await refresh();
                  
                  // Refresh last model in case it changed
                  if (request.model) {
                    setLastModel(request.model);
                  }
                  // Save last used directory (get it from the workspace)
                  // Save last used directory preference (for API compatibility)
                  if (request.workspaceId) {
                    const workspace = workspaces.find(w => w.id === request.workspaceId);
                    if (workspace) {
                      try {
                        await fetch("/api/preferences/last-directory", {
                          method: "PUT",
                          headers: { "Content-Type": "application/json" },
                          body: JSON.stringify({ directory: workspace.directory }),
                        });
                      } catch {
                        // Ignore errors saving preference
                      }
                    }
                  }
                  return true; // Success - close the modal
                }
                
                return false; // Failed - keep modal open
              }}
              onCancel={handleCloseCreateModal}
              models={models}
              modelsLoading={modelsLoading}
              lastModel={lastModel}
              onWorkspaceChange={handleWorkspaceChange}
              planningWarning={planningWarning}
              branches={branches}
              branchesLoading={branchesLoading}
              currentBranch={currentBranch}
              defaultBranch={defaultBranch}
              workspaces={workspaces}
              workspacesLoading={workspacesLoading}
              workspaceError={workspaceError}
            />
          </Modal>
        );
      })()}

      {/* Delete confirmation modal */}
      <DeleteLoopModal
        isOpen={deleteModal.open}
        onClose={() => setDeleteModal({ open: false, loopId: null })}
        onDelete={handleDelete}
      />

      {/* Accept/Push modal */}
      <AcceptLoopModal
        isOpen={acceptModal.open}
        onClose={() => setAcceptModal({ open: false, loopId: null })}
        onAccept={handleAccept}
        onPush={handlePush}
        restrictToAction={loops.find(l => l.config.id === acceptModal.loopId)?.state.reviewMode?.completionAction}
      />

      {/* Purge confirmation modal */}
      <PurgeLoopModal
        isOpen={purgeModal.open}
        onClose={() => setPurgeModal({ open: false, loopId: null })}
        onPurge={handlePurge}
      />

      {/* Address Comments modal */}
      {addressCommentsModal.loopId && (
        <AddressCommentsModal
          isOpen={addressCommentsModal.open}
          onClose={() => setAddressCommentsModal({ open: false, loopId: null })}
          onSubmit={handleAddressComments}
          loopName={loops.find(l => l.config.id === addressCommentsModal.loopId)?.config.name || ""}
          reviewCycle={(loops.find(l => l.config.id === addressCommentsModal.loopId)?.state.reviewMode?.reviewCycles || 0) + 1}
        />
      )}

      {/* Uncommitted changes modal */}
      <UncommittedChangesModal
        isOpen={uncommittedModal.open}
        onClose={() => setUncommittedModal({ open: false, loopId: null, error: null })}
        error={uncommittedModal.error}
      />

      {/* App Settings modal */}
      <AppSettingsModal
        isOpen={showServerSettingsModal}
        onClose={() => setShowServerSettingsModal(false)}
        onResetAll={resetAllSettings}
        resetting={appSettingsResetting}
        onKillServer={killServer}
        killingServer={appSettingsKilling}
        onExportConfig={exportConfig}
        onImportConfig={importConfig}
        configSaving={workspaceCreating}
      />

      {/* Rename Loop modal */}
      <RenameLoopModal
        isOpen={renameModal.open}
        onClose={() => setRenameModal({ open: false, loopId: null })}
        currentName={loops.find(l => l.config.id === renameModal.loopId)?.config.name ?? ""}
        onRename={async (newName) => {
          if (renameModal.loopId) {
            await updateLoop(renameModal.loopId, { name: newName });
          }
        }}
      />

      {/* Workspace Settings modal */}
      <WorkspaceSettingsModal
        isOpen={workspaceSettingsModal.open}
        onClose={() => {
          setWorkspaceSettingsModal({ open: false, workspaceId: null });
          // Refresh the workspace list to reflect any name changes
          // (handled by useWorkspaces hook re-fetching)
        }}
        workspace={workspaceFromHook}
        status={workspaceStatus}
        onSave={async (name, settings) => {
          if (!workspaceSettingsModal.workspaceId) return false;
          // Use the hook's updateWorkspace function for proper state management
          const success = await updateWorkspaceSettings(name, settings);
          if (success) {
            // Refresh the workspaces list so the UI shows updated data
            await refreshWorkspaces();
          }
          return success;
        }}
        onTest={testWorkspaceConnection}
        onResetConnection={resetWorkspaceConnection}
        saving={workspaceSettingsSaving}
        testing={workspaceSettingsTesting}
        resettingConnection={workspaceSettingsResetting}
        remoteOnly={remoteOnly}
      />

      {/* Create Workspace modal */}
      <CreateWorkspaceModal
        isOpen={showCreateWorkspaceModal}
        onClose={() => setShowCreateWorkspaceModal(false)}
        onCreate={async (request) => {
          const result = await createWorkspace(request);
          return !!result;
        }}
        creating={workspaceCreating}
        error={workspaceError}
        remoteOnly={remoteOnly}
      />
    </div>
  );
}

export default Dashboard;

/**
 * Simple gear icon component.
 */
function GearIcon() {
  return (
    <svg
      className="w-4 h-4 text-gray-500 dark:text-gray-400"
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={2}
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"
      />
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
      />
    </svg>
  );
}

/**
 * Smaller gear icon for workspace settings.
 */
function WorkspaceGearIcon() {
  return (
    <svg
      className="w-4 h-4"
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={2}
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"
      />
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
      />
    </svg>
  );
}
