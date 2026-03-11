/**
 * Modal for creating a persistent SSH session.
 */

import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import type { CreateSshSessionRequest, SshSession, Workspace } from "../types";
import { Modal, Button } from "./common";
import { WorkspaceSelector } from "./WorkspaceSelector";
import { useToast } from "../hooks";
import { buildDefaultSshSessionName } from "../utils";

export interface CreateSshSessionModalProps {
  isOpen: boolean;
  onClose: () => void;
  onCreate: (request: CreateSshSessionRequest) => Promise<SshSession | null>;
  sessions: SshSession[];
  workspaces: Workspace[];
  workspacesLoading: boolean;
  workspaceError: string | null;
  onCreated: (sessionId: string) => void;
}

export function CreateSshSessionModal({
  isOpen,
  onClose,
  onCreate,
  sessions,
  workspaces,
  workspacesLoading,
  workspaceError,
  onCreated,
}: CreateSshSessionModalProps) {
  const toast = useToast();
  const sshWorkspaces = useMemo(
    () => workspaces.filter((workspace) => workspace.serverSettings.agent.transport === "ssh"),
    [workspaces],
  );
  const [name, setName] = useState("");
  const [nameTouched, setNameTouched] = useState(false);
  const [workspaceId, setWorkspaceId] = useState<string | undefined>(sshWorkspaces[0]?.id);
  const [directory, setDirectory] = useState(sshWorkspaces[0]?.directory ?? "");
  const [submitting, setSubmitting] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);
  const selectedWorkspace = useMemo(
    () => sshWorkspaces.find((workspace) => workspace.id === workspaceId),
    [sshWorkspaces, workspaceId],
  );
  const defaultName = useMemo(() => {
    if (!selectedWorkspace) {
      return "";
    }
    const existingSessionCount = sessions.filter((session) => {
      return session.config.workspaceId === selectedWorkspace.id;
    }).length;
    return buildDefaultSshSessionName(selectedWorkspace.name, existingSessionCount);
  }, [selectedWorkspace, sessions]);

  useEffect(() => {
    if (!isOpen) {
      return;
    }
    const initialWorkspace = sshWorkspaces[0];
    setWorkspaceId(initialWorkspace?.id);
    setDirectory(initialWorkspace?.directory ?? "");
    setNameTouched(false);
  }, [isOpen, sshWorkspaces]);

  useEffect(() => {
    if (!isOpen || nameTouched) {
      return;
    }
    setName(defaultName);
  }, [defaultName, isOpen, nameTouched]);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!workspaceId) {
      toast.error("Select an SSH workspace to continue.");
      return;
    }
    try {
      setSubmitting(true);
      const trimmedName = name.trim();
      const session = await onCreate({
        workspaceId,
        ...(nameTouched && trimmedName.length > 0 ? { name: trimmedName } : {}),
      });
      if (!session) {
        return;
      }
      onClose();
      onCreated(session.config.id);
    } catch (error) {
      toast.error(String(error));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="New SSH Session"
      description="Create a persistent tmux-backed terminal session for an SSH workspace."
      size="md"
      footer={(
        <>
          <Button variant="ghost" onClick={onClose} disabled={submitting}>
            Cancel
          </Button>
          <Button onClick={() => formRef.current?.requestSubmit()} loading={submitting}>
            Create Session
          </Button>
        </>
      )}
    >
      <form ref={formRef} className="space-y-4" onSubmit={(e) => void handleSubmit(e)}>
        <WorkspaceSelector
          workspaces={sshWorkspaces}
          loading={workspacesLoading}
          selectedWorkspaceId={workspaceId}
          onSelect={(selectedId, selectedDirectory) => {
            setWorkspaceId(selectedId ?? undefined);
            setDirectory(selectedDirectory);
            setNameTouched(false);
          }}
          error={workspaceError}
        />
        {sshWorkspaces.length === 0 && (
          <p className="text-sm text-amber-600 dark:text-amber-400">
            Create or configure a workspace with SSH transport before starting an SSH session.
          </p>
        )}
        <div>
          <label
            htmlFor="ssh-session-name"
            className="block text-sm font-medium text-gray-700 dark:text-gray-300"
          >
            Session name
          </label>
          <input
            id="ssh-session-name"
            type="text"
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              setNameTouched(true);
            }}
            className="mt-1 block w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-gray-900 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 text-sm"
          />
        </div>
        {directory && (
          <p className="text-xs font-mono text-gray-500 dark:text-gray-400 break-all">
            Remote working directory: {directory}
          </p>
        )}
      </form>
    </Modal>
  );
}
