/**
 * Single loop hook.
 * Provides detailed state and real-time updates for a specific loop.
 */

import { useCallback, useEffect, useState } from "react";
import type {
  Loop,
  LoopEvent,
  UpdateLoopRequest,
  StartLoopRequest,
  UncommittedChangesError,
  FileDiff,
  FileContentResponse,
  MessageData,
  ToolCallData,
  LogLevel,
} from "../types";
import { useLoopSSE } from "./useSSE";

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
  /** SSE connection status */
  sseStatus: "connecting" | "open" | "closed" | "error";
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
  /** Counter that increments when git changes occur (use to trigger diff refresh) */
  gitChangeCounter: number;
  /** Refresh loop data */
  refresh: () => Promise<void>;
  /** Update the loop */
  update: (request: UpdateLoopRequest) => Promise<boolean>;
  /** Delete the loop */
  remove: () => Promise<boolean>;
  /** Start the loop */
  start: (request?: StartLoopRequest) => Promise<{ success: boolean; uncommittedError?: UncommittedChangesError }>;
  /** Stop the loop */
  stop: () => Promise<boolean>;
  /** Pause the loop */
  pause: () => Promise<boolean>;
  /** Resume the loop */
  resume: () => Promise<boolean>;
  /** Accept (merge) the loop's changes */
  accept: () => Promise<{ success: boolean; mergeCommit?: string }>;
  /** Discard the loop's changes */
  discard: () => Promise<boolean>;
  /** Get the git diff */
  getDiff: () => Promise<FileDiff[]>;
  /** Get the plan.md content */
  getPlan: () => Promise<FileContentResponse>;
  /** Get the status.md content */
  getStatusFile: () => Promise<FileContentResponse>;
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
  const [gitChangeCounter, setGitChangeCounter] = useState(0);

  // SSE connection for real-time updates
  const { events, status: sseStatus } = useLoopSSE<LoopEvent>(loopId, {
    onEvent: handleSSEEvent,
  });

  // Handle SSE events
  function handleSSEEvent(event: LoopEvent) {
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
        // When a tool completes, it may have modified files - trigger diff check
        if (event.tool.status === "completed") {
          setGitChangeCounter((prev) => prev + 1);
        }
        break;

      case "loop.iteration.start":
        // Clear messages, tool calls, and progress for new iteration
        // Keep logs as they show the full history
        setMessages([]);
        setToolCalls([]);
        setProgressContent("");
        refresh();
        break;

      case "loop.started":
      case "loop.stopped":
      case "loop.paused":
      case "loop.resumed":
      case "loop.completed":
      case "loop.accepted":
      case "loop.discarded":
      case "loop.error":
        refresh();
        break;

      case "loop.iteration.end":
      case "loop.git.commit":
        // These events indicate git changes that affect the diff
        setGitChangeCounter((prev) => prev + 1);
        refresh();
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
      if (data.state.logs && data.state.logs.length > 0 && logs.length === 0) {
        setLogs(data.state.logs.map((log) => ({
          id: log.id,
          level: log.level,
          message: log.message,
          details: log.details,
          timestamp: log.timestamp,
        })));
      }
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  }, [loopId, logs.length]);

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
      const response = await fetch(`/api/loops/${loopId}`, {
        method: "DELETE",
      });
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.message || "Failed to delete loop");
      }
      setLoop(null);
      return true;
    } catch (err) {
      setError(String(err));
      return false;
    }
  }, [loopId]);

  // Start the loop
  const start = useCallback(
    async (request?: StartLoopRequest): Promise<{ success: boolean; uncommittedError?: UncommittedChangesError }> => {
      try {
        const response = await fetch(`/api/loops/${loopId}/start`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(request || {}),
        });

        if (response.status === 409) {
          const errorData = (await response.json()) as UncommittedChangesError;
          return { success: false, uncommittedError: errorData };
        }

        if (!response.ok) {
          const errorData = await response.json();
          throw new Error(errorData.message || "Failed to start loop");
        }

        await refresh();
        return { success: true };
      } catch (err) {
        setError(String(err));
        return { success: false };
      }
    },
    [loopId, refresh]
  );

  // Stop the loop
  const stop = useCallback(async (): Promise<boolean> => {
    try {
      const response = await fetch(`/api/loops/${loopId}/stop`, {
        method: "POST",
      });
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.message || "Failed to stop loop");
      }
      await refresh();
      return true;
    } catch (err) {
      setError(String(err));
      return false;
    }
  }, [loopId, refresh]);

  // Pause the loop
  const pause = useCallback(async (): Promise<boolean> => {
    try {
      const response = await fetch(`/api/loops/${loopId}/pause`, {
        method: "POST",
      });
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.message || "Failed to pause loop");
      }
      await refresh();
      return true;
    } catch (err) {
      setError(String(err));
      return false;
    }
  }, [loopId, refresh]);

  // Resume the loop
  const resume = useCallback(async (): Promise<boolean> => {
    try {
      const response = await fetch(`/api/loops/${loopId}/resume`, {
        method: "POST",
      });
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.message || "Failed to resume loop");
      }
      await refresh();
      return true;
    } catch (err) {
      setError(String(err));
      return false;
    }
  }, [loopId, refresh]);

  // Accept the loop's changes
  const accept = useCallback(async (): Promise<{ success: boolean; mergeCommit?: string }> => {
    try {
      const response = await fetch(`/api/loops/${loopId}/accept`, {
        method: "POST",
      });
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.message || "Failed to accept loop");
      }
      const data = await response.json();
      await refresh();
      return { success: true, mergeCommit: data.mergeCommit };
    } catch (err) {
      setError(String(err));
      return { success: false };
    }
  }, [loopId, refresh]);

  // Discard the loop's changes
  const discard = useCallback(async (): Promise<boolean> => {
    try {
      const response = await fetch(`/api/loops/${loopId}/discard`, {
        method: "POST",
      });
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.message || "Failed to discard loop");
      }
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

  // Initial fetch
  useEffect(() => {
    refresh();
  }, [refresh]);

  return {
    loop,
    loading,
    error,
    sseStatus,
    events,
    messages,
    toolCalls,
    progressContent,
    logs,
    gitChangeCounter,
    refresh,
    update,
    remove,
    start,
    stop,
    pause,
    resume,
    accept,
    discard,
    getDiff,
    getPlan,
    getStatusFile,
  };
}
