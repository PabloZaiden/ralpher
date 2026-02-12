/**
 * Dashboard modal renderings — aggregates all modal components used in the Dashboard.
 */

import type { Loop, UncommittedChangesError, ModelInfo, BranchInfo, Workspace, CreateLoopRequest } from "../types";
import type { WorkspaceExportData, WorkspaceImportResult, CreateWorkspaceRequest } from "../types/workspace";
import type { CreateLoopFormActionState } from "./CreateLoopForm";
import type { CreateLoopResult } from "../hooks/useLoops";
import type { UseWorkspaceServerSettingsResult } from "../hooks/useWorkspaceServerSettings";
import { Modal, Button } from "./common";
import { CreateLoopForm } from "./CreateLoopForm";
import {
  UncommittedChangesModal,
  RenameLoopModal,
} from "./LoopModals";
import { AppSettingsModal } from "./AppSettingsModal";
import { WorkspaceSettingsModal } from "./WorkspaceSettingsModal";
import { CreateWorkspaceModal } from "./CreateWorkspaceModal";
import { createLogger } from "../lib/logger";
import { useToast } from "../hooks";

const log = createLogger("DashboardModals");

export interface DashboardModalsProps {
  loops: Loop[];
  workspaces: Workspace[];
  workspacesLoading: boolean;
  workspaceError: string | null;

  // Create/Edit modal
  showCreateModal: boolean;
  editDraftId: string | null;
  formActionState: CreateLoopFormActionState | null;
  setFormActionState: (state: CreateLoopFormActionState | null) => void;
  onCloseCreateModal: () => void;
  onCreateLoop: (request: CreateLoopRequest) => Promise<CreateLoopResult>;
  onRefresh: () => Promise<void>;

  // Model/branch/workspace data for create form
  models: ModelInfo[];
  modelsLoading: boolean;
  lastModel: { providerID: string; modelID: string } | null;
  setLastModel: (model: { providerID: string; modelID: string } | null) => void;
  onWorkspaceChange: (workspaceId: string | null, directory: string) => void;
  planningWarning: string | null;
  branches: BranchInfo[];
  branchesLoading: boolean;
  currentBranch: string;
  defaultBranch: string;

  // Uncommitted changes modal
  uncommittedModal: { open: boolean; loopId: string | null; error: UncommittedChangesError | null };
  onCloseUncommittedModal: () => void;
  setUncommittedModal: (state: { open: boolean; loopId: string | null; error: UncommittedChangesError | null }) => void;

  // Rename modal
  renameModal: { open: boolean; loopId: string | null };
  onCloseRenameModal: () => void;
  onRename: (loopId: string, newName: string) => Promise<void>;

  // App settings modal
  showServerSettingsModal: boolean;
  onCloseServerSettingsModal: () => void;
  onResetAll: () => Promise<boolean>;
  appSettingsResetting: boolean;
  onKillServer: () => Promise<boolean>;
  appSettingsKilling: boolean;
  onExportConfig: () => Promise<WorkspaceExportData | null>;
  onImportConfig: (data: WorkspaceExportData) => Promise<WorkspaceImportResult | null>;
  workspaceCreating: boolean;

  // Workspace settings modal
  workspaceSettingsModal: { open: boolean; workspaceId: string | null };
  onCloseWorkspaceSettingsModal: () => void;
  workspaceFromHook: UseWorkspaceServerSettingsResult["workspace"];
  workspaceStatus: UseWorkspaceServerSettingsResult["status"];
  workspaceSettingsSaving: boolean;
  workspaceSettingsTesting: boolean;
  workspaceSettingsResetting: boolean;
  testWorkspaceConnection: UseWorkspaceServerSettingsResult["testConnection"];
  resetWorkspaceConnection: UseWorkspaceServerSettingsResult["resetConnection"];
  updateWorkspaceSettings: UseWorkspaceServerSettingsResult["updateWorkspace"];
  refreshWorkspaces: () => Promise<void>;
  remoteOnly: boolean;

  // Create workspace modal
  showCreateWorkspaceModal: boolean;
  onCloseCreateWorkspaceModal: () => void;
  onCreateWorkspace: (request: CreateWorkspaceRequest) => Promise<Workspace | null>;
}

export function DashboardModals(props: DashboardModalsProps) {
  const toast = useToast();

  // Compute create/edit modal state
  const editLoop = props.editDraftId ? props.loops.find((l) => l.config.id === props.editDraftId) : null;
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
    <>
      {/* Create/Edit loop modal */}
      <Modal
        isOpen={props.showCreateModal}
        onClose={props.onCloseCreateModal}
        title={isEditing ? "Edit Draft Loop" : "Create New Loop"}
        description={isEditing ? "Update your draft loop configuration." : "Configure a new Ralph Loop for autonomous AI development."}
        size="lg"
        footer={props.formActionState && (
          <>
            {/* Left side - Save as Draft / Update Draft button */}
            {(!props.formActionState.isEditing || props.formActionState.isEditingDraft) && (
              <Button
                type="button"
                variant="secondary"
                onClick={props.formActionState.onSaveAsDraft}
                disabled={props.formActionState.isSubmitting || !props.formActionState.canSaveDraft}
                loading={props.formActionState.isSubmitting}
                className="sm:mr-auto"
              >
                {props.formActionState.isEditingDraft ? "Update Draft" : "Save as Draft"}
              </Button>
            )}

            {/* Right side - Cancel and Create/Start buttons */}
            <Button
              type="button"
              variant="ghost"
              onClick={props.formActionState.onCancel}
              disabled={props.formActionState.isSubmitting}
            >
              Cancel
            </Button>
            <Button
              type="button"
              onClick={props.formActionState.onSubmit}
              loading={props.formActionState.isSubmitting}
              disabled={!props.formActionState.canSubmit}
            >
              {props.formActionState.isEditing
                ? (props.formActionState.planMode ? "Start Plan" : "Start Loop")
                : (props.formActionState.planMode ? "Create Plan" : "Create Loop")
              }
            </Button>
          </>
        )}
      >
        <CreateLoopForm
          key={isEditing ? editLoop!.config.id : "create-new"}
          editLoopId={isEditing ? editLoop!.config.id : undefined}
          initialLoopData={initialLoopData}
          isEditingDraft={isEditingDraft}
          renderActions={props.setFormActionState}
          onSubmit={async (request) => {
            return await handleCreateLoopSubmit(props, editLoop, request, toast);
          }}
          onCancel={props.onCloseCreateModal}
          models={props.models}
          modelsLoading={props.modelsLoading}
          lastModel={props.lastModel}
          onWorkspaceChange={props.onWorkspaceChange}
          planningWarning={props.planningWarning}
          branches={props.branches}
          branchesLoading={props.branchesLoading}
          currentBranch={props.currentBranch}
          defaultBranch={props.defaultBranch}
          workspaces={props.workspaces}
          workspacesLoading={props.workspacesLoading}
          workspaceError={props.workspaceError}
        />
      </Modal>

      {/* Uncommitted changes modal */}
      <UncommittedChangesModal
        isOpen={props.uncommittedModal.open}
        onClose={props.onCloseUncommittedModal}
        error={props.uncommittedModal.error}
      />

      {/* App Settings modal */}
      <AppSettingsModal
        isOpen={props.showServerSettingsModal}
        onClose={props.onCloseServerSettingsModal}
        onResetAll={props.onResetAll}
        resetting={props.appSettingsResetting}
        onKillServer={props.onKillServer}
        killingServer={props.appSettingsKilling}
        onExportConfig={props.onExportConfig}
        onImportConfig={props.onImportConfig}
        configSaving={props.workspaceCreating}
      />

      {/* Rename Loop modal */}
      <RenameLoopModal
        isOpen={props.renameModal.open}
        onClose={props.onCloseRenameModal}
        currentName={props.loops.find(l => l.config.id === props.renameModal.loopId)?.config.name ?? ""}
        onRename={async (newName) => {
          if (props.renameModal.loopId) {
            await props.onRename(props.renameModal.loopId, newName);
          }
        }}
      />

      {/* Workspace Settings modal */}
      <WorkspaceSettingsModal
        isOpen={props.workspaceSettingsModal.open}
        onClose={props.onCloseWorkspaceSettingsModal}
        workspace={props.workspaceFromHook}
        status={props.workspaceStatus}
        onSave={async (name, settings) => {
          if (!props.workspaceSettingsModal.workspaceId) return false;
          const success = await props.updateWorkspaceSettings(name, settings);
          if (success) {
            await props.refreshWorkspaces();
          }
          return success;
        }}
        onTest={props.testWorkspaceConnection}
        onResetConnection={props.resetWorkspaceConnection}
        saving={props.workspaceSettingsSaving}
        testing={props.workspaceSettingsTesting}
        resettingConnection={props.workspaceSettingsResetting}
        remoteOnly={props.remoteOnly}
      />

      {/* Create Workspace modal */}
      <CreateWorkspaceModal
        isOpen={props.showCreateWorkspaceModal}
        onClose={props.onCloseCreateWorkspaceModal}
        onCreate={async (request) => {
          const result = await props.onCreateWorkspace(request);
          return !!result;
        }}
        creating={props.workspaceCreating}
        error={props.workspaceError}
        remoteOnly={props.remoteOnly}
      />
    </>
  );
}

/** Handles the create/edit loop form submission logic */
async function handleCreateLoopSubmit(
  props: DashboardModalsProps,
  editLoop: Loop | null | undefined,
  request: CreateLoopRequest,
  toast: { error: (msg: string) => void },
): Promise<boolean> {
  const isEditing = !!editLoop;

  // If editing a draft
  if (isEditing && editLoop) {
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

        await props.onRefresh();
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

        if (error.error === "uncommitted_changes") {
          props.setUncommittedModal({
            open: true,
            loopId: editLoop.config.id,
            error: error.message,
          });
          return true;
        }

        log.error("Failed to start draft:", error);
        toast.error("Failed to start loop");
        return false;
      }

      await props.onRefresh();
      return true;
    } catch (error) {
      log.error("Failed to start draft:", error);
      toast.error("Failed to start loop");
      return false;
    }
  }

  // Otherwise, create a new loop
  const result = await props.onCreateLoop(request);

  if (result.startError) {
    props.setUncommittedModal({
      open: true,
      loopId: result.loop?.config.id ?? null,
      error: result.startError,
    });
    return true;
  }

  if (result.loop) {
    await props.onRefresh();

    if (request.model) {
      props.setLastModel(request.model);
    }

    if (request.workspaceId) {
      const workspace = props.workspaces.find(w => w.id === request.workspaceId);
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
    return true;
  }

  return false;
}
