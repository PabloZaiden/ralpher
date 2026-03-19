import { useMemo, useState } from "react";
import type { SshServer, SshServerSession, Workspace } from "../../types";
import { getServerLabel } from "../../types/settings";
import type { useLoopGrouping, useLoops, useSshSessions } from "../../hooks";
import { getLoopStatusLabel, shouldShowInRecentActivity } from "../../utils";
import {
  ActionMenu,
  Badge,
  Button,
  ConfirmModal,
  GearIcon,
  type ActionMenuItem,
  getStatusBadgeVariant,
} from "../common";
import type { ShellRoute } from "./shell-types";
import { ShellPanel, SummaryCard } from "./shell-panel";
import { EmptySection } from "./shell-sidebar";

export function OverviewView({
  loops,
  servers,
  sessionsByServerId,
  workspaceGroups,
  headerOffsetClassName,
  onNavigate,
}: {
  loops: ReturnType<typeof useLoops>["loops"];
  servers: SshServer[];
  sessionsByServerId: Record<string, SshServerSession[]>;
  workspaceGroups: ReturnType<typeof useLoopGrouping>["workspaceGroups"];
  headerOffsetClassName?: string;
  onNavigate: (route: ShellRoute) => void;
}) {
  const recentLoops = useMemo(() => {
    return loops
      .filter((loop) => shouldShowInRecentActivity(loop.state.status))
      .sort((left, right) => right.config.createdAt.localeCompare(left.config.createdAt))
      .slice(0, 5);
  }, [loops]);
  const serverMapItems = useMemo(() => {
    return servers.map((server) => ({
      server,
      sessionCount: sessionsByServerId[server.config.id]?.length ?? 0,
    }));
  }, [servers, sessionsByServerId]);

  return (
    <ShellPanel
      eyebrow="Overview"
      title="Ralpher"
      variant="compact"
      headerOffsetClassName={headerOffsetClassName}
    >
      <div className="space-y-6">
        <div
          data-testid="recent-activity-card"
          className="space-y-4 rounded-2xl border border-gray-200 bg-gray-50 p-5 dark:border-gray-800 dark:bg-neutral-950/50"
        >
          <div>
            <h2 className="text-lg font-semibold text-gray-950 dark:text-gray-100">Recent activity</h2>
            <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
              Jump back into active loops or chats from the overview.
            </p>
          </div>
          <div className="space-y-2">
            {recentLoops.length === 0 ? (
              <EmptySection message="Recent activity will appear here as you start work." />
            ) : (
              recentLoops.map((loop) => {
                const route: ShellRoute = loop.config.mode === "chat"
                  ? { view: "chat", chatId: loop.config.id }
                  : { view: "loop", loopId: loop.config.id };
                const label = getLoopStatusLabel(loop);
                return (
                  <button
                    key={loop.config.id}
                    type="button"
                    onClick={() => onNavigate(route)}
                    className="flex w-full min-w-0 items-start justify-between gap-3 rounded-2xl border border-gray-200 bg-white px-4 py-3 text-left transition hover:border-gray-300 hover:bg-gray-100 dark:border-gray-800 dark:bg-neutral-900 dark:hover:border-gray-700 dark:hover:bg-neutral-800"
                  >
                    <span className="flex min-w-0 flex-1 flex-col">
                      <span className="block break-words text-sm font-medium text-gray-900 dark:text-gray-100 [overflow-wrap:anywhere]">
                        {loop.config.name}
                      </span>
                      <span className="mt-1 block break-words text-xs text-gray-500 dark:text-gray-400 [overflow-wrap:anywhere]">
                        {loop.config.directory}
                      </span>
                    </span>
                    <Badge variant={getStatusBadgeVariant(loop.state.status)} className="shrink-0">
                      {label}
                    </Badge>
                  </button>
                );
              })
            )}
          </div>
        </div>

        <div className="space-y-4 rounded-2xl border border-gray-200 bg-gray-50 p-5 dark:border-gray-800 dark:bg-neutral-950/50">
          <div>
            <h2 className="text-lg font-semibold text-gray-950 dark:text-gray-100">Server maps</h2>
            <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
              Jump into saved SSH servers to review standalone sessions and start new terminals.
            </p>
          </div>
          <div className="space-y-2">
            {serverMapItems.length === 0 ? (
              <EmptySection message="No SSH servers yet. Register one to see it here." />
            ) : (
              serverMapItems.map(({ server, sessionCount }) => (
                <button
                  key={server.config.id}
                  type="button"
                  onClick={() => onNavigate({ view: "ssh-server", serverId: server.config.id })}
                  className="flex w-full min-w-0 items-start justify-between gap-3 rounded-2xl border border-gray-200 bg-white px-4 py-3 text-left transition hover:border-gray-300 hover:bg-gray-100 dark:border-gray-800 dark:bg-neutral-900 dark:hover:border-gray-700 dark:hover:bg-neutral-800"
                >
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="block break-words text-sm font-medium text-gray-900 dark:text-gray-100 [overflow-wrap:anywhere]">
                      {server.config.name}
                    </span>
                    <span className="mt-1 block break-words text-xs text-gray-500 dark:text-gray-400 [overflow-wrap:anywhere]">
                      {server.config.username}@{server.config.address}
                    </span>
                  </span>
                  <span className="shrink-0 rounded-full bg-gray-200 px-2 py-0.5 text-right text-xs font-semibold text-gray-600 dark:bg-neutral-800 dark:text-gray-300">
                    {sessionCount} session{sessionCount === 1 ? "" : "s"}
                  </span>
                </button>
              ))
            )}
          </div>
        </div>

        <div className="space-y-4 rounded-2xl border border-gray-200 bg-gray-50 p-5 dark:border-gray-800 dark:bg-neutral-950/50">
          <div>
            <h2 className="text-lg font-semibold text-gray-950 dark:text-gray-100">Workspaces map</h2>
            <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
              Browse workspaces first, then branch into loops, chats, and terminals from there.
            </p>
          </div>
          <div className="space-y-2">
            {workspaceGroups.length === 0 ? (
              <EmptySection message="No workspaces yet. Start by creating one." />
            ) : (
              workspaceGroups.map((group) => (
                <button
                  key={group.workspace.id}
                  type="button"
                  onClick={() => onNavigate({ view: "workspace", workspaceId: group.workspace.id })}
                  className="flex w-full items-center justify-between rounded-2xl border border-gray-200 bg-white px-4 py-3 text-left transition hover:border-gray-300 hover:bg-gray-100 dark:border-gray-800 dark:bg-neutral-900 dark:hover:border-gray-700 dark:hover:bg-neutral-800"
                >
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium text-gray-900 dark:text-gray-100">
                      {group.workspace.name}
                    </span>
                    <span className="mt-1 block truncate text-xs text-gray-500 dark:text-gray-400">
                      {group.workspace.directory}
                    </span>
                  </span>
                  <span className="rounded-full bg-gray-200 px-2 py-0.5 text-xs font-semibold text-gray-600 dark:bg-neutral-800 dark:text-gray-300">
                    {group.loops.length} items
                  </span>
                </button>
              ))
            )}
          </div>
        </div>
      </div>
    </ShellPanel>
  );
}

export function WorkspaceView({
  workspace,
  relatedLoops,
  relatedSessions,
  registeredSshServers,
  headerOffsetClassName,
  onOpenSettings,
  onNavigate,
}: {
  workspace: Workspace;
  relatedLoops: ReturnType<typeof useLoops>["loops"];
  relatedSessions: ReturnType<typeof useSshSessions>["sessions"];
  registeredSshServers: readonly SshServer[];
  headerOffsetClassName?: string;
  onOpenSettings: () => void;
  onNavigate: (route: ShellRoute) => void;
}) {
  const workspaceSshEnabled = workspace.serverSettings.agent.transport === "ssh";
  const createActionItems: ActionMenuItem[] = [
    {
      label: "New Loop",
      onClick: () => onNavigate({ view: "compose", kind: "loop", scopeId: workspace.id }),
    },
    {
      label: "New Chat",
      onClick: () => onNavigate({ view: "compose", kind: "chat", scopeId: workspace.id }),
    },
    ...(workspaceSshEnabled
      ? [{
          label: "New SSH Session",
          onClick: () => onNavigate({ view: "compose", kind: "ssh-session", scopeId: workspace.id }),
        }]
      : []),
  ];

  return (
    <ShellPanel
      eyebrow="Workspace"
      title={workspace.name}
      description={workspace.directory}
      descriptionClassName="hidden sm:inline font-mono"
      variant="compact"
      headerOffsetClassName={headerOffsetClassName}
      actions={(
        <>
          <Button
            variant="ghost"
            size="sm"
            onClick={onOpenSettings}
            title="Workspace Settings"
            aria-label="Open workspace settings"
            className="min-w-[44px] min-h-[44px] sm:min-w-0 sm:min-h-0 px-1.5"
            icon={<GearIcon size="h-5 w-5" />}
          >
            {null}
          </Button>
          <ActionMenu items={createActionItems} ariaLabel={`Create items in workspace ${workspace.name}`} />
        </>
      )}
    >
      <div className="grid gap-4 lg:grid-cols-3">
        <SummaryCard
          label="Connection"
          value={workspace.serverSettings.agent.transport}
          meta={getServerLabel(workspace.serverSettings, registeredSshServers)}
        />
        <SummaryCard
          label="Loops"
          value={relatedLoops.filter((loop) => loop.config.mode !== "chat").length}
          meta="Task loops in this workspace."
        />
        <SummaryCard
          label="Chats / SSH"
          value={`${relatedLoops.filter((loop) => loop.config.mode === "chat").length} / ${relatedSessions.length}`}
          meta="Interactive chat sessions and terminals."
        />
      </div>

      <div className="grid min-w-0 gap-6 xl:grid-cols-2">
        <div className="min-w-0 space-y-4 rounded-2xl border border-gray-200 bg-gray-50 p-5 dark:border-gray-800 dark:bg-neutral-950/50">
          <h2 className="text-lg font-semibold text-gray-950 dark:text-gray-100">Loops and chats</h2>
          <div className="space-y-2">
            {relatedLoops.length === 0 ? (
              <EmptySection message="No loops or chats in this workspace yet." />
            ) : (
              relatedLoops.map((loop) => {
                const route: ShellRoute = loop.config.mode === "chat"
                  ? { view: "chat", chatId: loop.config.id }
                  : { view: "loop", loopId: loop.config.id };
                return (
                  <button
                    key={loop.config.id}
                    type="button"
                    onClick={() => onNavigate(route)}
                    className="flex min-w-0 w-full items-center gap-3 rounded-2xl border border-gray-200 bg-white px-4 py-3 text-left transition hover:border-gray-300 hover:bg-gray-100 dark:border-gray-800 dark:bg-neutral-900 dark:hover:border-gray-700 dark:hover:bg-neutral-800"
                  >
                    <span className="flex min-w-0 flex-1 flex-col">
                      <span className="block truncate text-sm font-medium text-gray-900 dark:text-gray-100">
                        {loop.config.name}
                      </span>
                      <span className="mt-1 block text-xs text-gray-500 dark:text-gray-400">
                        {loop.config.mode === "chat" ? "Chat" : "Loop"}
                      </span>
                    </span>
                    <Badge className="ml-auto shrink-0" variant={getStatusBadgeVariant(loop.state.status)}>
                      {getLoopStatusLabel(loop)}
                    </Badge>
                  </button>
                );
              })
            )}
          </div>
        </div>

        <div className="min-w-0 space-y-4 rounded-2xl border border-gray-200 bg-gray-50 p-5 dark:border-gray-800 dark:bg-neutral-950/50">
          <h2 className="text-lg font-semibold text-gray-950 dark:text-gray-100">SSH sessions</h2>
          <div className="space-y-2">
            {relatedSessions.length === 0 ? (
              <EmptySection
                message={workspaceSshEnabled
                  ? "No SSH sessions yet for this workspace."
                  : "This workspace is not configured for SSH transport."}
              />
            ) : (
              relatedSessions.map((session) => (
                <button
                  key={session.config.id}
                  type="button"
                  onClick={() => onNavigate({ view: "ssh", sshSessionId: session.config.id })}
                  className="flex min-w-0 w-full items-center gap-3 rounded-2xl border border-gray-200 bg-white px-4 py-3 text-left transition hover:border-gray-300 hover:bg-gray-100 dark:border-gray-800 dark:bg-neutral-900 dark:hover:border-gray-700 dark:hover:bg-neutral-800"
                >
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="block truncate text-sm font-medium text-gray-900 dark:text-gray-100">
                      {session.config.name}
                    </span>
                    <span className="mt-1 block text-xs text-gray-500 dark:text-gray-400">
                      {session.config.connectionMode === "direct" ? "Direct SSH" : "Persistent SSH"}
                    </span>
                  </span>
                  <Badge
                    className="ml-auto shrink-0"
                    variant={
                      session.state.status === "connected"
                        ? "success"
                        : session.state.status === "failed"
                          ? "error"
                          : "default"
                    }
                  >
                    {session.state.status}
                  </Badge>
                </button>
              ))
            )}
          </div>
        </div>
      </div>
    </ShellPanel>
  );
}

export function SshServerView({
  server,
  sessions,
  headerOffsetClassName,
  onNavigate,
  onDeleteServer,
}: {
  server: SshServer;
  sessions: SshServerSession[];
  headerOffsetClassName?: string;
  onNavigate: (route: ShellRoute) => void;
  onDeleteServer: () => Promise<boolean>;
}) {
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [deleteSubmitting, setDeleteSubmitting] = useState(false);

  async function handleDeleteServer() {
    try {
      setDeleteSubmitting(true);
      const deleted = await onDeleteServer();
      if (deleted) {
        setDeleteConfirmOpen(false);
      }
    } finally {
      setDeleteSubmitting(false);
    }
  }

  const deleteMessage = sessions.length === 0
    ? `Delete "${server.config.name}"? This removes the saved SSH server metadata from Ralpher and any saved browser credential for this server.`
    : `Delete "${server.config.name}" and its ${sessions.length} standalone session${sessions.length === 1 ? "" : "s"}? This removes the saved SSH server metadata from Ralpher, any saved browser credential for this server, and cannot be undone.`;

  return (
    <ShellPanel
      eyebrow="SSH server"
      title={server.config.name}
      description={`${server.config.username}@${server.config.address}`}
      variant="compact"
      headerOffsetClassName={headerOffsetClassName}
      badges={(
        <Badge variant="default" size="sm">
          {sessions.length} session{sessions.length === 1 ? "" : "s"}
        </Badge>
      )}
      actions={(
        <>
          <Button
            size="sm"
            variant="danger"
            onClick={() => setDeleteConfirmOpen(true)}
            disabled={deleteSubmitting}
          >
            Delete Server
          </Button>
          <Button
            size="sm"
            onClick={() => onNavigate({ view: "compose", kind: "ssh-session", scopeId: server.config.id })}
            disabled={deleteSubmitting}
          >
            New Session
          </Button>
        </>
      )}
    >
      <div className="grid gap-4 lg:grid-cols-3">
        <SummaryCard label="Address" value={server.config.address} meta="Stored without credentials on the server." />
        <SummaryCard label="Username" value={server.config.username} meta="Used for standalone SSH sessions." />
        <SummaryCard label="Saved sessions" value={sessions.length} meta="Standalone terminals attached to this host." />
      </div>

      <div className="space-y-4 rounded-2xl border border-gray-200 bg-gray-50 p-5 dark:border-gray-800 dark:bg-neutral-950/50">
        <h2 className="text-lg font-semibold text-gray-950 dark:text-gray-100">Standalone sessions</h2>
        <div className="space-y-2">
          {sessions.length === 0 ? (
            <EmptySection message="No standalone sessions yet for this SSH server." />
          ) : (
            sessions.map((session) => (
              <button
                key={session.config.id}
                type="button"
                onClick={() => onNavigate({ view: "ssh", sshSessionId: session.config.id })}
                className="flex w-full items-center justify-between rounded-2xl border border-gray-200 bg-white px-4 py-3 text-left transition hover:border-gray-300 hover:bg-gray-100 dark:border-gray-800 dark:bg-neutral-900 dark:hover:border-gray-700 dark:hover:bg-neutral-800"
              >
                <span className="min-w-0">
                  <span className="block truncate text-sm font-medium text-gray-900 dark:text-gray-100">
                    {session.config.name}
                  </span>
                  <span className="mt-1 block text-xs text-gray-500 dark:text-gray-400">
                    {session.config.connectionMode === "direct" ? "Direct SSH" : "Persistent SSH"}
                  </span>
                </span>
                <Badge
                  variant={
                    session.state.status === "connected"
                      ? "success"
                      : session.state.status === "failed"
                        ? "error"
                        : "default"
                  }
                >
                  {session.state.status}
                </Badge>
              </button>
            ))
          )}
        </div>
      </div>

      <ConfirmModal
        isOpen={deleteConfirmOpen}
        onClose={() => setDeleteConfirmOpen(false)}
        onConfirm={() => void handleDeleteServer()}
        title="Delete SSH Server"
        message={deleteMessage}
        confirmLabel="Delete Server"
        loading={deleteSubmitting}
        variant="danger"
      />
    </ShellPanel>
  );
}
