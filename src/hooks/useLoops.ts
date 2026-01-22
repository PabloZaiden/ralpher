/**
 * Loops state management hook.
 * Provides CRUD operations and real-time state updates for loops.
 */

import { useCallback, useEffect, useState } from "react";
import type { Loop, LoopEvent, CreateLoopRequest, UpdateLoopRequest, StartLoopRequest } from "../types";
import { useGlobalEvents } from "./useWebSocket";
import {
  startLoopApi,
  stopLoopApi,
  acceptLoopApi,
  pushLoopApi,
  discardLoopApi,
  deleteLoopApi,
  purgeLoopApi,
  type StartLoopResult,
  type AcceptLoopResult,
  type PushLoopResult,
} from "./loopActions";

export interface UseLoopsResult {
  /** Array of all loops */
  loops: Loop[];
  /** Whether loops are currently loading */
  loading: boolean;
  /** Error message if any */
  error: string | null;
  /** WebSocket connection status */
  connectionStatus: "connecting" | "open" | "closed" | "error";
  /** Refresh loops from the server */
  refresh: () => Promise<void>;
  /** Create a new loop */
  createLoop: (request: CreateLoopRequest) => Promise<Loop | null>;
  /** Update an existing loop */
  updateLoop: (id: string, request: UpdateLoopRequest) => Promise<Loop | null>;
  /** Delete a loop */
  deleteLoop: (id: string) => Promise<boolean>;
  /** Start a loop */
  startLoop: (id: string, request?: StartLoopRequest) => Promise<StartLoopResult>;
  /** Stop a loop */
  stopLoop: (id: string) => Promise<boolean>;
  /** Accept (merge) a loop's changes */
  acceptLoop: (id: string) => Promise<AcceptLoopResult>;
  /** Push a loop's branch to remote */
  pushLoop: (id: string) => Promise<PushLoopResult>;
  /** Discard a loop's changes */
  discardLoop: (id: string) => Promise<boolean>;
  /** Purge a loop (permanently delete - only for merged/pushed/deleted loops) */
  purgeLoop: (id: string) => Promise<boolean>;
  /** Get a loop by ID */
  getLoop: (id: string) => Loop | undefined;
}

/**
 * Hook for managing loops state with real-time updates via WebSocket.
 */
export function useLoops(): UseLoopsResult {
  const [loops, setLoops] = useState<Loop[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // WebSocket connection for real-time updates
  const { status: connectionStatus } = useGlobalEvents<LoopEvent>({
    onEvent: handleEvent,
  });

  // Handle events to update loops state
  function handleEvent(event: LoopEvent) {
    switch (event.type) {
      case "loop.created":
        // Refresh to get the full loop data
        refresh();
        break;

      case "loop.deleted":
        setLoops((prev) => prev.filter((loop) => loop.config.id !== event.loopId));
        break;

      case "loop.started":
      case "loop.stopped":
      case "loop.completed":
      case "loop.accepted":
      case "loop.pushed":
      case "loop.discarded":
      case "loop.error":
      case "loop.iteration.start":
      case "loop.iteration.end":
        // Refresh the specific loop to get updated state
        refreshLoop(event.loopId);
        break;
    }
  }

  // Fetch all loops
  const refresh = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const response = await fetch("/api/loops");
      if (!response.ok) {
        throw new Error(`Failed to fetch loops: ${response.statusText}`);
      }
      const data = (await response.json()) as Loop[];
      setLoops(data);
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  // Refresh a single loop
  const refreshLoop = useCallback(async (id: string) => {
    try {
      const response = await fetch(`/api/loops/${id}`);
      if (!response.ok) {
        if (response.status === 404) {
          // Loop was deleted
          setLoops((prev) => prev.filter((loop) => loop.config.id !== id));
          return;
        }
        throw new Error(`Failed to fetch loop: ${response.statusText}`);
      }
      const loop = (await response.json()) as Loop;
      setLoops((prev) => {
        const index = prev.findIndex((l) => l.config.id === id);
        if (index >= 0) {
          const newLoops = [...prev];
          newLoops[index] = loop;
          return newLoops;
        }
        return [...prev, loop];
      });
    } catch (err) {
      console.error("Failed to refresh loop:", err);
    }
  }, []);

  // Create a new loop
  const createLoop = useCallback(async (request: CreateLoopRequest): Promise<Loop | null> => {
    try {
      const response = await fetch("/api/loops", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(request),
      });
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.message || "Failed to create loop");
      }
      const loop = (await response.json()) as Loop;
      setLoops((prev) => [...prev, loop]);
      return loop;
    } catch (err) {
      setError(String(err));
      return null;
    }
  }, []);

  // Update an existing loop
  const updateLoop = useCallback(async (id: string, request: UpdateLoopRequest): Promise<Loop | null> => {
    try {
      const response = await fetch(`/api/loops/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(request),
      });
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.message || "Failed to update loop");
      }
      const loop = (await response.json()) as Loop;
      setLoops((prev) =>
        prev.map((l) => (l.config.id === id ? loop : l))
      );
      return loop;
    } catch (err) {
      setError(String(err));
      return null;
    }
  }, []);

  // Delete a loop
  const deleteLoop = useCallback(async (id: string): Promise<boolean> => {
    try {
      await deleteLoopApi(id);
      setLoops((prev) => prev.filter((l) => l.config.id !== id));
      return true;
    } catch (err) {
      setError(String(err));
      return false;
    }
  }, []);

  // Start a loop
  const startLoop = useCallback(
    async (id: string, request?: StartLoopRequest): Promise<StartLoopResult> => {
      try {
        const result = await startLoopApi(id, request);
        if (result.success) {
          await refreshLoop(id);
        }
        return result;
      } catch (err) {
        setError(String(err));
        return { success: false };
      }
    },
    [refreshLoop]
  );

  // Stop a loop
  const stopLoop = useCallback(async (id: string): Promise<boolean> => {
    try {
      await stopLoopApi(id);
      await refreshLoop(id);
      return true;
    } catch (err) {
      setError(String(err));
      return false;
    }
  }, [refreshLoop]);

  // Accept a loop's changes
  const acceptLoop = useCallback(async (id: string): Promise<AcceptLoopResult> => {
    try {
      const result = await acceptLoopApi(id);
      await refreshLoop(id);
      return result;
    } catch (err) {
      setError(String(err));
      return { success: false };
    }
  }, [refreshLoop]);

  // Push a loop's branch to remote
  const pushLoop = useCallback(async (id: string): Promise<PushLoopResult> => {
    try {
      const result = await pushLoopApi(id);
      await refreshLoop(id);
      return result;
    } catch (err) {
      setError(String(err));
      return { success: false };
    }
  }, [refreshLoop]);

  // Discard a loop's changes
  const discardLoop = useCallback(async (id: string): Promise<boolean> => {
    try {
      await discardLoopApi(id);
      await refreshLoop(id);
      return true;
    } catch (err) {
      setError(String(err));
      return false;
    }
  }, [refreshLoop]);

  // Purge a loop (permanently delete)
  const purgeLoop = useCallback(async (id: string): Promise<boolean> => {
    try {
      await purgeLoopApi(id);
      setLoops((prev) => prev.filter((l) => l.config.id !== id));
      return true;
    } catch (err) {
      setError(String(err));
      return false;
    }
  }, []);

  // Get a loop by ID
  const getLoop = useCallback(
    (id: string): Loop | undefined => {
      return loops.find((loop) => loop.config.id === id);
    },
    [loops]
  );

  // Initial fetch
  useEffect(() => {
    refresh();
  }, [refresh]);

  return {
    loops,
    loading,
    error,
    connectionStatus,
    refresh,
    createLoop,
    updateLoop,
    deleteLoop,
    startLoop,
    stopLoop,
    acceptLoop,
    pushLoop,
    discardLoop,
    purgeLoop,
    getLoop,
  };
}
