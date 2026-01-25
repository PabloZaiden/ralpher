/**
 * API type definitions for Ralph Loops Management System.
 * These types define the request and response shapes for the REST API.
 */

import type { GitConfig, Loop, ModelConfig } from "./loop";

/**
 * Model information returned by the API.
 */
export interface ModelInfo {
  /** Provider ID (e.g., "anthropic", "openai") */
  providerID: string;
  /** Provider display name */
  providerName: string;
  /** Model ID (e.g., "claude-sonnet-4-20250514") */
  modelID: string;
  /** Model display name */
  modelName: string;
  /** Whether the provider is connected (has valid API key) */
  connected: boolean;
}

/**
 * Request to create a new loop.
 * Note: Loops are always started immediately after creation.
 */
export interface CreateLoopRequest {
  /** Human-readable name */
  name: string;
  /** Absolute path to working directory */
  directory: string;
  /** The task prompt/PRD */
  prompt: string;
  /** Model configuration (optional) */
  model?: ModelConfig;
  /** Optional iteration limit */
  maxIterations?: number;
  /** Maximum consecutive identical errors before failsafe exit (default: 10) */
  maxConsecutiveErrors?: number;
  /** Activity timeout in seconds - time without events before treating as error (default: 180 = 3 minutes) */
  activityTimeoutSeconds?: number;
  /** Regex for completion detection (optional, uses default) */
  stopPattern?: string;
  /** Git configuration (optional, uses defaults) */
  git?: Partial<GitConfig>;
  /** Base branch to create the loop from (default: current branch) */
  baseBranch?: string;
  /** Clear the .planning folder contents before starting (default: false) */
  clearPlanningFolder?: boolean;
}

/**
 * Request to update an existing loop.
 */
export interface UpdateLoopRequest {
  /** Update name */
  name?: string;
  /** Update prompt */
  prompt?: string;
  /** Update model */
  model?: ModelConfig;
  /** Update max iterations */
  maxIterations?: number;
  /** Update max consecutive errors */
  maxConsecutiveErrors?: number;
  /** Update activity timeout in seconds */
  activityTimeoutSeconds?: number;
  /** Update stop pattern */
  stopPattern?: string;
  /** Update git config */
  git?: Partial<GitConfig>;
}

/**
 * Request to start a loop.
 * Note: Previously supported handleUncommitted option has been removed.
 * Loops now fail to start if there are uncommitted changes.
 */
export interface StartLoopRequest {
  // Reserved for future options
}

/**
 * Response for successful operations.
 */
export interface SuccessResponse {
  success: boolean;
}

/**
 * Response for loop accept operation.
 */
export interface AcceptResponse {
  success: boolean;
  mergeCommit?: string;
}

/**
 * Response for loop push operation.
 */
export interface PushResponse {
  success: boolean;
  remoteBranch?: string;
}

/**
 * Error response for uncommitted changes.
 * This error indicates the loop cannot start because the directory has uncommitted changes.
 * User must commit or stash changes manually before starting the loop.
 */
export interface UncommittedChangesError {
  error: "uncommitted_changes";
  message: string;
  changedFiles: string[];
}

/**
 * Generic error response.
 */
export interface ErrorResponse {
  error: string;
  message: string;
}

/**
 * Health check response.
 */
export interface HealthResponse {
  healthy: boolean;
  version: string;
}

/**
 * File diff information.
 */
export interface FileDiff {
  /** File path */
  path: string;
  /** Change type */
  status: "added" | "modified" | "deleted" | "renamed";
  /** Number of additions */
  additions: number;
  /** Number of deletions */
  deletions: number;
  /** Old path (for renames) */
  oldPath?: string;
  /** The actual diff patch content */
  patch?: string;
}

/**
 * Log entry for loop execution.
 */
export interface LogEntry {
  /** Log level */
  level: "agent" | "info" | "warn" | "error" | "debug";
  /** Log message */
  message: string;
  /** ISO timestamp */
  timestamp: string;
  /** Additional data */
  data?: Record<string, unknown>;
}

/**
 * File content response.
 */
export interface FileContentResponse {
  content: string;
  exists: boolean;
}

/**
 * Type for API responses that return a loop.
 */
export type LoopResponse = Loop;

/**
 * Response from creating a loop.
 * On success, returns the created loop (which is immediately started).
 * On failure due to uncommitted changes, returns a 409 error response instead.
 */
export type CreateLoopResponse = Loop;

/**
 * Type for API responses that return multiple loops.
 */
export type LoopsResponse = Loop[];

/**
 * Validate a CreateLoopRequest.
 * Returns an error message if invalid, undefined if valid.
 */
export function validateCreateLoopRequest(req: unknown): string | undefined {
  if (typeof req !== "object" || req === null) {
    return "Request body must be an object";
  }

  const body = req as Record<string, unknown>;

  if (typeof body["name"] !== "string" || (body["name"] as string).trim() === "") {
    return "name is required and must be a non-empty string";
  }

  if (typeof body["directory"] !== "string" || (body["directory"] as string).trim() === "") {
    return "directory is required and must be a non-empty string";
  }

  if (typeof body["prompt"] !== "string" || (body["prompt"] as string).trim() === "") {
    return "prompt is required and must be a non-empty string";
  }

  if (body["maxIterations"] !== undefined && typeof body["maxIterations"] !== "number") {
    return "maxIterations must be a number";
  }

  if (body["maxConsecutiveErrors"] !== undefined && typeof body["maxConsecutiveErrors"] !== "number") {
    return "maxConsecutiveErrors must be a number";
  }

  if (body["activityTimeoutSeconds"] !== undefined) {
    if (typeof body["activityTimeoutSeconds"] !== "number") {
      return "activityTimeoutSeconds must be a number";
    }
    if (body["activityTimeoutSeconds"] < 60) {
      return "activityTimeoutSeconds must be at least 60 seconds";
    }
  }

  if (body["stopPattern"] !== undefined && typeof body["stopPattern"] !== "string") {
    return "stopPattern must be a string";
  }

  return undefined;
}
