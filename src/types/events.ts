/**
 * Event type definitions for Ralph Loops Management System.
 * 
 * These types define the events emitted during loop execution and streamed
 * to connected clients via WebSocket. Events follow a consistent structure:
 * - `type`: Event identifier (always prefixed with "loop.")
 * - `loopId`: The loop this event belongs to
 * - `timestamp`: ISO 8601 timestamp when the event occurred
 * 
 * Events are used for:
 * - Real-time UI updates (progress, messages, tool calls)
 * - State synchronization across browser tabs
 * - Activity logging and debugging
 * 
 * @module types/events
 */

import type { GitCommit, LoopConfig, ModelConfig } from "./loop";
import type { TodoItem } from "../backends/types";

/**
 * Message data from the AI agent.
 * 
 * Represents a single message in the conversation between the user prompt
 * and the AI assistant. Messages are streamed during iteration execution.
 * 
 * @example
 * ```typescript
 * const message: MessageData = {
 *   id: "msg_123",
 *   role: "assistant",
 *   content: "I'll start by reading the package.json file...",
 *   timestamp: "2025-01-27T10:30:00.000Z"
 * };
 * ```
 */
export interface MessageData {
  /** Unique message identifier (from the backend) */
  id: string;
  /** Role: "user" for prompts, "assistant" for AI responses */
  role: "user" | "assistant";
  /** The message content (may contain markdown) */
  content: string;
  /** ISO 8601 timestamp when the message was created */
  timestamp: string;
}

/**
 * Tool call data from the AI agent.
 * 
 * Represents a tool invocation by the AI during iteration execution.
 * Tool calls go through states: pending -> running -> completed/failed.
 * The same tool call ID is emitted multiple times as its status changes.
 * 
 * @example
 * ```typescript
 * const toolCall: ToolCallData = {
 *   id: "tool_456",
 *   name: "Write",
 *   input: { filePath: "/src/index.ts", content: "..." },
 *   status: "completed",
 *   output: { success: true },
 *   timestamp: "2025-01-27T10:30:05.000Z"
 * };
 * ```
 */
export interface ToolCallData {
  /** Unique tool call identifier (from the backend) */
  id: string;
  /** Tool name (e.g., "Write", "Bash", "Glob", "Grep", "Read") */
  name: string;
  /** Tool input parameters (structure varies by tool) */
  input: unknown;
  /** Tool output/result (populated when status is "completed") */
  output?: unknown;
  /** Current execution status of the tool call */
  status: "pending" | "running" | "completed" | "failed";
  /** ISO 8601 timestamp when the tool call was created or last updated */
  timestamp: string;
}

/**
 * Union type of all possible loop events.
 * 
 * These events are streamed via WebSocket to connected clients for real-time
 * updates. Each event type corresponds to a specific state change or activity
 * in the loop lifecycle.
 * 
 * Event categories:
 * - **Lifecycle events**: created, started, completed, stopped, error, deleted
 * - **Iteration events**: iteration.start, iteration.end
 * - **Activity events**: message, tool_call, progress, log, git.commit
 * - **Completion events**: accepted (merged), discarded, pushed
 * - **Plan mode events**: plan.ready, plan.feedback, plan.accepted, plan.discarded
 * - **State events**: todo.updated
 */
export type LoopEvent =
  | LoopCreatedEvent
  | LoopStartedEvent
  | LoopIterationStartEvent
  | LoopIterationEndEvent
  | LoopMessageEvent
  | LoopToolCallEvent
  | LoopProgressEvent
  | LoopLogEvent
  | LoopGitCommitEvent
  | LoopCompletedEvent
  | LoopStoppedEvent
  | LoopErrorEvent
  | LoopDeletedEvent
  | LoopAcceptedEvent
  | LoopDiscardedEvent
  | LoopPushedEvent
  | LoopPlanReadyEvent
  | LoopPlanFeedbackSentEvent
  | LoopPlanAcceptedEvent
  | LoopPlanDiscardedEvent
  | LoopTodoUpdatedEvent
  | LoopPendingUpdatedEvent;

/**
 * Emitted when a new loop is created.
 * Contains the full configuration for the new loop.
 */
export interface LoopCreatedEvent {
  type: "loop.created";
  /** ID of the newly created loop */
  loopId: string;
  /** Full configuration of the loop */
  config: LoopConfig;
  /** ISO 8601 timestamp */
  timestamp: string;
}

/**
 * Emitted when a loop starts execution.
 * This occurs after git branch setup and backend connection are established.
 */
export interface LoopStartedEvent {
  type: "loop.started";
  /** ID of the loop that started */
  loopId: string;
  /** Iteration number (usually 1 for initial start) */
  iteration: number;
  /** ISO 8601 timestamp */
  timestamp: string;
}

/**
 * Emitted at the beginning of each iteration.
 * An iteration is one complete prompt-response cycle with the AI.
 */
export interface LoopIterationStartEvent {
  type: "loop.iteration.start";
  /** ID of the loop */
  loopId: string;
  /** Iteration number (1-based) */
  iteration: number;
  /** ISO 8601 timestamp */
  timestamp: string;
}

/**
 * Emitted at the end of each iteration.
 * Contains the outcome which determines what happens next.
 */
export interface LoopIterationEndEvent {
  type: "loop.iteration.end";
  /** ID of the loop */
  loopId: string;
  /** Iteration number (1-based) */
  iteration: number;
  /** 
   * How the iteration ended:
   * - "continue": More work needed, will start next iteration
   * - "complete": Stop pattern matched, loop is done
   * - "error": An error occurred during iteration
   * - "plan_ready": Plan mode completed, awaiting approval
   */
  outcome: "continue" | "complete" | "error" | "plan_ready";
  /** ISO 8601 timestamp */
  timestamp: string;
}

/**
 * Emitted when an AI message is received.
 * Messages are streamed incrementally during iteration execution.
 */
export interface LoopMessageEvent {
  type: "loop.message";
  /** ID of the loop */
  loopId: string;
  /** Current iteration number */
  iteration: number;
  /** The message data */
  message: MessageData;
  /** ISO 8601 timestamp */
  timestamp: string;
}

/**
 * Emitted when a tool call is made or updated.
 * The same tool call ID may be emitted multiple times as status changes.
 */
export interface LoopToolCallEvent {
  type: "loop.tool_call";
  /** ID of the loop */
  loopId: string;
  /** Current iteration number */
  iteration: number;
  /** The tool call data */
  tool: ToolCallData;
  /** ISO 8601 timestamp */
  timestamp: string;
}

/**
 * Emitted for streaming progress updates.
 * Used for partial content that doesn't form complete messages yet.
 */
export interface LoopProgressEvent {
  type: "loop.progress";
  /** ID of the loop */
  loopId: string;
  /** Current iteration number */
  iteration: number;
  /** Partial content being streamed */
  content: string;
  /** ISO 8601 timestamp */
  timestamp: string;
}

/**
 * Log level for application log events.
 * - "agent": AI agent activity (responses, tool calls)
 * - "info": General informational messages
 * - "warn": Warning messages
 * - "error": Error messages
 * - "debug": Debug/verbose messages
 */
export type LogLevel = "agent" | "info" | "warn" | "error" | "debug";

/**
 * Application-level log event.
 * Used to communicate what the loop engine is doing internally.
 */
export interface LoopLogEvent {
  type: "loop.log";
  loopId: string;
  /** Unique ID for this log entry (used for updates) */
  id: string;
  /** Log level */
  level: LogLevel;
  /** Log message */
  message: string;
  /** Optional additional details */
  details?: Record<string, unknown>;
  timestamp: string;
}

/**
 * Emitted when a git commit is created during loop execution.
 * The AI agent may create commits after making file changes.
 */
export interface LoopGitCommitEvent {
  type: "loop.git.commit";
  /** ID of the loop */
  loopId: string;
  /** Iteration number when the commit was made */
  iteration: number;
  /** Git commit details */
  commit: GitCommit;
  /** ISO 8601 timestamp */
  timestamp: string;
}

/**
 * Emitted when a loop completes successfully.
 * This occurs when the stop pattern is matched in the AI response.
 */
export interface LoopCompletedEvent {
  type: "loop.completed";
  /** ID of the loop that completed */
  loopId: string;
  /** Total number of iterations executed */
  totalIterations: number;
  /** ISO 8601 timestamp */
  timestamp: string;
}

/**
 * Emitted when a loop is manually stopped by the user.
 */
export interface LoopStoppedEvent {
  type: "loop.stopped";
  /** ID of the loop that was stopped */
  loopId: string;
  /** Reason for stopping (e.g., "User requested stop") */
  reason: string;
  /** ISO 8601 timestamp */
  timestamp: string;
}

/**
 * Emitted when an error occurs during loop execution.
 * The loop may retry or fail depending on the error type and retry count.
 */
export interface LoopErrorEvent {
  type: "loop.error";
  /** ID of the loop that errored */
  loopId: string;
  /** Error message */
  error: string;
  /** Iteration number when the error occurred */
  iteration: number;
  /** ISO 8601 timestamp */
  timestamp: string;
}

/**
 * Emitted when a loop is deleted.
 * The loop's git branch may or may not be deleted depending on user choice.
 */
export interface LoopDeletedEvent {
  type: "loop.deleted";
  /** ID of the deleted loop */
  loopId: string;
  /** ISO 8601 timestamp */
  timestamp: string;
}

/**
 * Emitted when a loop's changes are accepted (merged into the original branch).
 */
export interface LoopAcceptedEvent {
  type: "loop.accepted";
  /** ID of the loop that was accepted */
  loopId: string;
  /** SHA of the merge commit created */
  mergeCommit: string;
  /** ISO 8601 timestamp */
  timestamp: string;
}

/**
 * Emitted when a loop's changes are discarded.
 * The working branch is deleted and changes are lost.
 */
export interface LoopDiscardedEvent {
  type: "loop.discarded";
  /** ID of the loop that was discarded */
  loopId: string;
  /** ISO 8601 timestamp */
  timestamp: string;
}

/**
 * Emitted when a loop's branch is pushed to a remote repository.
 * The loop enters "pushed" status and can receive reviewer comments.
 */
export interface LoopPushedEvent {
  type: "loop.pushed";
  /** ID of the loop that was pushed */
  loopId: string;
  /** Name of the remote branch (e.g., "origin/ralph/add-feature") */
  remoteBranch: string;
  /** ISO 8601 timestamp */
  timestamp: string;
}

/**
 * Emitted when plan mode completes and a plan is ready for review.
 * The user can approve, provide feedback, or discard the plan.
 */
export interface LoopPlanReadyEvent {
  type: "loop.plan.ready";
  /** ID of the loop in planning mode */
  loopId: string;
  /** The generated plan content (markdown) */
  planContent: string;
  /** ISO 8601 timestamp */
  timestamp: string;
}

/**
 * Emitted when the user sends feedback on a plan.
 * The AI will revise the plan based on the feedback.
 */
export interface LoopPlanFeedbackSentEvent {
  type: "loop.plan.feedback";
  /** ID of the loop */
  loopId: string;
  /** Feedback round number (1-based) */
  round: number;
  /** ISO 8601 timestamp */
  timestamp: string;
}

/**
 * Emitted when a plan is accepted and execution begins.
 * The loop transitions from "planning" to "running" status.
 */
export interface LoopPlanAcceptedEvent {
  type: "loop.plan.accepted";
  /** ID of the loop */
  loopId: string;
  /** ISO 8601 timestamp */
  timestamp: string;
}

/**
 * Emitted when a plan is discarded.
 * The loop returns to draft status without executing.
 */
export interface LoopPlanDiscardedEvent {
  type: "loop.plan.discarded";
  /** ID of the loop */
  loopId: string;
  /** ISO 8601 timestamp */
  timestamp: string;
}

/**
 * Emitted when the loop's TODO list is updated.
 * Contains the full current state of all TODO items.
 */
export interface LoopTodoUpdatedEvent {
  type: "loop.todo.updated";
  /** ID of the loop */
  loopId: string;
  /** Current TODO items from the session */
  todos: TodoItem[];
  /** ISO 8601 timestamp */
  timestamp: string;
}

/**
 * Emitted when pending values (prompt or model) are updated.
 * Used for real-time UI updates when user queues a message or model change.
 */
export interface LoopPendingUpdatedEvent {
  type: "loop.pending.updated";
  /** ID of the loop */
  loopId: string;
  /** Pending prompt (if set, undefined if cleared) */
  pendingPrompt?: string;
  /** Pending model (if set, undefined if cleared) */
  pendingModel?: ModelConfig;
  /** ISO 8601 timestamp */
  timestamp: string;
}

/**
 * Creates an ISO 8601 timestamp for event creation.
 * 
 * @returns Current time as ISO 8601 string (e.g., "2025-01-27T10:30:00.000Z")
 * 
 * @example
 * ```typescript
 * const event: LoopCreatedEvent = {
 *   type: "loop.created",
 *   loopId: "abc-123",
 *   config: loopConfig,
 *   timestamp: createTimestamp()
 * };
 * ```
 */
export function createTimestamp(): string {
  return new Date().toISOString();
}

/**
 * Type guard to check if an unknown object is a valid LoopEvent.
 * 
 * Validates that the object has the required structure for a loop event:
 * - Is an object (not null)
 * - Has a `type` property that is a string starting with "loop."
 * 
 * @param obj - The object to check
 * @returns True if the object is a valid LoopEvent
 * 
 * @example
 * ```typescript
 * const data = JSON.parse(websocketMessage);
 * if (isLoopEvent(data)) {
 *   // TypeScript now knows data is a LoopEvent
 *   handleEvent(data);
 * }
 * ```
 */
export function isLoopEvent(obj: unknown): obj is LoopEvent {
  return (
    typeof obj === "object" &&
    obj !== null &&
    "type" in obj &&
    typeof (obj as LoopEvent).type === "string" &&
    (obj as LoopEvent).type.startsWith("loop.")
  );
}
