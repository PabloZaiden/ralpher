/**
 * Single loop hook.
 * Provides detailed state and real-time updates for a specific loop.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import type {
  Loop,
  LoopEvent,
  UpdateLoopRequest,
  FileDiff,
  FileContentResponse,
  PullRequestDestinationResponse,
  MessageData,
  ToolCallData,
  TodoItem,
  SshSession,
} from "../types";
import type { LogEntry } from "../../components/LogViewer";
import { useLoopEvents } from "../useWebSocket";
import {
  acceptLoopApi,
  pushLoopApi,
  discardLoopApi,
  deleteLoopApi,
  purgeLoopApi,
  markMergedApi,
  setPendingPromptApi,
  clearPendingPromptApi,
  setPendingApi,
  clearPendingApi,
  sendPlanFeedbackApi,
  answerPlanQuestionApi,
  acceptPlanApi,
  discardPlanApi,
  addressReviewCommentsApi,
  updateBranchApi,
  sendFollowUpApi,
  sendChatMessageApi,
  getOrCreateLoopSshSessionApi,
    type AcceptLoopResult,
    type AcceptPlanResult,
    type PushLoopResult,
    type AddressCommentsResult,
    type SetPendingResult,
} from "../loopActions";
import { createLogger } from "../../lib/logger";
import { appFetch } from "../../lib/public-path";

const log = createLogger("useLoop");

/** Maximum number of log entries to keep in frontend state */
const MAX_FRONTEND_LOGS = 2000;
/** Maximum number of messages to keep in frontend state */
const MAX_FRONTEND_MESSAGES = 1000;
/** Maximum number of tool calls to keep in frontend state */
const MAX_FRONTEND_TOOL_CALLS = 2000;

export interface UseLoopResult {
  /** The loop data */
  loop: Loop | null;
  /** Whether the loop is loading */
  loading: boolean;
  /** Error message if any */
  error: string | null;
  /** WebSocket connection status */
  connectionStatus: "connecting" | "open" | "closed" | "error";
  /** Recent events for this loop */
  events: LoopEvent[];
  /** Messages from the current/recent iterations */
  messages: MessageData[];
  /** Tool calls from the current/recent iterations */
  toolCalls: ToolCallData[];
  /** Streaming progress content (accumulated text deltas) */
  progressContent: string;
  /** Application logs from the loop engine */
  logs: LogEntry[];
  /** TODOs from the agent session */
  todos: TodoItem[];
  /** Counter that increments when git changes occur (use to trigger diff refresh) */
  gitChangeCounter: number;
  /** Whether this loop is in chat mode */
  isChatMode: boolean;
  /** Refresh loop data */
  refresh: () => Promise<void>;
  /** Update the loop */
  update: (request: UpdateLoopRequest) => Promise<boolean>;
  /** Delete the loop */
  remove: () => Promise<boolean>;
  /** Accept (merge) the loop's changes */
  accept: () => Promise<AcceptLoopResult>;
  /** Push the loop's branch to remote */
  push: () => Promise<PushLoopResult>;
  /** Update a pushed loop's branch by syncing with the base branch and re-pushing */
  updateBranch: () => Promise<PushLoopResult>;
  /** Discard the loop's changes */
  discard: () => Promise<boolean>;
  /** Purge the loop (permanently delete - only for merged/pushed/deleted loops) */
  purge: () => Promise<boolean>;
  /** Mark a loop as merged and sync with remote (only for final-state loops) */
  markMerged: () => Promise<boolean>;
  /** Set a pending prompt for the next iteration (only works when loop is running) */
  setPendingPrompt: (prompt: string) => Promise<boolean>;
  /** Clear the pending prompt (only works when loop is running) */
  clearPendingPrompt: () => Promise<boolean>;
  /** Get the git diff */
  getDiff: () => Promise<FileDiff[]>;
  /** Get the plan.md content */
  getPlan: () => Promise<FileContentResponse>;
  /** Get the status.md content */
  getStatusFile: () => Promise<FileContentResponse>;
  /** Get pull request navigation metadata for pushed loops */
  getPullRequestDestination: () => Promise<PullRequestDestinationResponse>;
  /** Send feedback to refine the plan (only works when loop is in planning status) */
  sendPlanFeedback: (feedback: string) => Promise<boolean>;
  /** Answer a pending plan-mode question */
  answerPlanQuestion: (answers: string[][]) => Promise<boolean>;
  /** Accept the plan via the requested mode (only works when loop is in planning status) */
  acceptPlan: (mode?: "start_loop" | "open_ssh") => Promise<AcceptPlanResult>;
  /** Discard the plan and delete the loop (only works when loop is in planning status) */
  discardPlan: () => Promise<boolean>;
  /** Address reviewer comments (only works for pushed/merged loops with reviewMode.addressable = true) */
  addressReviewComments: (comments: string) => Promise<AddressCommentsResult>;
  /** Set pending message and/or model for next iteration (only works when loop is active) */
  setPending: (options: { message?: string; model?: { providerID: string; modelID: string } }) => Promise<SetPendingResult>;
  /** Clear all pending values (message and model) */
  clearPending: () => Promise<boolean>;
  /** Send a message to a chat (only works for chat-mode loops) */
  sendChatMessage: (message: string, model?: { providerID: string; modelID: string }) => Promise<boolean>;
  /** Start a new feedback cycle from a restartable terminal state */
  sendFollowUp: (message: string, model?: { providerID: string; modelID: string }) => Promise<boolean>;
  /** Get or create the loop's linked SSH session */
  connectViaSsh: () => Promise<SshSession | null>;
}

/**
 * Hook for managing a single loop with real-time updates.
 */
export function useLoop(loopId: string): UseLoopResult {
  log.debug("useLoop initialized", { loopId });
  const [loop, setLoop] = useState<Loop | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [messages, setMessages] = useState<MessageData[]>([]);
  const [toolCalls, setToolCalls] = useState<ToolCallData[]>([]);
  const [progressContent, setProgressContent] = useState<string>("");
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [todos, setTodos] = useState<TodoItem[]>([]);
  const [gitChangeCounter, setGitChangeCounter] = useState(0);

  // AbortController for cancelling in-flight fetch requests on unmount
  const abortControllerRef = useRef<AbortController | null>(null);
  // Track whether initial data has been loaded (used to decide whether to hydrate from API response)
  const initialLoadDoneRef = useRef(false);
  const activeLoopIdRef = useRef(loopId);
  const refreshRequestIdRef = useRef(0);
  const hasMountedRef = useRef(false);
  activeLoopIdRef.current = loopId;

  const isActiveLoop = useCallback((expectedLoopId: string): boolean => {
    return activeLoopIdRef.current === expectedLoopId;
  }, []);

  const ignoreStaleLoopAction = useCallback(<T,>(
    actionName: string,
    expectedLoopId: string,
    fallback: T,
  ): T | null => {
    if (isActiveLoop(expectedLoopId)) {
      return null;
    }
    log.debug("Ignoring stale loop action", {
      actionName,
      expectedLoopId,
      activeLoopId: activeLoopIdRef.current,
    });
    return fallback;
  }, [isActiveLoop]);

  const ignoreStaleLoopError = useCallback(<T,>(
    actionName: string,
    expectedLoopId: string,
    fallback: T,
    error: unknown,
  ): T | null => {
    if (isActiveLoop(expectedLoopId)) {
      return null;
    }
    log.debug("Ignoring stale loop action error", {
      actionName,
      expectedLoopId,
      activeLoopId: activeLoopIdRef.current,
      error: String(error),
    });
    return fallback;
  }, [isActiveLoop]);

  // Handle events
  function handleEvent(event: LoopEvent) {
    if (!isActiveLoop(event.loopId)) {
      log.trace("Ignoring event for inactive loop", {
        type: event.type,
        eventLoopId: event.loopId,
        activeLoopId: activeLoopIdRef.current,
      });
      return;
    }

    log.trace("Received event", { loopId: event.loopId, type: event.type });
    switch (event.type) {
      case "loop.log":
        // Update existing log entry or add new one
        setLogs((prev) => {
          const existingIndex = prev.findIndex((log) => log.id === event.id);
          if (existingIndex >= 0) {
            // Update existing entry
            const updated = [...prev];
            updated[existingIndex] = {
              id: event.id,
              level: event.level,
              message: event.message,
              details: event.details,
              timestamp: event.timestamp,
            };
            return updated;
          }
          // Add new entry, evict oldest if over limit
          const newLogs = [
            ...prev,
            {
              id: event.id,
              level: event.level,
              message: event.message,
              details: event.details,
              timestamp: event.timestamp,
            },
          ];
          if (newLogs.length > MAX_FRONTEND_LOGS) {
            return newLogs.slice(-MAX_FRONTEND_LOGS);
          }
          return newLogs;
        });
        break;

      case "loop.progress":
        // Accumulate streaming text deltas
        setProgressContent((prev) => prev + event.content);
        break;

      case "loop.message":
        // Clear progress content when message is complete
        setProgressContent("");
        setMessages((prev) => {
          const newMessages = [...prev, event.message];
          if (newMessages.length > MAX_FRONTEND_MESSAGES) {
            return newMessages.slice(-MAX_FRONTEND_MESSAGES);
          }
          return newMessages;
        });
        break;

      case "loop.tool_call":
        setToolCalls((prev) => {
          // Update existing or add new
          const index = prev.findIndex((tc) => tc.id === event.tool.id);
          if (index >= 0) {
            const newToolCalls = [...prev];
            newToolCalls[index] = event.tool;
            return newToolCalls;
          }
          const newToolCalls = [...prev, event.tool];
          if (newToolCalls.length > MAX_FRONTEND_TOOL_CALLS) {
            return newToolCalls.slice(-MAX_FRONTEND_TOOL_CALLS);
          }
          return newToolCalls;
        });
        break;

      case "loop.iteration.start":
        // Clear progress content for new iteration
        // Keep messages, tool calls, and logs as they accumulate across iterations
        setProgressContent("");
        refresh();
        break;

      case "loop.started":
      case "loop.stopped":
      case "loop.completed":
      case "loop.ssh_handoff":
      case "loop.merged":
      case "loop.accepted":
      case "loop.pushed":
      case "loop.discarded":
      case "loop.error":
      case "loop.plan.ready":
      case "loop.plan.feedback":
      case "loop.plan.accepted":
      case "loop.plan.discarded":
        refresh();
        break;

      case "loop.iteration.end":
      case "loop.git.commit":
        // These events indicate git changes that affect the diff
        setGitChangeCounter((prev) => prev + 1);
        refresh();
        break;

      case "loop.todo.updated":
        // Update TODO list with the latest todos from the agent
        setTodos(event.todos);
        break;

      case "loop.pending.updated":
        // Pending values changed - refresh to get updated state
        refresh();
        break;
    }
  }

  // Fetch loop data
  const refresh = useCallback(async () => {
    const requestLoopId = loopId;
    const requestId = refreshRequestIdRef.current + 1;
    refreshRequestIdRef.current = requestId;
    log.debug("Refreshing loop data", { loopId: requestLoopId });
    
    // Cancel any in-flight request
    abortControllerRef.current?.abort();
    const controller = new AbortController();
    abortControllerRef.current = controller;
    
    // Only show loading spinner on initial load to prevent flicker on event-driven refreshes
    const isInitialLoad = !initialLoadDoneRef.current;
    
    try {
      if (isInitialLoad) {
        setLoading(true);
      }
      if (isActiveLoop(requestLoopId)) {
        setError(null);
      }
      const response = await appFetch(`/api/loops/${requestLoopId}`, { signal: controller.signal });
      
      // Check if request was aborted during fetch
      if (controller.signal.aborted || !isActiveLoop(requestLoopId) || refreshRequestIdRef.current !== requestId) {
        return;
      }
      
      if (!response.ok) {
        if (response.status === 404) {
          log.debug("Loop not found", { loopId: requestLoopId });
          setLoop(null);
          setError("Loop not found");
          return;
        }
        throw new Error(`Failed to fetch loop: ${response.statusText}`);
      }
      const data = (await response.json()) as Loop;
      if (controller.signal.aborted || !isActiveLoop(requestLoopId) || refreshRequestIdRef.current !== requestId) {
        return;
      }
      setLoop(data);
      log.debug("Loop data refreshed", { loopId: requestLoopId, status: data.state.status });
      
      // Hydrate persisted data only on the first successful load.
      // Using a ref avoids adding state array lengths to the dependency array,
      // which would cause a refresh cascade: event adds item → length changes →
      // refresh recreated → useEffect fires → full API refetch.
      if (!initialLoadDoneRef.current) {
        initialLoadDoneRef.current = true;

        // Load persisted logs from loop state (latest 1000 to keep UI responsive)
        if (data.state.logs && data.state.logs.length > 0) {
          const latestLogs = data.state.logs.slice(-1000);
          setLogs(latestLogs.map((logEntry) => ({
            id: logEntry.id,
            level: logEntry.level,
            message: logEntry.message,
            details: logEntry.details,
            timestamp: logEntry.timestamp,
          })));
        }

        // Load persisted messages from loop state (latest 1000)
        if (data.state.messages && data.state.messages.length > 0) {
          const latestMessages = data.state.messages.slice(-1000);
          setMessages(latestMessages.map((msg) => ({
            id: msg.id,
            role: msg.role,
            content: msg.content,
            timestamp: msg.timestamp,
          })));
        }

        // Load persisted tool calls from loop state (latest 1000)
        if (data.state.toolCalls && data.state.toolCalls.length > 0) {
          const latestToolCalls = data.state.toolCalls.slice(-1000);
          setToolCalls(latestToolCalls.map((tc) => ({
            id: tc.id,
            name: tc.name,
            input: tc.input,
            output: tc.output,
            status: tc.status,
            timestamp: tc.timestamp,
          })));
        }

        // Load persisted TODOs from loop state
        if (data.state.todos && data.state.todos.length > 0) {
          setTodos(data.state.todos);
        }
      }
    } catch (err) {
      // Ignore abort errors — they are expected during cleanup
      if (err instanceof DOMException && err.name === "AbortError") return;
      if (!isActiveLoop(requestLoopId) || refreshRequestIdRef.current !== requestId) {
        return;
      }
      log.error("Failed to refresh loop", { loopId: requestLoopId, error: String(err) });
      setError(String(err));
    } finally {
      if (abortControllerRef.current === controller) {
        abortControllerRef.current = null;
      }
      if (isInitialLoad && isActiveLoop(requestLoopId) && refreshRequestIdRef.current === requestId) {
        setLoading(false);
      }
    }
  }, [isActiveLoop, loopId]);

  // WebSocket connection for real-time updates
  const { events, status: connectionStatus, clearEvents } = useLoopEvents<LoopEvent>(loopId, {
    onEvent: handleEvent,
  });

  // Update the loop
  const update = useCallback(
    async (request: UpdateLoopRequest): Promise<boolean> => {
      const actionLoopId = loopId;
      const staleAction = ignoreStaleLoopAction("update", actionLoopId, false);
      if (staleAction !== null) {
        return staleAction;
      }
      log.debug("Updating loop", { loopId: actionLoopId, hasNameUpdate: request.name !== undefined });
      try {
        const response = await appFetch(`/api/loops/${actionLoopId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(request),
        });
        if (!response.ok) {
          const errorData = await response.json();
          throw new Error(errorData.message || "Failed to update loop");
        }
        const data = (await response.json()) as Loop;
        if (!isActiveLoop(actionLoopId)) {
          return false;
        }
        setLoop(data);
        log.debug("Loop updated successfully", { loopId: actionLoopId });
        return true;
      } catch (err) {
        const staleError = ignoreStaleLoopError("update", actionLoopId, false, err);
        if (staleError !== null) {
          return staleError;
        }
        log.error("Failed to update loop", { loopId: actionLoopId, error: String(err) });
        setError(String(err));
        return false;
      }
    },
    [ignoreStaleLoopAction, ignoreStaleLoopError, isActiveLoop, loopId]
  );

  // Delete the loop
  const remove = useCallback(async (): Promise<boolean> => {
    const actionLoopId = loopId;
    const staleAction = ignoreStaleLoopAction("remove", actionLoopId, false);
    if (staleAction !== null) {
      return staleAction;
    }
    log.debug("Deleting loop", { loopId: actionLoopId });
    try {
      await deleteLoopApi(actionLoopId);
      if (!isActiveLoop(actionLoopId)) {
        return false;
      }
      setLoop(null);
      log.info("Loop deleted", { loopId: actionLoopId });
      return true;
    } catch (err) {
      const staleError = ignoreStaleLoopError("remove", actionLoopId, false, err);
      if (staleError !== null) {
        return staleError;
      }
      log.error("Failed to delete loop", { loopId: actionLoopId, error: String(err) });
      setError(String(err));
      return false;
    }
  }, [ignoreStaleLoopAction, ignoreStaleLoopError, isActiveLoop, loopId, refresh]);

  // Accept the loop's changes
  const accept = useCallback(async (): Promise<AcceptLoopResult> => {
    const actionLoopId = loopId;
    const staleAction = ignoreStaleLoopAction("accept", actionLoopId, { success: false });
    if (staleAction !== null) {
      return staleAction;
    }
    log.debug("Accepting loop", { loopId: actionLoopId });
    try {
      const result = await acceptLoopApi(actionLoopId);
      await refresh();
      if (!isActiveLoop(actionLoopId)) {
        return { success: false };
      }
      log.info("Loop accepted", { loopId: actionLoopId, mergeCommit: result.mergeCommit });
      return result;
    } catch (err) {
      const staleError = ignoreStaleLoopError("accept", actionLoopId, { success: false }, err);
      if (staleError !== null) {
        return staleError;
      }
      log.error("Failed to accept loop", { loopId: actionLoopId, error: String(err) });
      setError(String(err));
      return { success: false };
    }
  }, [ignoreStaleLoopAction, ignoreStaleLoopError, isActiveLoop, loopId, refresh]);

  // Push the loop's branch to remote
  const push = useCallback(async (): Promise<PushLoopResult> => {
    const actionLoopId = loopId;
    const staleAction = ignoreStaleLoopAction("push", actionLoopId, { success: false });
    if (staleAction !== null) {
      return staleAction;
    }
    log.debug("Pushing loop", { loopId: actionLoopId });
    try {
      const result = await pushLoopApi(actionLoopId);
      await refresh();
      if (!isActiveLoop(actionLoopId)) {
        return { success: false };
      }
      log.info("Loop pushed", { loopId: actionLoopId, remoteBranch: result.remoteBranch });
      return result;
    } catch (err) {
      const staleError = ignoreStaleLoopError("push", actionLoopId, { success: false }, err);
      if (staleError !== null) {
        return staleError;
      }
      log.error("Failed to push loop", { loopId: actionLoopId, error: String(err) });
      setError(String(err));
      return { success: false };
    }
  }, [ignoreStaleLoopAction, ignoreStaleLoopError, isActiveLoop, loopId, refresh]);

  // Update a pushed loop's branch by syncing with the base branch and re-pushing
  const updateBranch = useCallback(async (): Promise<PushLoopResult> => {
    const actionLoopId = loopId;
    const staleAction = ignoreStaleLoopAction("updateBranch", actionLoopId, { success: false });
    if (staleAction !== null) {
      return staleAction;
    }
    log.debug("Updating branch", { loopId: actionLoopId });
    try {
      const result = await updateBranchApi(actionLoopId);
      await refresh();
      if (!isActiveLoop(actionLoopId)) {
        return { success: false };
      }
      log.info("Branch updated", {
        loopId: actionLoopId,
        remoteBranch: result.remoteBranch,
        syncStatus: result.syncStatus,
      });
      return result;
    } catch (err) {
      const staleError = ignoreStaleLoopError("updateBranch", actionLoopId, { success: false }, err);
      if (staleError !== null) {
        return staleError;
      }
      log.error("Failed to update branch", { loopId: actionLoopId, error: String(err) });
      setError(String(err));
      return { success: false };
    }
  }, [ignoreStaleLoopAction, ignoreStaleLoopError, isActiveLoop, loopId, refresh]);

  // Discard the loop's changes
  const discard = useCallback(async (): Promise<boolean> => {
    const actionLoopId = loopId;
    const staleAction = ignoreStaleLoopAction("discard", actionLoopId, false);
    if (staleAction !== null) {
      return staleAction;
    }
    log.debug("Discarding loop", { loopId: actionLoopId });
    try {
      await discardLoopApi(actionLoopId);
      await refresh();
      if (!isActiveLoop(actionLoopId)) {
        return false;
      }
      log.info("Loop discarded", { loopId: actionLoopId });
      return true;
    } catch (err) {
      const staleError = ignoreStaleLoopError("discard", actionLoopId, false, err);
      if (staleError !== null) {
        return staleError;
      }
      log.error("Failed to discard loop", { loopId: actionLoopId, error: String(err) });
      setError(String(err));
      return false;
    }
  }, [ignoreStaleLoopAction, ignoreStaleLoopError, isActiveLoop, loopId, refresh]);

  // Purge the loop (permanently delete)
  const purge = useCallback(async (): Promise<boolean> => {
    const actionLoopId = loopId;
    const staleAction = ignoreStaleLoopAction("purge", actionLoopId, false);
    if (staleAction !== null) {
      return staleAction;
    }
    log.debug("Purging loop", { loopId: actionLoopId });
    try {
      await purgeLoopApi(actionLoopId);
      if (!isActiveLoop(actionLoopId)) {
        return false;
      }
      setLoop(null);
      log.info("Loop purged", { loopId: actionLoopId });
      return true;
    } catch (err) {
      const staleError = ignoreStaleLoopError("purge", actionLoopId, false, err);
      if (staleError !== null) {
        return staleError;
      }
      log.error("Failed to purge loop", { loopId: actionLoopId, error: String(err) });
      setError(String(err));
      return false;
    }
  }, [ignoreStaleLoopAction, ignoreStaleLoopError, isActiveLoop, loopId, refresh]);

  // Mark a loop as merged and sync with remote
  const markMerged = useCallback(async (): Promise<boolean> => {
    const actionLoopId = loopId;
    const staleAction = ignoreStaleLoopAction("markMerged", actionLoopId, false);
    if (staleAction !== null) {
      return staleAction;
    }
    log.debug("Marking loop as merged", { loopId: actionLoopId });
    try {
      await markMergedApi(actionLoopId);
      await refresh();
      if (!isActiveLoop(actionLoopId)) {
        return false;
      }
      log.info("Loop marked as merged", { loopId: actionLoopId });
      return true;
    } catch (err) {
      const staleError = ignoreStaleLoopError("markMerged", actionLoopId, false, err);
      if (staleError !== null) {
        return staleError;
      }
      log.error("Failed to mark loop as merged", { loopId: actionLoopId, error: String(err) });
      setError(String(err));
      return false;
    }
  }, [ignoreStaleLoopAction, ignoreStaleLoopError, isActiveLoop, loopId]);

  // Set a pending prompt for the next iteration
  const setPendingPrompt = useCallback(
    async (prompt: string): Promise<boolean> => {
      const actionLoopId = loopId;
      const staleAction = ignoreStaleLoopAction("setPendingPrompt", actionLoopId, false);
      if (staleAction !== null) {
        return staleAction;
      }
      log.debug("Setting pending prompt", { loopId: actionLoopId, promptLength: prompt.length });
      try {
        await setPendingPromptApi(actionLoopId, prompt);
        await refresh();
        if (!isActiveLoop(actionLoopId)) {
          return false;
        }
        log.debug("Pending prompt set", { loopId: actionLoopId });
        return true;
      } catch (err) {
        const staleError = ignoreStaleLoopError("setPendingPrompt", actionLoopId, false, err);
        if (staleError !== null) {
          return staleError;
        }
        log.error("Failed to set pending prompt", { loopId: actionLoopId, error: String(err) });
        setError(String(err));
        return false;
      }
    },
    [ignoreStaleLoopAction, ignoreStaleLoopError, isActiveLoop, loopId, refresh]
  );

  // Clear the pending prompt
  const clearPendingPrompt = useCallback(async (): Promise<boolean> => {
    const actionLoopId = loopId;
    const staleAction = ignoreStaleLoopAction("clearPendingPrompt", actionLoopId, false);
    if (staleAction !== null) {
      return staleAction;
    }
    log.debug("Clearing pending prompt", { loopId: actionLoopId });
    try {
      await clearPendingPromptApi(actionLoopId);
      await refresh();
      if (!isActiveLoop(actionLoopId)) {
        return false;
      }
      log.debug("Pending prompt cleared", { loopId: actionLoopId });
      return true;
    } catch (err) {
      const staleError = ignoreStaleLoopError("clearPendingPrompt", actionLoopId, false, err);
      if (staleError !== null) {
        return staleError;
      }
      log.error("Failed to clear pending prompt", { loopId: actionLoopId, error: String(err) });
      setError(String(err));
      return false;
    }
  }, [ignoreStaleLoopAction, ignoreStaleLoopError, isActiveLoop, loopId, refresh]);

  // Get the git diff
  const getDiff = useCallback(async (): Promise<FileDiff[]> => {
    const actionLoopId = loopId;
    const staleAction = ignoreStaleLoopAction("getDiff", actionLoopId, [] as FileDiff[]);
    if (staleAction !== null) {
      return staleAction;
    }
    log.debug("Getting diff", { loopId: actionLoopId });
    try {
      const response = await appFetch(`/api/loops/${actionLoopId}/diff`);
      if (!response.ok) {
        // 400 "no_git_branch" is expected when loop is in planning mode or hasn't started yet
        if (response.status === 400) {
          return []; // Return empty diff instead of showing error
        }
        throw new Error(`Failed to get diff: ${response.statusText}`);
      }
      const diff = (await response.json()) as FileDiff[];
      if (!isActiveLoop(actionLoopId)) {
        return [];
      }
      log.debug("Diff retrieved", { loopId: actionLoopId, fileCount: diff.length });
      return diff;
    } catch (err) {
      const staleError = ignoreStaleLoopError("getDiff", actionLoopId, [] as FileDiff[], err);
      if (staleError !== null) {
        return staleError;
      }
      log.error("Failed to get diff", { loopId: actionLoopId, error: String(err) });
      setError(String(err));
      return [];
    }
  }, [ignoreStaleLoopAction, ignoreStaleLoopError, isActiveLoop, loopId]);

  // Get the plan.md content
  const getPlan = useCallback(async (): Promise<FileContentResponse> => {
    const actionLoopId = loopId;
    const staleAction = ignoreStaleLoopAction("getPlan", actionLoopId, {
      content: "",
      exists: false,
    });
    if (staleAction !== null) {
      return staleAction;
    }
    log.debug("Getting plan", { loopId: actionLoopId });
    try {
      const response = await appFetch(`/api/loops/${actionLoopId}/plan`);
      if (!response.ok) {
        throw new Error(`Failed to get plan: ${response.statusText}`);
      }
      const result = (await response.json()) as FileContentResponse;
      if (!isActiveLoop(actionLoopId)) {
        return { content: "", exists: false };
      }
      return result;
    } catch (err) {
      const staleError = ignoreStaleLoopError("getPlan", actionLoopId, {
        content: "",
        exists: false,
      }, err);
      if (staleError !== null) {
        return staleError;
      }
      log.error("Failed to get plan", { loopId: actionLoopId, error: String(err) });
      setError(String(err));
      return { content: "", exists: false };
    }
  }, [ignoreStaleLoopAction, ignoreStaleLoopError, isActiveLoop, loopId]);

  // Get the status.md content
  const getStatusFile = useCallback(async (): Promise<FileContentResponse> => {
    const actionLoopId = loopId;
    const staleAction = ignoreStaleLoopAction("getStatusFile", actionLoopId, {
      content: "",
      exists: false,
    });
    if (staleAction !== null) {
      return staleAction;
    }
    log.debug("Getting status file", { loopId: actionLoopId });
    try {
      const response = await appFetch(`/api/loops/${actionLoopId}/status-file`);
      if (!response.ok) {
        throw new Error(`Failed to get status file: ${response.statusText}`);
      }
      const result = (await response.json()) as FileContentResponse;
      if (!isActiveLoop(actionLoopId)) {
        return { content: "", exists: false };
      }
      return result;
    } catch (err) {
      const staleError = ignoreStaleLoopError("getStatusFile", actionLoopId, {
        content: "",
        exists: false,
      }, err);
      if (staleError !== null) {
        return staleError;
      }
      log.error("Failed to get status file", { loopId: actionLoopId, error: String(err) });
      setError(String(err));
      return { content: "", exists: false };
    }
  }, [ignoreStaleLoopAction, ignoreStaleLoopError, isActiveLoop, loopId]);

  // Get PR navigation metadata for pushed loops
  const getPullRequestDestination = useCallback(async (): Promise<PullRequestDestinationResponse> => {
    const actionLoopId = loopId;
    const fallback: PullRequestDestinationResponse = {
      enabled: false,
      destinationType: "disabled",
      disabledReason: "Failed to load pull request information.",
    };
    const staleAction = ignoreStaleLoopAction("getPullRequestDestination", actionLoopId, fallback);
    if (staleAction !== null) {
      return staleAction;
    }
    log.debug("Getting pull request destination", { loopId: actionLoopId });
    try {
      const response = await appFetch(`/api/loops/${actionLoopId}/pull-request`);
      if (!response.ok) {
        throw new Error(`Failed to get pull request destination: ${response.statusText}`);
      }
      const result = (await response.json()) as PullRequestDestinationResponse;
      if (!isActiveLoop(actionLoopId)) {
        return fallback;
      }
      return result;
    } catch (err) {
      const staleError = ignoreStaleLoopError("getPullRequestDestination", actionLoopId, fallback, err);
      if (staleError !== null) {
        return staleError;
      }
      log.error("Failed to get pull request destination", { loopId: actionLoopId, error: String(err) });
      return fallback;
    }
  }, [ignoreStaleLoopAction, ignoreStaleLoopError, isActiveLoop, loopId]);

  // Send feedback to refine the plan
  const sendPlanFeedback = useCallback(
    async (feedback: string): Promise<boolean> => {
      const actionLoopId = loopId;
      const staleAction = ignoreStaleLoopAction("sendPlanFeedback", actionLoopId, false);
      if (staleAction !== null) {
        return staleAction;
      }
      log.debug("Sending plan feedback", { loopId: actionLoopId, feedbackLength: feedback.length });
      try {
        await sendPlanFeedbackApi(actionLoopId, feedback);
        await refresh();
        if (!isActiveLoop(actionLoopId)) {
          return false;
        }
        log.debug("Plan feedback sent", { loopId: actionLoopId });
        return true;
      } catch (err) {
        const staleError = ignoreStaleLoopError("sendPlanFeedback", actionLoopId, false, err);
        if (staleError !== null) {
          return staleError;
        }
        log.error("Failed to send plan feedback", { loopId: actionLoopId, error: String(err) });
        setError(String(err));
        return false;
      }
    },
    [ignoreStaleLoopAction, ignoreStaleLoopError, isActiveLoop, loopId, refresh]
  );

  const answerPlanQuestion = useCallback(
    async (answers: string[][]): Promise<boolean> => {
      const actionLoopId = loopId;
      const staleAction = ignoreStaleLoopAction("answerPlanQuestion", actionLoopId, false);
      if (staleAction !== null) {
        return staleAction;
      }
      log.debug("Answering plan question", { loopId: actionLoopId, answerGroups: answers.length });
      try {
        await answerPlanQuestionApi(actionLoopId, answers);
        await refresh();
        if (!isActiveLoop(actionLoopId)) {
          return false;
        }
        log.debug("Plan question answered", { loopId: actionLoopId });
        return true;
      } catch (err) {
        const staleError = ignoreStaleLoopError("answerPlanQuestion", actionLoopId, false, err);
        if (staleError !== null) {
          return staleError;
        }
        log.error("Failed to answer plan question", { loopId: actionLoopId, error: String(err) });
        setError(String(err));
        return false;
      }
    },
    [ignoreStaleLoopAction, ignoreStaleLoopError, isActiveLoop, loopId, refresh],
  );

  // Accept the plan and start the loop execution
  const acceptPlan = useCallback(
    async (mode: "start_loop" | "open_ssh" = "start_loop"): Promise<AcceptPlanResult> => {
      const actionLoopId = loopId;
      const staleAction = ignoreStaleLoopAction<AcceptPlanResult>("acceptPlan", actionLoopId, {
        success: false,
      });
      if (staleAction !== null) {
        return staleAction;
      }
      log.debug("Accepting plan", { loopId: actionLoopId, mode });
      try {
        const result = await acceptPlanApi(actionLoopId, mode);
        await refresh();
        if (!isActiveLoop(actionLoopId)) {
          return { success: false };
        }
        if (result.success) {
          log.info("Plan accepted", { loopId: actionLoopId, mode: result.mode });
        }
        return result;
      } catch (err) {
        const staleError = ignoreStaleLoopError<AcceptPlanResult>("acceptPlan", actionLoopId, {
          success: false,
        }, err);
        if (staleError !== null) {
          return staleError;
        }
        log.error("Failed to accept plan", { loopId: actionLoopId, mode, error: String(err) });
        setError(String(err));
        return { success: false };
      }
    },
    [ignoreStaleLoopAction, ignoreStaleLoopError, isActiveLoop, loopId, refresh],
  );

  // Discard the plan and delete the loop
  const discardPlan = useCallback(async (): Promise<boolean> => {
    const actionLoopId = loopId;
    const staleAction = ignoreStaleLoopAction("discardPlan", actionLoopId, false);
    if (staleAction !== null) {
      return staleAction;
    }
    log.debug("Discarding plan", { loopId: actionLoopId });
    try {
      await discardPlanApi(actionLoopId);
      if (!isActiveLoop(actionLoopId)) {
        return false;
      }
      setLoop(null);
      log.info("Plan discarded", { loopId: actionLoopId });
      return true;
    } catch (err) {
      const staleError = ignoreStaleLoopError("discardPlan", actionLoopId, false, err);
      if (staleError !== null) {
        return staleError;
      }
      log.error("Failed to discard plan", { loopId: actionLoopId, error: String(err) });
      setError(String(err));
      return false;
    }
  }, [ignoreStaleLoopAction, ignoreStaleLoopError, isActiveLoop, loopId]);

  // Address reviewer comments
  const addressReviewComments = useCallback(
    async (comments: string): Promise<AddressCommentsResult> => {
      const actionLoopId = loopId;
      const staleAction = ignoreStaleLoopAction("addressReviewComments", actionLoopId, { success: false });
      if (staleAction !== null) {
        return staleAction;
      }
      log.debug("Addressing review comments", { loopId: actionLoopId, commentsLength: comments.length });
      try {
        const result = await addressReviewCommentsApi(actionLoopId, comments);
        await refresh();
        if (!isActiveLoop(actionLoopId)) {
          return { success: false };
        }
        log.info("Review comments addressed", { loopId: actionLoopId, reviewCycle: result.reviewCycle });
        return result;
      } catch (err) {
        const staleError = ignoreStaleLoopError("addressReviewComments", actionLoopId, { success: false }, err);
        if (staleError !== null) {
          return staleError;
        }
        log.error("Failed to address review comments", { loopId: actionLoopId, error: String(err) });
        setError(String(err));
        return { success: false };
      }
    },
    [ignoreStaleLoopAction, ignoreStaleLoopError, isActiveLoop, loopId, refresh]
  );

  // Set pending message and/or model
  const setPending = useCallback(
    async (options: { message?: string; model?: { providerID: string; modelID: string } }): Promise<SetPendingResult> => {
      const actionLoopId = loopId;
      const staleAction = ignoreStaleLoopAction("setPending", actionLoopId, { success: false });
      if (staleAction !== null) {
        return staleAction;
      }
      log.debug("Setting pending", {
        loopId: actionLoopId,
        hasMessage: options.message !== undefined,
        hasModel: options.model !== undefined,
      });
      try {
        const result = await setPendingApi(actionLoopId, options);
        await refresh();
        if (!isActiveLoop(actionLoopId)) {
          return { success: false };
        }
        log.debug("Pending values set", { loopId: actionLoopId });
        return result;
      } catch (err) {
        const staleError = ignoreStaleLoopError("setPending", actionLoopId, { success: false }, err);
        if (staleError !== null) {
          return staleError;
        }
        log.error("Failed to set pending", { loopId: actionLoopId, error: String(err) });
        setError(String(err));
        return { success: false };
      }
    },
    [ignoreStaleLoopAction, ignoreStaleLoopError, isActiveLoop, loopId, refresh]
  );

  // Clear all pending values
  const clearPending = useCallback(async (): Promise<boolean> => {
    const actionLoopId = loopId;
    const staleAction = ignoreStaleLoopAction("clearPending", actionLoopId, false);
    if (staleAction !== null) {
      return staleAction;
    }
    log.debug("Clearing pending values", { loopId: actionLoopId });
    try {
      await clearPendingApi(actionLoopId);
      await refresh();
      if (!isActiveLoop(actionLoopId)) {
        return false;
      }
      log.debug("Pending values cleared", { loopId: actionLoopId });
      return true;
    } catch (err) {
      const staleError = ignoreStaleLoopError("clearPending", actionLoopId, false, err);
      if (staleError !== null) {
        return staleError;
      }
      log.error("Failed to clear pending", { loopId: actionLoopId, error: String(err) });
      setError(String(err));
      return false;
    }
  }, [ignoreStaleLoopAction, ignoreStaleLoopError, isActiveLoop, loopId, refresh]);

  // Send a message to a chat
  const sendChatMessage = useCallback(
    async (message: string, model?: { providerID: string; modelID: string }): Promise<boolean> => {
      const actionLoopId = loopId;
      const staleAction = ignoreStaleLoopAction("sendChatMessage", actionLoopId, false);
      if (staleAction !== null) {
        return staleAction;
      }
      log.debug("Sending chat message", { loopId: actionLoopId, messageLength: message.length });
      try {
        await sendChatMessageApi(actionLoopId, message, model);
        await refresh();
        if (!isActiveLoop(actionLoopId)) {
          return false;
        }
        log.debug("Chat message sent", { loopId: actionLoopId });
        return true;
      } catch (err) {
        const staleError = ignoreStaleLoopError("sendChatMessage", actionLoopId, false, err);
        if (staleError !== null) {
          return staleError;
        }
        log.error("Failed to send chat message", { loopId: actionLoopId, error: String(err) });
        setError(String(err));
        return false;
      }
    },
    [ignoreStaleLoopAction, ignoreStaleLoopError, isActiveLoop, loopId, refresh]
  );

  const sendFollowUp = useCallback(
    async (message: string, model?: { providerID: string; modelID: string }): Promise<boolean> => {
      const actionLoopId = loopId;
      const staleAction = ignoreStaleLoopAction("sendFollowUp", actionLoopId, false);
      if (staleAction !== null) {
        return staleAction;
      }
      log.debug("Sending terminal follow-up", { loopId: actionLoopId, messageLength: message.length });
      try {
        await sendFollowUpApi(actionLoopId, message, model);
        await refresh();
        if (!isActiveLoop(actionLoopId)) {
          return false;
        }
        log.debug("Terminal follow-up sent", { loopId: actionLoopId });
        return true;
      } catch (err) {
        const staleError = ignoreStaleLoopError("sendFollowUp", actionLoopId, false, err);
        if (staleError !== null) {
          return staleError;
        }
        log.error("Failed to send terminal follow-up", { loopId: actionLoopId, error: String(err) });
        setError(String(err));
        return false;
      }
    },
    [ignoreStaleLoopAction, ignoreStaleLoopError, isActiveLoop, loopId, refresh],
  );

  const connectViaSsh = useCallback(async (): Promise<SshSession | null> => {
    const actionLoopId = loopId;
    if (!isActiveLoop(actionLoopId)) {
      log.debug("Ignoring stale loop action", {
        actionName: "connectViaSsh",
        expectedLoopId: actionLoopId,
        activeLoopId: activeLoopIdRef.current,
      });
      return null;
    }
    log.debug("Connecting loop SSH session", { loopId: actionLoopId });
    try {
      const session = await getOrCreateLoopSshSessionApi(actionLoopId);
      if (!isActiveLoop(actionLoopId)) {
        return null;
      }
      return session;
    } catch (err) {
      if (!isActiveLoop(actionLoopId)) {
        log.debug("Ignoring stale loop action error", {
          actionName: "connectViaSsh",
          expectedLoopId: actionLoopId,
          activeLoopId: activeLoopIdRef.current,
          error: String(err),
        });
        return null;
      }
      log.error("Failed to connect loop SSH session", { loopId: actionLoopId, error: String(err) });
      setError(String(err));
      return null;
    }
  }, [isActiveLoop, loopId]);

  // Whether this loop is in chat mode
  const isChatMode = loop?.config.mode === "chat";

  // Reset state when loopId changes (switching between loops)
  // This prevents stale data from appearing briefly when switching loops
  useEffect(() => {
    if (!hasMountedRef.current) {
      hasMountedRef.current = true;
      return;
    }
    abortControllerRef.current?.abort();
    abortControllerRef.current = null;
    refreshRequestIdRef.current += 1;
    setLoading(true);
    setError(null);
    setLoop(null);
    setMessages([]);
    setToolCalls([]);
    setProgressContent("");
    setLogs([]);
    setTodos([]);
    setGitChangeCounter(0);
    clearEvents();
    // Reset initial load tracking so the new loop hydrates from API
    initialLoadDoneRef.current = false;
  }, [clearEvents, loopId]);

  // Initial fetch
  useEffect(() => {
    refresh();
  }, [refresh]);

  // Cleanup: Release memory and cancel in-flight requests when component unmounts
  // Critical for preventing memory leaks when closing LoopDetails
  // This handles the case where the component unmounts entirely (not just switching loops)
  // React state updates in cleanup are safe — warnings about unmounted components are
  // development-only and don't affect production behavior
  // Empty dependency array means this only runs on unmount, not on every render
  useEffect(() => {
    return () => {
      // Cancel any in-flight fetch request
      abortControllerRef.current?.abort();
      abortControllerRef.current = null;
      
      setLoop(null);
      setMessages([]);
      setToolCalls([]);
      setProgressContent("");
      setLogs([]);
      setTodos([]);
      setGitChangeCounter(0);
      refreshRequestIdRef.current += 1;
      clearEvents();
      // WebSocket cleanup is automatically handled by useLoopEvents hook
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return {
    loop,
    loading,
    error,
    connectionStatus,
    events,
    messages,
    toolCalls,
    progressContent,
    logs,
    todos,
    gitChangeCounter,
    isChatMode,
    refresh,
    update,
    remove,
    accept,
    push,
    updateBranch,
    discard,
    purge,
    markMerged,
    setPendingPrompt,
    clearPendingPrompt,
    getDiff,
    getPlan,
    getStatusFile,
    getPullRequestDestination,
    sendPlanFeedback,
    answerPlanQuestion,
    acceptPlan,
    discardPlan,
    addressReviewComments,
    setPending,
    clearPending,
    sendChatMessage,
    sendFollowUp,
    connectViaSsh,
  };
}
