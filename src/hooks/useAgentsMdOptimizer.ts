/**
 * Hook for AGENTS.md optimization operations.
 * Provides functions to read, preview, and apply Ralpher optimization
 * to a workspace's AGENTS.md file.
 */

import { useCallback, useState } from "react";
import type { OptimizationAnalysis, OptimizationPreview } from "../core/agents-md-optimizer";
import { log } from "../lib/logger";

/** Result of reading the current AGENTS.md state */
export interface AgentsMdStatus {
  content: string;
  fileExists: boolean;
  analysis: OptimizationAnalysis;
}

/** Result of applying optimization */
export interface OptimizeResult {
  success: boolean;
  alreadyOptimized: boolean;
  content: string;
}

export interface UseAgentsMdOptimizerResult {
  /** Current AGENTS.md status (null if not yet fetched) */
  status: AgentsMdStatus | null;
  /** Preview of optimization changes (null if not yet fetched) */
  preview: OptimizationPreview | null;
  /** Whether any operation is in progress */
  loading: boolean;
  /** Error message if any operation failed */
  error: string | null;
  /** Fetch the current AGENTS.md status */
  fetchStatus: (workspaceId: string) => Promise<AgentsMdStatus | null>;
  /** Fetch a preview of what optimization would change */
  fetchPreview: (workspaceId: string) => Promise<OptimizationPreview | null>;
  /** Apply optimization to the workspace's AGENTS.md */
  optimize: (workspaceId: string) => Promise<OptimizeResult | null>;
  /** Clear the current state */
  reset: () => void;
}

/**
 * Hook for managing AGENTS.md optimization for a workspace.
 */
export function useAgentsMdOptimizer(): UseAgentsMdOptimizerResult {
  const [status, setStatus] = useState<AgentsMdStatus | null>(null);
  const [preview, setPreview] = useState<OptimizationPreview | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchStatus = useCallback(async (workspaceId: string): Promise<AgentsMdStatus | null> => {
    try {
      setLoading(true);
      setError(null);
      const response = await fetch(`/api/workspaces/${workspaceId}/agents-md`);
      if (!response.ok) {
        const errorData = await response.json() as { message?: string };
        throw new Error(errorData.message || "Failed to fetch AGENTS.md status");
      }
      const data = (await response.json()) as AgentsMdStatus;
      setStatus(data);
      return data;
    } catch (err) {
      const message = String(err);
      setError(message);
      log.error("Failed to fetch AGENTS.md status:", err);
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchPreview = useCallback(async (workspaceId: string): Promise<OptimizationPreview | null> => {
    try {
      setLoading(true);
      setError(null);
      const response = await fetch(`/api/workspaces/${workspaceId}/agents-md/preview`, {
        method: "POST",
      });
      if (!response.ok) {
        const errorData = await response.json() as { message?: string };
        throw new Error(errorData.message || "Failed to preview optimization");
      }
      const data = (await response.json()) as OptimizationPreview;
      setPreview(data);
      // Also update the status from the preview analysis
      setStatus({
        content: data.currentContent,
        fileExists: data.fileExists,
        analysis: data.analysis,
      });
      return data;
    } catch (err) {
      const message = String(err);
      setError(message);
      log.error("Failed to preview AGENTS.md optimization:", err);
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  const optimize = useCallback(async (workspaceId: string): Promise<OptimizeResult | null> => {
    try {
      setLoading(true);
      setError(null);
      const response = await fetch(`/api/workspaces/${workspaceId}/agents-md/optimize`, {
        method: "POST",
      });
      if (!response.ok) {
        const errorData = await response.json() as { message?: string };
        throw new Error(errorData.message || "Failed to optimize AGENTS.md");
      }
      const data = (await response.json()) as OptimizeResult;
      // Update local status after successful optimization
      if (data.success) {
        setStatus({
          content: data.content,
          fileExists: true,
          analysis: {
            isOptimized: true,
            currentVersion: null, // Will be refreshed on next fetch
            updateAvailable: false,
          },
        });
        setPreview(null);
      }
      return data;
    } catch (err) {
      const message = String(err);
      setError(message);
      log.error("Failed to optimize AGENTS.md:", err);
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  const reset = useCallback(() => {
    setStatus(null);
    setPreview(null);
    setLoading(false);
    setError(null);
  }, []);

  return {
    status,
    preview,
    loading,
    error,
    fetchStatus,
    fetchPreview,
    optimize,
    reset,
  };
}
