/**
 * Dashboard modal renderings — aggregates all modal components used in the Dashboard.
 */

import { useEffect, useState } from "react";
import type {
  Loop,
  UncommittedChangesError,
  ModelInfo,
  BranchInfo,
  Workspace,
  CreateLoopRequest,
  CreateChatRequest,
  SshSession,
  SshServer,
} from "../types";
import type { WorkspaceExportData, WorkspaceImportResult, CreateWorkspaceRequest } from "../types/workspace";
import type { CreateLoopFormActionState } from "./CreateLoopForm";
import type { PurgeArchivedLoopsResult } from "../hooks";
import type { CreateLoopResult, CreateChatResult } from "../hooks/useLoops";
import type { UseWorkspaceServerSettingsResult } from "../hooks/useWorkspaceServerSettings";
import { Modal, Button } from "./common";
import { CreateLoopForm } from "./CreateLoopForm";
import type { CreateLoopFormSubmitRequest } from "./CreateLoopForm";
import {
  UncommittedChangesModal,
  RenameLoopModal,
} from "./LoopModals";
import { AppSettingsModal } from "./AppSettingsModal";
import { RenameSshSessionModal } from "./RenameSshSessionModal";
import { WorkspaceSettingsModal } from "./WorkspaceSettingsModal";
import { CreateWorkspaceModal } from "./CreateWorkspaceModal";
import { createLogger } from "../lib/logger";
import { useToast } from "../hooks";
import { appFetch } from "../lib/public-path";
import { DEFAULT_LOOP_CONFIG } from "../types/loop";

const log = createLogger("DashboardModals");

export interface DashboardModalsProps {
  loops: Loop[];
  sshSessions: SshSession[];
  workspaces: Workspace[];
  workspacesLoading: boolean;
  workspaceError: string | null;

  // Create/Edit modal
  showCreateModal: boolean;
  editDraftId: string | null;
  createMode: "loop" | "chat";
  formActionState: CreateLoopFormActionState | null;
  setFormActionState: (state: CreateLoopFormActionState | null) => void;
  onCloseCreateModal: () => void;
  onCreateLoop: (request: CreateLoopRequest) => Promise<CreateLoopResult>;
  onCreateChat: (request: CreateChatRequest) => Promise<CreateChatResult>;
  onDeleteDraft: (loopId: string) => Promise<boolean>;
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
  sshSessionRenameModal: { open: boolean; sessionId: string | null };
  onCloseSshSessionRenameModal: () => void;
  onRenameSshSession: (sessionId: string, newName: string) => Promise<void>;

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
  workspaceArchivedLoopsPurging: boolean;
  testWorkspaceConnection: UseWorkspaceServerSettingsResult["testConnection"];
  resetWorkspaceConnection: UseWorkspaceServerSettingsResult["resetConnection"];
  updateWorkspaceSettings: UseWorkspaceServerSettingsResult["updateWorkspace"];
  archivedLoopCount: number;
  workspaceLoopCount: number;
  purgeArchivedWorkspaceLoops: (workspaceId: string) => Promise<PurgeArchivedLoopsResult>;
  onDeleteWorkspace: (workspaceId: string) => Promise<{ success: boolean; error?: string }>;
  refreshWorkspaces: () => Promise<void>;
  remoteOnly: boolean;

  // Create workspace modal
  showCreateWorkspaceModal: boolean;
  onCloseCreateWorkspaceModal: () => void;
  onCreateWorkspace: (request: CreateWorkspaceRequest) => Promise<Workspace | null>;
  onProvisioningSuccess?: () => Promise<void>;
  sshServers: SshServer[];
}

export function DashboardModals(props: DashboardModalsProps) {
  const toast = useToast();
  const [deleteDraftConfirmation, setDeleteDraftConfirmation] = useState<{ loopId: string; loopName: string } | null>(null);
  const [deletingDraft, setDeletingDraft] = useState(false);

  // Compute create/edit modal state
  const editLoop = props.editDraftId ? props.loops.find((l) => l.config.id === props.editDraftId) : null;
  const isEditing = !!editLoop;
  const isEditingDraft = editLoop?.state.status === "draft";
  const isChatMode = props.createMode === "chat";
  const isConfirmingDraftDelete = deleteDraftConfirmation !== null;

  useEffect(() => {
    if (!props.showCreateModal) {
      setDeleteDraftConfirmation(null);
      setDeletingDraft(false);
    }
  }, [props.showCreateModal]);

  function openDeleteDraftConfirmation(): void {
    if (!editLoop) {
      props.onCloseCreateModal();
      toast.error("Draft could not be deleted because it no longer exists.");
      return;
    }

    setDeleteDraftConfirmation({
      loopId: editLoop.config.id,
      loopName: editLoop.config.name,
    });
  }

  async function handleDeleteDraft(): Promise<void> {
    if (!deleteDraftConfirmation) {
      return;
    }

    setDeletingDraft(true);
    try {
      const success = await props.onDeleteDraft(deleteDraftConfirmation.loopId);
      if (!success) {
        toast.error("Failed to delete draft");
        return;
      }

      setDeleteDraftConfirmation(null);
      props.onCloseCreateModal();
    } finally {
      setDeletingDraft(false);
    }
  }

  // Modal titles/descriptions based on mode
  const modalTitle = isConfirmingDraftDelete
    ? "Edit Draft Loop"
    : isEditing
    ? "Edit Draft Loop"
    : isChatMode
      ? "New Chat"
      : "Create New Loop";
  const modalDescription = isConfirmingDraftDelete
    ? "Confirm whether you want to permanently remove this draft from the dashboard."
    : isEditing
    ? "Update your draft loop configuration."
    : isChatMode
      ? "Start an interactive conversation with your workspace."
      : "Configure a new Ralph Loop for autonomous AI development.";

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
    useWorktree: editLoop.config.useWorktree,
    clearPlanningFolder: editLoop.config.clearPlanningFolder,
    planMode: editLoop.config.planMode ?? false,
    planModeAutoReply: editLoop.config.planModeAutoReply ?? DEFAULT_LOOP_CONFIG.planModeAutoReply,
    workspaceId: editLoop.config.workspaceId,
  } : null;

  return (
    <>
      {/* Create/Edit modal */}
      <Modal
        isOpen={props.showCreateModal}
        onClose={props.onCloseCreateModal}
        title={modalTitle}
        description={modalDescription}
        size="lg"
        footer={props.formActionState && (
          isConfirmingDraftDelete ? (
            <>
              <Button
                type="button"
                variant="ghost"
                onClick={() => setDeleteDraftConfirmation(null)}
                disabled={deletingDraft}
              >
                Keep Draft
              </Button>
              <Button
                type="button"
                variant="danger"
                onClick={handleDeleteDraft}
                loading={deletingDraft}
              >
                Delete Draft
              </Button>
            </>
          ) : (
            <>
              {props.formActionState.isEditingDraft && (
                <Button
                  type="button"
                  variant="danger"
                  onClick={openDeleteDraftConfirmation}
                  disabled={props.formActionState.isSubmitting}
                >
                  Delete Draft
                </Button>
              )}
              <Button
                type="button"
                variant="ghost"
                onClick={props.formActionState.onCancel}
                disabled={props.formActionState.isSubmitting}
              >
                Cancel
              </Button>
              {!isChatMode && (!props.formActionState.isEditing || props.formActionState.isEditingDraft) && (
                <Button
                  type="button"
                  variant="secondary"
                  onClick={props.formActionState.onSaveAsDraft}
                  disabled={props.formActionState.isSubmitting || !props.formActionState.canSaveDraft}
                  loading={props.formActionState.isSubmitting}
                >
                  {props.formActionState.isEditingDraft ? "Update Draft" : "Save as Draft"}
                </Button>
              )}
              <Button
                type="button"
                onClick={props.formActionState.onSubmit}
                loading={props.formActionState.isSubmitting}
                disabled={!props.formActionState.canSubmit}
              >
                {isChatMode
                  ? "Start Chat"
                  : props.formActionState.isEditing
                    ? (props.formActionState.planMode ? "Start Plan" : "Start Loop")
                    : (props.formActionState.planMode ? "Create Plan" : "Create Loop")
                }
              </Button>
            </>
          )
        )}
      >
        {isConfirmingDraftDelete ? (
          <div className="rounded-lg border border-red-200 bg-red-50 p-4 dark:border-red-900/60 dark:bg-red-950/30">
             <h3 className="text-sm font-semibold text-red-800 dark:text-red-200">
               Delete Draft?
             </h3>
             <p className="mt-2 text-sm text-red-700 dark:text-red-300">
               Are you sure you want to permanently delete "{deleteDraftConfirmation.loopName}"?
             </p>
           </div>
        ) : (
          <CreateLoopForm
            key={isEditing ? editLoop!.config.id : `create-new-${props.createMode}`}
            editLoopId={isEditing ? editLoop!.config.id : undefined}
            initialLoopData={initialLoopData}
            isEditingDraft={isEditingDraft}
            renderActions={props.setFormActionState}
            mode={props.createMode}
            onSubmit={async (request) => {
              if (isChatMode) {
                if (isCreateLoopRequest(request)) {
                  throw new Error("Expected chat submission request");
                }
                return await handleCreateChatSubmit(props, request, toast);
              }
              if (!isCreateLoopRequest(request)) {
                throw new Error("Expected loop submission request");
              }
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
            registeredSshServers={props.sshServers}
          />
        )}
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

      <RenameSshSessionModal
        isOpen={props.sshSessionRenameModal.open}
        onClose={props.onCloseSshSessionRenameModal}
        currentName={props.sshSessions.find((session) => session.config.id === props.sshSessionRenameModal.sessionId)?.config.name ?? ""}
        onRename={async (newName) => {
          if (props.sshSessionRenameModal.sessionId) {
            await props.onRenameSshSession(props.sshSessionRenameModal.sessionId, newName);
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
        onPurgeArchivedLoops={async () => {
          if (!props.workspaceSettingsModal.workspaceId) {
            return {
              success: false,
              workspaceId: "",
              totalArchived: 0,
              purgedCount: 0,
              purgedLoopIds: [],
              failures: [],
            };
          }
          return await props.purgeArchivedWorkspaceLoops(props.workspaceSettingsModal.workspaceId);
        }}
        onDeleteWorkspace={async () => {
          if (!props.workspaceSettingsModal.workspaceId) {
            return {
              success: false,
              error: "Workspace settings are unavailable right now.",
            };
          }
          return await props.onDeleteWorkspace(props.workspaceSettingsModal.workspaceId);
        }}
        archivedLoopCount={props.archivedLoopCount}
        workspaceLoopCount={props.workspaceLoopCount}
        saving={props.workspaceSettingsSaving}
        testing={props.workspaceSettingsTesting}
        resettingConnection={props.workspaceSettingsResetting}
        purgingArchivedLoops={props.workspaceArchivedLoopsPurging}
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
        registeredSshServers={props.sshServers}
        onProvisioningSuccess={props.onProvisioningSuccess}
      />

    </>
  );
}

/** Handles the create/edit loop form submission logic */
function isCreateLoopRequest(request: CreateLoopFormSubmitRequest): request is CreateLoopRequest {
  return "name" in request;
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
    const persistDraftChanges = async (): Promise<boolean> => {
      try {
        const response = await appFetch(`/api/loops/${editLoop.config.id}`, {
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
    };

    // If draft flag is set, this is an "Update Draft" action
    if (request.draft) {
      return await persistDraftChanges();
    }

    const persisted = await persistDraftChanges();
    if (!persisted) {
      return false;
    }

    // Otherwise, this is a "Start Loop" action - transition draft to execution
    try {
      const startResponse = await appFetch(`/api/loops/${editLoop.config.id}/draft/start`, {
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
          await appFetch("/api/preferences/last-directory", {
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

/** Handles the create chat form submission logic */
async function handleCreateChatSubmit(
  props: DashboardModalsProps,
  request: CreateChatRequest,
  toast: { error: (msg: string) => void },
): Promise<boolean> {
  const result = await props.onCreateChat(request);

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
          await appFetch("/api/preferences/last-directory", {
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

  toast.error("Failed to create chat");
  return false;
}
