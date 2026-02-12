/**
 * Loops state management hook.
 * Provides CRUD operations and real-time state updates for loops.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import type { Loop, LoopEvent, CreateLoopRequest, CreateChatRequest, UpdateLoopRequest, UncommittedChangesError } from "../types";
import { useGlobalEvents } from "./useWebSocket";
import { log } from "../lib/logger";
import {
  acceptLoopApi,
  pushLoopApi,
  discardLoopApi,
  deleteLoopApi,
  purgeLoopApi,
  addressReviewCommentsApi,
  updateBranchApi,
  createChatApi,
  type AcceptLoopResult,
  type PushLoopResult,
  type AddressCommentsResult,
} from "./loopActions";

export interface CreateLoopResult {
  /** The created loop, or null if creation failed */
  loop: Loop | null;
  /** Error if the loop was created but failed to start (e.g., uncommitted changes) */
  startError?: UncommittedChangesError;
}

export interface CreateChatResult {
  /** The created chat, or null if creation failed */
  loop: Loop | null;
  /** Error if the chat was created but failed to start (e.g., uncommitted changes) */
  startError?: UncommittedChangesError;
}

export interface UseLoopsResult {
  /** Array of all loops */
  loops: Loop[];
  /** Whether loops are currently loading */
  loading: boolean;
  /** Error message if any */
  error: string | null;
  /** Refresh loops from the server */
  refresh: () => Promise<void>;
  /** Create a new loop (loops are always started immediately) */
  createLoop: (request: CreateLoopRequest) => Promise<CreateLoopResult>;
  /** Create a new interactive chat */
  createChat: (request: CreateChatRequest) => Promise<CreateChatResult>;
  /** Update an existing loop */
  updateLoop: (id: string, request: UpdateLoopRequest) => Promise<Loop | null>;
  /** Delete a loop */
  deleteLoop: (id: string) => Promise<boolean>;
  /** Accept (merge) a loop's changes */
  acceptLoop: (id: string) => Promise<AcceptLoopResult>;
  /** Push a loop's branch to remote */
  pushLoop: (id: string) => Promise<PushLoopResult>;
  /** Update a pushed loop's branch by syncing with the base branch and re-pushing */
  updateBranch: (id: string) => Promise<PushLoopResult>;
  /** Discard a loop's changes */
  discardLoop: (id: string) => Promise<boolean>;
  /** Purge a loop (permanently delete - only for merged/pushed/deleted loops) */
  purgeLoop: (id: string) => Promise<boolean>;
  /** Address reviewer comments (only for pushed/merged loops with reviewMode.addressable = true) */
  addressReviewComments: (id: string, comments: string) => Promise<AddressCommentsResult>;
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

  // AbortController for cancelling in-flight fetch requests on unmount
  const abortControllerRef = useRef<AbortController | null>(null);

  // WebSocket connection for real-time updates
  useGlobalEvents<LoopEvent>({
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
      case "loop.plan.accepted":
      case "loop.plan.ready":
      case "loop.plan.feedback":
      case "loop.plan.discarded":
        // Refresh the specific loop to get updated state
        refreshLoop(event.loopId);
        break;
    }
  }

  // Fetch all loops
  const refresh = useCallback(async () => {
    // Cancel any in-flight request
    abortControllerRef.current?.abort();
    const controller = new AbortController();
    abortControllerRef.current = controller;
    
    try {
      setLoading(true);
      setError(null);
      const response = await fetch("/api/loops", { signal: controller.signal });
      if (controller.signal.aborted) return;
      if (!response.ok) {
        throw new Error(`Failed to fetch loops: ${response.statusText}`);
      }
      const data = (await response.json()) as Loop[];
      setLoops(data);
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") return;
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
      log.error("Failed to refresh loop:", err);
    }
  }, []);

  // Create a new loop (loops are always started immediately by the API)
  const createLoop = useCallback(async (request: CreateLoopRequest): Promise<CreateLoopResult> => {
    try {
      const response = await fetch("/api/loops", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(request),
      });
      
      // Handle uncommitted changes error (409)
      if (response.status === 409) {
        const errorData = await response.json() as UncommittedChangesError;
        return {
          loop: null,
          startError: errorData,
        };
      }
      
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.message || "Failed to create loop");
      }
      
      const loop = (await response.json()) as Loop;
      // Don't add to state here - let the WebSocket event handle it
      // to avoid duplicate entries during the brief moment before refresh completes
      
      return { loop };
    } catch (err) {
      setError(String(err));
      return { loop: null };
    }
  }, []);

  // Create a new interactive chat
  const createChat = useCallback(async (request: CreateChatRequest): Promise<CreateChatResult> => {
    try {
      const loop = await createChatApi(request);
      // Don't add to state here - let the WebSocket event handle it
      return { loop };
    } catch (err) {
      setError(String(err));
      return { loop: null };
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
      // Update state immediately for config changes (no WebSocket event for PATCH)
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
      // Don't remove from state here - let the WebSocket event handle it
      // to avoid race conditions with state updates
      return true;
    } catch (err) {
      setError(String(err));
      return false;
    }
  }, []);

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

  // Update a pushed loop's branch by syncing with the base branch and re-pushing
  const updateBranch = useCallback(async (id: string): Promise<PushLoopResult> => {
    try {
      const result = await updateBranchApi(id);
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
      // Remove from state immediately since purge doesn't emit a WebSocket event
      // (archived loops are removed from the system entirely)
      setLoops((prev) => prev.filter((l) => l.config.id !== id));
      return true;
    } catch (err) {
      setError(String(err));
      return false;
    }
  }, []);

  // Address reviewer comments
  const addressReviewComments = useCallback(async (id: string, comments: string): Promise<AddressCommentsResult> => {
    try {
      const result = await addressReviewCommentsApi(id, comments);
      await refreshLoop(id);
      return result;
    } catch (err) {
      setError(String(err));
      return { success: false };
    }
  }, [refreshLoop]);

  // Get a loop by ID
  const getLoop = useCallback(
    (id: string): Loop | undefined => {
      return loops.find((loop) => loop.config.id === id);
    },
    [loops]
  );

  // Initial fetch and cleanup
  useEffect(() => {
    refresh();
    return () => {
      abortControllerRef.current?.abort();
      abortControllerRef.current = null;
    };
  }, [refresh]);

  return {
    loops,
    loading,
    error,
    refresh,
    createLoop,
    createChat,
    updateLoop,
    deleteLoop,
    acceptLoop,
    pushLoop,
    updateBranch,
    discardLoop,
    purgeLoop,
    addressReviewComments,
    getLoop,
  };
}
