import { useEffect, useRef, useState, type FormEvent } from "react";
import type { SshServer, SshServerSession } from "../types";
import { Button, Modal } from "./common";
import { useToast } from "../hooks";

export interface CreateStandaloneSshSessionModalProps {
  isOpen: boolean;
  server: SshServer | null;
  hasStoredCredential: boolean;
  onClose: () => void;
  onCreate: (serverId: string, options?: { name?: string; password?: string }) => Promise<SshServerSession | null>;
  onCreated: (sessionId: string) => void;
}

export function CreateStandaloneSshSessionModal({
  isOpen,
  server,
  hasStoredCredential,
  onClose,
  onCreate,
  onCreated,
}: CreateStandaloneSshSessionModalProps) {
  const toast = useToast();
  const formRef = useRef<HTMLFormElement>(null);
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!isOpen) {
      return;
    }
    setName("");
    setPassword("");
  }, [isOpen, server?.config.id]);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!server) {
      toast.error("Select a server first.");
      return;
    }
    if (!hasStoredCredential && !password.trim()) {
      toast.error("Enter the SSH password for this server or save it in this browser first.");
      return;
    }
    try {
      setSubmitting(true);
      const session = await onCreate(server.config.id, {
        name: name.trim() || undefined,
        password: password.trim() || undefined,
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
      title="New Standalone SSH Session"
      description={server
        ? `Create a tmux-backed session on ${server.config.username}@${server.config.address}.`
        : "Create a tmux-backed standalone SSH session."}
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
      <form ref={formRef} className="space-y-4" onSubmit={(event) => void handleSubmit(event)}>
        <div>
          <label htmlFor="standalone-ssh-session-name" className="block text-sm font-medium text-gray-700 dark:text-gray-300">
            Session name (optional)
          </label>
          <input
            id="standalone-ssh-session-name"
            type="text"
            value={name}
            onChange={(event) => setName(event.target.value)}
            className="mt-1 block w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100"
          />
        </div>
        <div>
          <label htmlFor="standalone-ssh-session-password" className="block text-sm font-medium text-gray-700 dark:text-gray-300">
            SSH password {hasStoredCredential ? "(leave blank to use saved browser password)" : ""}
          </label>
          <input
            id="standalone-ssh-session-password"
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            className="mt-1 block w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100"
          />
          <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
            {hasStoredCredential
              ? "A compatible encrypted password is already saved in this browser."
              : "This browser does not have a saved password for the selected server yet."}
          </p>
        </div>
      </form>
    </Modal>
  );
}
