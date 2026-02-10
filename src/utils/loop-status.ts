/**
 * Shared loop status helper functions.
 * These are used by LoopCard, LoopDetails, and other components
 * to determine what actions are available for a loop.
 */

import type { Loop, LoopStatus } from "../types";
import { createLogger } from "../lib/logger";

const log = createLogger("LoopStatus");

/**
 * Get a human-readable label for a loop status.
 * Optionally considers syncState to show "Resolving Conflicts" when
 * a loop is running to resolve merge conflicts before push.
 */
export function getStatusLabel(status: LoopStatus, syncState?: { status: string } | null): string {
  // If the loop is actively running and has a sync conflict state, show the sync label
  if (syncState?.status === "conflicts" && (status === "running" || status === "starting" || status === "waiting")) {
    return "Resolving Conflicts";
  }

  switch (status) {
    case "idle":
      return "Idle";
    case "draft":
      return "Draft";
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
    case "resolving_conflicts":
      return "Resolving Conflicts";
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
  const result = status === "completed" || status === "max_iterations";
  log.trace("canAccept check", { status, result });
  return result;
}

/**
 * Check if a loop is in a final state (merged, pushed, or deleted).
 * Only purge is allowed in final states.
 */
export function isFinalState(status: LoopStatus): boolean {
  const result = status === "merged" || status === "pushed" || status === "deleted";
  log.trace("isFinalState check", { status, result });
  return result;
}

/**
 * Check if a loop is actively running.
 * Used to determine if pending prompts can be set.
 */
export function isLoopActive(status: LoopStatus): boolean {
  const result = status === "running" || status === "waiting" || status === "starting";
  log.trace("isLoopActive check", { status, result });
  return result;
}

/**
 * Check if a loop is in a running state where iteration prompts can be set.
 */
export function isLoopRunning(status: LoopStatus): boolean {
  const result = status === "running" || status === "starting";
  log.trace("isLoopRunning check", { status, result });
  return result;
}

/**
 * Check if a loop can be "jumpstarted" - restarted from a stopped state.
 * This allows users to send a message to restart the loop.
 */
export function canJumpstart(status: LoopStatus): boolean {
  const result = status === "completed" || status === "stopped" || status === "failed" || status === "max_iterations";
  log.trace("canJumpstart check", { status, result });
  return result;
}

/**
 * Check if a loop is awaiting feedback (pushed/merged but still addressable).
 * These loops are in a final state but can still receive reviewer comments.
 */
export function isAwaitingFeedback(status: LoopStatus, reviewModeAddressable: boolean | undefined): boolean {
  const result = (status === "merged" || status === "pushed") && reviewModeAddressable === true;
  log.trace("isAwaitingFeedback check", { status, reviewModeAddressable, result });
  return result;
}

/**
 * Get the appropriate status label for a planning loop based on plan readiness.
 * Returns "Plan Ready" when the plan is ready for human review,
 * or "Planning" when the AI is still generating/revising the plan.
 */
export function getPlanningStatusLabel(isPlanReady: boolean): string {
  return isPlanReady ? "Plan Ready" : "Planning";
}

/**
 * Check if a loop's plan is ready for human review.
 * Returns true only when the loop is in planning status AND the plan is marked as ready.
 */
export function isLoopPlanReady(loop: Loop): boolean {
  const result = loop.state.status === "planning" && loop.state.planMode?.isPlanReady === true;
  log.trace("isLoopPlanReady check", { status: loop.state.status, isPlanReady: loop.state.planMode?.isPlanReady, result });
  return result;
}
