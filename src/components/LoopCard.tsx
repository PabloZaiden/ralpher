/**
 * LoopCard component for displaying a loop summary in the dashboard grid.
 */

import type { Loop } from "../types";
import { Badge, getStatusBadgeVariant, Button, Card } from "./common";
import {
  getStatusLabel,
  canAccept,
  isFinalState,
  isLoopActive,
} from "../utils";

export interface LoopCardProps {
  /** The loop to display */
  loop: Loop;
  /** Callback when card is clicked */
  onClick?: () => void;
  /** Callback when accept button is clicked (merge) */
  onAccept?: () => void;
  /** Callback when delete button is clicked */
  onDelete?: () => void;
  /** Callback when purge button is clicked */
  onPurge?: () => void;
}

/**
 * Format a relative time string.
 */
function formatRelativeTime(isoString: string | undefined): string {
  if (!isoString) return "Never";

  const date = new Date(isoString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffSec = Math.floor(diffMs / 1000);
  const diffMin = Math.floor(diffSec / 60);
  const diffHour = Math.floor(diffMin / 60);
  const diffDay = Math.floor(diffHour / 24);

  if (diffSec < 60) return "Just now";
  if (diffMin < 60) return `${diffMin}m ago`;
  if (diffHour < 24) return `${diffHour}h ago`;
  return `${diffDay}d ago`;
}

export function LoopCard({
  loop,
  onClick,
  onAccept,
  onDelete,
  onPurge,
}: LoopCardProps) {
  const { config, state } = loop;
  const isActive = isLoopActive(state.status);
  const isPlanning = state.status === "planning";

  return (
    <Card
      clickable={!!onClick}
      onClick={onClick}
      className={`relative ${isActive ? "ring-2 ring-blue-500" : ""} ${isPlanning ? "ring-2 ring-cyan-500" : ""}`}
    >
      {/* Status indicator */}
      {isActive && !isPlanning && (
        <div className="absolute -top-1 -right-1">
          <span className="relative flex h-3 w-3">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-blue-400 opacity-75" />
            <span className="relative inline-flex rounded-full h-3 w-3 bg-blue-500" />
          </span>
        </div>
      )}
      {isPlanning && (
        <div className="absolute -top-1 -right-1">
          <span className="relative flex h-3 w-3">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-cyan-400 opacity-75" />
            <span className="relative inline-flex rounded-full h-3 w-3 bg-cyan-500" />
          </span>
        </div>
      )}

      {/* Header */}
      <div className="mb-3">
        <div className="flex items-start justify-between gap-2">
          <h3 className="text-base sm:text-lg font-semibold text-gray-900 dark:text-gray-100 truncate flex-1 min-w-0">
            {config.name}
          </h3>
          <Badge variant={getStatusBadgeVariant(state.status)} className="flex-shrink-0">
            {getStatusLabel(state.status)}
          </Badge>
        </div>
        <p className="mt-1 text-xs sm:text-sm text-gray-500 dark:text-gray-400 truncate">
          {config.directory}
        </p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 gap-2 sm:gap-4 mb-3 sm:mb-4 text-xs sm:text-sm">
        <div className="min-w-0">
          <span className="text-gray-500 dark:text-gray-400 block sm:inline">Iterations:</span>
          <span className="ml-0 sm:ml-2 font-medium text-gray-900 dark:text-gray-100 block sm:inline">
            {state.currentIteration}
            {config.maxIterations ? `/${config.maxIterations}` : ""}
          </span>
        </div>
        <div className="min-w-0">
          <span className="text-gray-500 dark:text-gray-400 block sm:inline">Last activity:</span>
          <span className="ml-0 sm:ml-2 font-medium text-gray-900 dark:text-gray-100 block sm:inline">
            {formatRelativeTime(state.lastActivityAt)}
          </span>
        </div>
      </div>

      {/* Git info */}
      {state.git && (
        <div className="mb-3 sm:mb-4 text-xs sm:text-sm">
          <span className="text-gray-500 dark:text-gray-400">Branch:</span>
          <span className="ml-2 font-mono text-gray-900 dark:text-gray-100 break-all">
            {state.git.workingBranch}
          </span>
          {state.git.commits.length > 0 && (
            <span className="ml-2 text-gray-500 dark:text-gray-400">
              ({state.git.commits.length} commits)
            </span>
          )}
        </div>
      )}

      {/* Actions */}
      <div className="flex flex-wrap items-center gap-2 pt-3 border-t border-gray-200 dark:border-gray-700">
        {/* Planning state - show Review Plan button */}
        {isPlanning ? (
          <Button
            size="sm"
            variant="primary"
            onClick={(e) => {
              e.stopPropagation();
              onClick?.();
            }}
            className="bg-cyan-600 hover:bg-cyan-700 dark:bg-cyan-600 dark:hover:bg-cyan-700"
          >
            Review Plan
          </Button>
        ) : isFinalState(state.status) ? (
          /* Final state - only show Purge */
          onPurge && (
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
          )
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
                className="ml-auto text-red-600 hover:text-red-700 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-900/20"
              >
                Delete
              </Button>
            )}
          </>
        )}
      </div>
    </Card>
  );
}

export default LoopCard;
