/**
 * Type definitions for the OpenCode backend.
 * These types define the data structures used by OpenCodeBackend.
 */

/**
 * Configuration for connecting to the OpenCode backend.
 */
export interface BackendConnectionConfig {
  /** Spawn new server or connect to existing */
  mode: "spawn" | "connect";
  /** Hostname for connect mode */
  hostname?: string;
  /** Port for connect mode */
  port?: number;
  /** Password for connect mode (optional) */
  password?: string;
  /** Working directory for the backend */
  directory: string;
  /** Whether to use HTTPS for connect mode */
  useHttps?: boolean;
  /** Whether to allow insecure connections (self-signed certificates) */
  allowInsecure?: boolean;
}

/**
 * Options for creating a new session.
 */
export interface CreateSessionOptions {
  /** Session title */
  title?: string;
  /** Working directory */
  directory: string;
}

/**
 * Represents a session in the agent backend.
 */
export interface AgentSession {
  /** Session ID */
  id: string;
  /** Session title */
  title?: string;
  /** Creation timestamp (ISO) */
  createdAt: string;
}

/**
 * Part of a prompt message.
 */
export interface PromptPart {
  /** Part type */
  type: "text";
  /** Text content */
  text: string;
}

/**
 * Input for sending a prompt.
 */
export interface PromptInput {
  /** Prompt parts */
  parts: PromptPart[];
  /** Model override */
  model?: {
    providerID: string;
    modelID: string;
  };
}

/**
 * Part of an agent response.
 */
export interface AgentPart {
  /** Part type */
  type: "text" | "tool_call" | "tool_result";
  /** Text content (for text type) */
  text?: string;
  /** Tool name (for tool types) */
  toolName?: string;
  /** Tool input (for tool_call) */
  toolInput?: unknown;
  /** Tool output (for tool_result) */
  toolOutput?: unknown;
}

/**
 * Response from the agent backend.
 */
export interface AgentResponse {
  /** Response ID */
  id: string;
  /** Full response content */
  content: string;
  /** Response parts */
  parts: AgentPart[];
  /** Token usage */
  usage?: {
    inputTokens: number;
    outputTokens: number;
  };
}

/**
 * Question option for question.asked events.
 */
export interface QuestionOption {
  label: string;
  description: string;
}

/**
 * Question in a question.asked event.
 */
export interface QuestionInfo {
  question: string;
  header: string;
  options: QuestionOption[];
  multiple?: boolean;
  custom?: boolean;
}

/**
 * A TODO item from an agent session.
 */
export interface TodoItem {
  /** Brief description of the task */
  content: string;
  /** Current status of the task */
  status: "pending" | "in_progress" | "completed" | "cancelled";
  /** Priority level of the task */
  priority: "high" | "medium" | "low";
  /** Unique identifier for the todo item */
  id: string;
}

/**
 * Events emitted by the OpenCode backend.
 */
export type AgentEvent =
  | { type: "message.start"; messageId: string }
  | { type: "message.delta"; content: string }
  | { type: "message.complete"; content: string }
  | { type: "reasoning.delta"; content: string }
  | { type: "tool.start"; toolName: string; input: unknown }
  | { type: "tool.complete"; toolName: string; output: unknown }
  | { type: "error"; message: string }
  | { type: "permission.asked"; requestId: string; sessionId: string; permission: string; patterns: string[] }
  | { type: "question.asked"; requestId: string; sessionId: string; questions: QuestionInfo[] }
  | { type: "session.status"; sessionId: string; status: "idle" | "busy" | "retry"; attempt?: number; message?: string }
  | { type: "todo.updated"; sessionId: string; todos: TodoItem[] };
