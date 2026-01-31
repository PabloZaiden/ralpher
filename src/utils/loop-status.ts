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
    case "planning":
      return "Planning";
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
 * Check if a loop can be accepted (merged or pushed).
 * Only loops that completed successfully or hit max iterations
 * can have their changes accepted. Failed loops should be
 * reviewed manually or discarded.
 */
export function canAccept(status: LoopStatus): boolean {
  return status === "completed" || status === "max_iterations";
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

/**
 * Check if a loop can be "jumpstarted" - restarted from a stopped state.
 * This allows users to send a message to restart the loop.
 */
export function canJumpstart(status: LoopStatus): boolean {
  return status === "completed" || status === "stopped" || status === "failed" || status === "max_iterations";
}

/**
 * Check if a loop is awaiting feedback (pushed/merged but still addressable).
 * These loops are in a final state but can still receive reviewer comments.
 */
export function isAwaitingFeedback(status: LoopStatus, reviewModeAddressable: boolean | undefined): boolean {
  return (status === "merged" || status === "pushed") && reviewModeAddressable === true;
}
