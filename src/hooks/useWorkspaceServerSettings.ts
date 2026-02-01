/**
 * Workspace server settings state management hook.
 * Provides access to workspace-specific server settings and connection status.
 */

import { useCallback, useEffect, useState } from "react";
import type { ServerSettings, ConnectionStatus } from "../types/settings";

export interface UseWorkspaceServerSettingsResult {
  /** Current server settings for the workspace */
  settings: ServerSettings | null;
  /** Current connection status for the workspace */
  status: ConnectionStatus | null;
  /** Whether settings are loading */
  loading: boolean;
  /** Error message if any */
  error: string | null;
  /** Whether a save operation is in progress */
  saving: boolean;
  /** Whether a test operation is in progress */
  testing: boolean;
  /** Whether a reset connection operation is in progress */
  resettingConnection: boolean;
  /** Refresh settings from the server */
  refresh: () => Promise<void>;
  /** Update server settings for the workspace */
  updateSettings: (settings: ServerSettings) => Promise<boolean>;
  /** Test connection with provided settings (uses workspace's current settings if not provided) */
  testConnection: (settings?: ServerSettings) => Promise<{ success: boolean; error?: string }>;
  /** Reset connection for the workspace */
  resetConnection: () => Promise<boolean>;
}

/**
 * Hook for managing workspace-specific server settings.
 * 
 * @param workspaceId - The ID of the workspace to manage settings for
 */
export function useWorkspaceServerSettings(workspaceId: string | null): UseWorkspaceServerSettingsResult {
  const [settings, setSettings] = useState<ServerSettings | null>(null);
  const [status, setStatus] = useState<ConnectionStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [resettingConnection, setResettingConnection] = useState(false);

  // Fetch current settings for the workspace
  const fetchSettings = useCallback(async () => {
    if (!workspaceId) {
      setSettings(null);
      return;
    }

    try {
      const response = await fetch(`/api/workspaces/${workspaceId}/server-settings`);
      if (!response.ok) {
        throw new Error(`Failed to fetch settings: ${response.statusText}`);
      }
      const data = (await response.json()) as ServerSettings;
      setSettings(data);
    } catch (err) {
      setError(String(err));
    }
  }, [workspaceId]);

  // Fetch connection status for the workspace
  const fetchStatus = useCallback(async () => {
    if (!workspaceId) {
      setStatus(null);
      return;
    }

    try {
      const response = await fetch(`/api/workspaces/${workspaceId}/server-settings/status`);
      if (!response.ok) {
        throw new Error(`Failed to fetch status: ${response.statusText}`);
      }
      const data = (await response.json()) as ConnectionStatus;
      setStatus(data);
    } catch (err) {
      // Don't set error for status fetch failures - non-critical
      console.error("Failed to fetch connection status:", err);
    }
  }, [workspaceId]);

  // Refresh both settings and status
  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    await Promise.all([fetchSettings(), fetchStatus()]);
    setLoading(false);
  }, [fetchSettings, fetchStatus]);

  // Update server settings for the workspace
  const updateSettings = useCallback(async (newSettings: ServerSettings): Promise<boolean> => {
    if (!workspaceId) {
      setError("No workspace selected");
      return false;
    }

    try {
      setSaving(true);
      setError(null);
      
      const response = await fetch(`/api/workspaces/${workspaceId}/server-settings`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(newSettings),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.message || "Failed to save settings");
      }

      // Update local state
      setSettings(newSettings);
      
      // Refresh status after settings change
      await fetchStatus();
      
      return true;
    } catch (err) {
      setError(String(err));
      return false;
    } finally {
      setSaving(false);
    }
  }, [workspaceId, fetchStatus]);

  // Test connection with provided settings (or current workspace settings)
  const testConnection = useCallback(
    async (testSettings?: ServerSettings): Promise<{ success: boolean; error?: string }> => {
      if (!workspaceId) {
        return { success: false, error: "No workspace selected" };
      }

      try {
        setTesting(true);
        setError(null);

        const response = await fetch(`/api/workspaces/${workspaceId}/server-settings/test`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: testSettings ? JSON.stringify(testSettings) : "{}",
        });

        const data = (await response.json()) as { success: boolean; error?: string };
        return data;
      } catch (err) {
        return { success: false, error: String(err) };
      } finally {
        setTesting(false);
      }
    },
    [workspaceId]
  );

  // Reset connection for the workspace
  const resetConnection = useCallback(async (): Promise<boolean> => {
    if (!workspaceId) {
      setError("No workspace selected");
      return false;
    }

    try {
      setResettingConnection(true);
      setError(null);

      const response = await fetch(`/api/workspaces/${workspaceId}/server-settings/reset`, {
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
      setError(String(err));
      return false;
    } finally {
      setResettingConnection(false);
    }
  }, [workspaceId, fetchStatus]);

  // Fetch when workspace changes
  useEffect(() => {
    if (workspaceId) {
      refresh();
    } else {
      setSettings(null);
      setStatus(null);
      setLoading(false);
    }
  }, [workspaceId, refresh]);

  return {
    settings,
    status,
    loading,
    error,
    saving,
    testing,
    resettingConnection,
    refresh,
    updateSettings,
    testConnection,
    resetConnection,
  };
}
