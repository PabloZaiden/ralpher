/**
 * Server settings state management hook.
 * Provides access to global server settings and connection status.
 */

import { useCallback, useEffect, useState } from "react";
import type { ServerSettings, ConnectionStatus } from "../types/settings";

export interface UseServerSettingsResult {
  /** Current server settings */
  settings: ServerSettings | null;
  /** Current connection status */
  status: ConnectionStatus | null;
  /** Whether settings are loading */
  loading: boolean;
  /** Error message if any */
  error: string | null;
  /** Whether a save operation is in progress */
  saving: boolean;
  /** Whether a test operation is in progress */
  testing: boolean;
  /** Refresh settings from the server */
  refresh: () => Promise<void>;
  /** Update server settings */
  updateSettings: (settings: ServerSettings) => Promise<boolean>;
  /** Test connection with provided settings */
  testConnection: (settings: ServerSettings, directory?: string) => Promise<{ success: boolean; error?: string }>;
}

/**
 * Hook for managing global server settings.
 */
export function useServerSettings(): UseServerSettingsResult {
  const [settings, setSettings] = useState<ServerSettings | null>(null);
  const [status, setStatus] = useState<ConnectionStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);

  // Fetch current settings
  const fetchSettings = useCallback(async () => {
    try {
      const response = await fetch("/api/settings/server");
      if (!response.ok) {
        throw new Error(`Failed to fetch settings: ${response.statusText}`);
      }
      const data = (await response.json()) as ServerSettings;
      setSettings(data);
    } catch (err) {
      setError(String(err));
    }
  }, []);

  // Fetch connection status
  const fetchStatus = useCallback(async () => {
    try {
      const response = await fetch("/api/settings/server/status");
      if (!response.ok) {
        throw new Error(`Failed to fetch status: ${response.statusText}`);
      }
      const data = (await response.json()) as ConnectionStatus;
      setStatus(data);
    } catch (err) {
      // Don't set error for status fetch failures - non-critical
      console.error("Failed to fetch connection status:", err);
    }
  }, []);

  // Refresh both settings and status
  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    await Promise.all([fetchSettings(), fetchStatus()]);
    setLoading(false);
  }, [fetchSettings, fetchStatus]);

  // Update server settings
  const updateSettings = useCallback(async (newSettings: ServerSettings): Promise<boolean> => {
    try {
      setSaving(true);
      setError(null);
      
      const response = await fetch("/api/settings/server", {
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
  }, [fetchStatus]);

  // Test connection with provided settings
  const testConnection = useCallback(
    async (testSettings: ServerSettings, directory?: string): Promise<{ success: boolean; error?: string }> => {
      try {
        setTesting(true);
        setError(null);

        const response = await fetch("/api/settings/server/test", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ...testSettings, directory }),
        });

        const data = (await response.json()) as { success: boolean; error?: string };
        return data;
      } catch (err) {
        return { success: false, error: String(err) };
      } finally {
        setTesting(false);
      }
    },
    []
  );

  // Initial fetch
  useEffect(() => {
    refresh();
  }, [refresh]);

  return {
    settings,
    status,
    loading,
    error,
    saving,
    testing,
    refresh,
    updateSettings,
    testConnection,
  };
}
