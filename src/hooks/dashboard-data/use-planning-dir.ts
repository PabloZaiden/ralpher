/**
 * Sub-hook for checking the planning directory status.
 */

import { useState, useCallback, useRef } from "react";
import { appFetch } from "../../lib/public-path";

export interface UsePlanningDirResult {
  planningWarning: string | null;
  checkPlanningDir: (directory: string, workspaceId: string | null) => Promise<void>;
  resetPlanningWarning: () => void;
}

export function usePlanningDir(): UsePlanningDirResult {
  const [planningWarning, setPlanningWarning] = useState<string | null>(null);
  const planningRequestIdRef = useRef(0);

  const checkPlanningDir = useCallback(async (directory: string, workspaceId: string | null) => {
    const requestId = ++planningRequestIdRef.current;
    if (!directory || !workspaceId) {
      setPlanningWarning(null);
      return;
    }

    try {
      const response = await appFetch(
        `/api/check-planning-dir?directory=${encodeURIComponent(directory)}&workspaceId=${encodeURIComponent(workspaceId)}`
      );
      if (requestId !== planningRequestIdRef.current) {
        return;
      }
      if (response.ok) {
        const data = await response.json();
        if (requestId !== planningRequestIdRef.current) {
          return;
        }
        setPlanningWarning(data.warning ?? null);
      } else {
        setPlanningWarning(null);
      }
    } catch {
      if (requestId === planningRequestIdRef.current) {
        setPlanningWarning(null);
      }
    }
  }, []);

  const resetPlanningWarning = useCallback(() => {
    setPlanningWarning(null);
  }, []);

  return { planningWarning, checkPlanningDir, resetPlanningWarning };
}
