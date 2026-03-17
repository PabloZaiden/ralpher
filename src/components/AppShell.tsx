import { useEffect, useId, useMemo, useState, type FormEvent } from "react";
import type {
  CreateChatRequest,
  CreateLoopRequest,
  Loop,
  SshConnectionMode,
  SshServer,
  SshServerSession,
  Workspace,
} from "../types";
import { getDefaultServerSettings, getServerLabel } from "../types/settings";
import type { ServerSettings } from "../types/settings";
import type { CreateWorkspaceRequest } from "../types/workspace";
import { createLogger } from "../lib/logger";
import { appFetch } from "../lib/public-path";
import {
  useDashboardData,
  useLoopGrouping,
  useLoops,
  useSshServers,
  useSshSessions,
  useToast,
  useWorkspaces,
} from "../hooks";
import { getPlanningStatusLabel, getStatusLabel } from "../utils";
import { AppSettingsPanel } from "./AppSettingsModal";
import { CreateLoopForm, type CreateLoopFormSubmitRequest } from "./CreateLoopForm";
import { LoopDetails } from "./LoopDetails";
import { ServerSettingsForm } from "./ServerSettingsForm";
import { SshSessionDetails } from "./SshSessionDetails";
import { WorkspaceSelector } from "./WorkspaceSelector";
import { Badge, Button, GearIcon, SidebarIcon, getStatusBadgeVariant } from "./common";

const log = createLogger("AppShell");
const SIDEBAR_SECTION_STORAGE_KEY = "ralpher.sidebarSectionCollapseState";

type SidebarSectionId =
  | "workspaces"
  | "drafts"
  | "loops"
  | "chats"
  | "workspace-ssh"
  | "ssh-servers";

type SidebarSectionCollapseState = Partial<Record<SidebarSectionId, boolean>>;

const SIDEBAR_SECTION_IDS: SidebarSectionId[] = [
  "workspaces",
  "drafts",
  "loops",
  "chats",
  "workspace-ssh",
  "ssh-servers",
];

function isDesktopShellViewport(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
    return false;
  }

  return window.matchMedia("(min-width: 1024px)").matches;
}

function getSidebarSectionStorage(): Storage | null {
  if (typeof window === "undefined") {
    return null;
  }

  try {
    return window.localStorage;
  } catch (error) {
    log.warn("Sidebar section storage is unavailable", { error: String(error) });
    return null;
  }
}

function loadSidebarSectionCollapseState(): SidebarSectionCollapseState {
  const storage = getSidebarSectionStorage();
  if (!storage) {
    return {};
  }

  const raw = storage.getItem(SIDEBAR_SECTION_STORAGE_KEY);
  if (!raw) {
    return {};
  }

  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    return SIDEBAR_SECTION_IDS.reduce<SidebarSectionCollapseState>((state, sectionId) => {
      if (typeof parsed[sectionId] === "boolean") {
        state[sectionId] = parsed[sectionId] as boolean;
      }
      return state;
    }, {});
  } catch (error) {
    log.warn("Removing invalid sidebar section state", { error: String(error) });
    storage.removeItem(SIDEBAR_SECTION_STORAGE_KEY);
    return {};
  }
}

function saveSidebarSectionCollapseState(state: SidebarSectionCollapseState): void {
  const storage = getSidebarSectionStorage();
  if (!storage) {
    return;
  }

  const persistedState = SIDEBAR_SECTION_IDS.reduce<SidebarSectionCollapseState>((result, sectionId) => {
    if (typeof state[sectionId] === "boolean") {
      result[sectionId] = state[sectionId];
    }
    return result;
  }, {});

  try {
    storage.setItem(SIDEBAR_SECTION_STORAGE_KEY, JSON.stringify(persistedState));
  } catch (error) {
    log.warn("Failed to persist sidebar section state", { error: String(error) });
  }
}

export type ShellRoute =
  | { view: "home" }
  | { view: "settings" }
  | { view: "loop"; loopId: string }
  | { view: "chat"; chatId: string }
  | { view: "ssh"; sshSessionId: string }
  | { view: "workspace"; workspaceId: string }
  | { view: "ssh-server"; serverId: string }
  | {
      view: "compose";
      kind: "loop" | "chat" | "workspace" | "ssh-session" | "ssh-server";
      scopeId?: string;
    };

interface AppShellProps {
  route: ShellRoute;
  onNavigate: (route: ShellRoute) => void;
}

type ComposeKind = Extract<ShellRoute, { view: "compose" }>["kind"];

function ShellSection({
  title,
  count,
  actionLabel,
  onAction,
  collapsed,
  onToggle,
  children,
}: {
  title: string;
  count?: number;
  actionLabel?: string;
  onAction?: () => void;
  collapsed: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  const contentId = useId();
  const toggleLabel = `${collapsed ? "Expand" : "Collapse"} ${title} section`;

  return (
    <section className="space-y-2">
      <div className="flex items-center justify-between gap-2 px-1">
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <h2 className="min-w-0 flex-1">
            <button
              type="button"
              onClick={onToggle}
              aria-expanded={!collapsed}
              aria-controls={contentId}
              aria-label={toggleLabel}
              className="flex w-full min-w-0 items-center gap-2 rounded-lg px-1 py-1 text-left transition hover:bg-gray-100 dark:hover:bg-gray-800/60"
            >
              <span className="text-xs text-gray-500 dark:text-gray-400">{collapsed ? "\u25B6" : "\u25BC"}</span>
              <span className="truncate text-xs font-semibold uppercase tracking-[0.18em] text-gray-500 dark:text-gray-400">
                {title}
              </span>
            </button>
          </h2>
          {typeof count === "number" && (
            <span className="rounded-full bg-gray-200 px-2 py-0.5 text-[10px] font-semibold text-gray-600 dark:bg-gray-800 dark:text-gray-300">
              {count}
            </span>
          )}
        </div>
        {onAction && actionLabel && (
          <button
            type="button"
            onClick={onAction}
            className="rounded-md px-2 py-1 text-xs font-medium text-gray-500 transition hover:bg-gray-200 hover:text-gray-900 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-gray-100"
          >
            {actionLabel}
          </button>
        )}
      </div>
      {!collapsed && (
        <div id={contentId} className="space-y-1">
          {children}
        </div>
      )}
    </section>
  );
}

function SectionItem({
  active = false,
  title,
  subtitle,
  badge,
  nested = false,
  onClick,
}: {
  active?: boolean;
  title: string;
  subtitle?: string;
  badge?: string;
  nested?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={[
        "flex w-full items-center justify-between rounded-xl border px-3 py-2 text-left transition",
        nested ? "ml-3 w-[calc(100%-0.75rem)]" : "",
        active
          ? "border-gray-900 bg-gray-900 text-white shadow-sm dark:border-gray-100 dark:bg-gray-100 dark:text-gray-950"
          : "border-transparent bg-transparent text-gray-700 hover:border-gray-200 hover:bg-gray-100 dark:text-gray-200 dark:hover:border-gray-800 dark:hover:bg-gray-800/80",
      ].join(" ")}
    >
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium">{title}</span>
        {subtitle && (
          <span
            className={[
              "mt-0.5 block truncate text-xs",
              active ? "text-gray-300 dark:text-gray-700" : "text-gray-500 dark:text-gray-400",
            ].join(" ")}
          >
            {subtitle}
          </span>
        )}
      </span>
      {badge && (
        <span
          className={[
            "ml-3 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
            active
              ? "bg-white/10 text-white dark:bg-gray-900/10 dark:text-gray-950"
              : "bg-gray-200 text-gray-600 dark:bg-gray-700 dark:text-gray-300",
          ].join(" ")}
        >
          {badge}
        </span>
      )}
    </button>
  );
}

function EmptySection({ message }: { message: string }) {
  return (
    <div className="rounded-xl border border-dashed border-gray-300 px-3 py-3 text-xs text-gray-500 dark:border-gray-700 dark:text-gray-400">
      {message}
    </div>
  );
}

function ShellPanel({
  eyebrow,
  title,
  description,
  actions,
  children,
}: {
  eyebrow?: string;
  title: string;
  description?: string;
  actions?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-4 py-5 sm:px-6 lg:px-8 lg:py-8">
      <div className="flex flex-col gap-4 rounded-3xl border border-gray-200 bg-white p-6 shadow-sm dark:border-gray-800 dark:bg-gray-900/80">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="space-y-2">
            {eyebrow && (
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-gray-500 dark:text-gray-400">
                {eyebrow}
              </p>
            )}
            <div>
              <h1 className="text-2xl font-semibold text-gray-950 dark:text-gray-100">{title}</h1>
              {description && (
                <p className="mt-2 max-w-3xl text-sm text-gray-600 dark:text-gray-400">{description}</p>
              )}
            </div>
          </div>
          {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
        </div>
        {children}
      </div>
    </div>
  );
}

function SummaryCard({ label, value, meta }: { label: string; value: string | number; meta: string }) {
  return (
    <div className="rounded-2xl border border-gray-200 bg-gray-50 p-4 dark:border-gray-800 dark:bg-gray-950/50">
      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-gray-500 dark:text-gray-400">{label}</p>
      <p className="mt-2 break-words text-3xl font-semibold text-gray-950 dark:text-gray-100">{value}</p>
      <p className="mt-2 text-sm text-gray-600 dark:text-gray-400">{meta}</p>
    </div>
  );
}

function InlineField({
  id,
  label,
  value,
  onChange,
  placeholder,
  type = "text",
  required = false,
  help,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  type?: string;
  required?: boolean;
  help?: string;
}) {
  return (
    <div>
      <label htmlFor={id} className="mb-1.5 block text-sm font-medium text-gray-700 dark:text-gray-300">
        {label}
        {required && <span className="ml-1 text-red-500">*</span>}
      </label>
      <input
        id={id}
        type={type}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        className="block w-full rounded-xl border border-gray-300 bg-white px-3 py-2.5 text-sm text-gray-900 shadow-sm outline-none transition focus:border-gray-500 focus:ring-2 focus:ring-gray-300 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 dark:focus:border-gray-500 dark:focus:ring-gray-700"
      />
      {help && <p className="mt-1.5 text-xs text-gray-500 dark:text-gray-400">{help}</p>}
    </div>
  );
}

function OverviewView({
  workspaces,
  loops,
  loopCount,
  chatCount,
  workspaceSessionCount,
  standaloneSessionCount,
  servers,
  workspaceGroups,
  onNavigate,
}: {
  workspaces: Workspace[];
  loops: ReturnType<typeof useLoops>["loops"];
  loopCount: number;
  chatCount: number;
  workspaceSessionCount: number;
  standaloneSessionCount: number;
  servers: SshServer[];
  workspaceGroups: ReturnType<typeof useLoopGrouping>["workspaceGroups"];
  onNavigate: (route: ShellRoute) => void;
}) {
  const recentLoops = useMemo(() => {
    return [...loops]
      .sort((left, right) => right.config.createdAt.localeCompare(left.config.createdAt))
      .slice(0, 5);
  }, [loops]);

  return (
    <ShellPanel
      eyebrow="Overview"
      title="Overview"
      description="Recent activity, workspace coverage, and quick access to active work."
    >
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <SummaryCard label="Workspaces" value={workspaces.length} meta="Tracked repositories and hosts." />
        <SummaryCard label="Loops" value={loopCount} meta="Task-oriented Ralph loops." />
        <SummaryCard label="Chats" value={chatCount} meta="Interactive conversations." />
        <SummaryCard
          label="SSH"
          value={workspaceSessionCount + standaloneSessionCount}
          meta={`${servers.length} saved servers across workspace and standalone sessions.`}
        />
      </div>

      <div className="grid gap-6 xl:grid-cols-[1.2fr,0.8fr]">
        <div className="space-y-4 rounded-2xl border border-gray-200 bg-gray-50 p-5 dark:border-gray-800 dark:bg-gray-950/50">
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
                const route = loop.config.mode === "chat"
                  ? { view: "chat", chatId: loop.config.id } as ShellRoute
                  : { view: "loop", loopId: loop.config.id } as ShellRoute;
                const label = loop.state.status === "planning"
                  ? getPlanningStatusLabel(loop.state.planMode?.isPlanReady ?? false)
                  : getStatusLabel(loop.state.status, loop.state.syncState);
                return (
                  <button
                    key={loop.config.id}
                    type="button"
                    onClick={() => onNavigate(route)}
                    className="flex w-full items-center justify-between rounded-2xl border border-gray-200 bg-white px-4 py-3 text-left transition hover:border-gray-300 hover:bg-gray-100 dark:border-gray-800 dark:bg-gray-900 dark:hover:border-gray-700 dark:hover:bg-gray-800"
                  >
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-medium text-gray-900 dark:text-gray-100">
                        {loop.config.name}
                      </span>
                      <span className="mt-1 block truncate text-xs text-gray-500 dark:text-gray-400">
                        {loop.config.directory}
                      </span>
                    </span>
                    <Badge variant={getStatusBadgeVariant(loop.state.status)}>{label}</Badge>
                  </button>
                );
              })
            )}
          </div>
        </div>

        <div className="space-y-4 rounded-2xl border border-gray-200 bg-gray-50 p-5 dark:border-gray-800 dark:bg-gray-950/50">
          <div>
            <h2 className="text-lg font-semibold text-gray-950 dark:text-gray-100">Workspace map</h2>
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
                  className="flex w-full items-center justify-between rounded-2xl border border-gray-200 bg-white px-4 py-3 text-left transition hover:border-gray-300 hover:bg-gray-100 dark:border-gray-800 dark:bg-gray-900 dark:hover:border-gray-700 dark:hover:bg-gray-800"
                >
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium text-gray-900 dark:text-gray-100">
                      {group.workspace.name}
                    </span>
                    <span className="mt-1 block truncate text-xs text-gray-500 dark:text-gray-400">
                      {group.workspace.directory}
                    </span>
                  </span>
                  <span className="rounded-full bg-gray-200 px-2 py-0.5 text-xs font-semibold text-gray-600 dark:bg-gray-800 dark:text-gray-300">
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

function WorkspaceView({
  workspace,
  relatedLoops,
  relatedSessions,
  registeredSshServers,
  onNavigate,
}: {
  workspace: Workspace;
  relatedLoops: ReturnType<typeof useLoops>["loops"];
  relatedSessions: ReturnType<typeof useSshSessions>["sessions"];
  registeredSshServers: readonly SshServer[];
  onNavigate: (route: ShellRoute) => void;
}) {
  const workspaceSshEnabled = workspace.serverSettings.agent.transport === "ssh";

  return (
    <ShellPanel
      eyebrow="Workspace"
      title={workspace.name}
      description={workspace.directory}
      actions={(
        <>
          <Button variant="secondary" onClick={() => onNavigate({ view: "compose", kind: "chat", scopeId: workspace.id })}>
            New Chat
          </Button>
          <Button variant="secondary" onClick={() => onNavigate({ view: "compose", kind: "loop", scopeId: workspace.id })}>
            New Loop
          </Button>
          {workspaceSshEnabled && (
            <Button onClick={() => onNavigate({ view: "compose", kind: "ssh-session", scopeId: workspace.id })}>New SSH Session</Button>
          )}
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

      <div className="grid gap-6 xl:grid-cols-2">
        <div className="space-y-4 rounded-2xl border border-gray-200 bg-gray-50 p-5 dark:border-gray-800 dark:bg-gray-950/50">
          <h2 className="text-lg font-semibold text-gray-950 dark:text-gray-100">Loops and chats</h2>
          <div className="space-y-2">
            {relatedLoops.length === 0 ? (
              <EmptySection message="No loops or chats in this workspace yet." />
            ) : (
              relatedLoops.map((loop) => {
                const route = loop.config.mode === "chat"
                  ? { view: "chat", chatId: loop.config.id } as ShellRoute
                  : { view: "loop", loopId: loop.config.id } as ShellRoute;
                return (
                  <button
                    key={loop.config.id}
                    type="button"
                    onClick={() => onNavigate(route)}
                    className="flex w-full items-center justify-between rounded-2xl border border-gray-200 bg-white px-4 py-3 text-left transition hover:border-gray-300 hover:bg-gray-100 dark:border-gray-800 dark:bg-gray-900 dark:hover:border-gray-700 dark:hover:bg-gray-800"
                  >
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-medium text-gray-900 dark:text-gray-100">
                        {loop.config.name}
                      </span>
                      <span className="mt-1 block text-xs text-gray-500 dark:text-gray-400">
                        {loop.config.mode === "chat" ? "Chat" : "Loop"}
                      </span>
                    </span>
                    <Badge variant={getStatusBadgeVariant(loop.state.status)}>
                      {loop.state.status === "planning"
                        ? getPlanningStatusLabel(loop.state.planMode?.isPlanReady ?? false)
                        : getStatusLabel(loop.state.status, loop.state.syncState)}
                    </Badge>
                  </button>
                );
              })
            )}
          </div>
        </div>

        <div className="space-y-4 rounded-2xl border border-gray-200 bg-gray-50 p-5 dark:border-gray-800 dark:bg-gray-950/50">
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
                  className="flex w-full items-center justify-between rounded-2xl border border-gray-200 bg-white px-4 py-3 text-left transition hover:border-gray-300 hover:bg-gray-100 dark:border-gray-800 dark:bg-gray-900 dark:hover:border-gray-700 dark:hover:bg-gray-800"
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
      </div>
    </ShellPanel>
  );
}

function SshServerView({
  server,
  sessions,
  onNavigate,
}: {
  server: SshServer;
  sessions: SshServerSession[];
  onNavigate: (route: ShellRoute) => void;
}) {
  return (
    <ShellPanel
      eyebrow="SSH server"
      title={server.config.name}
      description={`${server.config.username}@${server.config.address}`}
      actions={(
        <>
          <Button variant="secondary" onClick={() => onNavigate({ view: "compose", kind: "ssh-session" })}>
            New Session
          </Button>
          <Button onClick={() => onNavigate({ view: "compose", kind: "ssh-server" })}>Register Another Server</Button>
        </>
      )}
    >
      <div className="grid gap-4 lg:grid-cols-3">
        <SummaryCard label="Address" value={server.config.address} meta="Stored without credentials on the server." />
        <SummaryCard label="Username" value={server.config.username} meta="Used for standalone SSH sessions." />
        <SummaryCard label="Saved sessions" value={sessions.length} meta="Standalone terminals attached to this host." />
      </div>

      <div className="space-y-4 rounded-2xl border border-gray-200 bg-gray-50 p-5 dark:border-gray-800 dark:bg-gray-950/50">
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
                className="flex w-full items-center justify-between rounded-2xl border border-gray-200 bg-white px-4 py-3 text-left transition hover:border-gray-300 hover:bg-gray-100 dark:border-gray-800 dark:bg-gray-900 dark:hover:border-gray-700 dark:hover:bg-gray-800"
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
    </ShellPanel>
  );
}

function DraftLoopComposer({
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
  onRefresh: () => Promise<void>;
  onDeleteDraft: (id: string) => Promise<boolean>;
  onNavigate: (route: ShellRoute) => void;
}) {
  const toast = useToast();
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [deleteSubmitting, setDeleteSubmitting] = useState(false);
  const [startConflict, setStartConflict] = useState<{ message: string; changedFiles: string[] } | null>(null);

  const selectedWorkspace = workspaces.find((workspace) => workspace.id === loop.config.workspaceId) ?? null;
  const exitRoute = selectedWorkspace
    ? { view: "workspace", workspaceId: selectedWorkspace.id } satisfies ShellRoute
    : { view: "home" } satisfies ShellRoute;

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
      toast.success("Draft updated");
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
      toast.success(request.planMode ? "Draft started in plan mode" : "Draft started");
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
      toast.success("Draft deleted");
      onNavigate(exitRoute);
    } finally {
      setDeleteSubmitting(false);
    }
  }

  return (
    <ShellPanel
      eyebrow="Draft loop"
      title={`Edit ${loop.config.name}`}
      description={selectedWorkspace ? `${selectedWorkspace.name} · ${loop.config.directory}` : loop.config.directory}
      actions={(
        <Button
          variant="ghost"
          onClick={() => {
            setStartConflict(null);
            setDeleteConfirmOpen(false);
            onNavigate(exitRoute);
          }}
        >
          Cancel
        </Button>
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
        onCancel={() => {
          setStartConflict(null);
          setDeleteConfirmOpen(false);
          onNavigate(exitRoute);
        }}
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
      />

      <div className="mt-6 rounded-2xl border border-red-200 bg-red-50/70 p-4 dark:border-red-900/50 dark:bg-red-950/20">
        <p className="text-sm font-semibold text-red-900 dark:text-red-100">Delete draft</p>
        <p className="mt-1 text-sm text-red-800 dark:text-red-200">
          Remove this draft if you no longer need it. The draft will be marked as deleted and can be purged later.
        </p>
        {deleteConfirmOpen ? (
          <div className="mt-4 space-y-3">
            <p className="text-sm text-red-900 dark:text-red-100">
              Are you sure you want to delete "{loop.config.name}"? The draft will be marked as deleted and can be purged later if needed.
            </p>
            <div className="flex flex-wrap gap-3">
              <Button variant="ghost" onClick={() => setDeleteConfirmOpen(false)} disabled={deleteSubmitting}>
                Keep Draft
              </Button>
              <Button onClick={() => void handleDeleteDraft()} loading={deleteSubmitting}>
                Delete Draft
              </Button>
            </div>
          </div>
        ) : (
          <div className="mt-4">
            <Button variant="secondary" onClick={() => setDeleteConfirmOpen(true)}>
              Delete Draft
            </Button>
          </div>
        )}
      </div>
    </ShellPanel>
  );
}

function SshSessionComposer({
  workspaces,
  servers,
  initialWorkspaceId,
  onCancel,
  onNavigate,
  onCreateWorkspaceSession,
  onCreateStandaloneSession,
}: {
  workspaces: Workspace[];
  servers: SshServer[];
  initialWorkspaceId?: string;
  onCancel: () => void;
  onNavigate: (route: ShellRoute) => void;
  onCreateWorkspaceSession: ReturnType<typeof useSshSessions>["createSession"];
  onCreateStandaloneSession: ReturnType<typeof useSshServers>["createSession"];
}) {
  const toast = useToast();
  const [targetType, setTargetType] = useState<"workspace" | "server">(workspaces.length > 0 ? "workspace" : "server");
  const [selectedWorkspaceId, setSelectedWorkspaceId] = useState<string | undefined>(initialWorkspaceId ?? workspaces[0]?.id);
  const [selectedServerId, setSelectedServerId] = useState(servers[0]?.config.id ?? "");
  const [sessionName, setSessionName] = useState("");
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
          name: sessionName.trim() || undefined,
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
        name: sessionName.trim() || undefined,
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
      eyebrow="Compose SSH"
      title="Create an SSH session"
      description="Create a workspace-backed or standalone SSH session."
      actions={<Button variant="ghost" onClick={onCancel}>Cancel</Button>}
    >
      <form className="space-y-6" onSubmit={(event) => void handleSubmit(event)}>
        <div className="grid gap-4 lg:grid-cols-2">
          <div className="rounded-2xl border border-gray-200 bg-gray-50 p-4 dark:border-gray-800 dark:bg-gray-950/50">
            <p className="text-sm font-medium text-gray-900 dark:text-gray-100">Target</p>
            <div className="mt-3 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => setTargetType("workspace")}
                className={[
                  "rounded-xl border px-3 py-2 text-sm font-medium transition",
                  targetType === "workspace"
                    ? "border-gray-900 bg-gray-900 text-white dark:border-gray-100 dark:bg-gray-100 dark:text-gray-950"
                    : "border-gray-300 bg-white text-gray-700 hover:border-gray-400 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-200",
                ].join(" ")}
              >
                Workspace SSH
              </button>
              <button
                type="button"
                onClick={() => setTargetType("server")}
                className={[
                  "rounded-xl border px-3 py-2 text-sm font-medium transition",
                  targetType === "server"
                    ? "border-gray-900 bg-gray-900 text-white dark:border-gray-100 dark:bg-gray-100 dark:text-gray-950"
                    : "border-gray-300 bg-white text-gray-700 hover:border-gray-400 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-200",
                ].join(" ")}
              >
                Standalone server
              </button>
            </div>
          </div>
          <div className="rounded-2xl border border-gray-200 bg-gray-50 p-4 dark:border-gray-800 dark:bg-gray-950/50">
            <label htmlFor="ssh-connection-mode" className="block text-sm font-medium text-gray-700 dark:text-gray-300">
              Connection mode
            </label>
            <select
              id="ssh-connection-mode"
              value={connectionMode}
              onChange={(event) => setConnectionMode(event.target.value as SshConnectionMode)}
              className="mt-2 w-full rounded-xl border border-gray-300 bg-white px-3 py-2.5 text-sm text-gray-900 shadow-sm outline-none transition focus:border-gray-500 focus:ring-2 focus:ring-gray-300 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 dark:focus:border-gray-500 dark:focus:ring-gray-700"
            >
              <option value="dtach">Persistent SSH</option>
              <option value="direct">Direct SSH</option>
            </select>
            <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">
              Persistent SSH survives reconnects; direct SSH is better for one-off debugging sessions.
            </p>
          </div>
        </div>

        <InlineField
          id="ssh-session-name"
          label="Session name"
          value={sessionName}
          onChange={setSessionName}
          placeholder="Optional display name"
          help="Leave empty to use the default generated name."
        />

        {targetType === "workspace" ? (
          <div className="rounded-2xl border border-gray-200 bg-gray-50 p-4 dark:border-gray-800 dark:bg-gray-950/50">
            <WorkspaceSelector
              workspaces={workspaces}
              selectedWorkspaceId={selectedWorkspaceId}
              onSelect={(workspaceId) => setSelectedWorkspaceId(workspaceId ?? undefined)}
              registeredSshServers={servers}
            />
          </div>
        ) : (
          <div className="rounded-2xl border border-gray-200 bg-gray-50 p-4 dark:border-gray-800 dark:bg-gray-950/50">
            <label htmlFor="ssh-server" className="block text-sm font-medium text-gray-700 dark:text-gray-300">
              Server
            </label>
            <select
              id="ssh-server"
              value={selectedServerId}
              onChange={(event) => setSelectedServerId(event.target.value)}
              className="mt-2 w-full rounded-xl border border-gray-300 bg-white px-3 py-2.5 text-sm text-gray-900 shadow-sm outline-none transition focus:border-gray-500 focus:ring-2 focus:ring-gray-300 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 dark:focus:border-gray-500 dark:focus:ring-gray-700"
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

        <div className="flex flex-wrap gap-3">
          <Button variant="ghost" type="button" onClick={onCancel}>Cancel</Button>
          <Button type="submit" loading={submitting}>Create SSH Session</Button>
        </div>
      </form>
    </ShellPanel>
  );
}

function SshServerComposer({
  onCancel,
  onNavigate,
  onCreateServer,
}: {
  onCancel: () => void;
  onNavigate: (route: ShellRoute) => void;
  onCreateServer: ReturnType<typeof useSshServers>["createServer"];
}) {
  const toast = useToast();
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
      eyebrow="Compose SSH server"
      title="Register a standalone SSH server"
      description="Store server details. Passwords stay in the browser and are only requested when needed."
      actions={<Button variant="ghost" onClick={onCancel}>Cancel</Button>}
    >
      <form className="space-y-6" onSubmit={(event) => void handleSubmit(event)}>
        <div className="grid gap-4 lg:grid-cols-2">
          <InlineField id="server-name" label="Server name" value={name} onChange={setName} placeholder="Production host" required />
          <InlineField id="server-address" label="Address" value={address} onChange={setAddress} placeholder="server.example.com" required />
          <InlineField id="server-username" label="Username" value={username} onChange={setUsername} placeholder="ubuntu" required />
          <InlineField
            id="server-password"
            label="Browser-only password"
            value={password}
            onChange={setPassword}
            placeholder="Optional"
            type="password"
            help="Stored only in the browser to streamline persistent standalone sessions."
          />
        </div>
        <div className="flex flex-wrap gap-3">
          <Button variant="ghost" type="button" onClick={onCancel}>Cancel</Button>
          <Button type="submit" loading={submitting}>Create SSH Server</Button>
        </div>
      </form>
    </ShellPanel>
  );
}

export function AppShell({ route, onNavigate }: AppShellProps) {
  const toast = useToast();
  const {
    loops,
    loading: loopsLoading,
    error: loopsError,
    refresh: refreshLoops,
    createLoop,
    createChat,
    deleteLoop,
  } = useLoops();
  const {
    sessions,
    loading: sshSessionsLoading,
    error: sshSessionsError,
    createSession,
  } = useSshSessions();
  const {
    servers,
    sessionsByServerId,
    loading: sshServersLoading,
    error: sshServersError,
    createServer,
    createSession: createStandaloneSession,
  } = useSshServers();
  const {
    workspaces,
    loading: workspacesLoading,
    saving: workspacesSaving,
    error: workspaceError,
    createWorkspace,
    exportConfig,
    importConfig,
  } = useWorkspaces();
  const dashboardData = useDashboardData();
  const { workspaceGroups } = useLoopGrouping(loops, workspaces);

  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [collapsedSections, setCollapsedSections] = useState<SidebarSectionCollapseState>(() => loadSidebarSectionCollapseState());
  const [workspaceName, setWorkspaceName] = useState("");
  const [workspaceDirectory, setWorkspaceDirectory] = useState("");
  const [workspaceServerSettings, setWorkspaceServerSettings] = useState<ServerSettings>(() => getDefaultServerSettings(dashboardData.remoteOnly));
  const [workspaceServerSettingsValid, setWorkspaceServerSettingsValid] = useState(true);
  const [workspaceTesting, setWorkspaceTesting] = useState(false);
  const [workspaceCreateSubmitting, setWorkspaceCreateSubmitting] = useState(false);

  const sshWorkspaces = useMemo(() => {
    return workspaces.filter((workspace) => workspace.serverSettings.agent.transport === "ssh");
  }, [workspaces]);

  const loopItems = useMemo(() => loops.filter((loop) => loop.config.mode !== "chat"), [loops]);
  const draftLoopItems = useMemo(() => loopItems.filter((loop) => loop.state.status === "draft"), [loopItems]);
  const activeLoopItems = useMemo(() => loopItems.filter((loop) => loop.state.status !== "draft"), [loopItems]);
  const chatItems = useMemo(() => loops.filter((loop) => loop.config.mode === "chat"), [loops]);
  const standaloneSessions = useMemo(() => Object.values(sessionsByServerId).flat(), [sessionsByServerId]);
  const selectedLoop = route.view === "loop"
    ? loopItems.find((loop) => loop.config.id === route.loopId) ?? null
    : null;

  const selectedWorkspace = route.view === "workspace"
    ? workspaces.find((workspace) => workspace.id === route.workspaceId) ?? null
    : null;
  const composeWorkspace = route.view === "compose" && route.scopeId
    ? workspaces.find((workspace) => workspace.id === route.scopeId) ?? null
    : null;
  const selectedServer = route.view === "ssh-server"
    ? servers.find((server) => server.config.id === route.serverId) ?? null
    : null;

  useEffect(() => {
    if (route.view !== "compose" || (route.kind !== "loop" && route.kind !== "chat")) {
      dashboardData.resetCreateModalState();
    }
  }, [dashboardData.resetCreateModalState, route]);

  useEffect(() => {
    if (route.view !== "compose" || route.kind !== "workspace") {
      setWorkspaceName("");
      setWorkspaceDirectory("");
      setWorkspaceServerSettings(getDefaultServerSettings(dashboardData.remoteOnly));
      setWorkspaceServerSettingsValid(true);
      setWorkspaceTesting(false);
      setWorkspaceCreateSubmitting(false);
    }
  }, [dashboardData.remoteOnly, route]);

  useEffect(() => {
    saveSidebarSectionCollapseState(collapsedSections);
  }, [collapsedSections]);

  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
      return;
    }

    const mediaQuery = window.matchMedia("(min-width: 1024px)");
    const handleChange = (event: MediaQueryListEvent) => {
      if (event.matches) {
        setSidebarOpen(false);
      }
    };

    if (mediaQuery.matches) {
      setSidebarOpen(false);
    }

    mediaQuery.addEventListener("change", handleChange);
    return () => mediaQuery.removeEventListener("change", handleChange);
  }, []);

  const shellLoading = loopsLoading || sshSessionsLoading || sshServersLoading || workspacesLoading;
  const shellErrors = [loopsError, sshSessionsError, sshServersError, workspaceError].filter(Boolean);

  const navigateWithinShell = (nextRoute: ShellRoute) => {
    setSidebarOpen(false);
    onNavigate(nextRoute);
  };

  const openSidebar = () => {
    if (isDesktopShellViewport()) {
      setSidebarCollapsed(false);
      return;
    }

    setSidebarOpen(true);
  };

  const hideSidebar = () => {
    if (isDesktopShellViewport()) {
      setSidebarCollapsed(true);
      return;
    }

    setSidebarOpen(false);
  };

  function isSectionCollapsed(sectionId: SidebarSectionId): boolean {
    return collapsedSections[sectionId] ?? false;
  }

  function toggleSectionCollapsed(sectionId: SidebarSectionId) {
    setCollapsedSections((current) => ({
      ...current,
      [sectionId]: !(current[sectionId] ?? false),
    }));
  }

  const currentTitle = useMemo(() => {
    switch (route.view) {
      case "home":
        return "Overview";
      case "settings":
        return "Settings";
      case "loop":
        return selectedLoop?.config.name ?? "Loop";
      case "chat":
        return chatItems.find((loop) => loop.config.id === route.chatId)?.config.name ?? "Chat";
      case "ssh": {
        const workspaceSession = sessions.find((session) => session.config.id === route.sshSessionId);
        if (workspaceSession) {
          return workspaceSession.config.name;
        }
        const standaloneSession = standaloneSessions.find((session) => session.config.id === route.sshSessionId);
        return standaloneSession?.config.name ?? "SSH session";
      }
      case "workspace":
        return selectedWorkspace?.name ?? "Workspace";
      case "ssh-server":
        return selectedServer?.config.name ?? "SSH server";
      case "compose":
        return {
          loop: "New Loop",
          chat: "New Chat",
          workspace: "New Workspace",
          "ssh-session": "New SSH Session",
          "ssh-server": "New SSH Server",
        }[route.kind];
    }
  }, [chatItems, route, selectedLoop, selectedServer, selectedWorkspace, sessions, standaloneSessions]);

  async function handleLoopSubmit(kind: Extract<ComposeKind, "loop" | "chat">, request: CreateLoopFormSubmitRequest) {
    const result = kind === "chat"
      ? await createChat(request as CreateChatRequest)
      : await createLoop(request as CreateLoopRequest);

    if (result.startError) {
      toast.error("Uncommitted changes blocked the new run. Resolve them and try again.");
      return false;
    }

    if (!result.loop) {
      toast.error(kind === "chat" ? "Failed to create chat" : "Failed to create loop");
      return false;
    }

    await refreshLoops();
    navigateWithinShell(
      kind === "chat"
        ? { view: "chat", chatId: result.loop.config.id }
        : { view: "loop", loopId: result.loop.config.id },
    );
    return true;
  }

  async function handleTestWorkspaceConnection(settings: ServerSettings) {
    const trimmedDirectory = workspaceDirectory.trim();
    if (!trimmedDirectory) {
      return { success: false, error: "Enter a workspace directory first." };
    }

    setWorkspaceTesting(true);
    try {
      const response = await appFetch("/api/server-settings/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ settings, directory: trimmedDirectory }),
      });
      return await response.json() as { success: boolean; error?: string };
    } catch (error) {
      return { success: false, error: String(error) };
    } finally {
      setWorkspaceTesting(false);
    }
  }

  async function handleCreateWorkspace(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const name = workspaceName.trim();
    const directory = workspaceDirectory.trim();
    if (!name || !directory || !workspaceServerSettingsValid) {
      toast.error("Name, directory, and valid connection settings are required.");
      return;
    }

    setWorkspaceCreateSubmitting(true);
    try {
      const request: CreateWorkspaceRequest = {
        name,
        directory,
        serverSettings: workspaceServerSettings,
      };
      const workspace = await createWorkspace(request);
      if (!workspace) {
        toast.error("Failed to create workspace");
        return;
      }
      navigateWithinShell({ view: "workspace", workspaceId: workspace.id });
    } finally {
      setWorkspaceCreateSubmitting(false);
    }
  }

  function renderComposeView(kind: ComposeKind) {
    if (kind === "loop" || kind === "chat") {
      return (
        <ShellPanel
          eyebrow={kind === "chat" ? "Compose chat" : "Compose loop"}
          title={kind === "chat"
            ? composeWorkspace ? `Start a new chat in ${composeWorkspace.name}` : "Start a new chat"
            : composeWorkspace ? `Start a new loop in ${composeWorkspace.name}` : "Start a new loop"}
          description={kind === "chat"
            ? "Pick a workspace and model to start an interactive conversation."
            : "Pick a workspace, model, and prompt to start a new loop."}
          actions={(
            <Button
              variant="ghost"
              onClick={() => navigateWithinShell(composeWorkspace ? { view: "workspace", workspaceId: composeWorkspace.id } : { view: "home" })}
            >
              Cancel
            </Button>
          )}
        >
          <CreateLoopForm
            mode={kind}
            onSubmit={(request) => handleLoopSubmit(kind, request)}
            onCancel={() => navigateWithinShell({ view: "home" })}
            closeOnSuccess={false}
            models={dashboardData.models}
            modelsLoading={dashboardData.modelsLoading}
            lastModel={dashboardData.lastModel}
            onWorkspaceChange={dashboardData.handleWorkspaceChange}
            planningWarning={dashboardData.planningWarning}
            branches={dashboardData.branches}
            branchesLoading={dashboardData.branchesLoading}
            currentBranch={dashboardData.currentBranch}
            defaultBranch={dashboardData.defaultBranch}
            initialLoopData={composeWorkspace ? {
              directory: composeWorkspace.directory,
              prompt: "",
              workspaceId: composeWorkspace.id,
            } : null}
            workspaces={workspaces}
            workspacesLoading={workspacesLoading}
            workspaceError={workspaceError}
            registeredSshServers={servers}
          />
        </ShellPanel>
      );
    }

    if (kind === "workspace") {
      return (
        <ShellPanel
          eyebrow="Compose workspace"
          title="Create a workspace"
          description="Add a repository or remote workspace."
          actions={(
            <Button variant="ghost" onClick={() => navigateWithinShell({ view: "home" })}>
              Cancel
            </Button>
          )}
        >
          <form className="space-y-6" onSubmit={(event) => void handleCreateWorkspace(event)}>
            <div className="grid gap-4 lg:grid-cols-2">
              <InlineField
                id="workspace-name"
                label="Workspace name"
                value={workspaceName}
                onChange={setWorkspaceName}
                placeholder="Main repository"
                required
              />
              <InlineField
                id="workspace-directory"
                label="Directory"
                value={workspaceDirectory}
                onChange={setWorkspaceDirectory}
                placeholder="/workspaces/project"
                required
                help="Absolute path on the selected workspace host."
              />
            </div>
            <ServerSettingsForm
              initialSettings={workspaceServerSettings}
              onChange={(settings, isValid) => {
                setWorkspaceServerSettings((current) => {
                  return JSON.stringify(current) === JSON.stringify(settings) ? current : settings;
                });
                setWorkspaceServerSettingsValid(isValid);
              }}
              onTest={handleTestWorkspaceConnection}
              testing={workspaceTesting}
              remoteOnly={dashboardData.remoteOnly}
              registeredSshServers={servers}
            />
            <div className="flex flex-wrap gap-3">
              <Button variant="ghost" type="button" onClick={() => navigateWithinShell({ view: "home" })}>
                Cancel
              </Button>
              <Button type="submit" loading={workspaceCreateSubmitting || workspacesSaving}>
                Create Workspace
              </Button>
            </div>
          </form>
        </ShellPanel>
      );
    }

    if (kind === "ssh-session") {
      return (
        <SshSessionComposer
          workspaces={sshWorkspaces}
          servers={servers}
          initialWorkspaceId={composeWorkspace?.id}
          onCancel={() => navigateWithinShell(composeWorkspace ? { view: "workspace", workspaceId: composeWorkspace.id } : { view: "home" })}
          onNavigate={navigateWithinShell}
          onCreateWorkspaceSession={createSession}
          onCreateStandaloneSession={createStandaloneSession}
        />
      );
    }

    return (
      <SshServerComposer
        onCancel={() => navigateWithinShell({ view: "home" })}
        onNavigate={navigateWithinShell}
        onCreateServer={createServer}
      />
    );
  }

  function renderMainContent() {
    if (shellLoading && route.view === "home") {
      return <div className="p-6 text-sm text-gray-500 dark:text-gray-400">Loading…</div>;
    }

    if (route.view === "loop") {
      if (!selectedLoop) {
        return shellLoading
          ? <div className="p-6 text-sm text-gray-500 dark:text-gray-400">Loading loop…</div>
          : (
            <ShellPanel eyebrow="Loop" title="Loop not found" description="The selected loop no longer exists.">
              <Button onClick={() => navigateWithinShell({ view: "home" })}>Back to overview</Button>
            </ShellPanel>
          );
      }

      if (selectedLoop?.state.status === "draft") {
        return (
          <DraftLoopComposer
            loop={selectedLoop}
            workspaces={workspaces}
            models={dashboardData.models}
            modelsLoading={dashboardData.modelsLoading}
            lastModel={dashboardData.lastModel}
            onWorkspaceChange={dashboardData.handleWorkspaceChange}
            planningWarning={dashboardData.planningWarning}
            branches={dashboardData.branches}
            branchesLoading={dashboardData.branchesLoading}
            currentBranch={dashboardData.currentBranch}
            defaultBranch={dashboardData.defaultBranch}
            registeredSshServers={servers}
            workspaceError={workspaceError}
            workspacesLoading={workspacesLoading}
            onRefresh={refreshLoops}
            onDeleteDraft={deleteLoop}
            onNavigate={navigateWithinShell}
          />
        );
      }

      return (
        <LoopDetails
          loopId={route.loopId}
          onBack={() => navigateWithinShell({ view: "home" })}
          showBackButton={false}
          onSelectSshSession={(sshSessionId) => navigateWithinShell({ view: "ssh", sshSessionId })}
        />
      );
    }

    if (route.view === "chat") {
      return (
        <LoopDetails
          loopId={route.chatId}
          onBack={() => navigateWithinShell({ view: "home" })}
          showBackButton={false}
          onSelectSshSession={(sshSessionId) => navigateWithinShell({ view: "ssh", sshSessionId })}
        />
      );
    }

    if (route.view === "ssh") {
      return (
        <SshSessionDetails
          sshSessionId={route.sshSessionId}
          onBack={() => navigateWithinShell({ view: "home" })}
          showBackButton={false}
        />
      );
    }

    if (route.view === "workspace") {
      if (!selectedWorkspace) {
        return (
          <ShellPanel eyebrow="Workspace" title="Workspace not found" description="The selected workspace no longer exists.">
            <Button onClick={() => navigateWithinShell({ view: "home" })}>Back to overview</Button>
          </ShellPanel>
        );
      }
      const relatedLoops = loops.filter((loop) => loop.config.workspaceId === selectedWorkspace.id);
      const relatedSessions = sessions.filter((session) => session.config.workspaceId === selectedWorkspace.id);
      return (
        <WorkspaceView
          workspace={selectedWorkspace}
          relatedLoops={relatedLoops}
          relatedSessions={relatedSessions}
          registeredSshServers={servers}
          onNavigate={navigateWithinShell}
        />
      );
    }

    if (route.view === "ssh-server") {
      if (!selectedServer) {
        return (
          <ShellPanel eyebrow="SSH server" title="Server not found" description="The selected SSH server no longer exists.">
            <Button onClick={() => navigateWithinShell({ view: "home" })}>Back to overview</Button>
          </ShellPanel>
        );
      }
      return (
        <SshServerView
          server={selectedServer}
          sessions={sessionsByServerId[selectedServer.config.id] ?? []}
          onNavigate={navigateWithinShell}
        />
      );
    }

    if (route.view === "compose") {
      return renderComposeView(route.kind);
    }

    if (route.view === "settings") {
      return (
        <ShellPanel
          eyebrow="App settings"
          title="Settings"
          description="Manage display, developer, import/export, and server controls."
          actions={(
            <Button variant="ghost" onClick={() => navigateWithinShell({ view: "home" })}>
              Back to overview
            </Button>
          )}
        >
          <AppSettingsPanel
            onResetAll={dashboardData.resetAllSettings}
            resetting={dashboardData.appSettingsResetting}
            onKillServer={dashboardData.killServer}
            killingServer={dashboardData.appSettingsKilling}
            onExportConfig={exportConfig}
            onImportConfig={importConfig}
            configSaving={workspacesSaving}
          />
        </ShellPanel>
      );
    }

    return (
      <OverviewView
        workspaces={workspaces}
        loops={loops}
        loopCount={activeLoopItems.length}
        chatCount={chatItems.length}
        workspaceSessionCount={sessions.length}
        standaloneSessionCount={standaloneSessions.length}
        servers={servers}
        workspaceGroups={workspaceGroups}
        onNavigate={navigateWithinShell}
      />
    );
  }

  return (
    <div className="flex h-full min-h-screen bg-gray-100 text-gray-950 dark:bg-gray-950 dark:text-gray-100">
      <div
        className={[
          "fixed inset-0 z-30 bg-gray-950/50 transition lg:hidden",
          sidebarOpen ? "opacity-100" : "pointer-events-none opacity-0",
        ].join(" ")}
        onClick={() => setSidebarOpen(false)}
      />

      <aside
        hidden={sidebarCollapsed && !sidebarOpen}
        aria-hidden={sidebarCollapsed && !sidebarOpen}
        className={[
          "fixed inset-y-0 left-0 z-40 flex w-80 max-w-[86vw] flex-col border-r border-gray-200 bg-gray-50/95 backdrop-blur transition-all duration-200 dark:border-gray-800 dark:bg-gray-900/95 lg:relative lg:inset-auto lg:z-10 lg:max-w-none lg:shrink-0",
          sidebarOpen ? "translate-x-0" : "-translate-x-full",
          sidebarCollapsed
            ? "lg:w-0 lg:min-w-0 lg:-translate-x-full lg:overflow-hidden lg:border-r-0 lg:opacity-0 lg:pointer-events-none"
            : "lg:w-80 lg:translate-x-0 lg:opacity-100",
        ].join(" ")}
      >
        <div className="flex h-16 items-center justify-between gap-3 border-b border-gray-200 px-4 dark:border-gray-800">
          <span className="text-xs font-semibold uppercase tracking-[0.24em] text-gray-500 dark:text-gray-400">
            Browse
          </span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => navigateWithinShell({ view: "settings" })}
              aria-label="Open settings"
              aria-current={route.view === "settings" ? "page" : undefined}
              className={[
                "inline-flex h-10 w-10 items-center justify-center rounded-xl border bg-white shadow-sm transition dark:bg-gray-900",
                route.view === "settings"
                  ? "border-gray-900 text-gray-900 dark:border-gray-100 dark:text-gray-100"
                  : "border-gray-200 text-gray-600 hover:border-gray-300 hover:text-gray-900 dark:border-gray-800 dark:text-gray-300 dark:hover:border-gray-700 dark:hover:text-gray-100",
              ].join(" ")}
              title="Settings"
            >
              <GearIcon size="h-5 w-5" />
            </button>
            <button
              type="button"
              onClick={hideSidebar}
              aria-label={sidebarOpen ? "Close sidebar" : "Hide sidebar"}
              className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-gray-200 bg-white text-gray-600 shadow-sm transition hover:border-gray-300 hover:text-gray-900 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-300 dark:hover:border-gray-700 dark:hover:text-gray-100"
            >
              <SidebarIcon size="h-5 w-5" />
            </button>
          </div>
        </div>

        <div className="flex-1 space-y-6 overflow-y-auto px-3 py-4 dark-scrollbar">
          <ShellSection
            title="Workspaces"
            count={workspaces.length}
            actionLabel="New"
            onAction={() => navigateWithinShell({ view: "compose", kind: "workspace" })}
            collapsed={isSectionCollapsed("workspaces")}
            onToggle={() => toggleSectionCollapsed("workspaces")}
          >
            {workspaces.length === 0 ? (
              <EmptySection message="No workspaces yet." />
            ) : (
              workspaces.map((workspace) => (
                <SectionItem
                  key={workspace.id}
                  active={route.view === "workspace" && route.workspaceId === workspace.id}
                  title={workspace.name}
                  subtitle={workspace.directory}
                  onClick={() => navigateWithinShell({ view: "workspace", workspaceId: workspace.id })}
                />
              ))
            )}
          </ShellSection>

          <ShellSection
            title="Drafts"
            count={draftLoopItems.length}
            collapsed={isSectionCollapsed("drafts")}
            onToggle={() => toggleSectionCollapsed("drafts")}
          >
            {draftLoopItems.length === 0 ? (
              <EmptySection message="No drafts yet." />
            ) : (
              draftLoopItems.map((loop) => (
                <SectionItem
                  key={loop.config.id}
                  active={route.view === "loop" && route.loopId === loop.config.id}
                  title={loop.config.name}
                  subtitle={loop.config.directory}
                  badge={getStatusLabel(loop.state.status, loop.state.syncState)}
                  onClick={() => navigateWithinShell({ view: "loop", loopId: loop.config.id })}
                />
              ))
            )}
          </ShellSection>

          <ShellSection
            title="Loops"
            count={activeLoopItems.length}
            actionLabel="New"
            onAction={() => navigateWithinShell({ view: "compose", kind: "loop" })}
            collapsed={isSectionCollapsed("loops")}
            onToggle={() => toggleSectionCollapsed("loops")}
          >
            {activeLoopItems.length === 0 ? (
              <EmptySection message="No loops yet." />
            ) : (
              activeLoopItems.map((loop) => (
                <SectionItem
                  key={loop.config.id}
                  active={route.view === "loop" && route.loopId === loop.config.id}
                  title={loop.config.name}
                  subtitle={loop.config.directory}
                  badge={getStatusLabel(loop.state.status, loop.state.syncState)}
                  onClick={() => navigateWithinShell({ view: "loop", loopId: loop.config.id })}
                />
              ))
            )}
          </ShellSection>

          <ShellSection
            title="Chats"
            count={chatItems.length}
            actionLabel="New"
            onAction={() => navigateWithinShell({ view: "compose", kind: "chat" })}
            collapsed={isSectionCollapsed("chats")}
            onToggle={() => toggleSectionCollapsed("chats")}
          >
            {chatItems.length === 0 ? (
              <EmptySection message="No chats yet." />
            ) : (
              chatItems.map((chat) => (
                <SectionItem
                  key={chat.config.id}
                  active={route.view === "chat" && route.chatId === chat.config.id}
                  title={chat.config.name}
                  subtitle={chat.config.directory}
                  badge={getStatusLabel(chat.state.status, chat.state.syncState)}
                  onClick={() => navigateWithinShell({ view: "chat", chatId: chat.config.id })}
                />
              ))
            )}
          </ShellSection>

          <ShellSection
            title="Workspace SSH"
            count={sessions.length}
            actionLabel="New"
            onAction={() => navigateWithinShell({ view: "compose", kind: "ssh-session" })}
            collapsed={isSectionCollapsed("workspace-ssh")}
            onToggle={() => toggleSectionCollapsed("workspace-ssh")}
          >
            {sessions.length === 0 ? (
              <EmptySection message="No workspace SSH sessions yet." />
            ) : (
              sessions.map((session) => (
                <SectionItem
                  key={session.config.id}
                  active={route.view === "ssh" && route.sshSessionId === session.config.id}
                  title={session.config.name}
                  subtitle={sshWorkspaces.find((workspace) => workspace.id === session.config.workspaceId)?.name ?? session.config.directory}
                  badge={session.state.status}
                  onClick={() => navigateWithinShell({ view: "ssh", sshSessionId: session.config.id })}
                />
              ))
            )}
          </ShellSection>

          <ShellSection
            title="SSH servers"
            count={servers.length}
            actionLabel="New"
            onAction={() => navigateWithinShell({ view: "compose", kind: "ssh-server" })}
            collapsed={isSectionCollapsed("ssh-servers")}
            onToggle={() => toggleSectionCollapsed("ssh-servers")}
          >
            {servers.length === 0 ? (
              <EmptySection message="No standalone SSH servers registered." />
            ) : (
              servers.map((server) => {
                const serverSessions = sessionsByServerId[server.config.id] ?? [];
                return (
                  <div key={server.config.id} className="space-y-1">
                    <SectionItem
                      active={route.view === "ssh-server" && route.serverId === server.config.id}
                      title={server.config.name}
                      subtitle={`${server.config.username}@${server.config.address}`}
                      badge={serverSessions.length > 0 ? String(serverSessions.length) : undefined}
                      onClick={() => navigateWithinShell({ view: "ssh-server", serverId: server.config.id })}
                    />
                    {serverSessions.map((session) => (
                      <SectionItem
                        key={session.config.id}
                        active={route.view === "ssh" && route.sshSessionId === session.config.id}
                        title={session.config.name}
                        subtitle={session.config.connectionMode === "direct" ? "Direct SSH" : "Persistent SSH"}
                        badge={session.state.status}
                        nested
                        onClick={() => navigateWithinShell({ view: "ssh", sshSessionId: session.config.id })}
                      />
                    ))}
                  </div>
                );
              })
            )}
          </ShellSection>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <div className="sticky top-0 z-20 flex h-16 items-center justify-between gap-3 border-b border-gray-200 bg-white/90 px-4 backdrop-blur dark:border-gray-800 dark:bg-gray-950/85 sm:px-6">
          <div className="flex min-w-0 items-center gap-3">
            <button
              type="button"
              onClick={openSidebar}
              aria-label="Open navigation"
              className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-gray-200 bg-white text-gray-600 shadow-sm transition hover:border-gray-300 hover:text-gray-900 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-300 dark:hover:border-gray-700 dark:hover:text-gray-100 lg:hidden"
            >
              <SidebarIcon size="h-5 w-5" />
            </button>
            {sidebarCollapsed && (
              <button
                type="button"
                onClick={openSidebar}
                aria-label="Open sidebar"
                className="hidden h-10 w-10 items-center justify-center rounded-xl border border-gray-200 bg-white text-gray-600 shadow-sm transition hover:border-gray-300 hover:text-gray-900 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-300 dark:hover:border-gray-700 dark:hover:text-gray-100 lg:inline-flex"
              >
                <SidebarIcon size="h-5 w-5" />
              </button>
            )}
            <p className="truncate text-sm font-medium text-gray-900 dark:text-gray-100">{currentTitle}</p>
          </div>
          <button
            type="button"
            onClick={() => navigateWithinShell({ view: "home" })}
            className="min-w-0 text-right"
          >
            <span className="truncate text-xs font-semibold uppercase tracking-[0.24em] text-gray-500 transition hover:text-gray-900 dark:text-gray-400 dark:hover:text-gray-100">
              RALPHER
            </span>
          </button>
        </div>

        {shellErrors.length > 0 && (
          <div className="border-b border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-amber-900/50 dark:bg-amber-950/40 dark:text-amber-200 sm:px-6">
            {shellErrors.join(" · ")}
          </div>
        )}

        <main className="min-h-0 flex-1 overflow-auto">{renderMainContent()}</main>
      </div>
    </div>
  );
}

export default AppShell;
