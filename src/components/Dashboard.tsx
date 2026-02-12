/**
 * Dashboard component showing all loops in a grid view.
 * Orchestrates data fetching, modal state, and loop grouping via extracted hooks and components.
 */

import { useLoops, useWorkspaces, useViewModePreference } from "../hooks";
import { useWorkspaceServerSettings } from "../hooks";
import { useDashboardData } from "../hooks/useDashboardData";
import { useDashboardModals } from "../hooks/useDashboardModals";
import { useLoopGrouping } from "../hooks/useLoopGrouping";
import { DashboardHeader } from "./DashboardHeader";
import { LoopGrid } from "./LoopGrid";
import { DashboardModals } from "./DashboardModals";

export interface DashboardProps {
  /** Callback when a loop is selected */
  onSelectLoop?: (loopId: string) => void;
}

export function Dashboard({ onSelectLoop }: DashboardProps) {
  const {
    loops,
    loading,
    error,
    refresh,
    createLoop,
    updateLoop,
  } = useLoops();

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
        onOpenCreateLoop={() => modals.setShowCreateModal(true)}
      />

      <LoopGrid
        loops={loops}
        loading={loading}
        error={error}
        viewMode={viewMode}
        workspaceGroups={workspaceGroups}
        unassignedLoops={unassignedLoops}
        unassignedStatusGroups={unassignedStatusGroups}
        onSelectLoop={onSelectLoop}
        onEditDraft={modals.handleEditDraft}
        onRename={(loopId) => modals.setRenameModal({ open: true, loopId })}
        onOpenWorkspaceSettings={(workspaceId) => modals.setWorkspaceSettingsModal({ open: true, workspaceId })}
        onDeleteWorkspace={deleteWorkspace}
      />

      <DashboardModals
        loops={loops}
        workspaces={workspaces}
        workspacesLoading={workspacesLoading}
        workspaceError={workspaceError}
        // Create/Edit modal
        showCreateModal={modals.showCreateModal}
        editDraftId={modals.editDraftId}
        formActionState={modals.formActionState}
        setFormActionState={modals.setFormActionState}
        onCloseCreateModal={modals.handleCloseCreateModal}
        onCreateLoop={createLoop}
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
    </div>
  );
}

export default Dashboard;
