/**
 * Agent backend type definitions for Ralph Loops Management System.
 * Defines the abstraction layer for AI agent backends.
 * OpenCode is the first implementation, but this allows for future backends.
 */

/**
 * Configuration for connecting to an agent backend.
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
 * Events emitted by the agent backend.
 */
export type AgentEvent =
  | { type: "message.start"; messageId: string }
  | { type: "message.delta"; content: string }
  | { type: "message.complete"; content: string }
  | { type: "reasoning.delta"; content: string }
  | { type: "tool.start"; toolName: string; input: unknown }
  | { type: "tool.complete"; toolName: string; output: unknown }
  | { type: "error"; message: string };

/**
 * Abstract interface for agent backends.
 * Implementations must provide all methods.
 */
export interface AgentBackend {
  /** Backend name (e.g., "opencode") */
  readonly name: string;

  /**
   * Connect to the backend.
   * For spawn mode, this starts a new server.
   * For connect mode, this verifies the connection.
   */
  connect(config: BackendConnectionConfig): Promise<void>;

  /**
   * Disconnect from the backend.
   * For spawn mode, this stops the server.
   */
  disconnect(): Promise<void>;

  /**
   * Check if connected to the backend.
   */
  isConnected(): boolean;

  /**
   * Create a new session.
   */
  createSession(options: CreateSessionOptions): Promise<AgentSession>;

  /**
   * Get an existing session by ID.
   */
  getSession(id: string): Promise<AgentSession | null>;

  /**
   * Delete a session.
   */
  deleteSession(id: string): Promise<void>;

  /**
   * Send a prompt and wait for the full response.
   */
  sendPrompt(sessionId: string, prompt: PromptInput): Promise<AgentResponse>;

  /**
   * Send a prompt without waiting for response.
   * Use subscribeToEvents to get the response.
   */
  sendPromptAsync(sessionId: string, prompt: PromptInput): Promise<void>;

  /**
   * Abort a running session.
   */
  abortSession(sessionId: string): Promise<void>;

  /**
   * Subscribe to events from a session.
   */
  subscribeToEvents(sessionId: string): AsyncIterable<AgentEvent>;
}

/**
 * Factory function type for creating backend instances.
 */
export type BackendFactory = () => AgentBackend;
