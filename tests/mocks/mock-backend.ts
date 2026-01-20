/**
 * Reusable mock backend for testing.
 * Provides a configurable AgentBackend implementation for E2E tests.
 */

import type {
  AgentBackend,
  AgentSession,
  AgentResponse,
  AgentEvent,
  BackendConnectionConfig,
  CreateSessionOptions,
  PromptInput,
} from "../../src/backends/types";

/**
 * Configuration for the mock backend.
 */
export interface MockBackendConfig {
  /** Responses to return for each sendPrompt call (in order) */
  responses?: string[];
  /** Delay in ms before returning responses */
  responseDelay?: number;
  /** Whether to throw errors on sendPrompt */
  throwOnPrompt?: boolean;
  /** Error message to throw */
  errorMessage?: string;
  /** Events to emit during subscribeToEvents */
  events?: AgentEvent[];
}

/**
 * A configurable mock backend for testing.
 */
export class MockBackend implements AgentBackend {
  readonly name = "mock";

  private connected = false;
  private sessions = new Map<string, AgentSession>();
  private responseIndex = 0;
  private config: MockBackendConfig;
  private pendingPrompt: { resolve: () => void; content: string } | null = null;

  // Track calls for assertions
  public connectCalls: BackendConnectionConfig[] = [];
  public createSessionCalls: CreateSessionOptions[] = [];
  public sendPromptCalls: { sessionId: string; prompt: PromptInput }[] = [];
  public abortCalls: string[] = [];

  constructor(config: MockBackendConfig = {}) {
    this.config = {
      responses: ["<promise>COMPLETE</promise>"],
      responseDelay: 0,
      throwOnPrompt: false,
      ...config,
    };
  }

  async connect(connectionConfig: BackendConnectionConfig): Promise<void> {
    this.connectCalls.push(connectionConfig);
    this.connected = true;
  }

  async disconnect(): Promise<void> {
    this.connected = false;
  }

  isConnected(): boolean {
    return this.connected;
  }

  async createSession(options: CreateSessionOptions): Promise<AgentSession> {
    this.createSessionCalls.push(options);
    const session: AgentSession = {
      id: `mock-session-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      title: options.title,
      createdAt: new Date().toISOString(),
    };
    this.sessions.set(session.id, session);
    return session;
  }

  async getSession(id: string): Promise<AgentSession | null> {
    return this.sessions.get(id) ?? null;
  }

  async deleteSession(id: string): Promise<void> {
    this.sessions.delete(id);
  }

  async sendPrompt(sessionId: string, prompt: PromptInput): Promise<AgentResponse> {
    this.sendPromptCalls.push({ sessionId, prompt });

    if (this.config.responseDelay && this.config.responseDelay > 0) {
      await new Promise((resolve) => setTimeout(resolve, this.config.responseDelay));
    }

    if (this.config.throwOnPrompt) {
      throw new Error(this.config.errorMessage ?? "Mock backend error");
    }

    const responses = this.config.responses ?? [];
    const content = responses[this.responseIndex] ?? "<promise>COMPLETE</promise>";
    this.responseIndex++;

    return {
      id: `mock-msg-${Date.now()}`,
      content,
      parts: [{ type: "text", text: content }],
    };
  }

  async sendPromptAsync(sessionId: string, prompt: PromptInput): Promise<void> {
    this.sendPromptCalls.push({ sessionId, prompt });

    if (this.config.throwOnPrompt) {
      throw new Error(this.config.errorMessage ?? "Mock backend error");
    }

    // Store the response content for subscribeToEvents to use
    const responses = this.config.responses ?? [];
    const content = responses[this.responseIndex] ?? "<promise>COMPLETE</promise>";
    this.responseIndex++;

    // Store pending prompt for event generation
    this.pendingPrompt = {
      resolve: () => {},
      content,
    };
  }

  async abortSession(sessionId: string): Promise<void> {
    this.abortCalls.push(sessionId);
  }

  async *subscribeToEvents(_sessionId: string): AsyncIterable<AgentEvent> {
    // If there are explicit events configured, use those
    if (this.config.events && this.config.events.length > 0) {
      for (const event of this.config.events) {
        yield event;
      }
      return;
    }

    // Otherwise, generate events based on the pending prompt
    if (this.pendingPrompt) {
      const content = this.pendingPrompt.content;
      
      // Add delay if configured
      if (this.config.responseDelay && this.config.responseDelay > 0) {
        await new Promise((resolve) => setTimeout(resolve, this.config.responseDelay));
      }

      // Emit message start
      yield { type: "message.start", messageId: `mock-msg-${Date.now()}` };

      // Emit content as delta
      yield { type: "message.delta", content };

      // Emit message complete
      yield { type: "message.complete", content };

      this.pendingPrompt = null;
    } else if (this.config.throwOnPrompt) {
      yield { type: "error", message: this.config.errorMessage ?? "Mock backend error" };
    }
  }

  /**
   * Reset the mock backend state.
   */
  reset(): void {
    this.connected = false;
    this.sessions.clear();
    this.responseIndex = 0;
    this.connectCalls = [];
    this.createSessionCalls = [];
    this.sendPromptCalls = [];
    this.abortCalls = [];
    this.pendingPrompt = null;
  }

  /**
   * Set new responses for future calls.
   */
  setResponses(responses: string[]): void {
    this.config.responses = responses;
    this.responseIndex = 0;
  }

  /**
   * Set whether to throw on next prompt.
   */
  setThrowOnPrompt(shouldThrow: boolean, message?: string): void {
    this.config.throwOnPrompt = shouldThrow;
    if (message) {
      this.config.errorMessage = message;
    }
  }
}

/**
 * Factory function for creating mock backends.
 */
export function createMockBackend(config?: MockBackendConfig): MockBackend {
  return new MockBackend(config);
}

/**
 * Create a mock backend factory for the registry.
 */
export function createMockBackendFactory(config?: MockBackendConfig): () => AgentBackend {
  return () => new MockBackend(config);
}
