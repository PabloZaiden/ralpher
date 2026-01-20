/**
 * OpenCode backend implementation for Ralph Loops Management System.
 * Uses the @opencode-ai/sdk to connect to opencode servers.
 */

import {
  createOpencode,
  createOpencodeClient,
  type OpencodeClient,
} from "@opencode-ai/sdk";
import type {
  Session as OpenCodeSession,
  Event as OpenCodeEvent,
  Part,
  AssistantMessage,
} from "@opencode-ai/sdk";
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

  /**
   * Connect to the backend.
   * For spawn mode, this starts a new opencode server.
   * For connect mode, this verifies the connection.
   */
  async connect(config: BackendConnectionConfig): Promise<void> {
    if (this.connected) {
      throw new Error("Already connected. Call disconnect() first.");
    }

    this.directory = config.directory;

    if (config.mode === "spawn") {
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

    this.client = createOpencodeClient({
      baseUrl,
      directory: config.directory,
    });

    // Verify connection by checking health
    // The SDK doesn't have a global.health() in my reading, so we try to list sessions
    try {
      await this.client.session.list({
        query: { directory: config.directory },
      });
    } catch (error) {
      this.client = null;
      throw new Error(`Failed to connect to opencode at ${baseUrl}: ${String(error)}`);
    }
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
  }

  /**
   * Check if connected to the backend.
   */
  isConnected(): boolean {
    return this.connected && this.client !== null;
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

    const result = await client.session.create({
      body: {
        title: options.title,
      },
      query: { directory: options.directory },
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

    const result = await client.session.get({
      path: { id },
      query: { directory: this.directory },
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

    const result = await client.session.delete({
      path: { id },
      query: { directory: this.directory },
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

    const result = await client.session.prompt({
      path: { id: sessionId },
      body: {
        parts: prompt.parts.map((p) => ({
          type: p.type as "text",
          text: p.text,
        })),
        model: prompt.model,
      },
      query: { directory: this.directory },
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
    const client = this.getClient();

    const result = await client.session.promptAsync({
      path: { id: sessionId },
      body: {
        parts: prompt.parts.map((p) => ({
          type: p.type as "text",
          text: p.text,
        })),
        model: prompt.model,
      },
      query: { directory: this.directory },
    });

    if (result.error) {
      throw new Error(`Failed to send async prompt: ${JSON.stringify(result.error)}`);
    }
  }

  /**
   * Abort a running session.
   */
  async abortSession(sessionId: string): Promise<void> {
    const client = this.getClient();

    const result = await client.session.abort({
      path: { id: sessionId },
      query: { directory: this.directory },
    });

    if (result.error) {
      throw new Error(`Failed to abort session: ${JSON.stringify(result.error)}`);
    }
  }

  /**
   * Subscribe to events from a session.
   * Yields AgentEvents translated from OpenCode SDK events.
   */
  async *subscribeToEvents(sessionId: string): AsyncIterable<AgentEvent> {
    const client = this.getClient();

    console.log("[OpenCodeBackend] Subscribing to events for session:", sessionId);
    const subscription = await client.event.subscribe({
      query: { directory: this.directory },
    });
    console.log("[OpenCodeBackend] Subscription created, waiting for events...");

    for await (const event of subscription.stream) {
      console.log("[OpenCodeBackend] Received SDK event:", (event as OpenCodeEvent).type, event);
      // Filter events for our session and translate them
      const translated = this.translateEvent(event as OpenCodeEvent, sessionId);
      if (translated) {
        console.log("[OpenCodeBackend] Translated event:", translated.type);
        yield translated;
      }
    }
    console.log("[OpenCodeBackend] Event stream ended");
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
   * Returns null if the event is not relevant or for a different session.
   */
  private translateEvent(
    event: OpenCodeEvent,
    sessionId: string
  ): AgentEvent | null {
    switch (event.type) {
      case "message.updated": {
        const msg = event.properties.info;
        if (msg.sessionID !== sessionId) return null;

        if (msg.role === "assistant") {
          // Message started or updated
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
          if (event.properties.delta) {
            return {
              type: "message.delta",
              content: event.properties.delta,
            };
          }
        } else if (part.type === "tool") {
          const state = part.state;
          if (state.status === "running") {
            return {
              type: "tool.start",
              toolName: part.tool,
              input: state.input,
            };
          } else if (state.status === "completed") {
            return {
              type: "tool.complete",
              toolName: part.tool,
              output: state.output,
            };
          } else if (state.status === "error") {
            return {
              type: "error",
              message: state.error,
            };
          }
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
}

/**
 * Get the server URL if in spawn mode.
 */
export function getServerUrl(backend: OpenCodeBackend): string | undefined {
  // Type assertion to access private field (for testing/debugging)
  const b = backend as unknown as { server: { url: string } | null };
  return b.server?.url;
}
