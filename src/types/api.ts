/**
 * API type definitions for Ralph Loops Management System.
 * 
 * These types define the request and response shapes for the REST API.
 * They are used for type safety in both the API route handlers and clients.
 * 
 * @module types/api
 */

import type { GitConfig, Loop, ModelConfig, ReviewComment } from "./loop";

/**
 * Model information returned by the GET /api/models endpoint.
 * Includes provider and model details with connection status.
 */
export interface ModelInfo {
  /** Provider ID (e.g., "anthropic", "openai", "bedrock") */
  providerID: string;
  /** Provider display name (e.g., "Anthropic", "OpenAI") */
  providerName: string;
  /** Model ID (e.g., "claude-sonnet-4-20250514", "gpt-4o") */
  modelID: string;
  /** Model display name (e.g., "Claude Sonnet 4", "GPT-4o") */
  modelName: string;
  /** Whether the provider is connected (has valid API key configured) */
  connected: boolean;
}

/**
 * Request body for POST /api/loops endpoint.
 * 
 * Creates a new Ralph Loop. Loops are started immediately after creation
 * unless `draft: true` is specified, which saves the loop for later editing.
 * 
 * If `planMode: true`, the loop starts in plan review mode before execution.
 * 
 * The loop name is automatically generated from the prompt using AI.
 */
export interface CreateLoopRequest {
  /** Absolute path to the working directory (must be a git repository) */
  directory: string;
  /** The task prompt/PRD describing what the loop should accomplish */
  prompt: string;
  /** Model configuration for AI provider and model selection */
  model?: ModelConfig;
  /** Maximum number of iterations before stopping (unlimited if not set) */
  maxIterations?: number;
  /** Maximum consecutive identical errors before failsafe exit (default: 10) */
  maxConsecutiveErrors?: number;
  /** Seconds without events before treating as error and retrying (default: 180, min: 60) */
  activityTimeoutSeconds?: number;
  /** Regex pattern for completion detection (default: "<promise>COMPLETE</promise>$") */
  stopPattern?: string;
  /** Git configuration for branch and commit naming */
  git?: Partial<GitConfig>;
  /** Base branch to create the loop from (default: current branch) */
  baseBranch?: string;
  /** Clear the .planning folder contents before starting (default: false) */
  clearPlanningFolder?: boolean;
  /** Start in plan creation mode instead of immediate execution */
  planMode?: boolean;
  /** Save as draft without starting (no git branch or session created) */
  draft?: boolean;
}

/**
 * Request body for PATCH /api/loops/:id endpoint.
 * All fields are optional - only provided fields are updated.
 */
export interface UpdateLoopRequest {
  /** Update the loop name */
  name?: string;
  /** Update the prompt/PRD */
  prompt?: string;
  /** Update the model configuration */
  model?: ModelConfig;
  /** Update the maximum iterations limit */
  maxIterations?: number;
  /** Update the max consecutive errors threshold */
  maxConsecutiveErrors?: number;
  /** Update the activity timeout in seconds */
  activityTimeoutSeconds?: number;
  /** Update the completion detection regex */
  stopPattern?: string;
  /** Update git configuration (branch/commit prefixes) */
  git?: Partial<GitConfig>;
}

/**
 * Request body for POST /api/loops/:id/plan/feedback endpoint.
 */
export interface PlanFeedbackRequest {
  /** User's feedback/comments on the plan to be incorporated */
  feedback: string;
}

/**
 * Request body for POST /api/loops/:id/plan/accept endpoint.
 * Empty body - just triggers acceptance of the current plan.
 */
export interface PlanAcceptRequest {
  // Empty - just triggers acceptance
}

/**
 * Request body for POST /api/loops/:id/address-comments endpoint.
 * Used to submit reviewer comments for the loop to address.
 */
export interface AddressCommentsRequest {
  /** Reviewer's comments to address (can be multi-line) */
  comments: string;
}

/**
 * Response from POST /api/loops/:id/address-comments endpoint.
 */
export interface AddressCommentsResponse {
  /** Whether the operation succeeded */
  success: boolean;
  /** The review cycle number (1-based, increments each time comments are addressed) */
  reviewCycle?: number;
  /** The branch being worked on */
  branch?: string;
  /** IDs of the comment records created */
  commentIds?: string[];
  /** Error message if success is false */
  error?: string;
}

/**
 * Response from GET /api/loops/:id/comments endpoint.
 */
export interface GetCommentsResponse {
  /** Whether the operation succeeded */
  success: boolean;
  /** Array of review comments for the loop */
  comments?: ReviewComment[];
  /** Error message if success is false */
  error?: string;
}

/**
 * Review history information for a loop.
 * Returned by GET /api/loops/:id/review-history endpoint.
 */
export interface ReviewHistory {
  /** Whether the loop can still receive reviewer comments */
  addressable: boolean;
  /** How the loop was originally completed (push or merge) */
  completionAction: "push" | "merge";
  /** Number of review cycles completed (times comments were addressed) */
  reviewCycles: number;
  /** For merged loops: list of all branches created during review cycles */
  reviewBranches: string[];
}

/**
 * Response from GET /api/loops/:id/review-history endpoint.
 */
export interface ReviewHistoryResponse {
  /** Whether the operation succeeded */
  success: boolean;
  /** The review history data */
  history?: ReviewHistory;
  /** Error message if success is false */
  error?: string;
}

/**
 * Request body for starting a loop.
 * Currently reserved for future options.
 * 
 * Note: Previously supported handleUncommitted option has been removed.
 * Loops now fail to start if there are uncommitted changes.
 */
export interface StartLoopRequest {
  // Reserved for future options
}

/**
 * Generic success response for operations without additional data.
 */
export interface SuccessResponse {
  /** Always true for successful operations */
  success: boolean;
}

/**
 * Response from POST /api/loops/:id/accept endpoint.
 */
export interface AcceptResponse {
  /** Whether the merge operation succeeded */
  success: boolean;
  /** The SHA of the merge commit created */
  mergeCommit?: string;
}

/**
 * Response from POST /api/loops/:id/push endpoint.
 */
export interface PushResponse {
  /** Whether the push operation succeeded */
  success: boolean;
  /** The name of the remote branch that was pushed */
  remoteBranch?: string;
}

/**
 * Error response returned when directory has uncommitted changes.
 * 
 * This error (HTTP 409) indicates the loop cannot start because the
 * working directory has uncommitted git changes. The user must commit
 * or stash changes manually before starting the loop.
 */
export interface UncommittedChangesError {
  /** Error code for this specific error type */
  error: "uncommitted_changes";
  /** Human-readable error description */
  message: string;
  /** List of files with uncommitted changes */
  changedFiles: string[];
}

/**
 * Error response returned when an active loop already exists for the directory.
 * 
 * This error (HTTP 409) indicates the loop cannot start because another
 * non-draft, non-terminal loop is already active for the same working directory.
 * The user must stop or complete the existing loop before starting a new one.
 */
export interface ActiveLoopExistsError {
  /** Error code for this specific error type */
  error: "active_loop_exists";
  /** Human-readable error description */
  message: string;
  /** Information about the conflicting loop */
  conflictingLoop: {
    /** ID of the existing active loop */
    id: string;
    /** Name of the existing active loop */
    name: string;
  };
}

/**
 * Generic error response format used by all API endpoints.
 */
export interface ErrorResponse {
  /** Error code for programmatic handling (e.g., "not_found", "validation_error") */
  error: string;
  /** Human-readable error description */
  message: string;
}

/**
 * Response from GET /api/health endpoint.
 */
export interface HealthResponse {
  /** Always true when server is responding */
  healthy: boolean;
  /** Server version string */
  version: string;
}

/**
 * File diff information returned by GET /api/loops/:id/diff endpoint.
 * Represents changes to a single file in the loop's working branch.
 */
export interface FileDiff {
  /** File path relative to repository root */
  path: string;
  /** Type of change made to the file */
  status: "added" | "modified" | "deleted" | "renamed";
  /** Number of lines added */
  additions: number;
  /** Number of lines deleted */
  deletions: number;
  /** Old path (only present for renames) */
  oldPath?: string;
  /** The actual diff patch content in unified diff format */
  patch?: string;
}

/**
 * Log entry for loop execution, stored in state and emitted via WebSocket.
 */
export interface LogEntry {
  /** Log level indicating the type/severity of the message */
  level: "agent" | "info" | "warn" | "error" | "debug";
  /** The log message content */
  message: string;
  /** ISO 8601 timestamp when the log was created */
  timestamp: string;
  /** Additional structured data associated with the log */
  data?: Record<string, unknown>;
}

/**
 * Response from GET /api/loops/:id/plan and /api/loops/:id/status-file endpoints.
 */
export interface FileContentResponse {
  /** The file contents (empty string if file doesn't exist) */
  content: string;
  /** Whether the file exists on disk */
  exists: boolean;
}

/**
 * Type alias for API responses that return a single loop.
 */
export type LoopResponse = Loop;

/**
 * Response type from POST /api/loops endpoint.
 * 
 * On success, returns the created loop. The loop status depends on options:
 * - `draft: true`: status is "draft"
 * - `planMode: true`: status is "planning"
 * - Otherwise: status is "running" (auto-started)
 * 
 * On failure due to uncommitted changes, returns HTTP 409 with UncommittedChangesError.
 */
export type CreateLoopResponse = Loop;

/**
 * Type alias for API responses that return multiple loops.
 * Used by GET /api/loops endpoint.
 */
export type LoopsResponse = Loop[];

/**
 * Validate a CreateLoopRequest object.
 * 
 * Checks that all required fields are present and have valid types.
 * Used by the POST /api/loops endpoint to validate incoming requests.
 * 
 * @param req - The request object to validate
 * @returns Error message string if invalid, undefined if valid
 */
export function validateCreateLoopRequest(req: unknown): string | undefined {
  if (typeof req !== "object" || req === null) {
    return "Request body must be an object";
  }

  const body = req as Record<string, unknown>;

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
