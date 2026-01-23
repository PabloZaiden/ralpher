/**
 * OpenCode backend implementation for Ralph Loops Management System.
 * Uses the @opencode-ai/sdk/v2 to connect to opencode servers.
 */

import {
  createOpencode,
  createOpencodeClient,
  type OpencodeClient,
} from "@opencode-ai/sdk/v2";
import type {
  Session as OpenCodeSession,
  Event as OpenCodeEvent,
  Part,
  AssistantMessage,
} from "@opencode-ai/sdk/v2";
import { isRemoteOnlyMode } from "../../core/config";
import { log } from "../../core/logger";

/**
 * Model information returned by getModels().
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
 * Connection info needed for WebSocket and other direct connections.
 */
export interface ConnectionInfo {
  /** Base URL for the opencode server */
  baseUrl: string;
  /** Auth headers to use for connections */
  authHeaders: Record<string, string>;
}

import type {
  AgentBackend,
  BackendConnectionConfig,
  CreateSessionOptions,
  AgentSession,
  PromptInput,
  AgentResponse,
  AgentPart,
  AgentEvent,
} from "../types";

/**
 * OpenCode backend implementation.
 * Supports both spawn mode (creates a new server) and connect mode (connects to existing).
 */
export class OpenCodeBackend implements AgentBackend {
  readonly name = "opencode";

  private client: OpencodeClient | null = null;
  private server: { url: string; close(): void } | null = null;
  private connected = false;
  private directory = "";
  private connectionInfo: ConnectionInfo | null = null;

  /**
   * Connect to an opencode server.
   * For spawn mode, this spawns a new local server.
   * For connect mode, this verifies the connection.
   */
  async connect(config: BackendConnectionConfig): Promise<void> {
    if (this.connected) {
      throw new Error("Already connected. Call disconnect() first.");
    }

    this.directory = config.directory;

    if (config.mode === "spawn") {
      // Block spawn mode when RALPHER_REMOTE_ONLY is set
      if (isRemoteOnlyMode()) {
        throw new Error(
          "Spawn mode is disabled. RALPHER_REMOTE_ONLY environment variable is set. " +
          "Only connecting to remote servers is allowed."
        );
      }
      await this.connectSpawn(config);
    } else {
      await this.connectToExisting(config);
    }

    this.connected = true;
  }

  /**
   * Spawn a new opencode server and connect to it.
   */
  private async connectSpawn(config: BackendConnectionConfig): Promise<void> {
    const options: Parameters<typeof createOpencode>[0] = {
      hostname: config.hostname ?? "127.0.0.1",
      port: config.port,
      timeout: 10000,
    };

    const result = await createOpencode(options);
    this.client = result.client;
    this.server = result.server;
    
    // Store connection info for spawn mode
    this.connectionInfo = {
      baseUrl: result.server.url,
      authHeaders: {}, // Spawn mode doesn't need auth
    };
  }

  /**
   * Connect to an existing opencode server.
   */
  private async connectToExisting(
    config: BackendConnectionConfig
  ): Promise<void> {
    const hostname = config.hostname ?? "127.0.0.1";
    const port = config.port ?? 4096;
    const baseUrl = `http://${hostname}:${port}`;

    // Build auth headers if password provided
    const authHeaders: Record<string, string> = {};
    if (config.password) {
      const credentials = Buffer.from(`opencode:${config.password}`).toString("base64");
      authHeaders["Authorization"] = `Basic ${credentials}`;
    }

    // Build client config with optional Basic auth
    const clientConfig: Parameters<typeof createOpencodeClient>[0] = {
      baseUrl,
      directory: config.directory,
      headers: authHeaders,
    };

    this.client = createOpencodeClient(clientConfig);

    // Verify connection by checking health (v2 uses flattened params)
    const result = await this.client.session.list({
      directory: config.directory,
    });

    if (result.error) {
      this.client = null;
      throw new Error(`Failed to connect to opencode at ${baseUrl}: ${JSON.stringify(result.error)}`);
    }

    // Store connection info
    this.connectionInfo = {
      baseUrl,
      authHeaders,
    };
  }

  /**
   * Disconnect from the backend.
   * For spawn mode, this stops the server.
   */
  async disconnect(): Promise<void> {
    if (!this.connected) {
      return;
    }

    if (this.server) {
      this.server.close();
      this.server = null;
    }

    this.client = null;
    this.connected = false;
    this.directory = "";
    this.connectionInfo = null;
  }

  /**
   * Check if connected to the backend.
   */
  isConnected(): boolean {
    return this.connected && this.client !== null;
  }

  /**
   * Get the SDK client for advanced operations.
   * Returns null if not connected.
   */
  getSdkClient(): OpencodeClient | null {
    return this.client;
  }

  /**
   * Get the current directory.
   */
  getDirectory(): string {
    return this.directory;
  }

  /**
   * Get connection info for WebSocket and other direct connections.
   * Returns null if not connected.
   */
  getConnectionInfo(): ConnectionInfo | null {
    return this.connectionInfo;
  }

  /**
   * Get the client, throwing if not connected.
   */
  private getClient(): OpencodeClient {
    if (!this.client) {
      throw new Error("Not connected. Call connect() first.");
    }
    return this.client;
  }

  /**
   * Create a new session.
   */
  async createSession(options: CreateSessionOptions): Promise<AgentSession> {
    const client = this.getClient();

    // v2 SDK uses flattened parameters
    const result = await client.session.create({
      title: options.title,
      directory: options.directory,
    });

    if (result.error) {
      throw new Error(`Failed to create session: ${JSON.stringify(result.error)}`);
    }

    const session = result.data as OpenCodeSession;
    return this.mapSession(session);
  }

  /**
   * Get an existing session by ID.
   */
  async getSession(id: string): Promise<AgentSession | null> {
    const client = this.getClient();

    // v2 SDK uses sessionID instead of path.id
    const result = await client.session.get({
      sessionID: id,
      directory: this.directory,
    });

    if (result.error) {
      // 404 means not found
      return null;
    }

    const session = result.data as OpenCodeSession;
    return this.mapSession(session);
  }

  /**
   * Delete a session.
   */
  async deleteSession(id: string): Promise<void> {
    const client = this.getClient();

    // v2 SDK uses sessionID instead of path.id
    const result = await client.session.delete({
      sessionID: id,
      directory: this.directory,
    });

    if (result.error) {
      throw new Error(`Failed to delete session: ${JSON.stringify(result.error)}`);
    }
  }

  /**
   * Send a prompt and wait for the full response.
   */
  async sendPrompt(sessionId: string, prompt: PromptInput): Promise<AgentResponse> {
    const client = this.getClient();

    // v2 SDK uses flattened parameters
    const result = await client.session.prompt({
      sessionID: sessionId,
      directory: this.directory,
      parts: prompt.parts.map((p) => ({
        type: p.type as "text",
        text: p.text,
      })),
      model: prompt.model,
    });

    if (result.error) {
      throw new Error(`Failed to send prompt: ${JSON.stringify(result.error)}`);
    }

    // The response is { info: Message, parts: Part[] }
    const response = result.data as { info: AssistantMessage; parts: Part[] };
    return this.mapResponse(response);
  }

  /**
   * Send a prompt without waiting for response.
   * Use subscribeToEvents to get the response.
   */
  async sendPromptAsync(sessionId: string, prompt: PromptInput): Promise<void> {
    log.trace("[OpenCodeBackend] sendPromptAsync: Entry", { sessionId });
    const client = this.getClient();

    // v2 SDK uses flattened parameters
    log.trace("[OpenCodeBackend] sendPromptAsync: About to call client.session.promptAsync");
    const result = await client.session.promptAsync({
      sessionID: sessionId,
      directory: this.directory,
      parts: prompt.parts.map((p) => ({
        type: p.type as "text",
        text: p.text,
      })),
      model: prompt.model,
    });
    log.trace("[OpenCodeBackend] sendPromptAsync: client.session.promptAsync returned", { hasError: !!result.error });

    if (result.error) {
      throw new Error(`Failed to send async prompt: ${JSON.stringify(result.error)}`);
    }
    log.trace("[OpenCodeBackend] sendPromptAsync: Exit");
  }

  /**
   * Abort a running session.
   */
  async abortSession(sessionId: string): Promise<void> {
    const client = this.getClient();

    // v2 SDK uses sessionID instead of path.id
    const result = await client.session.abort({
      sessionID: sessionId,
      directory: this.directory,
    });

    if (result.error) {
      throw new Error(`Failed to abort session: ${JSON.stringify(result.error)}`);
    }
  }

  /**
   * Subscribe to events from a session.
   * Yields AgentEvents translated from OpenCode SDK events.
   * 
   * Deduplication: The SDK emits update events repeatedly as messages/parts
   * are being built. We track what we've already emitted to avoid duplicates.
   */
  async *subscribeToEvents(sessionId: string): AsyncIterable<AgentEvent> {
    log.trace("[OpenCodeBackend] subscribeToEvents: Entry", { sessionId });
    const client = this.getClient();

    // Create AbortController to allow cancellation when consumer breaks
    const abortController = new AbortController();

    // v2 SDK uses flattened parameters
    log.trace("[OpenCodeBackend] subscribeToEvents: About to call client.event.subscribe");
    const subscription = await client.event.subscribe({
      directory: this.directory,
    }, {
      signal: abortController.signal,
    });
    log.trace("[OpenCodeBackend] subscribeToEvents: Subscription created");

    // Track emitted events to avoid duplicates
    // For message.start: track message IDs we've seen
    const emittedMessageStarts = new Set<string>();
    // For tool events: track tool part IDs and their last known status
    const toolPartStatus = new Map<string, string>();
    // For reasoning: track last known reasoning text length per part ID
    const reasoningTextLength = new Map<string, number>();
    // Track whether we've seen a message.start in this subscription.
    // 
    // IMPORTANT: This guard prevents stale `session.idle` events from causing
    // phantom iterations. When we subscribe before sending a prompt (which we
    // always do to avoid missing early events), there may be a pre-existing
    // `session.idle` event from the previous prompt. Without this guard, that
    // stale idle would be translated to `message.complete` and incorrectly
    // signal the end of an iteration before any work has started.
    //
    // This assumes subscriptions are always created BEFORE sending prompts.
    // If a subscription were started mid-message, it would miss the
    // `message.start` and incorrectly filter the subsequent `message.complete`.
    // However, this is not a concern for our usage pattern in loop-engine.ts.
    let hasMessageStart = false;

    try {
      log.trace("[OpenCodeBackend] subscribeToEvents: About to iterate over subscription.stream");
      for await (const event of subscription.stream) {
        log.trace("[OpenCodeBackend] subscribeToEvents: Received raw event", { type: (event as OpenCodeEvent).type });
        // Filter events for our session and translate them
        const translated = this.translateEvent(
          event as OpenCodeEvent,
          sessionId,
          emittedMessageStarts,
          toolPartStatus,
          reasoningTextLength
        );
        if (translated) {
          if (translated.type === "message.start") {
            hasMessageStart = true;
          }
          if (translated.type === "message.complete" && !hasMessageStart) {
            continue;
          }
          yield translated;
        }
      }
    } finally {
      // Abort the subscription when the consumer breaks out of the loop
      abortController.abort();
    }
  }

  /**
   * Map an OpenCode session to our AgentSession type.
   */
  private mapSession(session: OpenCodeSession): AgentSession {
    return {
      id: session.id,
      title: session.title,
      createdAt: new Date(session.time.created).toISOString(),
    };
  }

  /**
   * Map an OpenCode response to our AgentResponse type.
   */
  private mapResponse(response: { info: AssistantMessage; parts: Part[] }): AgentResponse {
    const parts: AgentPart[] = [];
    let fullContent = "";

    for (const part of response.parts) {
      if (part.type === "text") {
        parts.push({
          type: "text",
          text: part.text,
        });
        fullContent += part.text;
      } else if (part.type === "tool") {
        const toolPart = part;
        if (toolPart.state.status === "completed") {
          parts.push({
            type: "tool_result",
            toolName: toolPart.tool,
            toolOutput: toolPart.state.output,
          });
        } else {
          parts.push({
            type: "tool_call",
            toolName: toolPart.tool,
            toolInput: toolPart.state.input,
          });
        }
      }
    }

    return {
      id: response.info.id,
      content: fullContent,
      parts,
      usage: {
        inputTokens: response.info.tokens.input,
        outputTokens: response.info.tokens.output,
      },
    };
  }

  /**
   * Translate an OpenCode SDK event to our AgentEvent type.
   * Returns null if the event is not relevant, for a different session, or a duplicate.
   * 
   * @param event - The raw SDK event
   * @param sessionId - The session ID to filter for
   * @param emittedMessageStarts - Set of message IDs we've already emitted start events for
   * @param toolPartStatus - Map of tool part IDs to their last emitted status
   * @param reasoningTextLength - Map of reasoning part IDs to their last known text length
   */
  private translateEvent(
    event: OpenCodeEvent,
    sessionId: string,
    emittedMessageStarts: Set<string>,
    toolPartStatus: Map<string, string>,
    reasoningTextLength: Map<string, number>
  ): AgentEvent | null {
    switch (event.type) {
      case "message.updated": {
        const msg = event.properties.info;
        if (msg.sessionID !== sessionId) return null;

        if (msg.role === "assistant") {
          // Only emit message.start once per message ID
          if (emittedMessageStarts.has(msg.id)) {
            return null;
          }
          emittedMessageStarts.add(msg.id);
          return {
            type: "message.start",
            messageId: msg.id,
          };
        }
        return null;
      }

      case "message.part.updated": {
        const part = event.properties.part;
        if (part.sessionID !== sessionId) return null;

        if (part.type === "text") {
          // Text deltas are always unique (each delta is new content)
          if (event.properties.delta) {
            return {
              type: "message.delta",
              content: event.properties.delta,
            };
          }
        } else if (part.type === "reasoning") {
          // Reasoning content (AI thinking/chain of thought)
          // The SDK may send delta or full text updates
          if (event.properties.delta) {
            return {
              type: "reasoning.delta",
              content: event.properties.delta,
            };
          } else if (part.text) {
            // No delta, but we have full text - compute the new content
            const partId = part.id;
            const prevLength = reasoningTextLength.get(partId) ?? 0;
            const newContent = part.text.slice(prevLength);
            
            if (newContent.length > 0) {
              reasoningTextLength.set(partId, part.text.length);
              return {
                type: "reasoning.delta",
                content: newContent,
              };
            }
          }
        } else if (part.type === "tool") {
          const state = part.state;
          const partId = part.id;
          const lastStatus = toolPartStatus.get(partId);
          
          // Only emit if status changed from what we last emitted
          if (state.status === "running") {
            if (lastStatus === "running") {
              // Already emitted tool.start for this tool, skip
              return null;
            }
            toolPartStatus.set(partId, "running");
            return {
              type: "tool.start",
              toolName: part.tool,
              input: state.input,
            };
          } else if (state.status === "completed") {
            if (lastStatus === "completed") {
              // Already emitted tool.complete for this tool, skip
              return null;
            }
            toolPartStatus.set(partId, "completed");
            return {
              type: "tool.complete",
              toolName: part.tool,
              output: state.output,
            };
          } else if (state.status === "error") {
            if (lastStatus === "error") {
              // Already emitted error for this tool, skip
              return null;
            }
            toolPartStatus.set(partId, "error");
            return {
              type: "error",
              message: state.error,
            };
          }
        } else if (part.type === "step-start") {
          // Step start - AI is beginning a new step in its reasoning
          return {
            type: "message.delta",
            content: "", // Empty delta to indicate step start (could emit different event type in future)
          };
        } else if (part.type === "step-finish") {
          // Step finish - AI completed a step
          // The step-finish contains token usage but no content
          return null;
        }
        return null;
      }

      case "session.idle": {
        if (event.properties.sessionID !== sessionId) return null;
        // Session is idle = message complete
        // We need to track the last message content somehow
        return {
          type: "message.complete",
          content: "", // Content is accumulated by the caller
        };
      }

      case "session.error": {
        if (event.properties.sessionID !== sessionId) return null;
        const error = event.properties.error;
        const errorMessage = typeof error?.data?.message === "string" 
          ? error.data.message 
          : "Unknown error";
        return {
          type: "error",
          message: errorMessage,
        };
      }

      default:
        return null;
    }
  }

  /**
   * Get available models from the backend.
   * Returns models from all providers, indicating which are connected.
   */
  async getModels(directory: string): Promise<ModelInfo[]> {
    const client = this.getClient();

    // v2 SDK uses flattened parameters
    const result = await client.provider.list({
      directory,
    });

    if (result.error) {
      throw new Error(`Failed to get models: ${JSON.stringify(result.error)}`);
    }

    // The SDK returns provider list with models
    // We extract what we need without strict type checking since SDK types may vary
    const data = result.data as {
      all: Array<{
        id: string;
        name: string;
        models: { [key: string]: { id: string; name: string } };
      }>;
      connected: string[];
    };

    const models: ModelInfo[] = [];
    const connectedProviders = new Set(data.connected);

    for (const provider of data.all) {
      const isConnected = connectedProviders.has(provider.id);

      for (const modelId of Object.keys(provider.models)) {
        const model = provider.models[modelId];
        if (model) {
          models.push({
            providerID: provider.id,
            providerName: provider.name,
            modelID: model.id,
            modelName: model.name,
            connected: isConnected,
          });
        }
      }
    }

    return models;
  }
}

/**
 * Get the server URL if in spawn mode.
 */
export function getServerUrl(backend: OpenCodeBackend): string | undefined {
  // Type assertion to access private field (for testing/debugging)
  const b = backend as unknown as { server: { url: string } | null };
  return b.server?.url;
}
