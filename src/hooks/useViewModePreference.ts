/**
 * Hook for managing the dashboard view mode preference.
 * Provides access to the view mode setting (rows or cards).
 */

import { useCallback, useEffect, useRef, useState } from "react";
import type { DashboardViewMode } from "../types/preferences";

/**
 * Re-export DashboardViewMode so existing consumers of this module don't break.
 */
export type { DashboardViewMode } from "../types/preferences";

export interface UseViewModePreferenceResult {
  /** Current view mode */
  viewMode: DashboardViewMode;
  /** Whether the preference is being loaded */
  loading: boolean;
  /** Error message if any */
  error: string | null;
  /** Whether a save operation is in progress */
  saving: boolean;
  /** Toggle between rows and cards */
  toggle: () => Promise<void>;
  /** Set the view mode to a specific value */
  setViewMode: (mode: DashboardViewMode) => Promise<void>;
}

/**
 * Hook for managing the dashboard view mode preference.
 * The setting persists across browser sessions via server-side storage.
 */
export function useViewModePreference(): UseViewModePreferenceResult {
  const [viewMode, setViewModeState] = useState<DashboardViewMode>("rows"); // Default to rows
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // Ref to track the latest value to avoid stale closure in toggle
  const viewModeRef = useRef(viewMode);
  useEffect(() => {
    viewModeRef.current = viewMode;
  }, [viewMode]);

  // Fetch the current preference
  const fetchPreference = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const response = await fetch("/api/preferences/dashboard-view-mode");
      if (!response.ok) {
        throw new Error(`Failed to fetch preference: ${response.statusText}`);
      }
      const data = (await response.json()) as { mode: DashboardViewMode };
      setViewModeState(data.mode);
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  // Set the preference
  const setViewMode = useCallback(async (newMode: DashboardViewMode) => {
    try {
      setSaving(true);
      setError(null);
      const response = await fetch("/api/preferences/dashboard-view-mode", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: newMode }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.message || "Failed to save preference");
      }

      setViewModeState(newMode);
    } catch (err) {
      setError(String(err));
    } finally {
      setSaving(false);
    }
  }, []);

  // Toggle the preference using ref to avoid stale closure issues
  const toggle = useCallback(async () => {
    const newMode = viewModeRef.current === "rows" ? "cards" : "rows";
    await setViewMode(newMode);
  }, [setViewMode]);

  // Initial fetch
  useEffect(() => {
    fetchPreference();
  }, [fetchPreference]);

  return {
    viewMode,
    loading,
    error,
    saving,
    toggle,
    setViewMode,
  };
}
