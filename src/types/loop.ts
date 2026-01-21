/**
 * Loop type definitions for Ralph Loops Management System.
 * These types define the configuration and state of Ralph Loops.
 */

/**
 * Configuration for a Ralph Loop.
 * This is the persistent configuration that defines how a loop behaves.
 */
export interface LoopConfig {
  /** Unique identifier (UUID) */
  id: string;
  /** Human-readable name */
  name: string;
  /** Absolute path to working directory */
  directory: string;
  /** The task prompt/PRD */
  prompt: string;
  /** ISO timestamp of creation */
  createdAt: string;
  /** ISO timestamp of last update */
  updatedAt: string;

  /** Backend configuration */
  backend: BackendConfig;

  /** Model configuration (optional - inherits from backend config) */
  model?: ModelConfig;

  /** Optional iteration limit (default: unlimited) */
  maxIterations?: number;

  /** Maximum consecutive identical errors before failsafe exit (default: 5) */
  maxConsecutiveErrors?: number;

  /** Regex for completion detection. Default: "<promise>COMPLETE</promise>$" */
  stopPattern: string;

  /** Git integration settings */
  git: GitConfig;
}

/**
 * Backend connection configuration.
 */
export interface BackendConfig {
  /** Backend type (extensible for future backends) */
  type: "opencode";
  /** Spawn new server or connect to existing */
  mode: "spawn" | "connect";
  /** Hostname for connect mode */
  hostname?: string;
  /** Port for connect mode */
  port?: number;
}

/**
 * Model configuration for AI provider.
 */
export interface ModelConfig {
  /** Provider ID (e.g., "anthropic") */
  providerID: string;
  /** Model ID (e.g., "claude-3-5-sonnet-20241022") */
  modelID: string;
}

/**
 * Git integration configuration.
 */
export interface GitConfig {
  /** Whether git integration is enabled. Default: true */
  enabled: boolean;
  /** Branch name prefix. Default: "ralph/" */
  branchPrefix: string;
  /** Commit message prefix. Default: "[Ralph]" */
  commitPrefix: string;
}

/**
 * Runtime state of a Ralph Loop.
 */
export interface LoopState {
  /** Same as config ID */
  id: string;
  /** Current status */
  status: LoopStatus;
  /** Current iteration count */
  currentIteration: number;
  /** When loop was started (ISO timestamp) */
  startedAt?: string;
  /** When loop finished (ISO timestamp) */
  completedAt?: string;
  /** Last event timestamp (ISO) */
  lastActivityAt?: string;

  /** Backend session info */
  session?: SessionInfo;

  /** Error tracking */
  error?: LoopError;

  /** Git state (when git.enabled) */
  git?: GitState;

  /** Iteration history (last N for display) */
  recentIterations: IterationSummary[];

  /** Application logs (persisted for page refresh) */
  logs?: LoopLogEntry[];

  /** Messages from current iteration (persisted for page refresh) */
  messages?: PersistedMessage[];

  /** Tool calls from current iteration (persisted for page refresh) */
  toolCalls?: PersistedToolCall[];

  /** Consecutive error tracking for failsafe exit */
  consecutiveErrors?: ConsecutiveErrorTracker;
}

/**
 * A persisted log entry in the loop state.
 */
export interface LoopLogEntry {
  /** Unique ID for the log entry */
  id: string;
  /** Log level */
  level: "agent" | "info" | "warn" | "error" | "debug";
  /** Log message */
  message: string;
  /** Optional additional details */
  details?: Record<string, unknown>;
  /** ISO timestamp */
  timestamp: string;
}

/**
 * A persisted message in the loop state.
 * Mirrors MessageData from events.ts for persistence.
 */
export interface PersistedMessage {
  /** Message ID */
  id: string;
  /** Role (user or assistant) */
  role: "user" | "assistant";
  /** Message content */
  content: string;
  /** ISO timestamp */
  timestamp: string;
}

/**
 * A persisted tool call in the loop state.
 * Mirrors ToolCallData from events.ts for persistence.
 */
export interface PersistedToolCall {
  /** Tool call ID */
  id: string;
  /** Tool name */
  name: string;
  /** Tool input */
  input: unknown;
  /** Tool output (if completed) */
  output?: unknown;
  /** Status */
  status: "pending" | "running" | "completed" | "failed";
  /** Timestamp when the tool call was created/updated */
  timestamp: string;
}

/**
 * Tracks consecutive identical errors for failsafe exit.
 */
export interface ConsecutiveErrorTracker {
  /** Last error message seen */
  lastErrorMessage: string;
  /** Count of consecutive identical errors */
  count: number;
}

/**
 * Possible statuses for a Ralph Loop.
 */
export type LoopStatus =
  | "idle"           // Created but not started
  | "starting"       // Initializing backend connection
  | "running"        // Actively executing an iteration
  | "waiting"        // Between iterations
  | "completed"      // Successfully completed (stop pattern matched)
  | "stopped"        // Manually stopped
  | "failed"         // Error occurred
  | "max_iterations"; // Hit iteration limit

/**
 * Backend session information.
 */
export interface SessionInfo {
  /** Backend session ID */
  id: string;
  /** Backend server URL */
  serverUrl?: string;
}

/**
 * Error information for a loop.
 */
export interface LoopError {
  /** Error message */
  message: string;
  /** Iteration where error occurred */
  iteration: number;
  /** ISO timestamp */
  timestamp: string;
}

/**
 * Git state for a loop.
 */
export interface GitState {
  /** Branch we started from */
  originalBranch: string;
  /** Branch we created for this loop */
  workingBranch: string;
  /** Commits made during loop */
  commits: GitCommit[];
}

/**
 * Git commit information.
 */
export interface GitCommit {
  /** Iteration number */
  iteration: number;
  /** Commit SHA */
  sha: string;
  /** Commit message */
  message: string;
  /** ISO timestamp */
  timestamp: string;
  /** Number of files changed */
  filesChanged: number;
}

/**
 * Summary of a single iteration.
 */
export interface IterationSummary {
  /** Iteration number */
  iteration: number;
  /** When iteration started (ISO timestamp) */
  startedAt: string;
  /** When iteration completed (ISO timestamp) */
  completedAt: string;
  /** Number of messages in this iteration */
  messageCount: number;
  /** Number of tool calls in this iteration */
  toolCallCount: number;
  /** Outcome of the iteration */
  outcome: "continue" | "complete" | "error";
}

/**
 * Combined loop configuration and state.
 * This is what the API returns for a loop.
 */
export interface Loop {
  config: LoopConfig;
  state: LoopState;
}

/**
 * Default values for loop configuration.
 */
export const DEFAULT_LOOP_CONFIG = {
  stopPattern: "<promise>COMPLETE</promise>$",
  maxConsecutiveErrors: 10,
  git: {
    enabled: true,
    branchPrefix: "ralph/",
    commitPrefix: "[Ralph]",
  },
  backend: {
    type: "opencode" as const,
    mode: "spawn" as const,
  },
} as const;

/**
 * Create initial state for a new loop.
 */
export function createInitialState(id: string): LoopState {
  return {
    id,
    status: "idle",
    currentIteration: 0,
    recentIterations: [],
    logs: [],
    messages: [],
    toolCalls: [],
  };
}
