/**
 * Shared loop status helper functions.
 * These are used by LoopCard, LoopDetails, and other components
 * to determine what actions are available for a loop.
 */

import type { LoopStatus } from "../types";

/**
 * Get a human-readable label for a loop status.
 */
export function getStatusLabel(status: LoopStatus): string {
  switch (status) {
    case "idle":
      return "Idle";
    case "starting":
      return "Starting";
    case "running":
      return "Running";
    case "waiting":
      return "Waiting";
    case "completed":
      return "Completed";
    case "stopped":
      return "Stopped";
    case "failed":
      return "Failed";
    case "max_iterations":
      return "Max Iterations";
    case "merged":
      return "Merged";
    case "pushed":
      return "Pushed";
    case "deleted":
      return "Deleted";
    default:
      return status;
  }
}

/**
 * Check if a loop can be started.
 * Only show start for idle or stopped loops (not yet run or manually stopped).
 * Completed/failed/max_iterations loops should use "Accept" or be reviewed first.
 */
export function canStart(status: LoopStatus): boolean {
  return status === "idle" || status === "stopped";
}

/**
 * Check if a loop can be stopped.
 * Only running, waiting, or starting loops can be stopped.
 */
export function canStop(status: LoopStatus): boolean {
  return status === "running" || status === "waiting" || status === "starting";
}

/**
 * Check if a loop can be accepted (merged or pushed).
 * Loops that have completed, stopped, failed, or hit max iterations
 * can have their changes accepted.
 */
export function canAccept(status: LoopStatus): boolean {
  return (
    status === "completed" ||
    status === "max_iterations" ||
    status === "stopped" ||
    status === "failed"
  );
}

/**
 * Check if a loop is in a final state (merged, pushed, or deleted).
 * Only purge is allowed in final states.
 */
export function isFinalState(status: LoopStatus): boolean {
  return status === "merged" || status === "pushed" || status === "deleted";
}

/**
 * Check if a loop is actively running.
 * Used to determine if pending prompts can be set.
 */
export function isLoopActive(status: LoopStatus): boolean {
  return status === "running" || status === "waiting" || status === "starting";
}

/**
 * Check if a loop is in a running state where iteration prompts can be set.
 */
export function isLoopRunning(status: LoopStatus): boolean {
  return status === "running" || status === "starting";
}
