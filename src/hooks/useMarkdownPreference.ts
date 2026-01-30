/**
 * Hook for managing the markdown rendering preference.
 * Provides access to the global markdown rendering setting.
 */

import { useCallback, useEffect, useState } from "react";

export interface UseMarkdownPreferenceResult {
  /** Whether markdown rendering is enabled */
  enabled: boolean;
  /** Whether the preference is being loaded */
  loading: boolean;
  /** Error message if any */
  error: string | null;
  /** Whether a save operation is in progress */
  saving: boolean;
  /** Toggle the markdown rendering preference */
  toggle: () => Promise<void>;
  /** Set the markdown rendering preference to a specific value */
  setEnabled: (enabled: boolean) => Promise<void>;
}

/**
 * Hook for managing the global markdown rendering preference.
 * The setting persists across browser sessions.
 */
export function useMarkdownPreference(): UseMarkdownPreferenceResult {
  const [enabled, setEnabledState] = useState(true); // Default to true
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // Fetch the current preference
  const fetchPreference = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const response = await fetch("/api/preferences/markdown-rendering");
      if (!response.ok) {
        throw new Error(`Failed to fetch preference: ${response.statusText}`);
      }
      const data = (await response.json()) as { enabled: boolean };
      setEnabledState(data.enabled);
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  // Set the preference
  const setEnabled = useCallback(async (newEnabled: boolean) => {
    try {
      setSaving(true);
      setError(null);
      const response = await fetch("/api/preferences/markdown-rendering", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: newEnabled }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.message || "Failed to save preference");
      }

      setEnabledState(newEnabled);
    } catch (err) {
      setError(String(err));
    } finally {
      setSaving(false);
    }
  }, []);

  // Toggle the preference
  const toggle = useCallback(async () => {
    await setEnabled(!enabled);
  }, [enabled, setEnabled]);

  // Initial fetch
  useEffect(() => {
    fetchPreference();
  }, [fetchPreference]);

  return {
    enabled,
    loading,
    error,
    saving,
    toggle,
    setEnabled,
  };
}
