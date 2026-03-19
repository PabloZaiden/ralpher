import { useCallback, useState } from "react";
import { createLogger } from "../../lib/logger";
import type { ServerSettings } from "../../types/settings";
import { appFetch } from "../../lib/public-path";

export function useWorkspaceConnection(
  workspaceId: string | null,
  fetchStatus: () => Promise<void>,
  setError: (error: string | null) => void,
) {
  const log = createLogger("useWorkspaceConnection");
  const [testing, setTesting] = useState(false);
  const [resettingConnection, setResettingConnection] = useState(false);

  const testConnection = useCallback(
    async (testSettings?: ServerSettings): Promise<{ success: boolean; error?: string }> => {
      if (!workspaceId) {
        return { success: false, error: "No workspace selected" };
      }

      try {
        setTesting(true);
        setError(null);

        const response = await appFetch(`/api/workspaces/${workspaceId}/server-settings/test`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: testSettings ? JSON.stringify(testSettings) : "{}",
        });

        const data = (await response.json()) as { success: boolean; error?: string };
        return data;
      } catch (err) {
        log.error("Failed to test workspace server connection", {
          workspaceId,
          error: String(err),
        });
        return { success: false, error: String(err) };
      } finally {
        setTesting(false);
      }
    },
    [workspaceId, setError]
  );

  const resetConnection = useCallback(async (): Promise<boolean> => {
    if (!workspaceId) {
      setError("No workspace selected");
      return false;
    }

    try {
      setResettingConnection(true);
      setError(null);

      const response = await appFetch(`/api/workspaces/${workspaceId}/server-settings/reset`, {
        method: "POST",
      });

      const data = (await response.json()) as { success: boolean; message?: string; error?: string };

      if (!response.ok) {
        throw new Error(data.message || data.error || "Failed to reset connection");
      }

      // Refresh status after reset
      await fetchStatus();

      return true;
    } catch (err) {
      log.error("Failed to reset workspace server connection", {
        workspaceId,
        error: String(err),
      });
      setError(String(err));
      return false;
    } finally {
      setResettingConnection(false);
    }
  }, [workspaceId, fetchStatus, setError]);

  return { testing, resettingConnection, testConnection, resetConnection };
}
