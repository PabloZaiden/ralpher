/**
 * LoopCard component for displaying a loop summary in the dashboard grid.
 */

import type { Loop, LoopStatus } from "../types";
import { Badge, getStatusBadgeVariant, Button, Card } from "./common";

export interface LoopCardProps {
  /** The loop to display */
  loop: Loop;
  /** Callback when card is clicked */
  onClick?: () => void;
  /** Callback when start button is clicked */
  onStart?: () => void;
  /** Callback when stop button is clicked */
  onStop?: () => void;
  /** Callback when delete button is clicked */
  onDelete?: () => void;
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

/**
 * Get the status label.
 */
function getStatusLabel(status: LoopStatus): string {
  switch (status) {
    case "idle":
      return "Idle";
    case "starting":
      return "Starting";
    case "running":
      return "Running";
    case "waiting":
      return "Waiting";
    case "paused":
      return "Paused";
    case "completed":
      return "Completed";
    case "stopped":
      return "Stopped";
    case "failed":
      return "Failed";
    case "max_iterations":
      return "Max Iterations";
    default:
      return status;
  }
}

/**
 * Check if the loop can be started.
 */
function canStart(status: LoopStatus): boolean {
  return status === "idle" || status === "stopped" || status === "completed" || status === "failed" || status === "max_iterations";
}

/**
 * Check if the loop can be stopped.
 */
function canStop(status: LoopStatus): boolean {
  return status === "running" || status === "waiting" || status === "starting" || status === "paused";
}

export function LoopCard({
  loop,
  onClick,
  onStart,
  onStop,
  onDelete,
}: LoopCardProps) {
  const { config, state } = loop;
  const isActive = state.status === "running" || state.status === "waiting" || state.status === "starting";

  return (
    <Card
      clickable={!!onClick}
      onClick={onClick}
      className={`relative ${isActive ? "ring-2 ring-blue-500" : ""}`}
    >
      {/* Status indicator */}
      {isActive && (
        <div className="absolute -top-1 -right-1">
          <span className="relative flex h-3 w-3">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-blue-400 opacity-75" />
            <span className="relative inline-flex rounded-full h-3 w-3 bg-blue-500" />
          </span>
        </div>
      )}

      {/* Header */}
      <div className="mb-3">
        <div className="flex items-start justify-between">
          <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100 truncate">
            {config.name}
          </h3>
          <Badge variant={getStatusBadgeVariant(state.status)}>
            {getStatusLabel(state.status)}
          </Badge>
        </div>
        <p className="mt-1 text-sm text-gray-500 dark:text-gray-400 truncate">
          {config.directory}
        </p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 gap-4 mb-4 text-sm">
        <div>
          <span className="text-gray-500 dark:text-gray-400">Iterations:</span>
          <span className="ml-2 font-medium text-gray-900 dark:text-gray-100">
            {state.currentIteration}
            {config.maxIterations ? `/${config.maxIterations}` : ""}
          </span>
        </div>
        <div>
          <span className="text-gray-500 dark:text-gray-400">Last activity:</span>
          <span className="ml-2 font-medium text-gray-900 dark:text-gray-100">
            {formatRelativeTime(state.lastActivityAt)}
          </span>
        </div>
      </div>

      {/* Git info */}
      {state.git && (
        <div className="mb-4 text-sm">
          <span className="text-gray-500 dark:text-gray-400">Branch:</span>
          <span className="ml-2 font-mono text-gray-900 dark:text-gray-100">
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
      <div className="flex items-center gap-2 pt-3 border-t border-gray-200 dark:border-gray-700">
        {canStart(state.status) && onStart && (
          <Button
            size="sm"
            variant="primary"
            onClick={(e) => {
              e.stopPropagation();
              onStart();
            }}
          >
            Start
          </Button>
        )}
        {canStop(state.status) && onStop && (
          <Button
            size="sm"
            variant="secondary"
            onClick={(e) => {
              e.stopPropagation();
              onStop();
            }}
          >
            Stop
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
      </div>
    </Card>
  );
}

export default LoopCard;
