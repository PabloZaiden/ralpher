/**
 * Test data factories for creating mock data objects.
 *
 * Each factory creates a valid object with sensible defaults and supports
 * partial overrides via the spread pattern.
 */

import type { Loop, LoopConfig, LoopState, LoopStatus, ModelConfig } from "@/types/loop";
import type { GitConfig, GitState, GitCommit, IterationSummary, LoopLogEntry, PersistedMessage, PersistedToolCall, LoopError, SessionInfo } from "@/types/loop";
import type { Workspace, WorkspaceWithLoopCount } from "@/types/workspace";
import type { BranchInfo, ModelInfo, FileDiff } from "@/types/api";
import type { MessageData, ToolCallData, LoopEvent } from "@/types/events";
import type { TodoItem } from "@/backends/types";
import type { ServerSettings } from "@/types/settings";

let counter = 0;
function nextId(): string {
  counter++;
  return `test-${counter}-${Date.now()}`;
}

function isoNow(): string {
  return new Date().toISOString();
}

// ============================================
// Model
// ============================================

export function createModelConfig(overrides?: Partial<ModelConfig>): ModelConfig {
  return {
    providerID: "anthropic",
    modelID: "claude-sonnet-4-20250514",
    ...overrides,
  };
}

// ============================================
// Server Settings
// ============================================

export function createServerSettings(overrides?: Partial<ServerSettings>): ServerSettings {
  return {
    mode: "spawn",
    useHttps: false,
    allowInsecure: false,
    ...overrides,
  };
}

// ============================================
// Git
// ============================================

export function createGitConfig(overrides?: Partial<GitConfig>): GitConfig {
  return {
    branchPrefix: "ralph/",
    commitPrefix: "[Ralph]",
    ...overrides,
  };
}

export function createGitCommit(overrides?: Partial<GitCommit>): GitCommit {
  return {
    iteration: 1,
    sha: "abc123def456",
    message: "[Ralph] Initial implementation",
    timestamp: isoNow(),
    filesChanged: 3,
    ...overrides,
  };
}

export function createGitState(overrides?: Partial<GitState>): GitState {
  return {
    originalBranch: "main",
    workingBranch: "ralph/test-loop",
    commits: [],
    ...overrides,
  };
}

// ============================================
// Session
// ============================================

export function createSessionInfo(overrides?: Partial<SessionInfo>): SessionInfo {
  return {
    id: nextId(),
    serverUrl: "http://localhost:3000",
    ...overrides,
  };
}

// ============================================
// Error
// ============================================

export function createLoopError(overrides?: Partial<LoopError>): LoopError {
  return {
    message: "Test error occurred",
    iteration: 1,
    timestamp: isoNow(),
    ...overrides,
  };
}

// ============================================
// Iteration Summary
// ============================================

export function createIterationSummary(overrides?: Partial<IterationSummary>): IterationSummary {
  return {
    iteration: 1,
    startedAt: isoNow(),
    completedAt: isoNow(),
    messageCount: 5,
    toolCallCount: 3,
    outcome: "continue",
    ...overrides,
  };
}

// ============================================
// Log Entry
// ============================================

export function createLoopLogEntry(overrides?: Partial<LoopLogEntry>): LoopLogEntry {
  return {
    id: nextId(),
    level: "info",
    message: "Test log entry",
    timestamp: isoNow(),
    ...overrides,
  };
}

// ============================================
// Persisted Message
// ============================================

export function createPersistedMessage(overrides?: Partial<PersistedMessage>): PersistedMessage {
  return {
    id: nextId(),
    role: "assistant",
    content: "This is a test message",
    timestamp: isoNow(),
    ...overrides,
  };
}

// ============================================
// Persisted Tool Call
// ============================================

export function createPersistedToolCall(overrides?: Partial<PersistedToolCall>): PersistedToolCall {
  return {
    id: nextId(),
    name: "Write",
    input: { filePath: "/src/index.ts", content: "test" },
    status: "completed",
    timestamp: isoNow(),
    ...overrides,
  };
}

// ============================================
// Todo Item
// ============================================

export function createTodoItem(overrides?: Partial<TodoItem>): TodoItem {
  return {
    id: nextId(),
    content: "Test todo item",
    status: "pending",
    priority: "medium",
    ...overrides,
  };
}

// ============================================
// Loop Config
// ============================================

export function createLoopConfig(overrides?: Partial<LoopConfig>): LoopConfig {
  const id = overrides?.id ?? nextId();
  return {
    id,
    name: "Test Loop",
    directory: "/workspaces/test-project",
    prompt: "Write a test function",
    createdAt: isoNow(),
    updatedAt: isoNow(),
    workspaceId: "workspace-1",
    model: createModelConfig(),
    maxIterations: Infinity,
    maxConsecutiveErrors: 10,
    activityTimeoutSeconds: 180,
    stopPattern: "<promise>COMPLETE</promise>$",
    git: createGitConfig(),
    clearPlanningFolder: false,
    planMode: true,
    ...overrides,
  };
}

// ============================================
// Loop State
// ============================================

export function createLoopState(overrides?: Partial<LoopState>): LoopState {
  const id = overrides?.id ?? nextId();
  return {
    id,
    status: "idle",
    currentIteration: 0,
    recentIterations: [],
    logs: [],
    messages: [],
    toolCalls: [],
    todos: [],
    ...overrides,
  };
}

// ============================================
// Loop (combined config + state)
// ============================================

export function createLoop(overrides?: {
  config?: Partial<LoopConfig>;
  state?: Partial<LoopState>;
}): Loop {
  const id = overrides?.config?.id ?? overrides?.state?.id ?? nextId();
  return {
    config: createLoopConfig({ ...overrides?.config, id }),
    state: createLoopState({ ...overrides?.state, id }),
  };
}

/**
 * Create a loop in a specific status with appropriate state.
 */
export function createLoopWithStatus(status: LoopStatus, overrides?: {
  config?: Partial<LoopConfig>;
  state?: Partial<LoopState>;
}): Loop {
  const stateOverrides: Partial<LoopState> = { status };

  switch (status) {
    case "running":
    case "waiting":
      stateOverrides.startedAt = isoNow();
      stateOverrides.currentIteration = 1;
      stateOverrides.session = createSessionInfo();
      stateOverrides.git = createGitState();
      break;
    case "planning":
      stateOverrides.startedAt = isoNow();
      stateOverrides.session = createSessionInfo();
      stateOverrides.git = createGitState();
      stateOverrides.planMode = {
        active: true,
        feedbackRounds: 0,
        planningFolderCleared: false,
        isPlanReady: false,
      };
      break;
    case "completed":
    case "stopped":
    case "failed":
    case "max_iterations":
      stateOverrides.startedAt = isoNow();
      stateOverrides.completedAt = isoNow();
      stateOverrides.currentIteration = 3;
      stateOverrides.git = createGitState();
      if (status === "failed") {
        stateOverrides.error = createLoopError();
      }
      break;
    case "merged":
      stateOverrides.startedAt = isoNow();
      stateOverrides.completedAt = isoNow();
      stateOverrides.currentIteration = 3;
      stateOverrides.git = createGitState();
      break;
    case "pushed":
      stateOverrides.startedAt = isoNow();
      stateOverrides.completedAt = isoNow();
      stateOverrides.currentIteration = 3;
      stateOverrides.git = createGitState();
      stateOverrides.reviewMode = {
        addressable: true,
        completionAction: "push",
        reviewCycles: 0,
        reviewBranches: [],
      };
      break;
    case "deleted":
      stateOverrides.startedAt = isoNow();
      stateOverrides.completedAt = isoNow();
      stateOverrides.git = createGitState();
      break;
  }

  return createLoop({
    config: overrides?.config,
    state: { ...stateOverrides, ...overrides?.state },
  });
}

// ============================================
// Workspace
// ============================================

export function createWorkspace(overrides?: Partial<Workspace>): Workspace {
  return {
    id: overrides?.id ?? nextId(),
    name: "Test Workspace",
    directory: "/workspaces/test-project",
    serverSettings: createServerSettings(),
    createdAt: isoNow(),
    updatedAt: isoNow(),
    ...overrides,
  };
}

export function createWorkspaceWithLoopCount(overrides?: Partial<WorkspaceWithLoopCount>): WorkspaceWithLoopCount {
  return {
    ...createWorkspace(overrides),
    loopCount: 0,
    ...overrides,
  };
}

// ============================================
// API Response Types
// ============================================

export function createBranchInfo(overrides?: Partial<BranchInfo>): BranchInfo {
  return {
    name: "main",
    current: true,
    ...overrides,
  };
}

export function createModelInfo(overrides?: Partial<ModelInfo>): ModelInfo {
  return {
    providerID: "anthropic",
    providerName: "Anthropic",
    modelID: "claude-sonnet-4-20250514",
    modelName: "Claude Sonnet 4",
    connected: true,
    ...overrides,
  };
}

export function createFileDiff(overrides?: Partial<FileDiff>): FileDiff {
  return {
    path: "src/index.ts",
    status: "modified",
    additions: 10,
    deletions: 2,
    ...overrides,
  };
}

// ============================================
// Event Types
// ============================================

export function createMessageData(overrides?: Partial<MessageData>): MessageData {
  return {
    id: nextId(),
    role: "assistant",
    content: "Test message content",
    timestamp: isoNow(),
    ...overrides,
  };
}

export function createToolCallData(overrides?: Partial<ToolCallData>): ToolCallData {
  return {
    id: nextId(),
    name: "Write",
    input: { filePath: "/src/test.ts" },
    status: "completed",
    timestamp: isoNow(),
    ...overrides,
  };
}

/**
 * Create a typed LoopEvent.
 * Use specific factory functions below for convenience.
 */
export function createLoopCreatedEvent(loopId: string, config?: Partial<LoopConfig>): LoopEvent {
  return {
    type: "loop.created",
    loopId,
    config: createLoopConfig({ ...config, id: loopId }),
    timestamp: isoNow(),
  };
}

export function createLoopStartedEvent(loopId: string, iteration = 1): LoopEvent {
  return {
    type: "loop.started",
    loopId,
    iteration,
    timestamp: isoNow(),
  };
}

export function createLoopCompletedEvent(loopId: string, totalIterations = 3): LoopEvent {
  return {
    type: "loop.completed",
    loopId,
    totalIterations,
    timestamp: isoNow(),
  };
}

export function createLoopDeletedEvent(loopId: string): LoopEvent {
  return {
    type: "loop.deleted",
    loopId,
    timestamp: isoNow(),
  };
}

export function createLoopMessageEvent(loopId: string, message?: Partial<MessageData>): LoopEvent {
  return {
    type: "loop.message",
    loopId,
    iteration: 1,
    message: createMessageData(message),
    timestamp: isoNow(),
  };
}

export function createLoopToolCallEvent(loopId: string, tool?: Partial<ToolCallData>): LoopEvent {
  return {
    type: "loop.tool_call",
    loopId,
    iteration: 1,
    tool: createToolCallData(tool),
    timestamp: isoNow(),
  };
}

export function createLoopLogEvent(loopId: string, overrides?: Partial<{ id: string; level: string; message: string; details: Record<string, unknown> }>): LoopEvent {
  return {
    type: "loop.log",
    loopId,
    id: overrides?.id ?? nextId(),
    level: (overrides?.level ?? "info") as "info",
    message: overrides?.message ?? "Test log message",
    details: overrides?.details,
    timestamp: isoNow(),
  };
}

export function createLoopProgressEvent(loopId: string, content = "Streaming..."): LoopEvent {
  return {
    type: "loop.progress",
    loopId,
    iteration: 1,
    content,
    timestamp: isoNow(),
  };
}

export function createLoopPlanReadyEvent(loopId: string, planContent = "# Plan\n\n1. Do something"): LoopEvent {
  return {
    type: "loop.plan.ready",
    loopId,
    planContent,
    timestamp: isoNow(),
  };
}

export function createLoopTodoUpdatedEvent(loopId: string, todos: TodoItem[] = []): LoopEvent {
  return {
    type: "loop.todo.updated",
    loopId,
    todos,
    timestamp: isoNow(),
  };
}

export function createLoopErrorEvent(loopId: string, error = "Something went wrong", iteration = 1): LoopEvent {
  return {
    type: "loop.error",
    loopId,
    error,
    iteration,
    timestamp: isoNow(),
  };
}

export function createLoopAcceptedEvent(loopId: string, mergeCommit = "abc123"): LoopEvent {
  return {
    type: "loop.accepted",
    loopId,
    mergeCommit,
    timestamp: isoNow(),
  };
}

export function createLoopPushedEvent(loopId: string, remoteBranch = "origin/ralph/test-loop"): LoopEvent {
  return {
    type: "loop.pushed",
    loopId,
    remoteBranch,
    timestamp: isoNow(),
  };
}

export function createLoopPendingUpdatedEvent(loopId: string, overrides?: { pendingPrompt?: string; pendingModel?: ModelConfig }): LoopEvent {
  return {
    type: "loop.pending.updated",
    loopId,
    ...overrides,
    timestamp: isoNow(),
  };
}

/**
 * Reset the counter (useful between test files if needed).
 */
export function resetFactoryCounter(): void {
  counter = 0;
}
