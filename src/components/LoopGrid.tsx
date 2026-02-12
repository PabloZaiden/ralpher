/**
 * Main content area for the Dashboard — renders loops grouped by workspace and status.
 * Supports both card grid and row list view modes.
 */

import { useState } from "react";
import type { Loop, Workspace } from "../types";
import type { StatusGroups, StatusSectionKey, WorkspaceGroup } from "../hooks/useLoopGrouping";
import type { DashboardViewMode } from "../types/preferences";
import { sectionConfig } from "../hooks/useLoopGrouping";
import { CollapsibleSection, ConfirmModal } from "./common";
import { LoopCard } from "./LoopCard";
import { LoopRow } from "./LoopRow";
import { useToast } from "../hooks";

export interface LoopGridProps {
  loops: Loop[];
  loading: boolean;
  error: string | null;
  viewMode: DashboardViewMode;
  workspaceGroups: WorkspaceGroup[];
  unassignedLoops: Loop[];
  unassignedStatusGroups: StatusGroups;
  onSelectLoop?: (loopId: string) => void;
  onEditDraft: (loopId: string) => void;
  onRename: (loopId: string) => void;
  onOpenWorkspaceSettings: (workspaceId: string) => void;
  onDeleteWorkspace: (workspaceId: string) => Promise<{ success: boolean; error?: string }>;
}

/** Explicit action props type for loop summary components (LoopCard/LoopRow) */
interface LoopActions {
  onClick?: () => void;
  onRename?: () => void;
}

export function LoopGrid({
  loops,
  loading,
  error,
  viewMode,
  workspaceGroups,
  unassignedLoops,
  unassignedStatusGroups,
  onSelectLoop,
  onEditDraft,
  onRename,
  onOpenWorkspaceSettings,
  onDeleteWorkspace,
}: LoopGridProps) {
  const toast = useToast();
  const [deleteWorkspace, setDeleteWorkspace] = useState<Workspace | null>(null);
  const [deletingWorkspace, setDeletingWorkspace] = useState(false);

  /** Get LoopCard action props based on section type */
  function getLoopActions(sectionKey: StatusSectionKey, loopId: string): LoopActions {
    const actions: LoopActions = {
      onRename: () => onRename(loopId),
    };

    // onClick: drafts use edit, everything else uses select (only when handler is provided)
    if (sectionKey === "draft") {
      actions.onClick = () => onEditDraft(loopId);
    } else if (onSelectLoop) {
      actions.onClick = () => onSelectLoop(loopId);
    }

    return actions;
  }

  /** Renders status sections for a given set of status groups */
  function renderStatusSections(
    statusGroups: StatusGroups,
    keyPrefix: string,
  ) {
    return sectionConfig.map(({ key, label, defaultCollapsed }) => {
      const sectionLoops = statusGroups[key];
      if (sectionLoops.length === 0) return null;

      return (
        <CollapsibleSection
          key={`${keyPrefix}-${key}`}
          title={label}
          count={sectionLoops.length}
          defaultCollapsed={defaultCollapsed}
          idPrefix={`${keyPrefix}-${key}`}
        >
          {viewMode === "rows" ? (
            <div className="flex flex-col gap-2">
              {sectionLoops.map((loop) => (
                <LoopRow
                  key={loop.config.id}
                  loop={loop}
                  {...getLoopActions(key, loop.config.id)}
                />
              ))}
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 gap-4">
              {sectionLoops.map((loop) => (
                <LoopCard
                  key={loop.config.id}
                  loop={loop}
                  {...getLoopActions(key, loop.config.id)}
                />
              ))}
            </div>
          )}
        </CollapsibleSection>
      );
    });
  }

  return (
    <main className="flex-1 min-h-0 overflow-auto px-4 sm:px-6 lg:px-8 py-8 safe-area-bottom">
      {/* Error display */}
      {error && (
        <div className="mb-6 rounded-md bg-red-50 dark:bg-red-900/20 p-4">
          <p className="text-sm text-red-800 dark:text-red-300">{error}</p>
        </div>
      )}

      {/* Loading state */}
      {loading && loops.length === 0 && (
        <div className="flex items-center justify-center py-12">
          <div className="animate-spin rounded-full h-8 w-8 border-2 border-blue-500 border-t-transparent" />
        </div>
      )}

      {/* Empty state - no loops at all */}
      {!loading && loops.length === 0 && (
        <div className="text-center py-12">
          <div className="text-gray-400 dark:text-gray-500 mb-4">
            <svg
              className="mx-auto h-12 w-12"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={1.5}
                d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
              />
            </svg>
          </div>
          <h3 className="text-lg font-medium text-gray-900 dark:text-gray-100">
            No loops yet
          </h3>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
            Click "New Loop" to create your first Ralph Loop.
          </p>
        </div>
      )}

      {/* Workspace-grouped loop sections */}
      {workspaceGroups.map(({ workspace, loops: workspaceLoops, statusGroups }) => {
        if (workspaceLoops.length === 0) return null;

        return (
          <div key={workspace.id} className="mb-10">
            <WorkspaceHeader
              workspace={workspace}
              loopCount={workspaceLoops.length}
              onOpenSettings={() => onOpenWorkspaceSettings(workspace.id)}
            />
            <div className="space-y-6 pl-2">
              {renderStatusSections(statusGroups, `workspace-${workspace.id}`)}
            </div>
          </div>
        );
      })}

      {/* Unassigned loops section */}
      {unassignedLoops.length > 0 && (
        <div className="mb-10">
          <div className="flex items-center gap-3 mb-4 pb-2 border-b border-gray-200 dark:border-gray-700">
            <div className="flex items-center gap-2">
              <svg className="w-5 h-5 text-gray-400 dark:text-gray-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <h2 className="text-xl font-bold text-gray-900 dark:text-gray-100">
                Unassigned
              </h2>
            </div>
            <span className="text-sm text-gray-400 dark:text-gray-500">
              ({unassignedLoops.length} {unassignedLoops.length === 1 ? "loop" : "loops"})
            </span>
          </div>
          <div className="space-y-6 pl-2">
            {renderStatusSections(unassignedStatusGroups, "unassigned")}
          </div>
        </div>
      )}

      {/* Empty workspaces section */}
      {workspaceGroups.filter(g => g.loops.length === 0).length > 0 && (
        <div className="mb-10">
          <div className="flex items-center gap-3 mb-4 pb-2 border-b border-gray-200 dark:border-gray-700">
            <h2 className="text-lg font-semibold text-gray-700 dark:text-gray-300">
              Empty Workspaces
            </h2>
          </div>
          <div className="flex flex-wrap gap-2">
            {workspaceGroups
              .filter(g => g.loops.length === 0)
              .map(({ workspace }) => (
                <div key={workspace.id} className="flex items-center gap-2 px-3 py-2 bg-gray-100 dark:bg-gray-800 rounded-md">
                  <span className="text-sm text-gray-700 dark:text-gray-300">{workspace.name}</span>
                  <button
                    type="button"
                    onClick={() => onOpenWorkspaceSettings(workspace.id)}
                    className="p-1 text-gray-400 hover:text-gray-600 dark:text-gray-500 dark:hover:text-gray-300 transition-colors"
                    title="Workspace Settings"
                  >
                    <WorkspaceGearIcon />
                  </button>
                  <button
                    onClick={() => setDeleteWorkspace(workspace)}
                    className="p-1 text-gray-400 hover:text-red-500 dark:text-gray-500 dark:hover:text-red-400 transition-colors"
                    title="Delete empty workspace"
                  >
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>
              ))}
          </div>
        </div>
      )}

      {/* Workspace deletion confirmation modal */}
      <ConfirmModal
        isOpen={deleteWorkspace !== null}
        onClose={() => setDeleteWorkspace(null)}
        onConfirm={async () => {
          if (!deleteWorkspace) return;
          setDeletingWorkspace(true);
          try {
            const result = await onDeleteWorkspace(deleteWorkspace.id);
            if (!result.success) {
              toast.error(result.error || "Failed to delete workspace");
            }
          } finally {
            setDeletingWorkspace(false);
            setDeleteWorkspace(null);
          }
        }}
        title="Delete Workspace"
        message={`Are you sure you want to delete workspace "${deleteWorkspace?.name ?? ""}"?`}
        confirmLabel="Delete"
        loading={deletingWorkspace}
        variant="danger"
      />
    </main>
  );
}

/** Workspace header with icon, name, settings button, path, and loop count */
function WorkspaceHeader({
  workspace,
  loopCount,
  onOpenSettings,
}: {
  workspace: Workspace;
  loopCount: number;
  onOpenSettings: () => void;
}) {
  return (
    <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-3 mb-4 pb-2 border-b border-gray-200 dark:border-gray-700">
      <div className="flex items-center gap-2 min-w-0">
        <svg className="w-5 h-5 text-gray-500 dark:text-gray-400 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
        </svg>
        <h2 className="text-xl font-bold text-gray-900 dark:text-gray-100 truncate">
          {workspace.name}
        </h2>
        <button
          type="button"
          onClick={onOpenSettings}
          className="p-1 text-gray-400 hover:text-gray-600 dark:text-gray-500 dark:hover:text-gray-300 transition-colors"
          title="Workspace Settings"
        >
          <WorkspaceGearIcon />
        </button>
      </div>
      <div className="flex items-center gap-2 min-w-0 sm:flex-1">
        <span className="text-sm text-gray-500 dark:text-gray-400 truncate" title={workspace.directory}>
          {workspace.directory}
        </span>
        <span className="text-sm text-gray-400 dark:text-gray-500 flex-shrink-0">
          ({loopCount} {loopCount === 1 ? "loop" : "loops"})
        </span>
      </div>
    </div>
  );
}

/** Smaller gear icon for workspace settings */
function WorkspaceGearIcon() {
  return (
    <svg
      className="w-4 h-4"
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={2}
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"
      />
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
      />
    </svg>
  );
}
