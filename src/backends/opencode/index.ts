/**
 * OpenCode backend implementation for Ralph Loops Management System.
 * Uses ACP JSON-RPC over stdio for agent communication.
 */

import { isRemoteOnlyMode } from "../../core/config";
import { log } from "../../core/logger";
import type { ModelInfo } from "../../types/api";
import type { TodoItem } from "../../types/loop";

import type {
  BackendConnectionConfig,
  CreateSessionOptions,
  AgentSession,
  PromptInput,
  AgentResponse,
  AgentPart,
  AgentEvent,
  Backend,
  ConnectionInfo,
} from "../types";
import { createEventStream, type EventStream } from "../../utils/event-stream";

// Re-export ConnectionInfo for backward compatibility
export type { ConnectionInfo } from "../types";

// Compatibility types retained for translation/unit tests.
type OpenCodeSession = {
  id: string;
  title?: string;
  time: { created: number };
};
type OpenCodeEvent = {
  type: string;
  properties: any;
};
type Part = any;
type AssistantMessage = any;

/**
 * Context object for translateEvent(), bundling per-subscription tracking state.
 */
interface TranslateEventContext {
  /** The session ID to filter events for */
  sessionId: string;
  /** Subscription ID for logging */
  subId: string;
  /** Set of message IDs we've already emitted start events for */
  emittedMessageStarts: Set<string>;
  /** Map of tool part IDs to their last emitted status */
  toolPartStatus: Map<string, string>;
  /** Map of reasoning part IDs to their last known text length */
  reasoningTextLength: Map<string, number>;
  /** Map of part IDs to their type (text, reasoning, tool, etc.) for delta routing */
  partTypes: Map<string, string>;
  /** Optional client-like object used by translateEvent() tests */
  client: any;
  /** Directory for session queries */
  directory: string;
}

type JsonRpcMessage = {
  jsonrpc: "2.0";
  id?: number;
  method?: string;
  params?: Record<string, unknown>;
  result?: unknown;
  error?: { code?: number; message?: string; data?: unknown };
};

type PendingRequest = {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timeout: ReturnType<typeof setTimeout>;
};

type SessionSubscriber = (event: AgentEvent) => void;

const DEFAULT_REQUEST_TIMEOUT_MS = 120_000;
const PROMPT_REQUEST_TIMEOUT_MS = 1_800_000;

type PermissionOption = {
  optionId: string;
  kind?: string;
};

type PendingPermissionRequest = {
  rpcId: number;
  options: PermissionOption[];
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function getString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function getNumber(value: unknown): number | undefined {
  return typeof value === "number" ? value : undefined;
}

function firstString(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === "string") {
      return value;
    }
  }
  return undefined;
}

function normalizeTodoStatus(value: unknown): TodoItem["status"] | undefined {
  const normalized = typeof value === "string" ? value.toLowerCase() : undefined;
  switch (normalized) {
    case "pending":
      return "pending";
    case "in_progress":
    case "in-progress":
    case "running":
    case "active":
      return "in_progress";
    case "completed":
    case "complete":
    case "done":
    case "finished":
    case "success":
      return "completed";
    case "cancelled":
    case "canceled":
    case "skipped":
      return "cancelled";
    default:
      return undefined;
  }
}

function normalizeTodoPriority(value: unknown): TodoItem["priority"] | undefined {
  const normalized = typeof value === "string" ? value.toLowerCase() : undefined;
  switch (normalized) {
    case "high":
    case "urgent":
      return "high";
    case "medium":
    case "normal":
      return "medium";
    case "low":
      return "low";
    default:
      return undefined;
  }
}

function makeTodoId(prefix: string, index: number, content: string): string {
  const normalizedContent = content
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  const suffix = normalizedContent.length > 0 ? normalizedContent : String(index);
  return `${prefix}-${index}-${suffix}`;
}

function parseTodoChecklist(raw: string, prefix: string): TodoItem[] {
  const todos: TodoItem[] = [];
  const lines = raw.split(/\r?\n/);
  const checkboxPattern = /^\s*[-*]\s*\[([ xX~\-])\]\s*(.+?)\s*$/;

  for (const line of lines) {
    const match = line.match(checkboxPattern);
    if (!match) {
      continue;
    }
    const marker = match[1];
    const content = match[2]?.trim() ?? "";
    if (content.length === 0) {
      continue;
    }

    const status: TodoItem["status"] =
      marker === "x" || marker === "X"
        ? "completed"
        : marker === "~" || marker === "-"
          ? "in_progress"
          : "pending";

    todos.push({
      id: makeTodoId(prefix, todos.length, content),
      content,
      status,
      priority: "medium",
    });
  }

  return todos;
}

function parseTodoRecord(value: Record<string, unknown>, index: number, prefix: string): TodoItem | null {
  const content = firstString(
    value["content"],
    value["text"],
    value["title"],
    value["task"],
    value["name"],
  )?.trim();

  if (!content) {
    return null;
  }

  const status = normalizeTodoStatus(value["status"])
    ?? (typeof value["done"] === "boolean" ? (value["done"] ? "completed" : "pending") : undefined)
    ?? "pending";

  const priority = normalizeTodoPriority(value["priority"]) ?? "medium";
  const id = firstString(value["id"], value["todoId"], value["key"]) ?? makeTodoId(prefix, index, content);

  return {
    id,
    content,
    status,
    priority,
  };
}

function parseTodosFromUnknown(value: unknown, prefix: string): TodoItem[] {
  if (Array.isArray(value)) {
    const todos: TodoItem[] = [];
    for (const [index, item] of value.entries()) {
      if (isRecord(item)) {
        const parsed = parseTodoRecord(item, index, prefix);
        if (parsed) {
          todos.push(parsed);
        }
        continue;
      }
      if (typeof item === "string") {
        const checklistTodos = parseTodoChecklist(item, `${prefix}-${index}`);
        if (checklistTodos.length > 0) {
          todos.push(...checklistTodos);
        } else if (item.trim().length > 0) {
          todos.push({
            id: makeTodoId(prefix, index, item),
            content: item.trim(),
            status: "pending",
            priority: "medium",
          });
        }
      }
    }
    return todos;
  }

  if (isRecord(value)) {
    const nestedTodos = value["todos"];
    if (nestedTodos !== undefined) {
      const parsedNested = parseTodosFromUnknown(nestedTodos, `${prefix}-todos`);
      if (parsedNested.length > 0) {
        return parsedNested;
      }
    }

    const parsedRecord = parseTodoRecord(value, 0, prefix);
    if (parsedRecord) {
      return [parsedRecord];
    }

    const textCandidates = [
      firstString(value["detailedContent"]),
      firstString(value["content"]),
      firstString(value["text"]),
      firstString(value["message"]),
    ];
    for (const candidate of textCandidates) {
      if (!candidate) {
        continue;
      }
      const parsedChecklist = parseTodoChecklist(candidate, prefix);
      if (parsedChecklist.length > 0) {
        return parsedChecklist;
      }
    }

    return [];
  }

  if (typeof value === "string") {
    return parseTodoChecklist(value, prefix);
  }

  return [];
}

function inferProviderID(modelID: string): string {
  if (modelID.startsWith("claude")) {
    return "anthropic";
  }
  if (modelID.startsWith("gpt")) {
    return "openai";
  }
  if (modelID.startsWith("gemini")) {
    return "google";
  }
  return "copilot";
}

/**
 * OpenCode backend implementation.
 * Supports stdio ACP mode and translates ACP stream updates into AgentEvents.
 */
export class OpenCodeBackend implements Backend {
  readonly name = "opencode";

  private process: Bun.Subprocess | null = null;
  private connected = false;
  private directory = "";
  private connectionInfo: ConnectionInfo | null = null;

  /** Track active subscriptions for reset functionality */
  private activeSubscriptions = new Set<AbortController>();

  /** Track pending JSON-RPC requests by ID */
  private pendingRequests = new Map<number, PendingRequest>();
  private nextRequestId = 1;

  /** Event subscriber callbacks by session */
  private sessionSubscribers = new Map<string, Set<SessionSubscriber>>();

  /** Track whether message.start has been emitted for active prompt per session */
  private sessionMessageStarted = new Map<string, boolean>();

  /** Monotonic per-session prompt sequence to ignore stale async completions */
  private sessionPromptSequences = new Map<string, number>();

  /** Whether the active async prompt has produced meaningful activity */
  private sessionPromptHasActivity = new Map<string, boolean>();

  /** Track reasoning part identity per session to separate distinct reasoning parts */
  private sessionReasoningPartKeys = new Map<string, string>();

  /** Cache sessions and model discovery results */
  private sessionCache = new Map<string, AgentSession>();
  private modelCache = new Map<string, ModelInfo[]>();

  /** Track active permission requests that expect a JSON-RPC response */
  private pendingPermissionRequests = new Map<string, PendingPermissionRequest>();

  /** Track tool call names by toolCallId to resolve later updates */
  private toolCallNames = new Map<string, string>();

  /** Track last emitted TODO snapshot per session to avoid duplicate updates */
  private sessionTodoSnapshots = new Map<string, string>();

  /**
   * Connect to an ACP-capable agent.
   * Uses spawn mode to launch the configured CLI with ACP stdio transport.
   * Connect mode is intentionally unsupported in the ACP runtime.
   */
  async connect(config: BackendConnectionConfig, _signal?: AbortSignal): Promise<void> {
    if (this.connected) {
      throw new Error("Already connected. Call disconnect() first.");
    }

    this.directory = config.directory;

    if (config.mode !== "spawn") {
      throw new Error("Connect mode is not supported by ACP runtime. Use stdio or ssh transport.");
    }

    if (isRemoteOnlyMode() && config.transport !== "ssh") {
      throw new Error(
        "Local stdio transport is disabled. RALPHER_REMOTE_ONLY environment variable is set. " +
        "Only ssh transport is allowed.",
      );
    }

    this.connected = true;
    try {
      await this.connectSpawn(config);
    } catch (error) {
      this.connected = false;
      this.process = null;
      throw error;
    }
  }

  /**
   * Spawn an ACP stdio process and initialize JSON-RPC.
   */
  private async connectSpawn(config: BackendConnectionConfig): Promise<void> {
    const command = config.command ?? (config.provider === "copilot" ? "copilot" : "opencode");
    const args = config.args ?? (config.provider === "copilot" ? ["--acp"] : ["acp"]);

    let process: Bun.Subprocess;
    try {
      process = Bun.spawn([command, ...args], {
        cwd: config.directory,
        stdin: "pipe",
        stdout: "pipe",
        stderr: "pipe",
      });
    } catch (error) {
      throw new Error(`Failed to spawn ACP process (${command}): ${String(error)}`);
    }

    this.process = process;
    this.startProcessReaders();

    try {
      await this.sendRpcRequest("initialize", {
        protocolVersion: 1,
        clientInfo: {
          name: "ralpher",
          version: "0.0.0",
        },
      });
    } catch (error) {
      await this.disconnect();
      throw new Error(`Failed to initialize ACP process (${command}): ${String(error)}`);
    }

    this.connectionInfo = {
      baseUrl: `acp://stdio/${command}`,
      authHeaders: {},
    };
  }

  /**
   * Disconnect from the backend and clean up resources.
   */
  async disconnect(): Promise<void> {
    if (!this.connected && !this.process) {
      return;
    }

    this.abortAllSubscriptions();

    for (const pending of this.pendingRequests.values()) {
      clearTimeout(pending.timeout);
      pending.reject(new Error("Disconnected"));
    }
    this.pendingRequests.clear();

    this.process = null;

    this.sessionSubscribers.clear();
    this.sessionMessageStarted.clear();
    this.sessionPromptSequences.clear();
    this.sessionPromptHasActivity.clear();
    this.sessionReasoningPartKeys.clear();
    this.sessionCache.clear();
    this.modelCache.clear();
    this.pendingPermissionRequests.clear();
    this.toolCallNames.clear();
    this.sessionTodoSnapshots.clear();

    this.connected = false;
    this.directory = "";
    this.connectionInfo = null;
  }

  /**
   * Check if connected to the backend.
   */
  isConnected(): boolean {
    return this.connected;
  }

  /**
   * Get the low-level client object (not used for ACP transport).
   */
  getSdkClient(): { transport: "acp-stdio" } | null {
    if (!this.connected) {
      return null;
    }
    return { transport: "acp-stdio" };
  }

  /**
   * Get the current directory.
   */
  getDirectory(): string {
    return this.directory;
  }

  /**
   * Get connection info for diagnostics and ancillary connections.
   */
  getConnectionInfo(): ConnectionInfo | null {
    return this.connectionInfo;
  }

  private ensureConnected(): void {
    if (!this.connected || !this.process) {
      throw new Error("Not connected. Call connect() first.");
    }
  }

  private startProcessReaders(): void {
    const process = this.process;
    if (
      !process
      || !process.stdout
      || !process.stderr
      || typeof process.stdout === "number"
      || typeof process.stderr === "number"
    ) {
      return;
    }

    void this.readRpcStream(process.stdout, "stdout");
    void this.readRpcStream(process.stderr, "stderr");
  }

  private async readRpcStream(stream: ReadableStream<Uint8Array>, source: "stdout" | "stderr"): Promise<void> {
    const reader = stream.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          break;
        }

        buffer += decoder.decode(value, { stream: true });
        let newlineIndex = buffer.indexOf("\n");
        while (newlineIndex >= 0) {
          const line = buffer.slice(0, newlineIndex).trim();
          buffer = buffer.slice(newlineIndex + 1);
          if (line.length > 0) {
            this.handleRpcLine(line, source);
          }
          newlineIndex = buffer.indexOf("\n");
        }
      }

      const rest = buffer.trim();
      if (rest.length > 0) {
        this.handleRpcLine(rest, source);
      }
    } catch (error) {
      log.warn(`[OpenCodeBackend] ACP ${source} stream ended with error`, {
        error: String(error),
      });
    }
  }

  private handleRpcLine(line: string, source: "stdout" | "stderr"): void {
    let message: JsonRpcMessage;
    try {
      message = JSON.parse(line) as JsonRpcMessage;
    } catch {
      if (source === "stderr") {
        log.debug(`[OpenCodeBackend] ACP stderr: ${line}`);
      } else {
        log.trace(`[OpenCodeBackend] Non-JSON stdout: ${line}`);
      }
      return;
    }

    this.handleRpcMessage(message);
  }

  private handleRpcMessage(message: JsonRpcMessage): void {
    const method = message.method;
    if (method && isRecord(message.params)) {
      if (method === "session/update") {
        this.handleSessionUpdate(message.params);
        return;
      }

      if (method === "session/request_permission") {
        const sessionId = getString(message.params["sessionId"]);
        if (!sessionId) {
          return;
        }
        const toolCall = isRecord(message.params["toolCall"]) ? message.params["toolCall"] : {};
        const requestId = typeof message.id === "number"
          ? `permission-${sessionId}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
          : firstString(message.params["requestId"], toolCall["toolCallId"]);
        if (!requestId) {
          return;
        }

        const permission = firstString(
          message.params["permission"],
          toolCall["kind"],
          toolCall["title"],
        ) ?? "*";
        const rawInput = isRecord(toolCall["rawInput"]) ? toolCall["rawInput"] : {};

        const patternsFromCommands = Array.isArray(rawInput["commands"])
          ? rawInput["commands"].filter((p): p is string => typeof p === "string")
          : [];
        const patterns = Array.isArray(message.params["patterns"])
          ? message.params["patterns"].filter((p): p is string => typeof p === "string")
          : patternsFromCommands.length > 0
            ? patternsFromCommands
            : firstString(rawInput["command"])
              ? [String(rawInput["command"])]
              : ["*"];

        const options = Array.isArray(message.params["options"])
          ? message.params["options"]
            .filter((option): option is Record<string, unknown> => isRecord(option))
            .map((option) => ({
              optionId: getString(option["optionId"]) ?? "",
              kind: getString(option["kind"]),
            }))
            .filter((option) => option.optionId.length > 0)
          : [];

        if (typeof message.id === "number") {
          this.pendingPermissionRequests.set(requestId, {
            rpcId: message.id,
            options,
          });
        }

        this.emitSessionEvent(sessionId, {
          type: "permission.asked",
          requestId,
          sessionId,
          permission,
          patterns,
        });
        return;
      }

      if (method === "session/question") {
        const sessionId = getString(message.params["sessionId"]);
        const requestId = getString(message.params["requestId"]);
        const questions = message.params["questions"];
        if (!sessionId || !requestId || !Array.isArray(questions)) {
          return;
        }
        this.emitSessionEvent(sessionId, {
          type: "question.asked",
          requestId,
          sessionId,
          questions: questions as any,
        });
        return;
      }

      if (method === "session/status") {
        const sessionId = getString(message.params["sessionId"]);
        const status = getString(message.params["status"]);
        if (!sessionId || (status !== "idle" && status !== "busy" && status !== "retry")) {
          return;
        }
        const hasActivePrompt = this.sessionPromptSequences.has(sessionId);
        if (hasActivePrompt && (status === "busy" || status === "retry")) {
          this.sessionPromptHasActivity.set(sessionId, true);
        }
        this.emitSessionEvent(sessionId, {
          type: "session.status",
          sessionId,
          status,
          attempt: getNumber(message.params["attempt"]),
          message: getString(message.params["message"]),
        });
        const hasPromptActivity = this.sessionPromptHasActivity.get(sessionId) ?? false;
        if (status === "idle" && hasActivePrompt && hasPromptActivity) {
          this.emitSessionEvent(sessionId, {
            type: "message.complete",
            content: "",
          });
          this.sessionMessageStarted.delete(sessionId);
          this.sessionPromptSequences.delete(sessionId);
          this.sessionPromptHasActivity.delete(sessionId);
          this.sessionReasoningPartKeys.delete(sessionId);
        }
        return;
      }

      if (method === "session/todo_updated") {
        const sessionId = getString(message.params["sessionId"]);
        const todos = message.params["todos"];
        if (!sessionId || !Array.isArray(todos)) {
          return;
        }
        const parsedTodos = parseTodosFromUnknown(todos, `session-todo-updated-${sessionId}`);
        if (parsedTodos.length > 0) {
          this.emitTodoUpdate(sessionId, parsedTodos);
          return;
        }
        this.emitSessionEvent(sessionId, {
          type: "todo.updated",
          sessionId,
          todos: todos as any,
        });
      }
      return;
    }

    if (typeof message.id === "number") {
      const pending = this.pendingRequests.get(message.id);
      if (!pending) {
        return;
      }

      clearTimeout(pending.timeout);
      this.pendingRequests.delete(message.id);

      if (message.error) {
        const errMessage = message.error.message ?? JSON.stringify(message.error);
        pending.reject(new Error(errMessage));
        return;
      }

      pending.resolve(message.result);
    }
  }

  private handleSessionUpdate(params: Record<string, unknown>): void {
    const sessionId = getString(params["sessionId"]);
    const updateObj = isRecord(params["update"]) ? params["update"] : params;
    const updateType = getString(updateObj["sessionUpdate"]) ?? getString(updateObj["type"]);
    const content = isRecord(updateObj["content"]) ? updateObj["content"] : {};

    if (!sessionId || !updateType) {
      return;
    }

    if (updateType === "agent_message_chunk") {
      if (this.sessionPromptSequences.has(sessionId)) {
        this.sessionPromptHasActivity.set(sessionId, true);
      }
      const text = getString(content["text"]) ?? "";
      if (!this.sessionMessageStarted.get(sessionId)) {
        this.sessionMessageStarted.set(sessionId, true);
        this.emitSessionEvent(sessionId, {
          type: "message.start",
          messageId: `msg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        });
      }
      if (text.length > 0) {
        this.emitSessionEvent(sessionId, {
          type: "message.delta",
          content: text,
        });
      }
      return;
    }

    if (updateType === "agent_thought_chunk") {
      if (this.sessionPromptSequences.has(sessionId)) {
        this.sessionPromptHasActivity.set(sessionId, true);
      }
      const text = getString(content["text"]) ?? "";
      if (text.length > 0) {
        let reasoningText = text;
        const partKey = this.getReasoningPartKey(updateObj, content);
        if (partKey) {
          const previousPartKey = this.sessionReasoningPartKeys.get(sessionId);
          if (previousPartKey && previousPartKey !== partKey && !text.startsWith("\n")) {
            reasoningText = `\n${text}`;
          }
          this.sessionReasoningPartKeys.set(sessionId, partKey);
        }
        this.emitSessionEvent(sessionId, {
          type: "reasoning.delta",
          content: reasoningText,
        });
      }
      return;
    }

    if (updateType === "tool_call") {
      if (this.sessionPromptSequences.has(sessionId)) {
        this.sessionPromptHasActivity.set(sessionId, true);
      }
      const toolCallId = firstString(updateObj["toolCallId"], content["toolCallId"]);
      const toolName = firstString(
        content["toolName"],
        content["name"],
        updateObj["toolName"],
        updateObj["name"],
        updateObj["kind"],
        content["kind"],
        updateObj["title"],
      ) ?? "unknown_tool";
      if (toolCallId) {
        this.toolCallNames.set(toolCallId, toolName);
      }
      this.emitSessionEvent(sessionId, {
        type: "tool.start",
        toolName,
        input: content["input"] ?? updateObj["input"] ?? updateObj["rawInput"] ?? {},
      });
      this.maybeEmitTodoUpdateFromToolPayload(sessionId, updateObj, content);
      return;
    }

    if (updateType === "tool_call_update") {
      if (this.sessionPromptSequences.has(sessionId)) {
        this.sessionPromptHasActivity.set(sessionId, true);
      }
      const toolCallId = firstString(updateObj["toolCallId"], content["toolCallId"]);
      const toolName = firstString(
        content["toolName"],
        content["name"],
        updateObj["toolName"],
        updateObj["name"],
        updateObj["kind"],
        toolCallId ? this.toolCallNames.get(toolCallId) : undefined,
        updateObj["title"],
      ) ?? "unknown_tool";
      const status = firstString(
        content["status"],
        updateObj["status"],
        content["state"],
        updateObj["state"],
      );

      if (
        status === "completed"
        || status === "success"
        || status === "failed"
        || status === "error"
        || status === "cancelled"
        || status === "canceled"
      ) {
        const rawOutput = isRecord(updateObj["rawOutput"]) ? updateObj["rawOutput"] : {};
        const errorMessage = firstString(content["error"], updateObj["error"], rawOutput["message"]);
        const baseOutput = content["output"] ?? updateObj["output"] ?? updateObj["rawOutput"] ?? content["content"] ?? updateObj["content"];
        const isFailure = status === "failed" || status === "error";
        const output = isFailure
          ? isRecord(baseOutput)
            ? {
              ...baseOutput,
              status,
              ...(errorMessage ? { error: errorMessage } : {}),
            }
            : {
              status,
              ...(errorMessage ? { error: errorMessage } : {}),
              ...(baseOutput !== undefined ? { output: baseOutput } : {}),
            }
          : baseOutput ?? {};

        this.emitSessionEvent(sessionId, {
          type: "tool.complete",
          toolName,
          output,
        });
        this.maybeEmitTodoUpdateFromToolPayload(sessionId, updateObj, content);
        if (toolCallId) {
          this.toolCallNames.delete(toolCallId);
        }
      }
    }
  }

  private emitTodoUpdate(sessionId: string, todos: TodoItem[]): void {
    if (todos.length === 0) {
      return;
    }

    const snapshot = JSON.stringify(
      todos.map((todo) => ({
        content: todo.content,
        status: todo.status,
        priority: todo.priority,
      })),
    );
    if (this.sessionTodoSnapshots.get(sessionId) === snapshot) {
      return;
    }

    this.sessionTodoSnapshots.set(sessionId, snapshot);
    this.emitSessionEvent(sessionId, {
      type: "todo.updated",
      sessionId,
      todos,
    });
  }

  private getReasoningPartKey(
    updateObj: Record<string, unknown>,
    content: Record<string, unknown>,
  ): string | undefined {
    const partId = firstString(
      content["partId"],
      content["partID"],
      updateObj["partId"],
      updateObj["partID"],
      content["reasoningPartId"],
      updateObj["reasoningPartId"],
      content["thoughtId"],
      updateObj["thoughtId"],
    );
    if (partId) {
      return `id:${partId}`;
    }

    const partIndex = getNumber(content["partIndex"])
      ?? getNumber(updateObj["partIndex"])
      ?? getNumber(content["reasoningPartIndex"])
      ?? getNumber(updateObj["reasoningPartIndex"]);
    if (partIndex !== undefined) {
      return `index:${partIndex}`;
    }

    return undefined;
  }

  private maybeEmitTodoUpdateFromToolPayload(
    sessionId: string,
    updateObj: Record<string, unknown>,
    content: Record<string, unknown>,
  ): void {
    const rawInput = isRecord(updateObj["rawInput"]) ? updateObj["rawInput"] : {};
    const input = isRecord(updateObj["input"]) ? updateObj["input"] : {};
    const contentInput = isRecord(content["input"]) ? content["input"] : {};
    const rawOutput = isRecord(updateObj["rawOutput"]) ? updateObj["rawOutput"] : {};
    const output = isRecord(updateObj["output"]) ? updateObj["output"] : {};
    const contentOutput = isRecord(content["output"]) ? content["output"] : {};

    const todoCandidates: Array<{ value: unknown; source: string }> = [
      { value: updateObj["todos"], source: "update-todos" },
      { value: content["todos"], source: "content-todos" },
      { value: rawInput["todos"], source: "raw-input-todos" },
      { value: input["todos"], source: "input-todos" },
      { value: contentInput["todos"], source: "content-input-todos" },
      { value: rawOutput["todos"], source: "raw-output-todos" },
      { value: output["todos"], source: "output-todos" },
      { value: contentOutput["todos"], source: "content-output-todos" },
      { value: rawOutput["detailedContent"], source: "raw-output-detailed-content" },
      { value: rawOutput["content"], source: "raw-output-content" },
      { value: output["detailedContent"], source: "output-detailed-content" },
      { value: output["content"], source: "output-content" },
      { value: contentOutput["detailedContent"], source: "content-output-detailed-content" },
      { value: contentOutput["content"], source: "content-output-content" },
    ];

    for (const candidate of todoCandidates) {
      if (candidate.value === undefined || candidate.value === null) {
        continue;
      }

      const parsedTodos = parseTodosFromUnknown(
        candidate.value,
        `tool-todos-${sessionId}-${candidate.source}`,
      );
      if (parsedTodos.length > 0) {
        this.emitTodoUpdate(sessionId, parsedTodos);
        return;
      }
    }
  }

  private addSessionSubscriber(sessionId: string, subscriber: SessionSubscriber): void {
    const existing = this.sessionSubscribers.get(sessionId) ?? new Set<SessionSubscriber>();
    existing.add(subscriber);
    this.sessionSubscribers.set(sessionId, existing);
  }

  private removeSessionSubscriber(sessionId: string, subscriber: SessionSubscriber): void {
    const existing = this.sessionSubscribers.get(sessionId);
    if (!existing) {
      return;
    }
    existing.delete(subscriber);
    if (existing.size === 0) {
      this.sessionSubscribers.delete(sessionId);
    }
  }

  private emitSessionEvent(sessionId: string, event: AgentEvent): void {
    const subscribers = this.sessionSubscribers.get(sessionId);
    if (!subscribers || subscribers.size === 0) {
      return;
    }

    for (const subscriber of subscribers) {
      subscriber(event);
    }
  }

  private writeRpcMessage(message: JsonRpcMessage): void {
    const process = this.process;
    if (!process || !process.stdin) {
      throw new Error("ACP process is not available");
    }
    if (typeof process.stdin === "number") {
      throw new Error("ACP process stdin is not writable");
    }

    process.stdin.write(`${JSON.stringify(message)}\n`);
  }

  private async sendRpcRequest<T>(
    method: string,
    params: Record<string, unknown>,
    timeoutMs = DEFAULT_REQUEST_TIMEOUT_MS,
  ): Promise<T> {
    this.ensureConnected();

    const id = this.nextRequestId;
    this.nextRequestId += 1;

    const message: JsonRpcMessage = {
      jsonrpc: "2.0",
      id,
      method,
      params,
    };

    return await new Promise<T>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingRequests.delete(id);
        reject(new Error(`ACP request timed out for method '${method}'`));
      }, timeoutMs);

      this.pendingRequests.set(id, {
        resolve: (value: unknown) => resolve(value as T),
        reject,
        timeout,
      });

      try {
        this.writeRpcMessage(message);
      } catch (error) {
        clearTimeout(timeout);
        this.pendingRequests.delete(id);
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    });
  }

  private parseModelsFromSessionResult(result: unknown): ModelInfo[] {
    if (!isRecord(result)) {
      return [];
    }

    const modelsRaw = result["models"];
    const modelEntries = Array.isArray(modelsRaw)
      ? modelsRaw
      : isRecord(modelsRaw) && Array.isArray(modelsRaw["availableModels"])
        ? modelsRaw["availableModels"]
        : [];

    const mapped: ModelInfo[] = [];
    for (const item of modelEntries) {
      if (!isRecord(item)) {
        continue;
      }

      const modelID = getString(item["id"]) ?? getString(item["modelId"]);
      if (!modelID) {
        continue;
      }

      const name = getString(item["name"]) ?? modelID;
      const providerID = getString(item["provider"]) ?? inferProviderID(modelID);

      mapped.push({
        providerID,
        providerName: providerID,
        modelID,
        modelName: name,
        connected: true,
        variants: [""],
      });
    }

    const seen = new Set<string>();
    return mapped.filter((model) => {
      const key = `${model.providerID}:${model.modelID}`;
      if (seen.has(key)) {
        return false;
      }
      seen.add(key);
      return true;
    });
  }

  private buildPromptParts(prompt: PromptInput): Array<Record<string, string>> {
    return prompt.parts.map((part) => ({
      type: "text",
      text: part.text,
    }));
  }

  private buildPromptParams(sessionId: string, prompt: PromptInput): Record<string, unknown> {
    const modelID = prompt.model?.modelID;
    return {
      sessionId,
      prompt: this.buildPromptParts(prompt),
      ...(modelID ? { model: modelID } : {}),
    };
  }

  /**
   * Create a new session.
   */
  async createSession(options: CreateSessionOptions): Promise<AgentSession> {
    const result = await this.sendRpcRequest<unknown>("session/new", {
      cwd: options.directory,
      mcpServers: [],
      ...(options.title ? { title: options.title } : {}),
    });

    if (!isRecord(result)) {
      throw new Error("Invalid ACP response for session/new");
    }

    const id = getString(result["sessionId"]);
    if (!id) {
      throw new Error("ACP session/new did not return sessionId");
    }

    const session = this.mapSession({
      id,
      title: options.title,
      time: { created: Date.now() },
    });

    this.sessionCache.set(id, session);

    const models = this.parseModelsFromSessionResult(result);
    if (models.length > 0) {
      this.modelCache.set(options.directory, models);
    }

    return session;
  }

  /**
   * Get an existing session by ID.
   */
  async getSession(id: string): Promise<AgentSession | null> {
    const cached = this.sessionCache.get(id);
    if (cached) {
      return cached;
    }

    const result = await this.sendRpcRequest<unknown>("session/list", {});
    if (!isRecord(result) || !Array.isArray(result["sessions"])) {
      return null;
    }

    for (const rawSession of result["sessions"]) {
      if (!isRecord(rawSession)) {
        continue;
      }
      const sessionId = getString(rawSession["sessionId"]);
      if (sessionId !== id) {
        continue;
      }
      const session = this.mapSession({
        id: sessionId,
        title: getString(rawSession["title"]),
        time: { created: Date.now() },
      });
      this.sessionCache.set(session.id, session);
      return session;
    }

    return null;
  }

  /**
   * Delete a session.
   */
  async deleteSession(id: string): Promise<void> {
    this.ensureConnected();

    try {
      await this.sendRpcRequest("session/delete", { sessionId: id });
    } catch (error) {
      const message = String(error);
      if (!message.includes("Method not found") && !message.includes("-32601")) {
        throw error;
      }
    }

    this.sessionCache.delete(id);
    this.sessionSubscribers.delete(id);
    this.sessionMessageStarted.delete(id);
    this.sessionPromptSequences.delete(id);
    this.sessionPromptHasActivity.delete(id);
    this.sessionReasoningPartKeys.delete(id);
    this.sessionTodoSnapshots.delete(id);
  }

  /**
   * Send a prompt synchronously and return collected content.
   */
  async sendPrompt(sessionId: string, prompt: PromptInput): Promise<AgentResponse> {
    this.ensureConnected();

    const chunks: string[] = [];
    const toolParts: AgentPart[] = [];

    const capture: SessionSubscriber = (event) => {
      if (event.type === "message.delta") {
        chunks.push(event.content);
      } else if (event.type === "tool.start") {
        toolParts.push({
          type: "tool_call",
          toolName: event.toolName,
          toolInput: event.input,
        });
      } else if (event.type === "tool.complete") {
        toolParts.push({
          type: "tool_result",
          toolName: event.toolName,
          toolOutput: event.output,
        });
      }
    };

    this.addSessionSubscriber(sessionId, capture);
    this.sessionMessageStarted.set(sessionId, false);

    let responseContent = "";
    try {
      const result = await this.sendRpcRequest<unknown>(
        "session/prompt",
        this.buildPromptParams(sessionId, prompt),
        PROMPT_REQUEST_TIMEOUT_MS,
      );

      if (isRecord(result)) {
        const content = getString(result["content"]);
        if (content) {
          responseContent = content;
        }
      }
    } finally {
      this.removeSessionSubscriber(sessionId, capture);
      this.sessionMessageStarted.delete(sessionId);
    }

    if (!responseContent) {
      responseContent = chunks.join("");
    }

    const mappedParts: Part[] = [];
    if (responseContent.length > 0) {
      mappedParts.push({
        type: "text",
        text: responseContent,
      });
    }
    for (const part of toolParts) {
      if (part.type === "tool_call") {
        mappedParts.push({
          type: "tool",
          tool: part.toolName ?? "unknown_tool",
          state: {
            status: "running",
            input: part.toolInput,
          },
        });
      } else if (part.type === "tool_result") {
        mappedParts.push({
          type: "tool",
          tool: part.toolName ?? "unknown_tool",
          state: {
            status: "completed",
            output: part.toolOutput,
          },
        });
      }
    }

    return this.mapResponse({
      info: {
        id: `msg-${Date.now()}`,
        tokens: { input: 0, output: 0 },
      },
      parts: mappedParts,
    });
  }

  /**
   * Send a prompt asynchronously. Streaming updates are emitted via subscribeToEvents().
   */
  async sendPromptAsync(sessionId: string, prompt: PromptInput): Promise<void> {
    this.ensureConnected();
    this.sessionMessageStarted.set(sessionId, false);
    const sequence = (this.sessionPromptSequences.get(sessionId) ?? 0) + 1;
    this.sessionPromptSequences.set(sessionId, sequence);
    this.sessionPromptHasActivity.set(sessionId, false);
    this.sessionReasoningPartKeys.delete(sessionId);

    void this.sendRpcRequest("session/prompt", this.buildPromptParams(sessionId, prompt), PROMPT_REQUEST_TIMEOUT_MS)
      .then(() => {
        if (this.sessionPromptSequences.get(sessionId) !== sequence) {
          return;
        }
        this.emitSessionEvent(sessionId, {
          type: "message.complete",
          content: "",
        });
        this.sessionMessageStarted.delete(sessionId);
        this.sessionPromptSequences.delete(sessionId);
        this.sessionPromptHasActivity.delete(sessionId);
        this.sessionReasoningPartKeys.delete(sessionId);
      })
      .catch((error) => {
        if (this.sessionPromptSequences.get(sessionId) !== sequence) {
          return;
        }
        const message = String(error);
        if (message.includes("ACP request timed out for method 'session/prompt'")) {
          log.warn("[OpenCodeBackend] session/prompt request timed out; waiting for status-driven completion", {
            sessionId,
          });
          return;
        }
        this.emitSessionEvent(sessionId, {
          type: "error",
          message,
        });
        this.sessionMessageStarted.delete(sessionId);
        this.sessionPromptSequences.delete(sessionId);
        this.sessionPromptHasActivity.delete(sessionId);
        this.sessionReasoningPartKeys.delete(sessionId);
      });
  }

  /**
   * Abort a running session prompt if supported by the ACP provider.
   */
  async abortSession(sessionId: string): Promise<void> {
    this.ensureConnected();

    const cancellationMethods = ["session/cancel", "session/abort", "session/stop"];
    for (const method of cancellationMethods) {
      try {
        await this.sendRpcRequest(method, { sessionId }, 5_000);
        return;
      } catch (error) {
        const message = String(error);
        if (!message.includes("Method not found") && !message.includes("-32601")) {
          throw error;
        }
      }
    }

    log.debug("[OpenCodeBackend] Session abort is not supported by current ACP provider", { sessionId });
  }

  /**
   * Get available models for a directory.
   */
  async getModels(directory: string): Promise<ModelInfo[]> {
    const cached = this.modelCache.get(directory);
    if (cached) {
      return cached;
    }

    const result = await this.sendRpcRequest<unknown>("session/new", {
      cwd: directory,
      mcpServers: [],
    });

    const models = this.parseModelsFromSessionResult(result);
    if (models.length > 0) {
      this.modelCache.set(directory, models);
    }
    return models;
  }

  /**
   * Reply to a permission request.
   */
  async replyToPermission(requestId: string, response: string): Promise<void> {
    this.ensureConnected();

    const pendingRequest = this.pendingPermissionRequests.get(requestId);
    if (pendingRequest) {
      const normalizedResponse = response.toLowerCase();
      const preferredKinds =
        normalizedResponse === "always"
          ? ["allow_always", "allow_once"]
          : normalizedResponse === "once" || normalizedResponse === "allow"
            ? ["allow_once", "allow_always"]
            : normalizedResponse === "reject" || normalizedResponse === "deny"
              ? ["reject_once", "reject_always"]
              : [];

      let optionId = pendingRequest.options.find((option) => option.optionId === response)?.optionId;
      if (!optionId) {
        for (const preferredKind of preferredKinds) {
          optionId = pendingRequest.options.find((option) => option.kind === preferredKind)?.optionId;
          if (optionId) {
            break;
          }
        }
      }
      optionId = optionId
        ?? pendingRequest.options.find((option) => option.kind?.startsWith("allow"))?.optionId
        ?? pendingRequest.options[0]?.optionId;

      this.pendingPermissionRequests.delete(requestId);

      this.writeRpcMessage({
        jsonrpc: "2.0",
        id: pendingRequest.rpcId,
        result: {
          outcome: optionId
            ? { outcome: "selected", optionId }
            : { outcome: "cancelled" },
        },
      });
      return;
    }

    const payload = {
      requestId,
      response,
    };

    const methods = ["session/reply_permission", "session/permission_reply"];
    for (const method of methods) {
      try {
        await this.sendRpcRequest(method, payload, 10_000);
        return;
      } catch (error) {
        const message = String(error);
        if (!message.includes("Method not found") && !message.includes("-32601")) {
          throw error;
        }
      }
    }

    log.debug("[OpenCodeBackend] Permission reply is not supported by current ACP provider", {
      requestId,
      response,
    });
  }

  /**
   * Reply to a question request.
   */
  async replyToQuestion(requestId: string, answers: string[][]): Promise<void> {
    this.ensureConnected();

    const payload = {
      requestId,
      answers,
    };

    const methods = ["session/reply_question", "session/question_reply"];
    for (const method of methods) {
      try {
        await this.sendRpcRequest(method, payload, 10_000);
        return;
      } catch (error) {
        const message = String(error);
        if (!message.includes("Method not found") && !message.includes("-32601")) {
          throw error;
        }
      }
    }

    log.debug("[OpenCodeBackend] Question reply is not supported by current ACP provider", {
      requestId,
      answersCount: answers.length,
    });
  }

  /**
   * Abort all active event subscriptions.
   */
  abortAllSubscriptions(): void {
    for (const abortController of this.activeSubscriptions) {
      abortController.abort();
    }
    this.activeSubscriptions.clear();
  }

  /**
   * Subscribe to session events emitted from ACP notifications.
   */
  async subscribeToEvents(sessionId: string): Promise<EventStream<AgentEvent>> {
    this.ensureConnected();

    const abortController = new AbortController();
    this.activeSubscriptions.add(abortController);

    const { stream, push, end } = createEventStream<AgentEvent>();

    const subscriber: SessionSubscriber = (event) => {
      if (!abortController.signal.aborted) {
        push(event);
      }
    };

    this.addSessionSubscriber(sessionId, subscriber);

    const wrappedStream: EventStream<AgentEvent> = {
      next: () => stream.next(),
      close: () => {
        abortController.abort();
        this.activeSubscriptions.delete(abortController);
        this.removeSessionSubscriber(sessionId, subscriber);
        stream.close();
        end();
      },
    };

    return wrappedStream;
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
   */
  translateEvent(
    event: OpenCodeEvent,
    ctx: TranslateEventContext
  ): AgentEvent | null {
    const { sessionId, subId, emittedMessageStarts, toolPartStatus, reasoningTextLength, partTypes, client, directory } = ctx;
    switch (event.type) {
      case "message.updated": {
        const msg = event.properties.info;
        log.trace(`[OpenCodeBackend:${subId}] translateEvent: message.updated`, {
          msgSessionId: msg.sessionID,
          targetSessionId: sessionId,
          role: msg.role,
          messageId: msg.id,
          alreadyEmitted: emittedMessageStarts.has(msg.id),
        });
        if (msg.sessionID !== sessionId) {
          log.trace(`[OpenCodeBackend:${subId}] translateEvent: message.updated - session ID mismatch`);
          return null;
        }

        if (msg.role === "assistant") {
          // Only emit message.start once per message ID
          if (emittedMessageStarts.has(msg.id)) {
            log.trace(`[OpenCodeBackend:${subId}] translateEvent: message.updated - already emitted start for this message`);
            return null;
          }
          emittedMessageStarts.add(msg.id);
          log.info(`[OpenCodeBackend:${subId}] translateEvent: message.updated - emitting message.start`, { messageId: msg.id });
          return {
            type: "message.start",
            messageId: msg.id,
          };
        }
        log.trace(`[OpenCodeBackend:${subId}] translateEvent: message.updated - role is not assistant, returning null`, { role: msg.role });
        return null;
      }

      case "message.part.updated": {
        const part = event.properties.part;
        log.trace(`[OpenCodeBackend:${subId}] translateEvent: message.part.updated`, {
          partSessionId: part.sessionID,
          targetSessionId: sessionId,
          partType: part.type,
        });
        if (part.sessionID !== sessionId) {
          log.trace(`[OpenCodeBackend:${subId}] translateEvent: message.part.updated - session ID mismatch`);
          return null;
        }

        // Track the part type so message.part.delta can route correctly
        partTypes.set(part.id, part.type);

        if (part.type === "text") {
          // In SDK 1.2.x, text deltas arrive via message.part.delta events.
          // message.part.updated only carries the full accumulated text.
          // We use message.part.delta for streaming, so nothing to emit here.
          log.trace(`[OpenCodeBackend:${subId}] translateEvent: message.part.updated - text part (deltas via message.part.delta)`);
        } else if (part.type === "reasoning") {
          // In SDK 1.2.x, reasoning deltas arrive via message.part.delta events.
          // Fallback: if we have full text and our tracked length is behind,
          // emit the new content (handles cases where delta events are missed).
          if (part.text) {
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
        if (event.properties.sessionID !== sessionId) {
          log.trace(`[OpenCodeBackend:${subId}] translateEvent: session.idle - session ID mismatch`);
          return null;
        }
        // Session is idle = message complete
        // If we never saw a message.start, this might indicate an empty or error response
        if (!emittedMessageStarts.size) {
          log.warn(`[OpenCodeBackend:${subId}] translateEvent: session.idle received but no assistant messages were seen`, {
            sessionId,
            emittedMessageStartsCount: emittedMessageStarts.size,
          });
          // Fetch the session to see what messages exist
          (async () => {
            try {
              const sessionResult = await client.session.get({
                sessionID: sessionId,
                directory,
              });
              if (sessionResult.data) {
                const session = sessionResult.data as any;
                log.warn(`[OpenCodeBackend:${subId}] translateEvent: session.idle - session details`, {
                  sessionId,
                  messageCount: session.messages?.length ?? 0,
                  messages: JSON.stringify(session.messages ?? [], null, 2),
                });
              }
            } catch (err) {
              log.error(`[OpenCodeBackend:${subId}] translateEvent: Failed to fetch session details`, { error: String(err) });
            }
          })();
        }
        log.info(`[OpenCodeBackend:${subId}] translateEvent: session.idle - emitting message.complete`, { sessionId });
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
        log.error(`[OpenCodeBackend:${subId}] translateEvent: session.error`, { sessionId, errorMessage });
        return {
          type: "error",
          message: errorMessage,
        };
      }

      case "permission.asked": {
        // Permission request from the AI
        const props = event.properties;
        if (props.sessionID !== sessionId) return null;
        return {
          type: "permission.asked",
          requestId: props.id,
          sessionId: props.sessionID,
          permission: props.permission ?? "unknown",
          patterns: props.patterns ?? [],
        };
      }

      case "question.asked": {
        // Question from the AI requiring user input
        const props = event.properties;
        if (props.sessionID !== sessionId) return null;
        return {
          type: "question.asked",
          requestId: props.id,
          sessionId: props.sessionID,
          questions: (props.questions ?? []).map((q: any) => ({
            question: q.question ?? "",
            header: q.header ?? "",
            options: (q.options ?? []).map((o: any) => ({
              label: o.label ?? "",
              description: o.description ?? "",
            })),
            multiple: q.multiple ?? false,
            custom: q.custom ?? true,
          })),
        };
      }

      case "session.status": {
        // Session status update (idle, busy, retry)
        const props = event.properties;
        if (props.sessionID !== sessionId) return null;
        // Extract status type and optional retry info
        const statusInfo = props.status;
        const statusType = statusInfo.type;
        return {
          type: "session.status",
          sessionId: props.sessionID,
          status: statusType,
          attempt: statusType === "retry" ? statusInfo.attempt : undefined,
          message: statusType === "retry" ? statusInfo.message : undefined,
        };
      }

      case "todo.updated": {
        // TODO list updated
        const props = event.properties;
        if (props.sessionID !== sessionId) return null;
        return {
          type: "todo.updated",
          sessionId: props.sessionID,
          todos: (props.todos ?? []).map((todo: any, index: number) => ({
            content: todo.content,
            status: todo.status as "pending" | "in_progress" | "completed" | "cancelled",
            priority: todo.priority as "high" | "medium" | "low",
            id: `todo-${index}`,
          })),
        };
      }

      default:
        if ((event as { type: string }).type === "message.part.delta") {
          type MessagePartDeltaEvent = {
            type: "message.part.delta";
            properties: {
              sessionID: string;
              partID: string;
              field: string;
              delta: string;
            };
          };

          const deltaEvent = event as unknown as MessagePartDeltaEvent;
          const { sessionID, partID, field, delta } = deltaEvent.properties;
          if (sessionID !== sessionId) {
            return null;
          }

          const partType = partTypes.get(partID);
          const resolvedType = partType ?? field;
          if (resolvedType === "text") {
            return {
              type: "message.delta",
              content: delta,
            };
          }
          if (resolvedType === "reasoning") {
            const currentLength = reasoningTextLength.get(partID) ?? 0;
            reasoningTextLength.set(partID, currentLength + delta.length);
            return {
              type: "reasoning.delta",
              content: delta,
            };
          }
          return null;
        }

        // Log unhandled event types for debugging
        log.debug(`[OpenCodeBackend:${subId}] translateEvent: Unhandled event type`, { type: event.type });
        return null;
    }
  }

}
