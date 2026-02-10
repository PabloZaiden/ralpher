/**
 * Type definitions for the OpenCode backend.
 * These types define the data structures used by OpenCodeBackend.
 */

import type { EventStream } from "../utils/event-stream";
import type { TodoItem } from "../types/loop";

// Re-export TodoItem for backward compatibility
export type { TodoItem };

/**
 * Connection info needed for WebSocket and other direct connections.
 */
export interface ConnectionInfo {
  /** Base URL for the opencode server */
  baseUrl: string;
  /** Auth headers to use for connections */
  authHeaders: Record<string, string>;
  /** Whether to allow insecure connections (self-signed certificates) */
  allowInsecure?: boolean;
}

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
    /** Model variant (e.g., "thinking"). Empty string or undefined for default. */
    variant?: string;
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

/**
 * Backend interface that all backend implementations must implement.
 * This includes both the real OpenCodeBackend and MockOpenCodeBackend for tests.
 * 
 * The interface is split into two parts:
 * - Core methods: Used by LoopEngine for loop execution
 * - Manager methods: Used by BackendManager for connection management
 */
export interface Backend {
  /** Backend name identifier */
  readonly name: string;

  // ============================================
  // Core methods (used by LoopEngine)
  // ============================================

  /** Connect to the backend server */
  connect(config: BackendConnectionConfig): Promise<void>;

  /** Disconnect from the backend server */
  disconnect(): Promise<void>;

  /** Check if connected to the backend */
  isConnected(): boolean;

  /** Create a new agent session */
  createSession(options: CreateSessionOptions): Promise<AgentSession>;

  /** Send a prompt synchronously and wait for response */
  sendPrompt(sessionId: string, prompt: PromptInput): Promise<AgentResponse>;

  /** Send a prompt asynchronously (fire and forget, events come via subscription) */
  sendPromptAsync(sessionId: string, prompt: PromptInput): Promise<void>;

  /** Abort a session */
  abortSession(sessionId: string): Promise<void>;

  /** Subscribe to events from a session */
  subscribeToEvents(sessionId: string): Promise<EventStream<AgentEvent>>;

  /** Reply to a permission request */
  replyToPermission(requestId: string, response: string): Promise<void>;

  /** Reply to a question request */
  replyToQuestion(requestId: string, answers: string[][]): Promise<void>;

  // ============================================
  // Manager methods (used by BackendManager)
  // ============================================

  /** Abort all active event subscriptions */
  abortAllSubscriptions(): void;

  /** Get the SDK client (may be null for mocks) */
  getSdkClient(): unknown;

  /** Get the current working directory */
  getDirectory(): string;

  /** Get connection info for WebSocket and other direct connections */
  getConnectionInfo(): ConnectionInfo | null;

  /** Get an existing session by ID */
  getSession(id: string): Promise<AgentSession | null>;

  /** Delete a session */
  deleteSession(id: string): Promise<void>;

  /** Get available models */
  getModels(directory: string): Promise<unknown[]>;
}
