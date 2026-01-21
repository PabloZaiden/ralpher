/**
 * Event type definitions for Ralph Loops Management System.
 * These types define the events emitted during loop execution.
 */

import type { GitCommit, LoopConfig } from "./loop";

/**
 * Message data from the AI agent.
 */
export interface MessageData {
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
 * Tool call data from the AI agent.
 */
export interface ToolCallData {
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
 * All possible loop events.
 * These are streamed via SSE to connected clients.
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
  | LoopPushedEvent;

export interface LoopCreatedEvent {
  type: "loop.created";
  loopId: string;
  config: LoopConfig;
  timestamp: string;
}

export interface LoopStartedEvent {
  type: "loop.started";
  loopId: string;
  iteration: number;
  timestamp: string;
}

export interface LoopIterationStartEvent {
  type: "loop.iteration.start";
  loopId: string;
  iteration: number;
  timestamp: string;
}

export interface LoopIterationEndEvent {
  type: "loop.iteration.end";
  loopId: string;
  iteration: number;
  outcome: "continue" | "complete" | "error";
  timestamp: string;
}

export interface LoopMessageEvent {
  type: "loop.message";
  loopId: string;
  iteration: number;
  message: MessageData;
  timestamp: string;
}

export interface LoopToolCallEvent {
  type: "loop.tool_call";
  loopId: string;
  iteration: number;
  tool: ToolCallData;
  timestamp: string;
}

export interface LoopProgressEvent {
  type: "loop.progress";
  loopId: string;
  iteration: number;
  content: string;
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

export interface LoopGitCommitEvent {
  type: "loop.git.commit";
  loopId: string;
  iteration: number;
  commit: GitCommit;
  timestamp: string;
}

export interface LoopCompletedEvent {
  type: "loop.completed";
  loopId: string;
  totalIterations: number;
  timestamp: string;
}

export interface LoopStoppedEvent {
  type: "loop.stopped";
  loopId: string;
  reason: string;
  timestamp: string;
}

export interface LoopErrorEvent {
  type: "loop.error";
  loopId: string;
  error: string;
  iteration: number;
  timestamp: string;
}

export interface LoopDeletedEvent {
  type: "loop.deleted";
  loopId: string;
  timestamp: string;
}

export interface LoopAcceptedEvent {
  type: "loop.accepted";
  loopId: string;
  mergeCommit: string;
  timestamp: string;
}

export interface LoopDiscardedEvent {
  type: "loop.discarded";
  loopId: string;
  timestamp: string;
}

export interface LoopPushedEvent {
  type: "loop.pushed";
  loopId: string;
  remoteBranch: string;
  timestamp: string;
}

/**
 * Helper to create a timestamp for events.
 */
export function createTimestamp(): string {
  return new Date().toISOString();
}

/**
 * Type guard to check if an object is a LoopEvent.
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
