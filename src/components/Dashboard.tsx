/**
 * Dashboard component showing all loops in a grid view.
 * Orchestrates data fetching, modal state, and loop grouping via extracted hooks and components.
 */

import { useLoops, useWorkspaces, useToast, useViewModePreference } from "../hooks";
import { useWorkspaceServerSettings } from "../hooks";
import { useDashboardData } from "../hooks/useDashboardData";
import { useDashboardModals } from "../hooks/useDashboardModals";
import { useLoopGrouping } from "../hooks/useLoopGrouping";
import { DashboardHeader } from "./DashboardHeader";
import { LoopGrid } from "./LoopGrid";
import { DashboardModals } from "./DashboardModals";
import { createLogger } from "../lib/logger";

const log = createLogger("Dashboard");

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
    refresh,
    createLoop,
    deleteLoop,
    acceptLoop,
    pushLoop,
    purgeLoop,
    addressReviewComments,
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

  // Action handlers
  async function handleDelete() {
    if (!modals.deleteModal.loopId) return;
    await deleteLoop(modals.deleteModal.loopId);
    await refresh();
    modals.setDeleteModal({ open: false, loopId: null });
  }

  async function handleAccept() {
    if (!modals.acceptModal.loopId) return;
    await acceptLoop(modals.acceptModal.loopId);
    modals.setAcceptModal({ open: false, loopId: null });
  }

  async function handlePush() {
    if (!modals.acceptModal.loopId) return;
    await pushLoop(modals.acceptModal.loopId);
    modals.setAcceptModal({ open: false, loopId: null });
  }

  async function handlePurge() {
    if (!modals.purgeModal.loopId) return;
    await purgeLoop(modals.purgeModal.loopId);
    modals.setPurgeModal({ open: false, loopId: null });
  }

  async function handleAddressComments(comments: string) {
    if (!modals.addressCommentsModal.loopId) return;
    try {
      const result = await addressReviewComments(modals.addressCommentsModal.loopId, comments);
      if (!result.success) {
        throw new Error("Failed to address comments");
      }
      modals.setAddressCommentsModal({ open: false, loopId: null });
    } catch (error) {
      log.error("Failed to address comments:", error);
      toast.error("Failed to address review comments");
    }
  }

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
        onAccept={(loopId) => modals.setAcceptModal({ open: true, loopId })}
        onDelete={(loopId) => modals.setDeleteModal({ open: true, loopId })}
        onPurge={(loopId) => modals.setPurgeModal({ open: true, loopId })}
        onAddressComments={(loopId) => modals.setAddressCommentsModal({ open: true, loopId })}
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
        // Delete modal
        deleteModal={modals.deleteModal}
        onCloseDeleteModal={() => modals.setDeleteModal({ open: false, loopId: null })}
        onDelete={handleDelete}
        // Accept modal
        acceptModal={modals.acceptModal}
        onCloseAcceptModal={() => modals.setAcceptModal({ open: false, loopId: null })}
        onAccept={handleAccept}
        onPush={handlePush}
        // Purge modal
        purgeModal={modals.purgeModal}
        onClosePurgeModal={() => modals.setPurgeModal({ open: false, loopId: null })}
        onPurge={handlePurge}
        // Address comments modal
        addressCommentsModal={modals.addressCommentsModal}
        onCloseAddressCommentsModal={() => modals.setAddressCommentsModal({ open: false, loopId: null })}
        onAddressComments={handleAddressComments}
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
