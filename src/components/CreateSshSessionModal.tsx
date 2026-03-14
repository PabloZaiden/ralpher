/**
 * Modal for creating a workspace SSH session by choosing the target workspace.
 */

import { useEffect, useState, type FormEvent } from "react";
import { Button, Modal } from "./common";
import { WorkspaceSelector } from "./WorkspaceSelector";
import type { Workspace } from "../types";

export interface CreateSshSessionModalProps {
  isOpen: boolean;
  onClose: () => void;
  workspaces: Workspace[];
  onCreate: (workspaceId: string) => Promise<void>;
  loading?: boolean;
  error?: string | null;
}

export function CreateSshSessionModal({
  isOpen,
  onClose,
  workspaces,
  onCreate,
  loading = false,
  error,
}: CreateSshSessionModalProps) {
  const [selectedWorkspaceId, setSelectedWorkspaceId] = useState<string | undefined>(undefined);

  useEffect(() => {
    if (!isOpen) {
      return;
    }
    setSelectedWorkspaceId(workspaces[0]?.id);
  }, [isOpen, workspaces]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedWorkspaceId) {
      return;
    }
    await onCreate(selectedWorkspaceId);
  }

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Create SSH Session"
      description="Choose which SSH workspace should receive the new session."
      size="sm"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={loading}>
            Cancel
          </Button>
          <Button
            type="submit"
            form="create-ssh-session-form"
            loading={loading}
            disabled={!selectedWorkspaceId}
          >
            Create SSH Session
          </Button>
        </>
      }
    >
      <form id="create-ssh-session-form" onSubmit={handleSubmit} className="space-y-4">
        <WorkspaceSelector
          workspaces={workspaces}
          selectedWorkspaceId={selectedWorkspaceId}
          onSelect={(workspaceId) => setSelectedWorkspaceId(workspaceId ?? undefined)}
          error={error}
        />
      </form>
    </Modal>
  );
}

export default CreateSshSessionModal;
