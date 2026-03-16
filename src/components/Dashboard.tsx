/**
 * Dashboard component showing all loops in a grid view.
 * Orchestrates data fetching, modal state, and loop grouping via extracted hooks and components.
 */

import { useLoops, useSshServers, useSshSessions, useWorkspaces, useViewModePreference } from "../hooks";
import { useWorkspaceServerSettings } from "../hooks";
import { useToast } from "../hooks/useToast";
import { useDashboardData } from "../hooks/useDashboardData";
import { useDashboardModals } from "../hooks/useDashboardModals";
import { useLoopGrouping } from "../hooks/useLoopGrouping";
import { CollapsibleSection } from "./common";
import { DashboardHeader } from "./DashboardHeader";
import { LoopGrid } from "./LoopGrid";
import { DashboardModals } from "./DashboardModals";
import { SshSessionSection } from "./SshSessionSection";
import { CreateSshServerModal } from "./CreateSshServerModal";
import { CreateSshSessionModal } from "./CreateSshSessionModal";
import { SshServerSection } from "./SshServerSection";
import { useMemo, useState } from "react";
import type { SshServer } from "../types";

export interface DashboardProps {
  /** Callback when a loop is selected */
  onSelectLoop?: (loopId: string) => void;
  /** Callback when a chat is selected */
  onSelectChat?: (chatId: string) => void;
  /** Callback when an SSH session is selected */
  onSelectSshSession?: (sessionId: string) => void;
}

export function Dashboard({ onSelectLoop, onSelectChat, onSelectSshSession }: DashboardProps) {
  const {
    loops,
    loading,
    error,
    refresh,
    createLoop,
    createChat,
    deleteLoop,
    updateLoop,
    purgeArchivedWorkspaceLoops,
  } = useLoops();
  const {
    sessions,
    loading: sshSessionsLoading,
    error: sshSessionsError,
    createSession,
    updateSession,
  } = useSshSessions();
  const [showCreateSshSessionModal, setShowCreateSshSessionModal] = useState(false);
  const [creatingWorkspaceSshSession, setCreatingWorkspaceSshSession] = useState(false);
  const [createWorkspaceSshSessionError, setCreateWorkspaceSshSessionError] = useState<string | null>(null);
  const [showCreateSshServerModal, setShowCreateSshServerModal] = useState(false);
  const [editingSshServer, setEditingSshServer] = useState<SshServer | null>(null);
  const {
    servers: sshServers,
    sessionsByServerId,
    loading: sshServersLoading,
    error: sshServersError,
    createServer,
    updateServer,
    deleteServer,
    createSession: createStandaloneSession,
    hasStoredCredential,
  } = useSshServers();
  const toast = useToast();

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

  // Data fetching hook
  const dashboardData = useDashboardData();

  // Modal state hook
  const modals = useDashboardModals(dashboardData.resetCreateModalState);

  // Loop grouping hook (memoized)
  const { workspaceGroups, unassignedLoops, unassignedStatusGroups } = useLoopGrouping(loops, workspaces);
  const [workspaceArchivedLoopsPurging, setWorkspaceArchivedLoopsPurging] = useState(false);
  const sshWorkspaces = useMemo(() => {
    return workspaces.filter((workspace) => workspace.serverSettings.agent.transport === "ssh");
  }, [workspaces]);
  const selectedWorkspaceArchivedLoopCount = useMemo(() => {
    if (!modals.workspaceSettingsModal.workspaceId) {
      return 0;
    }
    return workspaceGroups.find(
      (group) => group.workspace.id === modals.workspaceSettingsModal.workspaceId
    )?.statusGroups.archived.length ?? 0;
  }, [modals.workspaceSettingsModal.workspaceId, workspaceGroups]);

  // Mode-aware selection handler: routes chats to #/chat/:id, loops to #/loop/:id
  const handleSelectItem = (loopId: string) => {
    const loop = loops.find((l) => l.config.id === loopId);
    if (loop?.config.mode === "chat" && onSelectChat) {
      onSelectChat(loopId);
    } else if (onSelectLoop) {
      onSelectLoop(loopId);
    }
  };

  // View mode preference hook
  const { viewMode, toggle: toggleViewMode } = useViewModePreference();

  async function createWorkspaceSshSessionFor(workspaceId: string, options?: { fromModal?: boolean }) {
    const workspace = sshWorkspaces.find((item) => item.id === workspaceId);
    const reportError = (message: string) => {
      if (options?.fromModal) {
        setCreateWorkspaceSshSessionError(message);
        return;
      }
      toast.error(message);
    };

    if (!workspace) {
      reportError("The selected SSH workspace is no longer available.");
      return;
    }

    try {
      setCreatingWorkspaceSshSession(true);
      setCreateWorkspaceSshSessionError(null);
      const session = await createSession({ workspaceId: workspace.id });
      setShowCreateSshSessionModal(false);
      onSelectSshSession?.(session.config.id);
    } catch (error) {
      reportError(String(error));
    } finally {
      setCreatingWorkspaceSshSession(false);
    }
  }

  function handleCloseCreateSshSessionModal() {
    if (creatingWorkspaceSshSession) {
      return;
    }
    setCreateWorkspaceSshSessionError(null);
    setShowCreateSshSessionModal(false);
  }

  async function handleCreateWorkspaceSshSession() {
    if (workspacesLoading) {
      toast.info("Loading SSH workspaces...");
      return;
    }
    if (workspaceError) {
      toast.error(workspaceError);
      return;
    }

    if (sshWorkspaces.length === 0) {
      toast.error("Create or configure a workspace with SSH transport before starting an SSH session.");
      return;
    }

    if (sshWorkspaces.length === 1) {
      await createWorkspaceSshSessionFor(sshWorkspaces[0]!.id);
      return;
    }

    setCreateWorkspaceSshSessionError(null);
    setShowCreateSshSessionModal(true);
  }

  async function handleCreateStandaloneSshSession(server: SshServer) {
    try {
      const session = await createStandaloneSession(server.config.id);
      onSelectSshSession?.(session.config.id);
    } catch (error) {
      toast.error(String(error));
    }
  }

  async function handlePurgeArchivedWorkspaceLoops(workspaceId: string) {
    try {
      setWorkspaceArchivedLoopsPurging(true);
      const result = await purgeArchivedWorkspaceLoops(workspaceId);

      if (!result.success) {
        toast.error("Failed to purge archived loops");
        return result;
      }

      if (result.totalArchived === 0) {
        toast.info("No archived loops found for this workspace");
      } else if (result.failures.length > 0) {
        toast.error(`Purged ${result.purgedCount} of ${result.totalArchived} archived loops`);
      } else {
        toast.success(`Purged ${result.purgedCount} archived loops`);
      }

      return result;
    } finally {
      setWorkspaceArchivedLoopsPurging(false);
    }
  }

  // Workspace server settings hook for the workspace being edited
  const {
    workspace: workspaceFromHook,
    status: workspaceStatus,
    saving: workspaceSettingsSaving,
    testing: workspaceSettingsTesting,
    resettingConnection: workspaceSettingsResetting,
    testConnection: testWorkspaceConnection,
    resetConnection: resetWorkspaceConnection,
    updateWorkspace: updateWorkspaceSettings,
  } = useWorkspaceServerSettings(modals.workspaceSettingsModal.workspaceId);

  return (
    <div className="h-full flex flex-col overflow-hidden bg-gray-50 dark:bg-gray-900">
      <DashboardHeader
        version={dashboardData.version}
        viewMode={viewMode}
        onToggleViewMode={toggleViewMode}
        onOpenServerSettings={() => modals.setShowServerSettingsModal(true)}
        onOpenCreateWorkspace={() => modals.setShowCreateWorkspaceModal(true)}
        onOpenCreateLoop={() => modals.handleOpenCreateLoop()}
        onOpenCreateChat={() => modals.handleOpenCreateChat()}
        onCreateSshSession={() => void handleCreateWorkspaceSshSession()}
      />

      <main className="flex-1 min-h-0 overflow-auto dark-scrollbar">
        <div className="px-4 sm:px-6 lg:px-8 py-4 sm:py-6 safe-area-bottom space-y-8">
          <section className="border-b border-gray-200 pb-6 dark:border-gray-800">
            <CollapsibleSection
              title="SSH"
              count={sshServers.length + sessions.length}
              defaultCollapsed={true}
              idPrefix="ssh"
            >
              <div className="space-y-6">
                <SshServerSection
                  servers={sshServers}
                  sessionsByServerId={sessionsByServerId}
                  loading={sshServersLoading}
                  error={sshServersError}
                  hasStoredCredential={hasStoredCredential}
                  onOpenCreateServer={() => {
                    setEditingSshServer(null);
                    setShowCreateSshServerModal(true);
                  }}
                  onOpenEditServer={(server) => {
                    setEditingSshServer(server);
                    setShowCreateSshServerModal(true);
                  }}
                  onDeleteServer={async (serverId) => {
                    await deleteServer(serverId);
                  }}
                  onCreateSession={(server) => {
                    void handleCreateStandaloneSshSession(server);
                  }}
                  onSelectSession={(sessionId) => onSelectSshSession?.(sessionId)}
                />

                <div className="space-y-3">
                  <div className="px-1">
                    <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">Workspace SSH Sessions</h3>
                    <p className="text-xs text-gray-500 dark:text-gray-400">
                      Saved terminal sessions for SSH-configured workspaces. Use persistent SSH to keep shells alive across reconnects, or direct SSH for a fresh shell.
                    </p>
                  </div>
                  <SshSessionSection
                    sessions={sessions}
                    loading={sshSessionsLoading}
                    error={sshSessionsError}
                    onSelect={(sessionId) => onSelectSshSession?.(sessionId)}
                    onRename={(sessionId) => modals.setSshSessionRenameModal({ open: true, sessionId })}
                  />
                </div>
              </div>
            </CollapsibleSection>
          </section>

          <LoopGrid
            loops={loops}
            loading={loading}
            error={error}
            viewMode={viewMode}
            workspaceGroups={workspaceGroups}
            registeredSshServers={sshServers}
            unassignedLoops={unassignedLoops}
            unassignedStatusGroups={unassignedStatusGroups}
            onSelectLoop={handleSelectItem}
            onEditDraft={modals.handleEditDraft}
            onRename={(loopId) => modals.setRenameModal({ open: true, loopId })}
            onOpenWorkspaceSettings={(workspaceId) => modals.setWorkspaceSettingsModal({ open: true, workspaceId })}
            onDeleteWorkspace={deleteWorkspace}
          />
        </div>
      </main>

      <DashboardModals
        loops={loops}
        sshSessions={sessions}
        workspaces={workspaces}
        workspacesLoading={workspacesLoading}
        workspaceError={workspaceError}
        // Create/Edit modal
        showCreateModal={modals.showCreateModal}
        editDraftId={modals.editDraftId}
        createMode={modals.createMode}
        formActionState={modals.formActionState}
        setFormActionState={modals.setFormActionState}
        onCloseCreateModal={modals.handleCloseCreateModal}
        onCreateLoop={createLoop}
        onCreateChat={createChat}
        onDeleteLoop={deleteLoop}
        onRefresh={refresh}
        // Model/branch/workspace data
        models={dashboardData.models}
        modelsLoading={dashboardData.modelsLoading}
        lastModel={dashboardData.lastModel}
        setLastModel={dashboardData.setLastModel}
        onWorkspaceChange={dashboardData.handleWorkspaceChange}
        planningWarning={dashboardData.planningWarning}
        branches={dashboardData.branches}
        branchesLoading={dashboardData.branchesLoading}
        currentBranch={dashboardData.currentBranch}
        defaultBranch={dashboardData.defaultBranch}
        // Uncommitted modal
        uncommittedModal={modals.uncommittedModal}
        onCloseUncommittedModal={() => modals.setUncommittedModal({ open: false, loopId: null, error: null })}
        setUncommittedModal={modals.setUncommittedModal}
        // Rename modal
        renameModal={modals.renameModal}
        onCloseRenameModal={() => modals.setRenameModal({ open: false, loopId: null })}
        onRename={async (loopId, newName) => { await updateLoop(loopId, { name: newName }); }}
        sshSessionRenameModal={modals.sshSessionRenameModal}
        onCloseSshSessionRenameModal={() => modals.setSshSessionRenameModal({ open: false, sessionId: null })}
        onRenameSshSession={async (sessionId, newName) => {
          await updateSession(sessionId, { name: newName });
          toast.success("SSH session renamed");
        }}
        // App settings modal
        showServerSettingsModal={modals.showServerSettingsModal}
        onCloseServerSettingsModal={() => modals.setShowServerSettingsModal(false)}
        onResetAll={dashboardData.resetAllSettings}
        appSettingsResetting={dashboardData.appSettingsResetting}
        onKillServer={dashboardData.killServer}
        appSettingsKilling={dashboardData.appSettingsKilling}
        onExportConfig={exportConfig}
        onImportConfig={importConfig}
        workspaceCreating={workspaceCreating}
        // Workspace settings modal
        workspaceSettingsModal={modals.workspaceSettingsModal}
        onCloseWorkspaceSettingsModal={() => modals.setWorkspaceSettingsModal({ open: false, workspaceId: null })}
        workspaceFromHook={workspaceFromHook}
        workspaceStatus={workspaceStatus}
        workspaceSettingsSaving={workspaceSettingsSaving}
        workspaceSettingsTesting={workspaceSettingsTesting}
        workspaceSettingsResetting={workspaceSettingsResetting}
        workspaceArchivedLoopsPurging={workspaceArchivedLoopsPurging}
        testWorkspaceConnection={testWorkspaceConnection}
        resetWorkspaceConnection={resetWorkspaceConnection}
        updateWorkspaceSettings={updateWorkspaceSettings}
        archivedLoopCount={selectedWorkspaceArchivedLoopCount}
        purgeArchivedWorkspaceLoops={handlePurgeArchivedWorkspaceLoops}
        refreshWorkspaces={refreshWorkspaces}
        remoteOnly={dashboardData.remoteOnly}
        // Create workspace modal
        showCreateWorkspaceModal={modals.showCreateWorkspaceModal}
        onCloseCreateWorkspaceModal={() => modals.setShowCreateWorkspaceModal(false)}
        onCreateWorkspace={createWorkspace}
        onProvisioningSuccess={refreshWorkspaces}
        sshServers={sshServers}
      />

      <CreateSshServerModal
        isOpen={showCreateSshServerModal}
        onClose={() => {
          setShowCreateSshServerModal(false);
          setEditingSshServer(null);
        }}
        initialServer={editingSshServer}
        onSubmit={(request, password) => {
          if (editingSshServer) {
            return updateServer(editingSshServer.config.id, request, password);
          }
          return createServer(request, password);
        }}
      />

        <CreateSshSessionModal
          isOpen={showCreateSshSessionModal}
          onClose={handleCloseCreateSshSessionModal}
          workspaces={sshWorkspaces}
          registeredSshServers={sshServers}
          onCreate={async (workspaceId) => {
            await createWorkspaceSshSessionFor(workspaceId, { fromModal: true });
          }}
        loading={creatingWorkspaceSshSession}
        error={createWorkspaceSshSessionError}
      />
    </div>
  );
}

export default Dashboard;
