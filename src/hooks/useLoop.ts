/**
 * Single loop hook.
 * Provides detailed state and real-time updates for a specific loop.
 */

import { useCallback, useEffect, useState } from "react";
import type {
  Loop,
  LoopEvent,
  UpdateLoopRequest,
  FileDiff,
  FileContentResponse,
  MessageData,
  ToolCallData,
  LogLevel,
} from "../types";
import type { TodoItem } from "../backends/types";
import { useLoopEvents } from "./useWebSocket";
import {
  acceptLoopApi,
  pushLoopApi,
  discardLoopApi,
  deleteLoopApi,
  purgeLoopApi,
  setPendingPromptApi,
  clearPendingPromptApi,
  sendPlanFeedbackApi,
  acceptPlanApi,
  discardPlanApi,
  addressReviewCommentsApi,
  type AcceptLoopResult,
  type PushLoopResult,
  type AddressCommentsResult,
} from "./loopActions";

/**
 * Application log entry for display in the UI.
 */
export interface LogEntry {
  /** Unique ID for the log entry */
  id: string;
  /** Log level */
  level: LogLevel;
  /** Log message */
  message: string;
  /** Optional additional details */
  details?: Record<string, unknown>;
  /** ISO timestamp */
  timestamp: string;
}

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
  /** Discard the loop's changes */
  discard: () => Promise<boolean>;
  /** Purge the loop (permanently delete - only for merged/pushed/deleted loops) */
  purge: () => Promise<boolean>;
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
}

/**
 * Hook for managing a single loop with real-time updates.
 */
export function useLoop(loopId: string): UseLoopResult {
  const [loop, setLoop] = useState<Loop | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [messages, setMessages] = useState<MessageData[]>([]);
  const [toolCalls, setToolCalls] = useState<ToolCallData[]>([]);
  const [progressContent, setProgressContent] = useState<string>("");
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [todos, setTodos] = useState<TodoItem[]>([]);
  const [gitChangeCounter, setGitChangeCounter] = useState(0);

  // WebSocket connection for real-time updates
  const { events, status: connectionStatus } = useLoopEvents<LoopEvent>(loopId, {
    onEvent: handleEvent,
  });

  // Handle events
  function handleEvent(event: LoopEvent) {
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
          // Add new entry
          return [
            ...prev,
            {
              id: event.id,
              level: event.level,
              message: event.message,
              details: event.details,
              timestamp: event.timestamp,
            },
          ];
        });
        break;

      case "loop.progress":
        // Accumulate streaming text deltas
        setProgressContent((prev) => prev + event.content);
        break;

      case "loop.message":
        // Clear progress content when message is complete
        setProgressContent("");
        setMessages((prev) => [...prev, event.message]);
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
          return [...prev, event.tool];
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
    }
  }

  // Fetch loop data
  const refresh = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const response = await fetch(`/api/loops/${loopId}`);
      if (!response.ok) {
        if (response.status === 404) {
          setLoop(null);
          setError("Loop not found");
          return;
        }
        throw new Error(`Failed to fetch loop: ${response.statusText}`);
      }
      const data = (await response.json()) as Loop;
      setLoop(data);
      
      // Load persisted logs from loop state on initial load
      // Only load if we have no logs yet (fresh page load)
      // Load only the latest 1000 to keep UI responsive
      if (data.state.logs && data.state.logs.length > 0 && logs.length === 0) {
        const latestLogs = data.state.logs.slice(-1000);
        setLogs(latestLogs.map((log) => ({
          id: log.id,
          level: log.level,
          message: log.message,
          details: log.details,
          timestamp: log.timestamp,
        })));
      }
      
      // Load persisted messages from loop state on initial load
      // Only load if we have no messages yet (fresh page load)
      // Load only the latest 1000 to keep UI responsive
      if (data.state.messages && data.state.messages.length > 0 && messages.length === 0) {
        const latestMessages = data.state.messages.slice(-1000);
        setMessages(latestMessages.map((msg) => ({
          id: msg.id,
          role: msg.role,
          content: msg.content,
          timestamp: msg.timestamp,
        })));
      }
      
      // Load persisted tool calls from loop state on initial load
      // Only load if we have no tool calls yet (fresh page load)
      // Load only the latest 1000 to keep UI responsive
      if (data.state.toolCalls && data.state.toolCalls.length > 0 && toolCalls.length === 0) {
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
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  }, [loopId, logs.length, messages.length, toolCalls.length]);

  // Update the loop
  const update = useCallback(
    async (request: UpdateLoopRequest): Promise<boolean> => {
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
        return true;
      } catch (err) {
        setError(String(err));
        return false;
      }
    },
    [loopId]
  );

  // Delete the loop
  const remove = useCallback(async (): Promise<boolean> => {
    try {
      await deleteLoopApi(loopId);
      setLoop(null);
      return true;
    } catch (err) {
      setError(String(err));
      return false;
    }
  }, [loopId]);

  // Accept the loop's changes
  const accept = useCallback(async (): Promise<AcceptLoopResult> => {
    try {
      const result = await acceptLoopApi(loopId);
      await refresh();
      return result;
    } catch (err) {
      setError(String(err));
      return { success: false };
    }
  }, [loopId, refresh]);

  // Push the loop's branch to remote
  const push = useCallback(async (): Promise<PushLoopResult> => {
    try {
      const result = await pushLoopApi(loopId);
      await refresh();
      return result;
    } catch (err) {
      setError(String(err));
      return { success: false };
    }
  }, [loopId, refresh]);

  // Discard the loop's changes
  const discard = useCallback(async (): Promise<boolean> => {
    try {
      await discardLoopApi(loopId);
      await refresh();
      return true;
    } catch (err) {
      setError(String(err));
      return false;
    }
  }, [loopId, refresh]);

  // Purge the loop (permanently delete)
  const purge = useCallback(async (): Promise<boolean> => {
    try {
      await purgeLoopApi(loopId);
      setLoop(null);
      return true;
    } catch (err) {
      setError(String(err));
      return false;
    }
  }, [loopId]);

  // Set a pending prompt for the next iteration
  const setPendingPrompt = useCallback(
    async (prompt: string): Promise<boolean> => {
      try {
        await setPendingPromptApi(loopId, prompt);
        await refresh();
        return true;
      } catch (err) {
        setError(String(err));
        return false;
      }
    },
    [loopId, refresh]
  );

  // Clear the pending prompt
  const clearPendingPrompt = useCallback(async (): Promise<boolean> => {
    try {
      await clearPendingPromptApi(loopId);
      await refresh();
      return true;
    } catch (err) {
      setError(String(err));
      return false;
    }
  }, [loopId, refresh]);

  // Get the git diff
  const getDiff = useCallback(async (): Promise<FileDiff[]> => {
    try {
      const response = await fetch(`/api/loops/${loopId}/diff`);
      if (!response.ok) {
        // 400 "no_git_branch" is expected when loop is in planning mode or hasn't started yet
        if (response.status === 400) {
          return []; // Return empty diff instead of showing error
        }
        throw new Error(`Failed to get diff: ${response.statusText}`);
      }
      return (await response.json()) as FileDiff[];
    } catch (err) {
      setError(String(err));
      return [];
    }
  }, [loopId]);

  // Get the plan.md content
  const getPlan = useCallback(async (): Promise<FileContentResponse> => {
    try {
      const response = await fetch(`/api/loops/${loopId}/plan`);
      if (!response.ok) {
        throw new Error(`Failed to get plan: ${response.statusText}`);
      }
      return (await response.json()) as FileContentResponse;
    } catch (err) {
      setError(String(err));
      return { content: "", exists: false };
    }
  }, [loopId]);

  // Get the status.md content
  const getStatusFile = useCallback(async (): Promise<FileContentResponse> => {
    try {
      const response = await fetch(`/api/loops/${loopId}/status-file`);
      if (!response.ok) {
        throw new Error(`Failed to get status file: ${response.statusText}`);
      }
      return (await response.json()) as FileContentResponse;
    } catch (err) {
      setError(String(err));
      return { content: "", exists: false };
    }
  }, [loopId]);

  // Send feedback to refine the plan
  const sendPlanFeedback = useCallback(
    async (feedback: string): Promise<boolean> => {
      try {
        await sendPlanFeedbackApi(loopId, feedback);
        await refresh();
        return true;
      } catch (err) {
        setError(String(err));
        return false;
      }
    },
    [loopId, refresh]
  );

  // Accept the plan and start the loop execution
  const acceptPlan = useCallback(async (): Promise<boolean> => {
    try {
      await acceptPlanApi(loopId);
      await refresh();
      return true;
    } catch (err) {
      setError(String(err));
      return false;
    }
  }, [loopId, refresh]);

  // Discard the plan and delete the loop
  const discardPlan = useCallback(async (): Promise<boolean> => {
    try {
      await discardPlanApi(loopId);
      setLoop(null);
      return true;
    } catch (err) {
      setError(String(err));
      return false;
    }
  }, [loopId]);

  // Address reviewer comments
  const addressReviewComments = useCallback(
    async (comments: string): Promise<AddressCommentsResult> => {
      try {
        const result = await addressReviewCommentsApi(loopId, comments);
        await refresh();
        return result;
      } catch (err) {
        setError(String(err));
        return { success: false };
      }
    },
    [loopId, refresh]
  );

  // Initial fetch
  useEffect(() => {
    refresh();
  }, [refresh]);

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
    discard,
    purge,
    setPendingPrompt,
    clearPendingPrompt,
    getDiff,
    getPlan,
    getStatusFile,
    sendPlanFeedback,
    acceptPlan,
    discardPlan,
    addressReviewComments,
  };
}
