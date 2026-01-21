/**
 * Loops state management hook.
 * Provides CRUD operations and real-time state updates for loops.
 */

import { useCallback, useEffect, useState } from "react";
import type { Loop, LoopEvent, CreateLoopRequest, UpdateLoopRequest, StartLoopRequest, UncommittedChangesError } from "../types";
import { useGlobalSSE } from "./useSSE";

export interface UseLoopsResult {
  /** Array of all loops */
  loops: Loop[];
  /** Whether loops are currently loading */
  loading: boolean;
  /** Error message if any */
  error: string | null;
  /** SSE connection status */
  sseStatus: "connecting" | "open" | "closed" | "error";
  /** Refresh loops from the server */
  refresh: () => Promise<void>;
  /** Create a new loop */
  createLoop: (request: CreateLoopRequest) => Promise<Loop | null>;
  /** Update an existing loop */
  updateLoop: (id: string, request: UpdateLoopRequest) => Promise<Loop | null>;
  /** Delete a loop */
  deleteLoop: (id: string) => Promise<boolean>;
  /** Start a loop */
  startLoop: (id: string, request?: StartLoopRequest) => Promise<{ success: boolean; uncommittedError?: UncommittedChangesError }>;
  /** Stop a loop */
  stopLoop: (id: string) => Promise<boolean>;
  /** Accept (merge) a loop's changes */
  acceptLoop: (id: string) => Promise<{ success: boolean; mergeCommit?: string }>;
  /** Discard a loop's changes */
  discardLoop: (id: string) => Promise<boolean>;
  /** Get a loop by ID */
  getLoop: (id: string) => Loop | undefined;
}

/**
 * Hook for managing loops state with real-time updates via SSE.
 */
export function useLoops(): UseLoopsResult {
  const [loops, setLoops] = useState<Loop[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // SSE connection for real-time updates
  const { status: sseStatus } = useGlobalSSE<LoopEvent>({
    onEvent: handleSSEEvent,
  });

  // Handle SSE events to update loops state
  function handleSSEEvent(event: LoopEvent) {
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
      const response = await fetch(`/api/loops/${id}`, {
        method: "DELETE",
      });
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.message || "Failed to delete loop");
      }
      setLoops((prev) => prev.filter((l) => l.config.id !== id));
      return true;
    } catch (err) {
      setError(String(err));
      return false;
    }
  }, []);

  // Start a loop
  const startLoop = useCallback(
    async (id: string, request?: StartLoopRequest): Promise<{ success: boolean; uncommittedError?: UncommittedChangesError }> => {
      try {
        const response = await fetch(`/api/loops/${id}/start`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(request || {}),
        });

        if (response.status === 409) {
          // Uncommitted changes error
          const errorData = (await response.json()) as UncommittedChangesError;
          return { success: false, uncommittedError: errorData };
        }

        if (!response.ok) {
          const errorData = await response.json();
          throw new Error(errorData.message || "Failed to start loop");
        }

        await refreshLoop(id);
        return { success: true };
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
      const response = await fetch(`/api/loops/${id}/stop`, {
        method: "POST",
      });
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.message || "Failed to stop loop");
      }
      await refreshLoop(id);
      return true;
    } catch (err) {
      setError(String(err));
      return false;
    }
  }, [refreshLoop]);

  // Accept a loop's changes
  const acceptLoop = useCallback(async (id: string): Promise<{ success: boolean; mergeCommit?: string }> => {
    try {
      const response = await fetch(`/api/loops/${id}/accept`, {
        method: "POST",
      });
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.message || "Failed to accept loop");
      }
      const data = await response.json();
      await refreshLoop(id);
      return { success: true, mergeCommit: data.mergeCommit };
    } catch (err) {
      setError(String(err));
      return { success: false };
    }
  }, [refreshLoop]);

  // Discard a loop's changes
  const discardLoop = useCallback(async (id: string): Promise<boolean> => {
    try {
      const response = await fetch(`/api/loops/${id}/discard`, {
        method: "POST",
      });
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.message || "Failed to discard loop");
      }
      await refreshLoop(id);
      return true;
    } catch (err) {
      setError(String(err));
      return false;
    }
  }, [refreshLoop]);

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
    sseStatus,
    refresh,
    createLoop,
    updateLoop,
    deleteLoop,
    startLoop,
    stopLoop,
    acceptLoop,
    discardLoop,
    getLoop,
  };
}
