import { useEffect, useId, useState, type FormEvent } from "react";
import type { Loop, SshConnectionMode, SshServer, Workspace } from "../../types";
import { appFetch } from "../../lib/public-path";
import {
  useDashboardData,
  useSshServers,
  useSshSessions,
  useToast,
} from "../../hooks";
import {
  CreateLoopForm,
  getComposeDraftActionLabel,
  getComposeSubmitActionLabel,
  type CreateLoopFormActionState,
  type CreateLoopFormSubmitRequest,
} from "../CreateLoopForm";
import { WorkspaceSelector } from "../WorkspaceSelector";
import {
  Badge,
  Button,
  ConfirmModal,
  PASSWORD_INPUT_PROPS,
} from "../common";
import type { ShellRoute } from "./shell-types";
import { ShellPanel, InlineField } from "./shell-panel";
import type { CreateLoopRequest } from "../../types";

export function DraftLoopComposer({
  loop,
  workspaces,
  models,
  modelsLoading,
  lastModel,
  onWorkspaceChange,
  planningWarning,
  branches,
  branchesLoading,
  currentBranch,
  defaultBranch,
  registeredSshServers,
  workspaceError,
  workspacesLoading,
  headerOffsetClassName,
  onRefresh,
  onDeleteDraft,
  onNavigate,
}: {
  loop: Loop;
  workspaces: Workspace[];
  models: ReturnType<typeof useDashboardData>["models"];
  modelsLoading: boolean;
  lastModel: ReturnType<typeof useDashboardData>["lastModel"];
  onWorkspaceChange: ReturnType<typeof useDashboardData>["handleWorkspaceChange"];
  planningWarning: string | null;
  branches: ReturnType<typeof useDashboardData>["branches"];
  branchesLoading: boolean;
  currentBranch: string;
  defaultBranch: string;
  registeredSshServers: readonly SshServer[];
  workspaceError: string | null;
  workspacesLoading: boolean;
  headerOffsetClassName?: string;
  onRefresh: () => Promise<void>;
  onDeleteDraft: (id: string) => Promise<boolean>;
  onNavigate: (route: ShellRoute) => void;
}) {
  const toast = useToast();
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [deleteSubmitting, setDeleteSubmitting] = useState(false);
  const [startConflict, setStartConflict] = useState<{ message: string; changedFiles: string[] } | null>(null);
  const [actionState, setActionState] = useState<CreateLoopFormActionState | null>(null);

  const selectedWorkspace = workspaces.find((workspace) => workspace.id === loop.config.workspaceId) ?? null;
  const exitRoute = selectedWorkspace
    ? { view: "workspace", workspaceId: selectedWorkspace.id } satisfies ShellRoute
    : { view: "home" } satisfies ShellRoute;

  function handleCancel() {
    setStartConflict(null);
    setDeleteConfirmOpen(false);
    onNavigate(exitRoute);
  }

  async function persistDraftChanges(request: CreateLoopRequest): Promise<boolean> {
    try {
      const response = await appFetch(`/api/loops/${loop.config.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(request),
      });

      if (!response.ok) {
        const error = await response.json() as { message?: string };
        toast.error(error.message || "Failed to update draft");
        return false;
      }

      await onRefresh();
      return true;
    } catch (error) {
      toast.error(String(error));
      return false;
    }
  }

  async function handleDraftSubmit(request: CreateLoopFormSubmitRequest): Promise<boolean> {
    if (!("name" in request)) {
      toast.error("Draft loops currently support loop mode only.");
      return false;
    }

    setStartConflict(null);
    const persisted = await persistDraftChanges(request);
    if (!persisted) {
      return false;
    }

    if (request.draft) {
      return true;
    }

    try {
      const response = await appFetch(`/api/loops/${loop.config.id}/draft/start`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ planMode: request.planMode ?? false }),
      });

      if (response.status === 409) {
        const error = await response.json() as { error?: string; message?: string; changedFiles?: string[] };
        if (error.error === "uncommitted_changes") {
          setStartConflict({
            message: error.message || "Directory has uncommitted changes.",
            changedFiles: error.changedFiles ?? [],
          });
          return false;
        }
      }

      if (!response.ok) {
        const error = await response.json() as { message?: string };
        toast.error(error.message || "Failed to start loop");
        return false;
      }

      await onRefresh();
      return true;
    } catch (error) {
      toast.error(String(error));
      return false;
    }
  }

  async function handleDeleteDraft() {
    setDeleteSubmitting(true);
    try {
      const deleted = await onDeleteDraft(loop.config.id);
      if (!deleted) {
        toast.error("Failed to delete draft");
        return;
      }
      onNavigate(exitRoute);
    } finally {
      setDeleteSubmitting(false);
    }
  }

  return (
    <ShellPanel
      eyebrow="Draft loop"
      title={`Edit ${loop.config.name}`}
      variant="compact"
      headerOffsetClassName={headerOffsetClassName}
      actions={(
        <>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={actionState?.onCancel ?? handleCancel}
            disabled={deleteSubmitting || actionState?.isSubmitting}
          >
            Cancel
          </Button>
          <Button
            type="button"
            variant="danger"
            size="sm"
            onClick={() => setDeleteConfirmOpen(true)}
            disabled={deleteSubmitting || actionState?.isSubmitting}
          >
            Delete
          </Button>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={actionState?.onSaveAsDraft}
            disabled={deleteSubmitting || !actionState?.canSaveDraft}
            loading={actionState?.isSubmitting ?? false}
          >
            {getComposeDraftActionLabel(true)}
          </Button>
          <Button
            type="button"
            size="sm"
            onClick={actionState?.onSubmit}
            disabled={deleteSubmitting || !actionState?.canSubmit}
            loading={actionState?.isSubmitting ?? false}
          >
            {getComposeSubmitActionLabel({
              isChatMode: false,
              isEditing: true,
            })}
          </Button>
        </>
      )}
    >
      {startConflict && (
        <div className="mb-6 rounded-2xl border border-amber-300 bg-amber-50 px-4 py-4 text-sm text-amber-950 dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-100">
          <p className="font-semibold">Cannot Start Loop</p>
          <p className="mt-1">{startConflict.message}</p>
          {startConflict.changedFiles.length > 0 && (
            <ul className="mt-3 list-disc space-y-1 pl-5 text-xs text-amber-800 dark:text-amber-200">
              {startConflict.changedFiles.map((filePath) => (
                <li key={filePath}>{filePath}</li>
              ))}
            </ul>
          )}
        </div>
      )}

      <CreateLoopForm
        onSubmit={handleDraftSubmit}
        onCancel={handleCancel}
        closeOnSuccess={false}
        models={models}
        modelsLoading={modelsLoading}
        lastModel={lastModel}
        onWorkspaceChange={onWorkspaceChange}
        planningWarning={planningWarning}
        branches={branches}
        branchesLoading={branchesLoading}
        currentBranch={currentBranch}
        defaultBranch={defaultBranch}
        editLoopId={loop.config.id}
        initialLoopData={{
          name: loop.config.name,
          directory: loop.config.directory,
          prompt: loop.config.prompt,
          model: loop.config.model,
          maxIterations: Number.isFinite(loop.config.maxIterations) ? loop.config.maxIterations : undefined,
          maxConsecutiveErrors: loop.config.maxConsecutiveErrors,
          activityTimeoutSeconds: loop.config.activityTimeoutSeconds,
          baseBranch: loop.config.baseBranch,
          useWorktree: loop.config.useWorktree,
          clearPlanningFolder: loop.config.clearPlanningFolder,
          planMode: loop.config.planMode,
          planModeAutoReply: loop.config.planModeAutoReply,
          workspaceId: loop.config.workspaceId,
        }}
        isEditingDraft
        workspaces={workspaces}
        workspacesLoading={workspacesLoading}
        workspaceError={workspaceError}
        registeredSshServers={registeredSshServers}
        renderActions={setActionState}
      />

      <ConfirmModal
        isOpen={deleteConfirmOpen}
        onClose={() => setDeleteConfirmOpen(false)}
        onConfirm={() => void handleDeleteDraft()}
        title="Delete Draft"
        message={`Are you sure you want to delete "${loop.config.name}"?`}
        confirmLabel="Delete Draft"
        loading={deleteSubmitting}
        variant="danger"
      />
    </ShellPanel>
  );
}

export function SshSessionComposer({
  workspaces,
  servers,
  initialWorkspaceId,
  initialServerId,
  headerOffsetClassName,
  onCancel,
  onNavigate,
  onCreateWorkspaceSession,
  onCreateStandaloneSession,
}: {
  workspaces: Workspace[];
  servers: SshServer[];
  initialWorkspaceId?: string;
  initialServerId?: string;
  headerOffsetClassName?: string;
  onCancel: () => void;
  onNavigate: (route: ShellRoute) => void;
  onCreateWorkspaceSession: ReturnType<typeof useSshSessions>["createSession"];
  onCreateStandaloneSession: ReturnType<typeof useSshServers>["createSession"];
}) {
  const toast = useToast();
  const formId = useId();
  const [targetType, setTargetType] = useState<"workspace" | "server">(
    initialWorkspaceId ? "workspace" : initialServerId ? "server" : (workspaces.length > 0 ? "workspace" : "server"),
  );
  const [selectedWorkspaceId, setSelectedWorkspaceId] = useState<string | undefined>(initialWorkspaceId ?? workspaces[0]?.id);
  const [selectedServerId, setSelectedServerId] = useState(initialServerId ?? servers[0]?.config.id ?? "");
  const [connectionMode, setConnectionMode] = useState<SshConnectionMode>("dtach");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!selectedWorkspaceId && (initialWorkspaceId || workspaces[0])) {
      setSelectedWorkspaceId(initialWorkspaceId ?? workspaces[0]?.id);
    }
  }, [initialWorkspaceId, selectedWorkspaceId, workspaces]);

  useEffect(() => {
    if (!selectedServerId && servers[0]) {
      setSelectedServerId(servers[0].config.id);
    }
  }, [selectedServerId, servers]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    try {
      if (targetType === "workspace") {
        if (!selectedWorkspaceId) {
          toast.error("Select an SSH workspace first.");
          return;
        }
        const session = await onCreateWorkspaceSession({
          workspaceId: selectedWorkspaceId,
          connectionMode,
        });
        onNavigate({ view: "ssh", sshSessionId: session.config.id });
        return;
      }

      if (!selectedServerId) {
        toast.error("Select a server first.");
        return;
      }

      const session = await onCreateStandaloneSession(selectedServerId, {
        connectionMode,
      });
      onNavigate({ view: "ssh", sshSessionId: session.config.id });
    } catch (error) {
      toast.error(String(error));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <ShellPanel
      eyebrow="SSH session"
      title="Create an SSH session"
      variant="compact"
      headerOffsetClassName={headerOffsetClassName}
      actions={(
        <>
          <Button type="button" variant="ghost" size="sm" onClick={onCancel} disabled={submitting}>
            Cancel
          </Button>
          <Button type="submit" form={formId} size="sm" loading={submitting}>
            Create SSH Session
          </Button>
        </>
      )}
    >
      <form id={formId} className="space-y-6" onSubmit={(event) => void handleSubmit(event)}>
        <div className="grid gap-4 lg:grid-cols-2">
          <div className="rounded-2xl border border-gray-200 bg-gray-50 p-4 dark:border-gray-800 dark:bg-neutral-950/50">
            <label htmlFor="ssh-target-type" className="block text-sm font-medium text-gray-700 dark:text-gray-300">
              Target type
            </label>
            <select
              id="ssh-target-type"
              value={targetType}
              onChange={(event) => setTargetType(event.target.value as "workspace" | "server")}
              className="mt-2 w-full rounded-xl border border-gray-300 bg-white px-3 py-2.5 text-sm text-gray-900 shadow-sm outline-none transition focus:border-gray-500 focus:ring-2 focus:ring-gray-300 dark:border-gray-700 dark:bg-neutral-800 dark:text-gray-100 dark:focus:border-gray-500 dark:focus:ring-gray-700"
            >
              <option value="workspace">Workspace</option>
              <option value="server">Standalone SSH server</option>
            </select>
          </div>
          <div className="rounded-2xl border border-gray-200 bg-gray-50 p-4 dark:border-gray-800 dark:bg-neutral-950/50">
            <label htmlFor="ssh-connection-mode" className="block text-sm font-medium text-gray-700 dark:text-gray-300">
              Connection mode
            </label>
            <select
              id="ssh-connection-mode"
              value={connectionMode}
              onChange={(event) => setConnectionMode(event.target.value as SshConnectionMode)}
              className="mt-2 w-full rounded-xl border border-gray-300 bg-white px-3 py-2.5 text-sm text-gray-900 shadow-sm outline-none transition focus:border-gray-500 focus:ring-2 focus:ring-gray-300 dark:border-gray-700 dark:bg-neutral-800 dark:text-gray-100 dark:focus:border-gray-500 dark:focus:ring-gray-700"
            >
              <option value="dtach">Persistent SSH</option>
              <option value="direct">Direct SSH</option>
            </select>
            <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">
              Persistent SSH survives reconnects; direct SSH is better for one-off debugging sessions.
            </p>
          </div>
        </div>

        {targetType === "workspace" ? (
          <div className="rounded-2xl border border-gray-200 bg-gray-50 p-4 dark:border-gray-800 dark:bg-neutral-950/50">
            <WorkspaceSelector
              workspaces={workspaces}
              selectedWorkspaceId={selectedWorkspaceId}
              onSelect={(workspaceId) => setSelectedWorkspaceId(workspaceId ?? undefined)}
              registeredSshServers={servers}
            />
          </div>
        ) : (
          <div className="rounded-2xl border border-gray-200 bg-gray-50 p-4 dark:border-gray-800 dark:bg-neutral-950/50">
            <label htmlFor="ssh-server" className="block text-sm font-medium text-gray-700 dark:text-gray-300">
              Server
            </label>
            <select
              id="ssh-server"
              value={selectedServerId}
              onChange={(event) => setSelectedServerId(event.target.value)}
              className="mt-2 w-full rounded-xl border border-gray-300 bg-white px-3 py-2.5 text-sm text-gray-900 shadow-sm outline-none transition focus:border-gray-500 focus:ring-2 focus:ring-gray-300 dark:border-gray-700 dark:bg-neutral-800 dark:text-gray-100 dark:focus:border-gray-500 dark:focus:ring-gray-700"
            >
              <option value="">Select a server…</option>
              {servers.map((server) => (
                <option key={server.config.id} value={server.config.id}>
                  {server.config.name} — {server.config.username}@{server.config.address}
                </option>
              ))}
            </select>
            {servers.length === 0 && (
              <p className="mt-2 text-sm text-amber-600 dark:text-amber-400">
                Register a standalone SSH server first.
              </p>
            )}
          </div>
        )}

      </form>
    </ShellPanel>
  );
}

export function SshServerComposer({
  headerOffsetClassName,
  onCancel,
  onNavigate,
  onCreateServer,
}: {
  headerOffsetClassName?: string;
  onCancel: () => void;
  onNavigate: (route: ShellRoute) => void;
  onCreateServer: ReturnType<typeof useSshServers>["createServer"];
}) {
  const toast = useToast();
  const formId = useId();
  const [name, setName] = useState("");
  const [address, setAddress] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!name.trim() || !address.trim() || !username.trim()) {
      toast.error("Name, address, and username are required.");
      return;
    }

    setSubmitting(true);
    try {
      const server = await onCreateServer(
        {
          name: name.trim(),
          address: address.trim(),
          username: username.trim(),
        },
        password.trim() || undefined,
      );
      if (!server) {
        toast.error("Failed to create SSH server");
        return;
      }
      onNavigate({ view: "ssh-server", serverId: server.config.id });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <ShellPanel
      eyebrow="SSH server"
      title="Register a standalone SSH server"
      variant="compact"
      headerOffsetClassName={headerOffsetClassName}
      badges={(
        <Badge variant="info" size="sm">Standalone SSH</Badge>
      )}
      actions={(
        <>
          <Button type="button" variant="ghost" size="sm" onClick={onCancel} disabled={submitting}>
            Cancel
          </Button>
          <Button type="submit" form={formId} size="sm" loading={submitting}>
            Create SSH Server
          </Button>
        </>
      )}
    >
      <form id={formId} className="space-y-6" onSubmit={(event) => void handleSubmit(event)}>
        <div className="grid gap-4 lg:grid-cols-2">
          <InlineField id="server-name" label="Server name" value={name} onChange={setName} placeholder="Production host" required />
          <InlineField id="server-address" label="Address" value={address} onChange={setAddress} placeholder="server.example.com" required />
          <InlineField id="server-username" label="Username" value={username} onChange={setUsername} placeholder="ubuntu" required />
          <InlineField
            id="server-password"
            label="Client-only password"
            value={password}
            onChange={setPassword}
            placeholder="Optional"
            type="password"
            help="Stored encrypted in this client to streamline persistent standalone sessions."
            inputProps={PASSWORD_INPUT_PROPS}
          />
        </div>
      </form>
    </ShellPanel>
  );
}
