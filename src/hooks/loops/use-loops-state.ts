/**
 * Core loops state: data fetching, refresh, and getLoop.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import type { Loop } from "../../types";
import { log } from "../../lib/logger";
import { appFetch } from "../../lib/public-path";

export interface UseLoopsStateResult {
  loops: Loop[];
  loading: boolean;
  error: string | null;
  setLoops: React.Dispatch<React.SetStateAction<Loop[]>>;
  setError: React.Dispatch<React.SetStateAction<string | null>>;
  refresh: () => Promise<void>;
  refreshLoop: (id: string) => Promise<void>;
  getLoop: (id: string) => Loop | undefined;
}

export function useLoopsState(): UseLoopsStateResult {
  const [loops, setLoops] = useState<Loop[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // AbortController for cancelling in-flight fetch requests on unmount
  const abortControllerRef = useRef<AbortController | null>(null);

  const refresh = useCallback(async () => {
    // Cancel any in-flight request
    abortControllerRef.current?.abort();
    const controller = new AbortController();
    abortControllerRef.current = controller;

    try {
      setLoading(true);
      setError(null);
      const response = await appFetch("/api/loops", { signal: controller.signal });
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

  const refreshLoop = useCallback(async (id: string) => {
    try {
      const response = await appFetch(`/api/loops/${id}`);
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

  return { loops, loading, error, setLoops, setError, refresh, refreshLoop, getLoop };
}
