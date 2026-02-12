/**
 * LoopRow component for displaying a loop summary as a horizontal row.
 * Shows full loop info without truncation, one row per loop.
 */

import type { LoopSummaryProps } from "../types";
import { Badge, getStatusBadgeVariant, Button, EditIcon } from "./common";
import type { BadgeVariant } from "./common";
import {
  getStatusLabel,
  getPlanningStatusLabel,
  isLoopPlanReady,
  canAccept,
  isFinalState,
  isLoopActive,
  formatRelativeTime,
} from "../utils";

export function LoopRow({
  loop,
  onClick,
  onAccept,
  onDelete,
  onPurge,
  onAddressComments,
  onUpdateBranch,
  onRename,
}: LoopSummaryProps) {
  const { config, state } = loop;
  const isActive = isLoopActive(state.status);
  const isPlanning = state.status === "planning";
  const isPlanReady = isLoopPlanReady(loop);
  const isDraft = state.status === "draft";
  const isAddressable = state.reviewMode?.addressable === true;

  // Determine badge variant and label for planning sub-states
  const badgeVariant: BadgeVariant = isPlanning
    ? (isPlanReady ? "plan_ready" : "planning")
    : getStatusBadgeVariant(state.status);
  const badgeLabel = isPlanning
    ? getPlanningStatusLabel(isPlanReady)
    : getStatusLabel(state.status, state.syncState);

  // Row border highlight for active/planning states
  const borderClass = isActive && !isPlanning
    ? "border-l-4 border-l-blue-500"
    : isPlanning
      ? isPlanReady
        ? "border-l-4 border-l-amber-500"
        : "border-l-4 border-l-cyan-500"
      : "border-l-4 border-l-transparent";

  return (
    <div
      className={`relative rounded-lg border border-gray-200 bg-white shadow-sm dark:border-gray-700 dark:bg-gray-800 ${borderClass} ${
        onClick ? "cursor-pointer hover:border-gray-300 hover:shadow-md dark:hover:border-gray-600" : ""
      }`}
      onClick={onClick}
    >
      <div className="px-4 py-3">
        {/* Desktop layout: single row with all info */}
        <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4">
          {/* Status indicator dot + Name + Rename */}
          <div className="flex items-center gap-2 sm:min-w-0 sm:flex-1">
            {/* Status dot */}
            {isActive && !isPlanning && (
              <span className="relative flex h-2.5 w-2.5 flex-shrink-0">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-blue-400 opacity-75" />
                <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-blue-500" />
              </span>
            )}
            {isPlanning && !isPlanReady && (
              <span className="relative flex h-2.5 w-2.5 flex-shrink-0">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-cyan-400 opacity-75" />
                <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-cyan-500" />
              </span>
            )}
            {isPlanReady && (
              <span className="relative flex h-2.5 w-2.5 flex-shrink-0">
                <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-amber-500" />
              </span>
            )}
            {!isActive && !isPlanning && (
              <span className="w-2.5 flex-shrink-0" />
            )}

            {/* Name - no truncation */}
            <h3 className="text-sm sm:text-base font-semibold text-gray-900 dark:text-gray-100">
              {config.name}
            </h3>
            {onRename && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onRename();
                }}
                className="flex-shrink-0 p-0.5 rounded text-gray-400 hover:text-gray-600 hover:bg-gray-100 dark:hover:text-gray-300 dark:hover:bg-gray-700"
                aria-label="Rename loop"
                title="Rename loop"
              >
                <EditIcon size="h-3.5 w-3.5" />
              </button>
            )}
          </div>

          {/* Badges */}
          <div className="flex items-center gap-1.5 flex-shrink-0">
            <Badge variant={badgeVariant}>
              {badgeLabel}
            </Badge>
            {isAddressable && (
              <Badge variant="info">
                Addressable
              </Badge>
            )}
            {state.reviewMode && state.reviewMode.reviewCycles > 0 && (
              <span className="text-xs text-blue-600 dark:text-blue-400">
                RC:{state.reviewMode.reviewCycles}
              </span>
            )}
          </div>

          {/* Meta info - iterations, last activity, branch */}
          {!isDraft && (
            <div className="flex items-center gap-3 text-xs text-gray-500 dark:text-gray-400 flex-shrink-0">
              <span title="Iterations">
                <span className="font-medium text-gray-700 dark:text-gray-300">
                  {state.currentIteration}
                  {config.maxIterations && config.maxIterations !== Infinity ? `/${config.maxIterations}` : ""}
                </span>
                {" iter"}
              </span>
              <span title="Last activity">
                {formatRelativeTime(state.lastActivityAt)}
              </span>
              {state.git && (
                <span className="font-mono text-xs" title={`Branch: ${state.git.workingBranch}`}>
                  {state.git.workingBranch}
                  {state.git.commits.length > 0 && (
                    <span className="ml-1 text-gray-400 dark:text-gray-500">
                      ({state.git.commits.length}c)
                    </span>
                  )}
                </span>
              )}
            </div>
          )}

          {/* Actions */}
          <div className="flex items-center gap-1.5 flex-shrink-0">
            {isDraft ? (
              <>
                <Button
                  size="sm"
                  variant="primary"
                  onClick={(e) => {
                    e.stopPropagation();
                    onClick?.();
                  }}
                >
                  Edit
                </Button>
                {onDelete && (
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={(e) => {
                      e.stopPropagation();
                      onDelete();
                    }}
                    className="text-red-600 hover:text-red-700 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-900/20"
                  >
                    Delete
                  </Button>
                )}
              </>
            ) : isPlanning ? (
              <Button
                size="sm"
                variant="primary"
                onClick={(e) => {
                  e.stopPropagation();
                  onClick?.();
                }}
                className={isPlanReady
                  ? "bg-amber-600 hover:bg-amber-700 dark:bg-amber-600 dark:hover:bg-amber-700"
                  : "bg-cyan-600 hover:bg-cyan-700 dark:bg-cyan-600 dark:hover:bg-cyan-700"}
              >
                Review Plan
              </Button>
            ) : isFinalState(state.status) ? (
              <>
                {isAddressable && state.status !== "deleted" && onAddressComments && (
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={(e) => {
                      e.stopPropagation();
                      onAddressComments();
                    }}
                  >
                    Address Comments
                  </Button>
                )}
                {state.status === "pushed" && state.git && onUpdateBranch && (
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={(e) => {
                      e.stopPropagation();
                      onUpdateBranch();
                    }}
                  >
                    Update Branch
                  </Button>
                )}
                {onPurge && (
                  <Button
                    size="sm"
                    variant="danger"
                    onClick={(e) => {
                      e.stopPropagation();
                      onPurge();
                    }}
                  >
                    Purge
                  </Button>
                )}
              </>
            ) : (
              <>
                {canAccept(state.status) && state.git && onAccept && (
                  <Button
                    size="sm"
                    variant="primary"
                    onClick={(e) => {
                      e.stopPropagation();
                      onAccept();
                    }}
                  >
                    Accept
                  </Button>
                )}
                {onDelete && (
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={(e) => {
                      e.stopPropagation();
                      onDelete();
                    }}
                    className="text-red-600 hover:text-red-700 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-900/20"
                  >
                    Delete
                  </Button>
                )}
              </>
            )}
          </div>
        </div>

        {/* Directory path - shown below on its own line, no truncation */}
        <div className="mt-1 text-xs text-gray-500 dark:text-gray-400 break-all">
          {config.directory}
        </div>

        {/* Error display */}
        {state.error && (
          <div className="mt-2 p-2 rounded-md bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800">
            <p className="text-xs text-red-800 dark:text-red-300 break-words">
              {state.error.message}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

export default LoopRow;
