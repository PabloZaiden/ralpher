/**
 * Dashboard component showing all loops in a grid view.
 * Orchestrates data fetching, modal state, and loop grouping via extracted hooks and components.
 */

import { useLoops, useSshServers, useSshSessions, useWorkspaces, useViewModePreference } from "../hooks";
import { useWorkspaceServerSettings } from "../hooks";
import { useDashboardData } from "../hooks/useDashboardData";
import { useDashboardModals } from "../hooks/useDashboardModals";
import { useLoopGrouping } from "../hooks/useLoopGrouping";
import { CollapsibleSection } from "./common";
import { DashboardHeader } from "./DashboardHeader";
import { LoopGrid } from "./LoopGrid";
import { DashboardModals } from "./DashboardModals";
import { CreateSshSessionModal } from "./CreateSshSessionModal";
import { SshSessionSection } from "./SshSessionSection";
import { CreateSshServerModal } from "./CreateSshServerModal";
import { CreateStandaloneSshSessionModal } from "./CreateStandaloneSshSessionModal";
import { SshServerSection } from "./SshServerSection";
import { useState } from "react";
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
  } = useLoops();
  const {
    sessions,
    loading: sshSessionsLoading,
    error: sshSessionsError,
    createSession,
  } = useSshSessions();
  const [showCreateSshSessionModal, setShowCreateSshSessionModal] = useState(false);
  const [showCreateSshServerModal, setShowCreateSshServerModal] = useState(false);
  const [editingSshServer, setEditingSshServer] = useState<SshServer | null>(null);
  const [selectedStandaloneServer, setSelectedStandaloneServer] = useState<SshServer | null>(null);
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
        onOpenCreateSshSession={() => setShowCreateSshSessionModal(true)}
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
                  onOpenCreateSession={(server) => {
                    setSelectedStandaloneServer(server);
                  }}
                  onSelectSession={(sessionId) => onSelectSshSession?.(sessionId)}
                />

                <div className="space-y-3">
                  <div className="px-1">
                    <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">Workspace SSH Sessions</h3>
                    <p className="text-xs text-gray-500 dark:text-gray-400">
                      Persistent tmux-backed terminal sessions for SSH-configured workspaces.
                    </p>
                  </div>
                  <SshSessionSection
                    sessions={sessions}
                    loading={sshSessionsLoading}
                    error={sshSessionsError}
                    onSelect={(sessionId) => onSelectSshSession?.(sessionId)}
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
        testWorkspaceConnection={testWorkspaceConnection}
        resetWorkspaceConnection={resetWorkspaceConnection}
        updateWorkspaceSettings={updateWorkspaceSettings}
        refreshWorkspaces={refreshWorkspaces}
        remoteOnly={dashboardData.remoteOnly}
        // Create workspace modal
        showCreateWorkspaceModal={modals.showCreateWorkspaceModal}
        onCloseCreateWorkspaceModal={() => modals.setShowCreateWorkspaceModal(false)}
        onCreateWorkspace={createWorkspace}
      />

      <CreateSshSessionModal
        isOpen={showCreateSshSessionModal}
        onClose={() => setShowCreateSshSessionModal(false)}
        onCreate={createSession}
        sessions={sessions}
        workspaces={workspaces}
        workspacesLoading={workspacesLoading}
        workspaceError={workspaceError}
        onCreated={(sessionId) => onSelectSshSession?.(sessionId)}
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

      <CreateStandaloneSshSessionModal
        isOpen={selectedStandaloneServer !== null}
        server={selectedStandaloneServer}
        hasStoredCredential={selectedStandaloneServer ? hasStoredCredential(selectedStandaloneServer.config.id) : false}
        onClose={() => setSelectedStandaloneServer(null)}
        onCreate={createStandaloneSession}
        onCreated={(sessionId) => onSelectSshSession?.(sessionId)}
      />
    </div>
  );
}

export default Dashboard;
