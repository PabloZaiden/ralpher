/**
 * Create/Edit Loop Modal — handles the create and draft-edit loop workflow,
 * including delete-draft confirmation and form submission.
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
  SshServer,
} from "../../types";
import {
  CreateLoopForm,
  getComposeDraftActionLabel,
  getComposeSubmitActionLabel,
} from "../CreateLoopForm";
import type { CreateLoopFormActionState, CreateLoopFormSubmitRequest } from "../CreateLoopForm";
import type { CreateLoopResult, CreateChatResult } from "../../hooks/useLoops";
import { Modal, Button } from "../common";
import { createLogger } from "../../lib/logger";
import { useToast } from "../../hooks";
import { appFetch } from "../../lib/public-path";
import { DEFAULT_LOOP_CONFIG } from "../../types/loop";

const log = createLogger("DashboardModals");

export interface CreateEditLoopModalProps {
  loops: Loop[];
  sshServers: SshServer[];

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
  workspaces: Workspace[];
  workspacesLoading: boolean;
  workspaceError: string | null;
  setUncommittedModal: (state: { open: boolean; loopId: string | null; error: UncommittedChangesError | null }) => void;
}

export function CreateEditLoopModal(props: CreateEditLoopModalProps) {
  const toast = useToast();
  const [deleteDraftConfirmation, setDeleteDraftConfirmation] = useState<{ loopId: string; loopName: string } | null>(null);
  const [deletingDraft, setDeletingDraft] = useState(false);

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
                Delete
              </Button>
          </>
        ) : (
          <>
            <Button
              type="button"
              variant="ghost"
              onClick={props.formActionState.onCancel}
              disabled={props.formActionState.isSubmitting}
            >
              Cancel
            </Button>
            {props.formActionState.isEditingDraft && (
              <Button
                type="button"
                variant="danger"
                onClick={openDeleteDraftConfirmation}
                disabled={props.formActionState.isSubmitting}
              >
                Delete
              </Button>
            )}
            {!isChatMode && (!props.formActionState.isEditing || props.formActionState.isEditingDraft) && (
              <Button
                type="button"
                variant="secondary"
                onClick={props.formActionState.onSaveAsDraft}
                disabled={props.formActionState.isSubmitting || !props.formActionState.canSaveDraft}
                loading={props.formActionState.isSubmitting}
              >
                {getComposeDraftActionLabel(props.formActionState.isEditingDraft)}
              </Button>
            )}
              <Button
                type="button"
                onClick={props.formActionState.onSubmit}
                loading={props.formActionState.isSubmitting}
                disabled={!props.formActionState.canSubmit}
              >
                {getComposeSubmitActionLabel({
                  isChatMode,
                  isEditing: props.formActionState.isEditing,
                })}
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
  );
}

function isCreateLoopRequest(request: CreateLoopFormSubmitRequest): request is CreateLoopRequest {
  return "name" in request;
}

async function handleCreateLoopSubmit(
  props: CreateEditLoopModalProps,
  editLoop: Loop | null | undefined,
  request: CreateLoopRequest,
  toast: { error: (msg: string) => void },
): Promise<boolean> {
  const isEditing = !!editLoop;

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

    if (request.draft) {
      return await persistDraftChanges();
    }

    const persisted = await persistDraftChanges();
    if (!persisted) {
      return false;
    }

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

async function handleCreateChatSubmit(
  props: CreateEditLoopModalProps,
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
