import { useEffect, useId, useMemo, useRef, useState, type FormEvent, type InputHTMLAttributes } from "react";
import type {
  CreateChatRequest,
  CreateLoopRequest,
  Loop,
  SshConnectionMode,
  SshServer,
  SshServerSession,
  Workspace,
} from "../types";
import { getCreateWorkspaceDefaultServerSettings, getServerLabel } from "../types/settings";
import type { AgentProvider, ServerSettings } from "../types/settings";
import type { CreateWorkspaceRequest } from "../types/workspace";
import { createLogger } from "../lib/logger";
import { appFetch } from "../lib/public-path";
import { getStoredSshServerCredential } from "../lib/ssh-browser-credentials";
import {
  useDashboardData,
  useLoopGrouping,
  useLoops,
  useProvisioningJob,
  useSshServers,
  useSshSessions,
  useToast,
  useWorkspaceServerSettings,
  useWorkspaces,
} from "../hooks";
import { getPlanningStatusLabel, getStatusLabel } from "../utils";
import { AppSettingsPanel } from "./AppSettingsModal";
import { CreateLoopForm, type CreateLoopFormActionState, type CreateLoopFormSubmitRequest } from "./CreateLoopForm";
import { LoopDetails } from "./LoopDetails";
import { ProvisioningJobView } from "./ProvisioningJobView";
import { ServerSettingsForm } from "./ServerSettingsForm";
import { SshSessionDetails } from "./SshSessionDetails";
import { WorkspaceSettingsForm } from "./WorkspaceSettingsModal";
import { WorkspaceSelector } from "./WorkspaceSelector";
import {
  ActionMenu,
  type ActionMenuItem,
  Badge,
  Button,
  ConfirmModal,
  GearIcon,
  PASSWORD_INPUT_PROPS,
  SidebarIcon,
  type BadgeVariant,
  getStatusBadgeVariant,
} from "./common";

const log = createLogger("AppShell");
const SIDEBAR_SECTION_STORAGE_KEY = "ralpher.sidebarSectionCollapseState";

type SidebarSectionId =
  | "workspaces"
  | "loops"
  | "chats"
  | "workspace-ssh"
  | "ssh-servers";

type SidebarSectionCollapseState = Partial<Record<SidebarSectionId, boolean>>;

interface SidebarSectionCollapseStateLoadResult {
  state: SidebarSectionCollapseState;
  invalidReason: string | null;
}

const SIDEBAR_SECTION_IDS: SidebarSectionId[] = [
  "workspaces",
  "loops",
  "chats",
  "workspace-ssh",
  "ssh-servers",
];

interface WorkspaceSidebarGroup {
  key: string;
  title: string;
  items: Loop[];
}

function getWorkspaceGroupCollapseKey(sectionId: SidebarSectionId, groupKey: string): string {
  return `${sectionId}:${groupKey}`;
}

function getSshConnectionModeLabel(mode: SshConnectionMode): string {
  return mode === "direct" ? "Direct SSH" : "Persistent SSH";
}

function getProvisioningStatusBadgeVariant(status: string | undefined): BadgeVariant {
  switch (status) {
    case "completed":
      return "success";
    case "failed":
      return "error";
    case "running":
      return "info";
    case "pending":
      return "warning";
    case "cancelled":
      return "default";
    default:
      return "default";
  }
}

function groupSidebarItemsByWorkspace(
  items: Loop[],
  workspaces: readonly Workspace[],
): WorkspaceSidebarGroup[] {
  const workspacesById = new Map(workspaces.map((workspace) => [workspace.id, workspace]));
  const workspaceOrder = new Map(workspaces.map((workspace, index) => [workspace.id, index]));
  const groups = new Map<string, WorkspaceSidebarGroup & { order: number }>();

  for (const item of items) {
    const workspace = workspacesById.get(item.config.workspaceId);
    const key = workspace?.id ?? `missing:${item.config.workspaceId ?? item.config.id}`;
    const group = groups.get(key) ?? {
      key,
      title: workspace?.name ?? "Unknown workspace",
      order: workspace ? (workspaceOrder.get(workspace.id) ?? Number.MAX_SAFE_INTEGER) : Number.MAX_SAFE_INTEGER,
      items: [],
    };
    group.items.push(item);
    groups.set(key, group);
  }

  return Array.from(groups.values())
    .sort((left, right) => {
      if (left.order !== right.order) {
        return left.order - right.order;
      }
      return left.title.localeCompare(right.title);
    })
    .map(({ key, title, items: groupedItems }) => ({ key, title, items: groupedItems }));
}

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

function loadSidebarSectionCollapseState(): SidebarSectionCollapseStateLoadResult {
  const storage = getSidebarSectionStorage();
  if (!storage) {
    return {
      state: {},
      invalidReason: null,
    };
  }

  const raw = storage.getItem(SIDEBAR_SECTION_STORAGE_KEY);
  if (!raw) {
    return {
      state: {},
      invalidReason: null,
    };
  }

  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("Invalid sidebar section state payload");
    }

    const parsedState = parsed as Record<string, unknown>;
    const sanitizedState = SIDEBAR_SECTION_IDS.reduce<SidebarSectionCollapseState>((state, sectionId) => {
      if (typeof parsedState[sectionId] === "boolean") {
        state[sectionId] = parsedState[sectionId] as boolean;
      }
      return state;
    }, {});
    return {
      state: sanitizedState,
      invalidReason: null,
    };
  } catch (error) {
    return {
      state: {},
      invalidReason: String(error),
    };
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
  | { view: "workspace-settings"; workspaceId: string }
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
              className="flex w-full min-w-0 items-center gap-2 rounded-lg px-1 py-1 text-left transition hover:bg-gray-100 dark:hover:bg-neutral-800/60"
            >
              <span className="text-xs text-gray-500 dark:text-gray-400">{collapsed ? "\u25B6" : "\u25BC"}</span>
              <span className="truncate text-xs font-semibold uppercase tracking-[0.18em] text-gray-500 dark:text-gray-400">
                {title}
              </span>
            </button>
          </h2>
          {typeof count === "number" && (
            <span className="rounded-full bg-gray-200 px-2 py-0.5 text-[10px] font-semibold text-gray-600 dark:bg-neutral-800 dark:text-gray-300">
              {count}
            </span>
          )}
        </div>
        {onAction && actionLabel && (
          <button
            type="button"
            onClick={onAction}
            className="rounded-md px-2 py-1 text-xs font-medium text-gray-500 transition hover:bg-gray-200 hover:text-gray-900 dark:text-gray-400 dark:hover:bg-neutral-800 dark:hover:text-gray-100"
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
          ? "border-gray-900 bg-gray-900 text-white shadow-sm dark:border-gray-100 dark:bg-neutral-100 dark:text-gray-950"
          : "border-transparent bg-transparent text-gray-700 hover:border-gray-200 hover:bg-gray-100 dark:text-gray-200 dark:hover:border-gray-800 dark:hover:bg-neutral-800/80",
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
              ? "bg-white/10 text-white dark:bg-neutral-900/10 dark:text-gray-950"
              : "bg-gray-200 text-gray-600 dark:bg-neutral-700 dark:text-gray-300",
          ].join(" ")}
        >
          {badge}
        </span>
      )}
    </button>
  );
}

function WorkspaceGroupedSectionItems({
  sectionId,
  groups,
  collapsedGroups,
  onToggleGroup,
  renderItem,
}: {
  sectionId: SidebarSectionId;
  groups: readonly WorkspaceSidebarGroup[];
  collapsedGroups: Partial<Record<string, boolean>>;
  onToggleGroup: (sectionId: SidebarSectionId, groupKey: string) => void;
  renderItem: (loop: Loop) => React.ReactNode;
}) {
  return (
    <div className="space-y-3">
      {groups.map((group) => {
        const collapseKey = getWorkspaceGroupCollapseKey(sectionId, group.key);
        const collapsed = collapsedGroups[collapseKey] ?? false;
        return (
          <div key={group.key} className="space-y-1">
            <button
              type="button"
              onClick={() => onToggleGroup(sectionId, group.key)}
              className="flex w-full items-center gap-2 rounded-lg px-3 py-1.5 text-left transition hover:bg-gray-100 dark:hover:bg-neutral-800/60"
              aria-expanded={!collapsed}
            >
              <span className="text-[11px] text-gray-500 dark:text-gray-400">{collapsed ? "\u25B6" : "\u25BC"}</span>
              <span className="min-w-0 flex-1 truncate text-[11px] font-semibold uppercase tracking-[0.18em] text-gray-500 dark:text-gray-400">
                {group.title}
              </span>
            </button>
            {!collapsed && (
              <div className="space-y-1">
                {group.items.map(renderItem)}
              </div>
            )}
          </div>
        );
      })}
    </div>
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
  eyebrow: _eyebrow,
  title,
  description,
  descriptionClassName,
  actions,
  badges,
  variant = "card",
  bodyClassName,
  headerOffsetClassName,
  children,
}: {
  eyebrow?: string;
  title: string;
  description?: string;
  descriptionClassName?: string;
  actions?: React.ReactNode;
  badges?: React.ReactNode;
  variant?: "card" | "compact";
  bodyClassName?: string;
  headerOffsetClassName?: string;
  children: React.ReactNode;
}) {
  if (variant === "compact") {
    return (
      <div className="flex h-full min-h-0 flex-col overflow-hidden bg-gray-50 dark:bg-neutral-900">
        <div className="border-b border-gray-200 bg-white px-4 py-2 dark:border-gray-800 dark:bg-neutral-800 sm:px-6 lg:px-8">
          <div
            className={[
              headerOffsetClassName ?? "ml-14 sm:ml-16 lg:ml-0",
              "flex min-h-14 flex-wrap items-center gap-1.5",
            ].join(" ")}
          >
            <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5">
              <h1 className="min-w-0 truncate text-base font-semibold text-gray-900 dark:text-gray-100">
                {title}
              </h1>
              {badges && <div className="flex flex-wrap items-center gap-1.5">{badges}</div>}
              {description && (
                <span
                  className={[
                    "min-w-0 max-w-full truncate text-xs text-gray-500 dark:text-gray-400",
                    descriptionClassName ?? "",
                  ].join(" ").trim()}
                >
                  {description}
                </span>
              )}
            </div>
            {actions && <div className="ml-auto flex max-w-full flex-wrap items-center justify-end gap-1.5">{actions}</div>}
          </div>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden px-4 py-5 pb-[calc(6rem+var(--safe-area-inset-bottom))] sm:px-6 sm:pb-5 lg:px-8 lg:py-6">
          <div className={bodyClassName ?? "space-y-6"}>
            {children}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex w-full min-w-0 flex-col gap-6 px-4 pb-5 pt-16 sm:px-6 sm:pt-20 lg:px-8 lg:pb-8 lg:pt-8">
      <div className="flex flex-col gap-4 rounded-3xl border border-gray-200 bg-white p-6 shadow-sm dark:border-gray-800 dark:bg-neutral-900/80">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="space-y-2">
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="text-2xl font-semibold text-gray-950 dark:text-gray-100">{title}</h1>
                {badges && <div className="flex flex-wrap items-center gap-2">{badges}</div>}
              </div>
              {description && (
                <p className={["mt-2 max-w-3xl text-sm text-gray-600 dark:text-gray-400", descriptionClassName ?? ""].join(" ").trim()}>
                  {description}
                </p>
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
    <div className="rounded-2xl border border-gray-200 bg-gray-50 p-4 dark:border-gray-800 dark:bg-neutral-950/50">
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
  inputProps,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  type?: string;
  required?: boolean;
  help?: string;
  inputProps?: InputHTMLAttributes<HTMLInputElement>;
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
        {...inputProps}
        className="block w-full rounded-xl border border-gray-300 bg-white px-3 py-2.5 text-sm text-gray-900 shadow-sm outline-none transition focus:border-gray-500 focus:ring-2 focus:ring-gray-300 dark:border-gray-700 dark:bg-neutral-800 dark:text-gray-100 dark:focus:border-gray-500 dark:focus:ring-gray-700"
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
  sessionsByServerId,
  workspaceGroups,
  headerOffsetClassName,
  onNavigate,
}: {
  workspaces: Workspace[];
  loops: ReturnType<typeof useLoops>["loops"];
  loopCount: number;
  chatCount: number;
  workspaceSessionCount: number;
  standaloneSessionCount: number;
  servers: SshServer[];
  sessionsByServerId: Record<string, SshServerSession[]>;
  workspaceGroups: ReturnType<typeof useLoopGrouping>["workspaceGroups"];
  headerOffsetClassName?: string;
  onNavigate: (route: ShellRoute) => void;
}) {
  const recentLoops = useMemo(() => {
    return [...loops]
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
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <SummaryCard label="Workspaces" value={workspaces.length} meta="Tracked repositories and hosts." />
        <SummaryCard label="Loops" value={loopCount} meta="Task-oriented Ralph loops." />
        <SummaryCard label="Chats" value={chatCount} meta="Interactive conversations." />
        <SummaryCard
          label="SSH"
          value={workspaceSessionCount + standaloneSessionCount}
          meta={`${servers.length} saved standalone SSH servers.`}
        />
      </div>

      <div className="space-y-6">
        <div className="space-y-4 rounded-2xl border border-gray-200 bg-gray-50 p-5 dark:border-gray-800 dark:bg-neutral-950/50">
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

        <div className="grid gap-6 xl:grid-cols-[0.8fr,1.2fr]">
          <div className="space-y-4 rounded-2xl border border-gray-200 bg-gray-50 p-5 dark:border-gray-800 dark:bg-neutral-950/50">
            <div>
              <h2 className="text-lg font-semibold text-gray-950 dark:text-gray-100">Servers map</h2>
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
          <Button variant="secondary" size="sm" onClick={onOpenSettings} aria-label="Open workspace settings">
            <span className="sm:hidden">Settings</span>
            <span className="hidden sm:inline">Workspace Settings</span>
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

      <div className="grid gap-6 xl:grid-cols-2">
        <div className="space-y-4 rounded-2xl border border-gray-200 bg-gray-50 p-5 dark:border-gray-800 dark:bg-neutral-950/50">
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
                    className="flex w-full items-center justify-between rounded-2xl border border-gray-200 bg-white px-4 py-3 text-left transition hover:border-gray-300 hover:bg-gray-100 dark:border-gray-800 dark:bg-neutral-900 dark:hover:border-gray-700 dark:hover:bg-neutral-800"
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

        <div className="space-y-4 rounded-2xl border border-gray-200 bg-gray-50 p-5 dark:border-gray-800 dark:bg-neutral-950/50">
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
      </div>
    </ShellPanel>
  );
}

function SshServerView({
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
      description={selectedWorkspace ? selectedWorkspace.name : loop.config.directory}
      variant="compact"
      headerOffsetClassName={headerOffsetClassName}
      badges={(
        <>
          <Badge variant="default" size="sm">Draft</Badge>
          {actionState?.planMode && <Badge variant="planning" size="sm">Plan mode</Badge>}
        </>
      )}
      actions={(
        <>
          <Button
            type="button"
            variant="danger"
            size="sm"
            onClick={() => setDeleteConfirmOpen(true)}
            disabled={deleteSubmitting || actionState?.isSubmitting}
          >
            Delete Draft
          </Button>
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
            variant="secondary"
            size="sm"
            onClick={actionState?.onSaveAsDraft}
            disabled={deleteSubmitting || !actionState?.canSaveDraft}
            loading={actionState?.isSubmitting ?? false}
          >
            Update Draft
          </Button>
          <Button
            type="button"
            size="sm"
            onClick={actionState?.onSubmit}
            disabled={deleteSubmitting || !actionState?.canSubmit}
            loading={actionState?.isSubmitting ?? false}
          >
            {actionState?.planMode ? "Start Plan" : "Start Loop"}
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

function SshSessionComposer({
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

function SshServerComposer({
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

export function AppShell({ route, onNavigate }: AppShellProps) {
  const toast = useToast();
  const {
    loops,
    loading: loopsLoading,
    error: loopsError,
    refresh: refreshLoops,
    createLoop,
    createChat,
    purgeLoop,
    purgeArchivedWorkspaceLoops,
  } = useLoops();
  const {
    sessions,
    loading: sshSessionsLoading,
    error: sshSessionsError,
    refresh: refreshSshSessions,
    createSession,
  } = useSshSessions();
  const {
    servers,
    sessionsByServerId,
    loading: sshServersLoading,
    error: sshServersError,
    refresh: refreshSshServers,
    createServer,
    deleteServer,
    createSession: createStandaloneSession,
  } = useSshServers();
  const {
    workspaces,
    loading: workspacesLoading,
    saving: workspacesSaving,
    error: workspaceError,
    refresh: refreshWorkspaces,
    createWorkspace,
    deleteWorkspace,
    exportConfig,
    importConfig,
  } = useWorkspaces();
  const dashboardData = useDashboardData();
  const provisioning = useProvisioningJob();
  const { workspaceGroups } = useLoopGrouping(loops, workspaces);

  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const shellHeaderOffsetClassName = sidebarCollapsed
    ? "ml-14 sm:ml-16 lg:ml-[4.5rem]"
    : "ml-14 sm:ml-16 lg:ml-0";
  const initialSidebarSectionState = useMemo(() => loadSidebarSectionCollapseState(), []);
  const [collapsedSections, setCollapsedSections] = useState<SidebarSectionCollapseState>(initialSidebarSectionState.state);
  const [collapsedWorkspaceGroups, setCollapsedWorkspaceGroups] = useState<Partial<Record<string, boolean>>>({});
  const [workspaceCreateMode, setWorkspaceCreateMode] = useState<"manual" | "automatic">("manual");
  const [workspaceName, setWorkspaceName] = useState("");
  const [workspaceDirectory, setWorkspaceDirectory] = useState("");
  const [workspaceServerSettings, setWorkspaceServerSettings] = useState<ServerSettings>(() => getCreateWorkspaceDefaultServerSettings());
  const [workspaceServerSettingsValid, setWorkspaceServerSettingsValid] = useState(true);
  const [workspaceTesting, setWorkspaceTesting] = useState(false);
  const [workspaceCreateSubmitting, setWorkspaceCreateSubmitting] = useState(false);
  const [workspaceSettingsFormValid, setWorkspaceSettingsFormValid] = useState(false);
  const [workspaceArchivedLoopsPurging, setWorkspaceArchivedLoopsPurging] = useState(false);
  const [composeActionState, setComposeActionState] = useState<CreateLoopFormActionState | null>(null);
  const [automaticServerId, setAutomaticServerId] = useState("");
  const [automaticRepoUrl, setAutomaticRepoUrl] = useState("");
  const [automaticBasePath, setAutomaticBasePath] = useState("/workspaces");
  const [automaticProvider, setAutomaticProvider] = useState<AgentProvider>("copilot");
  const [automaticPassword, setAutomaticPassword] = useState("");
  const lastProvisioningRefreshIdRef = useRef<string | null>(null);

  const sshWorkspaces = useMemo(() => {
    return workspaces.filter((workspace) => workspace.serverSettings.agent.transport === "ssh");
  }, [workspaces]);

  const workspacesById = useMemo(() => {
    return new Map(workspaces.map((workspace) => [workspace.id, workspace]));
  }, [workspaces]);
  const serversById = useMemo(() => {
    return new Map(servers.map((server) => [server.config.id, server]));
  }, [servers]);
  const loopItems = useMemo(() => loops.filter((loop) => loop.config.mode !== "chat"), [loops]);
  const activeLoopItems = useMemo(() => loopItems.filter((loop) => loop.state.status !== "draft"), [loopItems]);
  const chatItems = useMemo(() => loops.filter((loop) => loop.config.mode === "chat"), [loops]);
  const standaloneSessions = useMemo(() => Object.values(sessionsByServerId).flat(), [sessionsByServerId]);
  const loopGroups = useMemo(() => groupSidebarItemsByWorkspace(loopItems, workspaces), [loopItems, workspaces]);
  const chatGroups = useMemo(() => groupSidebarItemsByWorkspace(chatItems, workspaces), [chatItems, workspaces]);
  const allShellSessions = useMemo(() => {
    return [
      ...sessions.map((session) => ({
        id: session.config.id,
        title: session.config.name,
        subtitle: `${workspacesById.get(session.config.workspaceId)?.name ?? "Unknown workspace"} · ${getSshConnectionModeLabel(session.config.connectionMode)}`,
        badge: session.state.status,
        createdAt: session.config.createdAt,
      })),
      ...standaloneSessions.map((session) => ({
        id: session.config.id,
        title: session.config.name,
        subtitle: `${serversById.get(session.config.sshServerId)?.config.name ?? "Unknown server"} · ${getSshConnectionModeLabel(session.config.connectionMode)}`,
        badge: session.state.status,
        createdAt: session.config.createdAt,
      })),
    ].sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  }, [serversById, sessions, standaloneSessions, workspacesById]);
  const selectedLoop = route.view === "loop"
    ? loopItems.find((loop) => loop.config.id === route.loopId) ?? null
    : null;

  const selectedWorkspace = route.view === "workspace" || route.view === "workspace-settings"
    ? workspaces.find((workspace) => workspace.id === route.workspaceId) ?? null
    : null;
  const composeWorkspace = route.view === "compose" && route.scopeId
    ? workspaces.find((workspace) => workspace.id === route.scopeId) ?? null
    : null;
  const composeServer = route.view === "compose" && route.kind === "ssh-session" && route.scopeId
    ? servers.find((server) => server.config.id === route.scopeId) ?? null
    : null;
  const selectedServer = route.view === "ssh-server"
    ? servers.find((server) => server.config.id === route.serverId) ?? null
    : null;
  const workspaceSettingsWorkspaceId = route.view === "workspace-settings"
    ? route.workspaceId
    : null;
  const {
    workspace: workspaceFromHook,
    status: workspaceStatus,
    loading: workspaceSettingsLoading,
    error: workspaceSettingsError,
    saving: workspaceSettingsSaving,
    testing: workspaceSettingsTesting,
    resettingConnection: workspaceSettingsResetting,
    testConnection: testWorkspaceConnection,
    resetConnection: resetWorkspaceConnection,
    updateWorkspace: updateWorkspaceSettings,
  } = useWorkspaceServerSettings(workspaceSettingsWorkspaceId);
  const selectedWorkspaceArchivedLoopCount = useMemo(() => {
    if (!workspaceSettingsWorkspaceId) {
      return 0;
    }

    return workspaceGroups.find((group) => group.workspace.id === workspaceSettingsWorkspaceId)?.statusGroups.archived.length ?? 0;
  }, [workspaceGroups, workspaceSettingsWorkspaceId]);
  const selectedWorkspaceLoopCount = useMemo(() => {
    if (!workspaceSettingsWorkspaceId) {
      return 0;
    }

    return workspaceGroups.find((group) => group.workspace.id === workspaceSettingsWorkspaceId)?.loops.length ?? 0;
  }, [workspaceGroups, workspaceSettingsWorkspaceId]);

  useEffect(() => {
    if (route.view !== "compose" || (route.kind !== "loop" && route.kind !== "chat")) {
      dashboardData.resetCreateModalState();
    }
  }, [dashboardData.resetCreateModalState, route]);

  useEffect(() => {
    if (route.view !== "compose" || (route.kind !== "loop" && route.kind !== "chat")) {
      setComposeActionState(null);
    }
  }, [route.view, route.view === "compose" ? route.kind : undefined]);

  useEffect(() => {
    if (route.view !== "workspace-settings") {
      setWorkspaceSettingsFormValid(false);
    }
  }, [route.view]);

  useEffect(() => {
    setWorkspaceSettingsFormValid(false);
  }, [workspaceSettingsWorkspaceId]);

  useEffect(() => {
    if (route.view !== "compose" || route.kind !== "workspace") {
      return;
    }

    if (provisioning.activeJobId) {
      setWorkspaceCreateMode("automatic");
      return;
    }

    setWorkspaceCreateMode("manual");
    setWorkspaceName("");
    setWorkspaceDirectory("");
    setWorkspaceServerSettings(getCreateWorkspaceDefaultServerSettings());
    setWorkspaceServerSettingsValid(true);
    setWorkspaceTesting(false);
    setWorkspaceCreateSubmitting(false);
    setAutomaticServerId(servers[0]?.config.id ?? "");
    setAutomaticRepoUrl("");
    setAutomaticBasePath("/workspaces");
    setAutomaticProvider("copilot");
    setAutomaticPassword("");
  }, [provisioning.activeJobId, route, servers]);

  useEffect(() => {
    if (route.view !== "compose" || route.kind !== "workspace" || automaticServerId || !servers[0]) {
      return;
    }
    setAutomaticServerId(servers[0].config.id);
  }, [automaticServerId, route, servers]);

  useEffect(() => {
    const jobId = provisioning.snapshot?.job.config.id ?? null;
    if (
      provisioning.snapshot?.job.state.status === "completed"
      && jobId
      && lastProvisioningRefreshIdRef.current !== jobId
    ) {
      lastProvisioningRefreshIdRef.current = jobId;
      void refreshWorkspaces();
    }
  }, [provisioning.snapshot?.job.config.id, provisioning.snapshot?.job.state.status, refreshWorkspaces]);

  useEffect(() => {
    if (!initialSidebarSectionState.invalidReason) {
      return;
    }

    log.warn("Removing invalid sidebar section state", { error: initialSidebarSectionState.invalidReason });
  }, [initialSidebarSectionState.invalidReason]);

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

  function toggleWorkspaceGroupCollapsed(sectionId: SidebarSectionId, groupKey: string) {
    const collapseKey = getWorkspaceGroupCollapseKey(sectionId, groupKey);
    setCollapsedWorkspaceGroups((current) => ({
      ...current,
      [collapseKey]: !(current[collapseKey] ?? false),
    }));
  }

  function handleLoopDetailsExit() {
    navigateWithinShell({ view: "home" });
    void refreshLoops();
  }

  async function handlePurgeArchivedLoops(workspaceId: string) {
    try {
      setWorkspaceArchivedLoopsPurging(true);
      return await purgeArchivedWorkspaceLoops(workspaceId);
    } finally {
      setWorkspaceArchivedLoopsPurging(false);
    }
  }

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

  function handleBackToAutomaticWorkspaceForm() {
    const config = provisioning.snapshot?.job.config;
    if (!config) {
      provisioning.clearActiveJob();
      return;
    }

    setWorkspaceCreateMode("automatic");
    setWorkspaceName(config.name);
    setAutomaticServerId(config.sshServerId);
    setAutomaticRepoUrl(config.repoUrl);
    setAutomaticBasePath(config.basePath);
    setAutomaticProvider(config.provider);
    setAutomaticPassword("");
    provisioning.clearActiveJob();
  }

  async function handleCreateWorkspace(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const name = workspaceName.trim();
    if (!name) {
      toast.error("Workspace name is required.");
      return;
    }

    if (workspaceCreateMode === "automatic") {
      if (!automaticServerId.trim() || !automaticRepoUrl.trim() || !automaticBasePath.trim()) {
        toast.error("Saved SSH server, repository URL, and remote base path are required.");
        return;
      }

      const snapshot = await provisioning.startJob({
        name,
        sshServerId: automaticServerId,
        repoUrl: automaticRepoUrl.trim(),
        basePath: automaticBasePath.trim(),
        provider: automaticProvider,
        password: automaticPassword,
      });
      if (snapshot) {
        setWorkspaceCreateMode("automatic");
        setAutomaticPassword("");
      }
      return;
    }

    const directory = workspaceDirectory.trim();
    if (!directory || !workspaceServerSettingsValid) {
      toast.error("Directory and valid connection settings are required.");
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
      const handleComposeCancel = () => navigateWithinShell(
        composeWorkspace ? { view: "workspace", workspaceId: composeWorkspace.id } : { view: "home" },
      );

      return (
        <ShellPanel
          eyebrow={kind === "chat" ? "Chat" : "Loop"}
          title={kind === "chat"
            ? composeWorkspace ? `Start a new chat in ${composeWorkspace.name}` : "Start a new chat"
            : composeWorkspace ? `Start a new loop in ${composeWorkspace.name}` : "Start a new loop"}
          description={composeWorkspace?.directory}
          descriptionClassName="hidden sm:inline font-mono"
          variant="compact"
          headerOffsetClassName={shellHeaderOffsetClassName}
          actions={(
            <>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={composeActionState?.onCancel ?? handleComposeCancel}
                disabled={composeActionState?.isSubmitting}
              >
                Cancel
              </Button>
              {kind === "loop" && composeActionState && (!composeActionState.isEditing || composeActionState.isEditingDraft) && (
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  onClick={composeActionState.onSaveAsDraft}
                  aria-label={composeActionState.isEditingDraft ? "Update Draft" : "Save as Draft"}
                  disabled={!composeActionState.canSaveDraft}
                  loading={composeActionState.isSubmitting}
                >
                  {composeActionState.isEditingDraft ? "Update Draft" : (
                    <>
                      <span className="sm:hidden">Save Draft</span>
                      <span className="hidden sm:inline">Save as Draft</span>
                    </>
                  )}
                </Button>
              )}
              {composeActionState && (
                <Button
                  type="button"
                  size="sm"
                  onClick={composeActionState.onSubmit}
                  disabled={!composeActionState.canSubmit}
                  loading={composeActionState.isSubmitting}
                >
                  {kind === "chat"
                    ? "Start Chat"
                    : composeActionState.isEditing
                      ? (composeActionState.planMode ? "Start Plan" : "Start Loop")
                      : (composeActionState.planMode ? "Create Plan" : "Create Loop")}
                </Button>
              )}
            </>
          )}
        >
          <CreateLoopForm
            key={`${kind}:${composeWorkspace?.id ?? "none"}`}
            mode={kind}
            onSubmit={(request) => handleLoopSubmit(kind, request)}
            onCancel={handleComposeCancel}
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
            renderActions={setComposeActionState}
          />
        </ShellPanel>
      );
    }

    if (kind === "workspace") {
      const workspaceCreateFormId = "workspace-create-form";
      const provisioningStatus = provisioning.snapshot?.job.state.status;
      const provisionedWorkspaceId = provisioning.snapshot?.workspace?.id ?? provisioning.snapshot?.job.state.workspaceId;
      const canReturnToAutomaticForm = provisioningStatus === "failed" || provisioningStatus === "cancelled";
      const selectedServerHasStoredCredential = automaticServerId
        ? getStoredSshServerCredential(automaticServerId) !== null
        : false;
      const automaticFormValid = workspaceName.trim().length > 0
        && automaticServerId.trim().length > 0
        && automaticRepoUrl.trim().length > 0
        && automaticBasePath.trim().length > 0;
      const manualFormValid = workspaceName.trim().length > 0
        && workspaceDirectory.trim().length > 0
        && workspaceServerSettingsValid;

      return (
        <ShellPanel
          eyebrow="Workspace"
          title="Create a workspace"
          variant="compact"
          headerOffsetClassName={shellHeaderOffsetClassName}
          badges={(
            <>
              <Badge variant={workspaceCreateMode === "automatic" ? "info" : "default"} size="sm">
                {workspaceCreateMode === "automatic" ? "Automatic" : "Manual"}
              </Badge>
              {provisioningStatus && (
                <Badge variant={getProvisioningStatusBadgeVariant(provisioningStatus)} size="sm">
                  {provisioningStatus}
                </Badge>
              )}
            </>
          )}
          actions={provisioning.activeJobId ? (
            <>
              {canReturnToAutomaticForm && (
                <Button type="button" size="sm" onClick={handleBackToAutomaticWorkspaceForm}>
                  Back to Automatic Form
                </Button>
              )}
              {provisionedWorkspaceId && provisioningStatus === "completed" && (
                <Button
                  type="button"
                  size="sm"
                  onClick={() => navigateWithinShell({ view: "workspace", workspaceId: provisionedWorkspaceId })}
                >
                  Open Workspace
                </Button>
              )}
              {(provisioningStatus === "running" || provisioningStatus === "pending") && (
                <Button
                  type="button"
                  size="sm"
                  variant="danger"
                  onClick={() => {
                    void provisioning.cancelJob();
                  }}
                >
                  Cancel Job
                </Button>
              )}
            </>
          ) : (
            <>
              <Button
                type="button"
                size="sm"
                variant={workspaceCreateMode === "manual" ? "primary" : "secondary"}
                onClick={() => setWorkspaceCreateMode("manual")}
              >
                Manual
              </Button>
              <Button
                type="button"
                size="sm"
                variant={workspaceCreateMode === "automatic" ? "primary" : "secondary"}
                onClick={() => setWorkspaceCreateMode("automatic")}
              >
                Automatic
              </Button>
              <Button type="button" variant="ghost" size="sm" onClick={() => navigateWithinShell({ view: "home" })}>
                Cancel
              </Button>
              <Button
                type="submit"
                form={workspaceCreateFormId}
                size="sm"
                loading={workspaceCreateMode === "automatic" ? provisioning.starting : (workspaceCreateSubmitting || workspacesSaving)}
                disabled={workspaceCreateMode === "automatic" ? !automaticFormValid : !manualFormValid}
              >
                {workspaceCreateMode === "automatic" ? "Start Provisioning" : "Create Workspace"}
              </Button>
            </>
          )}
        >
          {provisioning.activeJobId ? (
            <div className="space-y-6">
              <ProvisioningJobView
                snapshot={provisioning.snapshot}
                logs={provisioning.logs}
                websocketStatus={provisioning.websocketStatus}
                loading={provisioning.loading}
                error={provisioning.error}
              />
            </div>
          ) : (
            <form id={workspaceCreateFormId} className="space-y-6" onSubmit={(event) => void handleCreateWorkspace(event)}>
              <InlineField
                id="workspace-name"
                label="Workspace name"
                value={workspaceName}
                onChange={setWorkspaceName}
                placeholder="Main repository"
                required
              />

              {workspaceCreateMode === "manual" ? (
                <>
                  <InlineField
                    id="workspace-directory"
                    label="Directory"
                    value={workspaceDirectory}
                    onChange={setWorkspaceDirectory}
                    placeholder="/workspaces/project"
                    required
                    help="Absolute path on the selected workspace host."
                  />
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
                </>
              ) : (
                <div className="space-y-4">
                  <div>
                    <label htmlFor="automatic-ssh-server" className="mb-1.5 block text-sm font-medium text-gray-700 dark:text-gray-300">
                      Saved SSH server <span className="ml-1 text-red-500">*</span>
                    </label>
                    <select
                      id="automatic-ssh-server"
                      value={automaticServerId}
                      onChange={(event) => setAutomaticServerId(event.target.value)}
                      className="block w-full rounded-xl border border-gray-300 bg-white px-3 py-2.5 text-sm text-gray-900 shadow-sm outline-none transition focus:border-gray-500 focus:ring-2 focus:ring-gray-300 dark:border-gray-700 dark:bg-neutral-800 dark:text-gray-100 dark:focus:border-gray-500 dark:focus:ring-gray-700"
                    >
                      <option value="">Select a saved SSH server</option>
                      {servers.map((server) => (
                        <option key={server.config.id} value={server.config.id}>
                          {server.config.name} ({server.config.username}@{server.config.address})
                        </option>
                      ))}
                    </select>
                    {servers.length === 0 && (
                      <p className="mt-1 text-xs text-amber-600 dark:text-amber-400">
                        Register a saved SSH server first to use automatic workspace provisioning.
                      </p>
                    )}
                  </div>

                  <InlineField
                    id="automatic-repo-url"
                    label="Git repository URL"
                    value={automaticRepoUrl}
                    onChange={setAutomaticRepoUrl}
                    placeholder="git@github.com:owner/repo.git"
                    required
                    help="Repository to clone on the remote host."
                  />

                  <InlineField
                    id="automatic-base-path"
                    label="Remote base path"
                    value={automaticBasePath}
                    onChange={setAutomaticBasePath}
                    placeholder="/workspaces"
                    required
                    help="Parent directory where the repo should be cloned."
                  />

                  <div>
                    <label htmlFor="automatic-provider" className="mb-1.5 block text-sm font-medium text-gray-700 dark:text-gray-300">
                      Provider <span className="ml-1 text-red-500">*</span>
                    </label>
                    <select
                      id="automatic-provider"
                      value={automaticProvider}
                      onChange={(event) => setAutomaticProvider(event.target.value as AgentProvider)}
                      className="block w-full rounded-xl border border-gray-300 bg-white px-3 py-2.5 text-sm text-gray-900 shadow-sm outline-none transition focus:border-gray-500 focus:ring-2 focus:ring-gray-300 dark:border-gray-700 dark:bg-neutral-800 dark:text-gray-100 dark:focus:border-gray-500 dark:focus:ring-gray-700"
                    >
                      <option value="copilot">copilot</option>
                      <option value="opencode">opencode</option>
                    </select>
                  </div>

                  {!selectedServerHasStoredCredential && (
                    <InlineField
                      id="automatic-ssh-password"
                      label="SSH password"
                      value={automaticPassword}
                      onChange={setAutomaticPassword}
                      placeholder="Leave blank for key-based auth"
                      type="password"
                      help="Stored encrypted in this client to start provisioning when password auth is required."
                      inputProps={PASSWORD_INPUT_PROPS}
                    />
                  )}
                </div>
              )}

              {provisioning.error && (
                <div className="rounded-md border border-red-200 bg-red-50 p-3 dark:border-red-800 dark:bg-red-900/20">
                  <p className="text-sm text-red-600 dark:text-red-400">{provisioning.error}</p>
                </div>
              )}
            </form>
          )}
        </ShellPanel>
      );
    }

    if (kind === "ssh-session") {
      return (
        <SshSessionComposer
          workspaces={sshWorkspaces}
          servers={servers}
          initialWorkspaceId={composeWorkspace?.id}
          initialServerId={composeServer?.config.id}
          headerOffsetClassName={shellHeaderOffsetClassName}
          onCancel={() => navigateWithinShell(
            composeWorkspace
              ? { view: "workspace", workspaceId: composeWorkspace.id }
              : composeServer
                ? { view: "ssh-server", serverId: composeServer.config.id }
                : { view: "home" },
          )}
          onNavigate={navigateWithinShell}
          onCreateWorkspaceSession={createSession}
          onCreateStandaloneSession={createStandaloneSession}
        />
      );
    }

    return (
      <SshServerComposer
        headerOffsetClassName={shellHeaderOffsetClassName}
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
              <p className="text-sm text-gray-500 dark:text-gray-400">Use the sidebar or home button to continue.</p>
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
            headerOffsetClassName={shellHeaderOffsetClassName}
            onRefresh={refreshLoops}
            onDeleteDraft={purgeLoop}
            onNavigate={navigateWithinShell}
          />
        );
      }

      return (
        <LoopDetails
          key={`loop:${route.loopId}`}
          loopId={route.loopId}
          onBack={handleLoopDetailsExit}
          showBackButton={false}
          headerOffsetClassName={shellHeaderOffsetClassName}
          onSelectSshSession={(sshSessionId) => navigateWithinShell({ view: "ssh", sshSessionId })}
        />
      );
    }

    if (route.view === "chat") {
      return (
        <LoopDetails
          key={`chat:${route.chatId}`}
          loopId={route.chatId}
          onBack={handleLoopDetailsExit}
          showBackButton={false}
          headerOffsetClassName={shellHeaderOffsetClassName}
          onSelectSshSession={(sshSessionId) => navigateWithinShell({ view: "ssh", sshSessionId })}
        />
      );
    }

    if (route.view === "ssh") {
      return (
        <SshSessionDetails
          sshSessionId={route.sshSessionId}
          onBack={() => {
            navigateWithinShell({ view: "home" });
            void refreshSshSessions();
            void refreshSshServers();
          }}
          showBackButton={false}
          headerOffsetClassName={shellHeaderOffsetClassName}
        />
      );
    }

    if (route.view === "workspace") {
      if (!selectedWorkspace) {
        return (
          <ShellPanel eyebrow="Workspace" title="Workspace not found" description="The selected workspace no longer exists.">
            <p className="text-sm text-gray-500 dark:text-gray-400">Use the sidebar or home button to continue.</p>
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
          headerOffsetClassName={shellHeaderOffsetClassName}
          onOpenSettings={() => navigateWithinShell({ view: "workspace-settings", workspaceId: selectedWorkspace.id })}
          onNavigate={navigateWithinShell}
        />
      );
    }

    if (route.view === "workspace-settings") {
      if (!selectedWorkspace) {
        return (
          <ShellPanel eyebrow="Workspace" title="Workspace not found" description="The selected workspace no longer exists.">
            <p className="text-sm text-gray-500 dark:text-gray-400">Use the sidebar or home button to continue.</p>
          </ShellPanel>
        );
      }

      return (
        <ShellPanel
          eyebrow="Workspace settings"
          title="Workspace Settings"
          description={workspaceFromHook?.directory ?? selectedWorkspace.directory}
          descriptionClassName="hidden sm:inline font-mono"
          variant="compact"
          headerOffsetClassName={shellHeaderOffsetClassName}
          actions={(
            <Button
              type="submit"
              form="workspace-settings-shell-form"
              size="sm"
              loading={workspaceSettingsSaving}
              disabled={!workspaceSettingsFormValid || workspaceSettingsLoading || !workspaceFromHook}
            >
              <span className="sm:hidden">Save</span>
              <span className="hidden sm:inline">Save Changes</span>
            </Button>
          )}
        >
          {workspaceSettingsError && (
            <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-900/20 dark:text-red-300">
              {workspaceSettingsError}
            </div>
          )}

          {workspaceSettingsLoading && !workspaceFromHook ? (
            <div className="text-sm text-gray-500 dark:text-gray-400">Loading workspace settings…</div>
          ) : workspaceFromHook ? (
            <WorkspaceSettingsForm
              workspace={workspaceFromHook}
              status={workspaceStatus}
              onSave={async (name, settings) => {
                const success = await updateWorkspaceSettings(name, settings);
                if (success) {
                  await refreshWorkspaces();
                }
                return success;
              }}
              onTest={testWorkspaceConnection}
              onResetConnection={resetWorkspaceConnection}
              onPurgeArchivedLoops={workspaceSettingsWorkspaceId
                ? async () => await handlePurgeArchivedLoops(workspaceSettingsWorkspaceId)
                : undefined}
              onDeleteWorkspace={workspaceSettingsWorkspaceId
                ? async () => await deleteWorkspace(workspaceSettingsWorkspaceId)
                : undefined}
              archivedLoopCount={selectedWorkspaceArchivedLoopCount}
              workspaceLoopCount={selectedWorkspaceLoopCount}
              saving={workspaceSettingsSaving}
              testing={workspaceSettingsTesting}
              resettingConnection={workspaceSettingsResetting}
              purgingArchivedLoops={workspaceArchivedLoopsPurging}
              remoteOnly={dashboardData.remoteOnly}
              showConnectionStatus={false}
              formId="workspace-settings-shell-form"
              onSaved={() => navigateWithinShell({ view: "workspace", workspaceId: selectedWorkspace.id })}
              onDeleted={() => navigateWithinShell({ view: "home" })}
              onValidityChange={setWorkspaceSettingsFormValid}
            />
          ) : (
            <div className="text-sm text-gray-500 dark:text-gray-400">Workspace settings are unavailable right now.</div>
          )}
        </ShellPanel>
      );
    }

    if (route.view === "ssh-server") {
      if (!selectedServer) {
        return (
          <ShellPanel eyebrow="SSH server" title="Server not found" description="The selected SSH server no longer exists.">
            <p className="text-sm text-gray-500 dark:text-gray-400">Use the sidebar or home button to continue.</p>
          </ShellPanel>
        );
      }
      return (
        <SshServerView
          server={selectedServer}
          sessions={sessionsByServerId[selectedServer.config.id] ?? []}
          headerOffsetClassName={shellHeaderOffsetClassName}
          onNavigate={navigateWithinShell}
          onDeleteServer={async () => {
            const deleted = await deleteServer(selectedServer.config.id);
            if (!deleted) {
              toast.error(`Failed to delete SSH server "${selectedServer.config.name}"`);
              return false;
            }
            toast.success(`Deleted SSH server "${selectedServer.config.name}"`);
            navigateWithinShell({ view: "home" });
            return true;
          }}
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
          variant="compact"
          headerOffsetClassName={shellHeaderOffsetClassName}
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
        sessionsByServerId={sessionsByServerId}
        workspaceGroups={workspaceGroups}
        headerOffsetClassName={shellHeaderOffsetClassName}
        onNavigate={navigateWithinShell}
      />
    );
  }

  return (
    <div className="flex h-full min-h-0 overflow-hidden bg-gray-100 text-gray-950 dark:bg-neutral-950 dark:text-gray-100">
      <div
        className={[
          "fixed inset-0 z-30 bg-neutral-950/50 transition lg:hidden",
          sidebarOpen ? "opacity-100" : "pointer-events-none opacity-0",
        ].join(" ")}
        onClick={() => setSidebarOpen(false)}
      />

      <aside
        hidden={sidebarCollapsed && !sidebarOpen}
        aria-hidden={sidebarCollapsed && !sidebarOpen}
        className={[
          "fixed inset-y-0 left-0 z-40 flex w-80 max-w-[86vw] flex-col border-r border-gray-200 bg-gray-50/95 backdrop-blur transition-all duration-200 dark:border-gray-800 dark:bg-neutral-900/95 lg:relative lg:inset-auto lg:z-10 lg:max-w-none lg:shrink-0",
          sidebarOpen ? "translate-x-0" : "-translate-x-full",
          sidebarCollapsed
            ? "lg:w-0 lg:min-w-0 lg:-translate-x-full lg:overflow-hidden lg:border-r-0 lg:opacity-0 lg:pointer-events-none"
            : "lg:w-80 lg:translate-x-0 lg:opacity-100",
        ].join(" ")}
      >
        <div className="border-b border-gray-200 bg-white px-4 py-2 dark:border-gray-800 dark:bg-neutral-800">
          <div className="flex min-h-14 items-center justify-between gap-3">
            <button
              type="button"
              onClick={() => navigateWithinShell({ view: "home" })}
              className="text-xs font-semibold uppercase tracking-[0.24em] text-gray-500 transition hover:text-gray-900 dark:text-gray-400 dark:hover:text-gray-100"
            >
              Ralpher
            </button>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => navigateWithinShell({ view: "settings" })}
                aria-label="Open settings"
                aria-current={route.view === "settings" ? "page" : undefined}
                className={[
                  "inline-flex h-10 w-10 items-center justify-center rounded-xl border bg-white shadow-sm transition dark:bg-neutral-900",
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
                className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-gray-200 bg-white text-gray-600 shadow-sm transition hover:border-gray-300 hover:text-gray-900 dark:border-gray-800 dark:bg-neutral-900 dark:text-gray-300 dark:hover:border-gray-700 dark:hover:text-gray-100"
              >
                <SidebarIcon size="h-5 w-5" />
              </button>
            </div>
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
                  active={(route.view === "workspace" || route.view === "workspace-settings") && route.workspaceId === workspace.id}
                  title={workspace.name}
                  subtitle={workspace.directory}
                  onClick={() => navigateWithinShell({ view: "workspace", workspaceId: workspace.id })}
                />
              ))
            )}
          </ShellSection>

          <ShellSection
            title="Loops"
            count={loopItems.length}
            actionLabel="New"
            onAction={() => navigateWithinShell({ view: "compose", kind: "loop" })}
            collapsed={isSectionCollapsed("loops")}
            onToggle={() => toggleSectionCollapsed("loops")}
          >
            {loopItems.length === 0 ? (
              <EmptySection message="No loops yet." />
            ) : (
              <WorkspaceGroupedSectionItems
                sectionId="loops"
                groups={loopGroups}
                collapsedGroups={collapsedWorkspaceGroups}
                onToggleGroup={toggleWorkspaceGroupCollapsed}
                renderItem={(loop) => (
                  <SectionItem
                    key={loop.config.id}
                    active={route.view === "loop" && route.loopId === loop.config.id}
                    title={loop.config.name}
                    badge={getStatusLabel(loop.state.status, loop.state.syncState)}
                    onClick={() => navigateWithinShell({ view: "loop", loopId: loop.config.id })}
                  />
                )}
              />
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
              <WorkspaceGroupedSectionItems
                sectionId="chats"
                groups={chatGroups}
                collapsedGroups={collapsedWorkspaceGroups}
                onToggleGroup={toggleWorkspaceGroupCollapsed}
                renderItem={(chat) => (
                  <SectionItem
                    key={chat.config.id}
                    active={route.view === "chat" && route.chatId === chat.config.id}
                    title={chat.config.name}
                    badge={getStatusLabel(chat.state.status, chat.state.syncState)}
                    onClick={() => navigateWithinShell({ view: "chat", chatId: chat.config.id })}
                  />
                )}
              />
            )}
          </ShellSection>

          <ShellSection
            title="SSH Sessions"
            count={allShellSessions.length}
            actionLabel="New"
            onAction={() => navigateWithinShell({ view: "compose", kind: "ssh-session" })}
            collapsed={isSectionCollapsed("workspace-ssh")}
            onToggle={() => toggleSectionCollapsed("workspace-ssh")}
          >
            {allShellSessions.length === 0 ? (
              <EmptySection message="No SSH sessions yet." />
            ) : (
              allShellSessions.map((session) => (
                <SectionItem
                  key={session.id}
                  active={route.view === "ssh" && route.sshSessionId === session.id}
                  title={session.title}
                  subtitle={session.subtitle}
                  badge={session.badge}
                  onClick={() => navigateWithinShell({ view: "ssh", sshSessionId: session.id })}
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
                  <SectionItem
                    key={server.config.id}
                    active={route.view === "ssh-server" && route.serverId === server.config.id}
                    title={server.config.name}
                    subtitle={`${server.config.username}@${server.config.address}`}
                    badge={serverSessions.length > 0 ? String(serverSessions.length) : undefined}
                    onClick={() => navigateWithinShell({ view: "ssh-server", serverId: server.config.id })}
                  />
                );
              })
            )}
          </ShellSection>

          {dashboardData.version && (
            <div className="px-1 text-[11px] leading-4 text-gray-400 dark:text-gray-500">
              v{dashboardData.version}
            </div>
          )}
        </div>
      </aside>

      <div className="relative flex min-w-0 min-h-0 flex-1 flex-col overflow-hidden">
        {shellErrors.length > 0 && (
          <div className="border-b border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-amber-900/50 dark:bg-amber-950/40 dark:text-amber-200 sm:px-6">
            {shellErrors.join(" · ")}
          </div>
        )}

        <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden">
          <div className="pointer-events-none absolute left-4 top-4 z-20 flex gap-3 sm:left-6 lg:left-8">
            <button
              type="button"
              onClick={openSidebar}
              aria-label="Open navigation"
              className="pointer-events-auto inline-flex h-10 w-10 items-center justify-center rounded-xl border border-gray-200 bg-white/95 text-gray-600 shadow-sm transition hover:border-gray-300 hover:text-gray-900 dark:border-gray-800 dark:bg-neutral-900/95 dark:text-gray-300 dark:hover:border-gray-700 dark:hover:text-gray-100 lg:hidden"
            >
              <SidebarIcon size="h-5 w-5" />
            </button>
            {sidebarCollapsed && (
              <button
                type="button"
                onClick={openSidebar}
                aria-label="Open sidebar"
                className="pointer-events-auto hidden h-10 w-10 items-center justify-center rounded-xl border border-gray-200 bg-white/95 text-gray-600 shadow-sm transition hover:border-gray-300 hover:text-gray-900 dark:border-gray-800 dark:bg-neutral-900/95 dark:text-gray-300 dark:hover:border-gray-700 dark:hover:text-gray-100 lg:inline-flex"
              >
                <SidebarIcon size="h-5 w-5" />
              </button>
            )}
          </div>
          <main className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden">
            {renderMainContent()}
          </main>
        </div>
      </div>
    </div>
  );
}

export default AppShell;
