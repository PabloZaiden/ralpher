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
  MessageData,
  ToolCallData,
  TodoItem,
} from "../types";
import type { LogEntry } from "../components/LogViewer";
import { useLoopEvents } from "./useWebSocket";
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
  acceptPlanApi,
  discardPlanApi,
  addressReviewCommentsApi,
  updateBranchApi,
  type AcceptLoopResult,
  type PushLoopResult,
  type AddressCommentsResult,
  type SetPendingResult,
} from "./loopActions";
import { createLogger } from "../lib/logger";

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
  /** Send feedback to refine the plan (only works when loop is in planning status) */
  sendPlanFeedback: (feedback: string) => Promise<boolean>;
  /** Accept the plan and start the loop execution (only works when loop is in planning status) */
  acceptPlan: () => Promise<boolean>;
  /** Discard the plan and delete the loop (only works when loop is in planning status) */
  discardPlan: () => Promise<boolean>;
  /** Address reviewer comments (only works for pushed/merged loops with reviewMode.addressable = true) */
  addressReviewComments: (comments: string) => Promise<AddressCommentsResult>;
  /** Set pending message and/or model for next iteration (only works when loop is active) */
  setPending: (options: { message?: string; model?: { providerID: string; modelID: string } }) => Promise<SetPendingResult>;
  /** Clear all pending values (message and model) */
  clearPending: () => Promise<boolean>;
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

  // WebSocket connection for real-time updates
  const { events, status: connectionStatus } = useLoopEvents<LoopEvent>(loopId, {
    onEvent: handleEvent,
  });

  // Handle events
  function handleEvent(event: LoopEvent) {
    log.trace("Received event", { loopId, type: event.type });
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
    log.debug("Refreshing loop data", { loopId });
    
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
      setError(null);
      const response = await fetch(`/api/loops/${loopId}`, { signal: controller.signal });
      
      // Check if request was aborted during fetch
      if (controller.signal.aborted) return;
      
      if (!response.ok) {
        if (response.status === 404) {
          log.debug("Loop not found", { loopId });
          setLoop(null);
          setError("Loop not found");
          return;
        }
        throw new Error(`Failed to fetch loop: ${response.statusText}`);
      }
      const data = (await response.json()) as Loop;
      setLoop(data);
      log.trace("Loop data refreshed", { loopId, status: data.state.status });
      
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
      log.error("Failed to refresh loop", { loopId, error: String(err) });
      setError(String(err));
    } finally {
      if (isInitialLoad) {
        setLoading(false);
      }
    }
  }, [loopId]);

  // Update the loop
  const update = useCallback(
    async (request: UpdateLoopRequest): Promise<boolean> => {
      log.debug("Updating loop", { loopId, hasNameUpdate: request.name !== undefined });
      try {
        const response = await fetch(`/api/loops/${loopId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(request),
        });
        if (!response.ok) {
          const errorData = await response.json();
          throw new Error(errorData.message || "Failed to update loop");
        }
        const data = (await response.json()) as Loop;
        setLoop(data);
        log.trace("Loop updated successfully", { loopId });
        return true;
      } catch (err) {
        log.error("Failed to update loop", { loopId, error: String(err) });
        setError(String(err));
        return false;
      }
    },
    [loopId]
  );

  // Delete the loop
  const remove = useCallback(async (): Promise<boolean> => {
    log.debug("Deleting loop", { loopId });
    try {
      await deleteLoopApi(loopId);
      setLoop(null);
      log.info("Loop deleted", { loopId });
      return true;
    } catch (err) {
      log.error("Failed to delete loop", { loopId, error: String(err) });
      setError(String(err));
      return false;
    }
  }, [loopId]);

  // Accept the loop's changes
  const accept = useCallback(async (): Promise<AcceptLoopResult> => {
    log.debug("Accepting loop", { loopId });
    try {
      const result = await acceptLoopApi(loopId);
      await refresh();
      log.info("Loop accepted", { loopId, mergeCommit: result.mergeCommit });
      return result;
    } catch (err) {
      log.error("Failed to accept loop", { loopId, error: String(err) });
      setError(String(err));
      return { success: false };
    }
  }, [loopId, refresh]);

  // Push the loop's branch to remote
  const push = useCallback(async (): Promise<PushLoopResult> => {
    log.debug("Pushing loop", { loopId });
    try {
      const result = await pushLoopApi(loopId);
      await refresh();
      log.info("Loop pushed", { loopId, remoteBranch: result.remoteBranch });
      return result;
    } catch (err) {
      log.error("Failed to push loop", { loopId, error: String(err) });
      setError(String(err));
      return { success: false };
    }
  }, [loopId, refresh]);

  // Update a pushed loop's branch by syncing with the base branch and re-pushing
  const updateBranch = useCallback(async (): Promise<PushLoopResult> => {
    log.debug("Updating branch", { loopId });
    try {
      const result = await updateBranchApi(loopId);
      await refresh();
      log.info("Branch updated", { loopId, remoteBranch: result.remoteBranch, syncStatus: result.syncStatus });
      return result;
    } catch (err) {
      log.error("Failed to update branch", { loopId, error: String(err) });
      setError(String(err));
      return { success: false };
    }
  }, [loopId, refresh]);

  // Discard the loop's changes
  const discard = useCallback(async (): Promise<boolean> => {
    log.debug("Discarding loop", { loopId });
    try {
      await discardLoopApi(loopId);
      await refresh();
      log.info("Loop discarded", { loopId });
      return true;
    } catch (err) {
      log.error("Failed to discard loop", { loopId, error: String(err) });
      setError(String(err));
      return false;
    }
  }, [loopId, refresh]);

  // Purge the loop (permanently delete)
  const purge = useCallback(async (): Promise<boolean> => {
    log.debug("Purging loop", { loopId });
    try {
      await purgeLoopApi(loopId);
      setLoop(null);
      log.info("Loop purged", { loopId });
      return true;
    } catch (err) {
      log.error("Failed to purge loop", { loopId, error: String(err) });
      setError(String(err));
      return false;
    }
  }, [loopId]);

  // Mark a loop as merged and sync with remote
  const markMerged = useCallback(async (): Promise<boolean> => {
    log.debug("Marking loop as merged", { loopId });
    try {
      await markMergedApi(loopId);
      setLoop(null);
      log.info("Loop marked as merged", { loopId });
      return true;
    } catch (err) {
      log.error("Failed to mark loop as merged", { loopId, error: String(err) });
      setError(String(err));
      return false;
    }
  }, [loopId]);

  // Set a pending prompt for the next iteration
  const setPendingPrompt = useCallback(
    async (prompt: string): Promise<boolean> => {
      log.debug("Setting pending prompt", { loopId, promptLength: prompt.length });
      try {
        await setPendingPromptApi(loopId, prompt);
        await refresh();
        log.trace("Pending prompt set", { loopId });
        return true;
      } catch (err) {
        log.error("Failed to set pending prompt", { loopId, error: String(err) });
        setError(String(err));
        return false;
      }
    },
    [loopId, refresh]
  );

  // Clear the pending prompt
  const clearPendingPrompt = useCallback(async (): Promise<boolean> => {
    log.debug("Clearing pending prompt", { loopId });
    try {
      await clearPendingPromptApi(loopId);
      await refresh();
      log.trace("Pending prompt cleared", { loopId });
      return true;
    } catch (err) {
      log.error("Failed to clear pending prompt", { loopId, error: String(err) });
      setError(String(err));
      return false;
    }
  }, [loopId, refresh]);

  // Get the git diff
  const getDiff = useCallback(async (): Promise<FileDiff[]> => {
    log.trace("Getting diff", { loopId });
    try {
      const response = await fetch(`/api/loops/${loopId}/diff`);
      if (!response.ok) {
        // 400 "no_git_branch" is expected when loop is in planning mode or hasn't started yet
        if (response.status === 400) {
          return []; // Return empty diff instead of showing error
        }
        throw new Error(`Failed to get diff: ${response.statusText}`);
      }
      const diff = (await response.json()) as FileDiff[];
      log.trace("Diff retrieved", { loopId, fileCount: diff.length });
      return diff;
    } catch (err) {
      log.error("Failed to get diff", { loopId, error: String(err) });
      setError(String(err));
      return [];
    }
  }, [loopId]);

  // Get the plan.md content
  const getPlan = useCallback(async (): Promise<FileContentResponse> => {
    log.trace("Getting plan", { loopId });
    try {
      const response = await fetch(`/api/loops/${loopId}/plan`);
      if (!response.ok) {
        throw new Error(`Failed to get plan: ${response.statusText}`);
      }
      return (await response.json()) as FileContentResponse;
    } catch (err) {
      log.error("Failed to get plan", { loopId, error: String(err) });
      setError(String(err));
      return { content: "", exists: false };
    }
  }, [loopId]);

  // Get the status.md content
  const getStatusFile = useCallback(async (): Promise<FileContentResponse> => {
    log.trace("Getting status file", { loopId });
    try {
      const response = await fetch(`/api/loops/${loopId}/status-file`);
      if (!response.ok) {
        throw new Error(`Failed to get status file: ${response.statusText}`);
      }
      return (await response.json()) as FileContentResponse;
    } catch (err) {
      log.error("Failed to get status file", { loopId, error: String(err) });
      setError(String(err));
      return { content: "", exists: false };
    }
  }, [loopId]);

  // Send feedback to refine the plan
  const sendPlanFeedback = useCallback(
    async (feedback: string): Promise<boolean> => {
      log.debug("Sending plan feedback", { loopId, feedbackLength: feedback.length });
      try {
        await sendPlanFeedbackApi(loopId, feedback);
        await refresh();
        log.trace("Plan feedback sent", { loopId });
        return true;
      } catch (err) {
        log.error("Failed to send plan feedback", { loopId, error: String(err) });
        setError(String(err));
        return false;
      }
    },
    [loopId, refresh]
  );

  // Accept the plan and start the loop execution
  const acceptPlan = useCallback(async (): Promise<boolean> => {
    log.debug("Accepting plan", { loopId });
    try {
      await acceptPlanApi(loopId);
      await refresh();
      log.info("Plan accepted", { loopId });
      return true;
    } catch (err) {
      log.error("Failed to accept plan", { loopId, error: String(err) });
      setError(String(err));
      return false;
    }
  }, [loopId, refresh]);

  // Discard the plan and delete the loop
  const discardPlan = useCallback(async (): Promise<boolean> => {
    log.debug("Discarding plan", { loopId });
    try {
      await discardPlanApi(loopId);
      setLoop(null);
      log.info("Plan discarded", { loopId });
      return true;
    } catch (err) {
      log.error("Failed to discard plan", { loopId, error: String(err) });
      setError(String(err));
      return false;
    }
  }, [loopId]);

  // Address reviewer comments
  const addressReviewComments = useCallback(
    async (comments: string): Promise<AddressCommentsResult> => {
      log.debug("Addressing review comments", { loopId, commentsLength: comments.length });
      try {
        const result = await addressReviewCommentsApi(loopId, comments);
        await refresh();
        log.info("Review comments addressed", { loopId, reviewCycle: result.reviewCycle });
        return result;
      } catch (err) {
        log.error("Failed to address review comments", { loopId, error: String(err) });
        setError(String(err));
        return { success: false };
      }
    },
    [loopId, refresh]
  );

  // Set pending message and/or model
  const setPending = useCallback(
    async (options: { message?: string; model?: { providerID: string; modelID: string } }): Promise<SetPendingResult> => {
      log.debug("Setting pending", { loopId, hasMessage: options.message !== undefined, hasModel: options.model !== undefined });
      try {
        const result = await setPendingApi(loopId, options);
        await refresh();
        log.trace("Pending values set", { loopId });
        return result;
      } catch (err) {
        log.error("Failed to set pending", { loopId, error: String(err) });
        setError(String(err));
        return { success: false };
      }
    },
    [loopId, refresh]
  );

  // Clear all pending values
  const clearPending = useCallback(async (): Promise<boolean> => {
    log.debug("Clearing pending values", { loopId });
    try {
      await clearPendingApi(loopId);
      await refresh();
      log.trace("Pending values cleared", { loopId });
      return true;
    } catch (err) {
      log.error("Failed to clear pending", { loopId, error: String(err) });
      setError(String(err));
      return false;
    }
  }, [loopId, refresh]);

  // Initial fetch
  useEffect(() => {
    refresh();
  }, [refresh]);

  // Reset state when loopId changes (switching between loops)
  // This prevents stale data from appearing briefly when switching loops
  useEffect(() => {
    setLoop(null);
    setMessages([]);
    setToolCalls([]);
    setProgressContent("");
    setLogs([]);
    setTodos([]);
    setGitChangeCounter(0);
    // Reset initial load tracking so the new loop hydrates from API
    initialLoadDoneRef.current = false;
  }, [loopId]);

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
    sendPlanFeedback,
    acceptPlan,
    discardPlan,
    addressReviewComments,
    setPending,
    clearPending,
  };
}
