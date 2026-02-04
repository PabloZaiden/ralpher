/**
 * Hook for managing the log level preference.
 * Provides access to the global log level setting that applies to both
 * frontend and backend logging.
 */

import { useCallback, useEffect, useState } from "react";
import { setLogLevel as setFrontendLogLevel, type LogLevelName, LOG_LEVEL_OPTIONS, DEFAULT_LOG_LEVEL } from "../lib/logger";

export interface UseLogLevelPreferenceResult {
  /** Current log level */
  level: LogLevelName;
  /** Default log level */
  defaultLevel: LogLevelName;
  /** Available log levels with labels and descriptions */
  availableLevels: typeof LOG_LEVEL_OPTIONS;
  /** Whether the preference is being loaded */
  loading: boolean;
  /** Error message if any */
  error: string | null;
  /** Whether a save operation is in progress */
  saving: boolean;
  /** Set the log level preference */
  setLevel: (level: LogLevelName) => Promise<void>;
}

/**
 * Hook for managing the global log level preference.
 * The setting persists across browser sessions and applies to both
 * frontend and backend logging.
 */
export function useLogLevelPreference(): UseLogLevelPreferenceResult {
  const [level, setLevelState] = useState<LogLevelName>(DEFAULT_LOG_LEVEL);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // Fetch the current preference
  const fetchPreference = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const response = await fetch("/api/preferences/log-level");
      if (!response.ok) {
        throw new Error(`Failed to fetch log level preference: ${response.statusText}`);
      }
      const data = (await response.json()) as { level: LogLevelName };
      setLevelState(data.level);
      // Also update the frontend logger
      setFrontendLogLevel(data.level);
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  // Set the preference
  const setLevel = useCallback(async (newLevel: LogLevelName) => {
    try {
      setSaving(true);
      setError(null);
      const response = await fetch("/api/preferences/log-level", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ level: newLevel }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.message || "Failed to save log level preference");
      }

      setLevelState(newLevel);
      // Also update the frontend logger
      setFrontendLogLevel(newLevel);
    } catch (err) {
      setError(String(err));
    } finally {
      setSaving(false);
    }
  }, []);

  // Initial fetch
  useEffect(() => {
    fetchPreference();
  }, [fetchPreference]);

  return {
    level,
    defaultLevel: DEFAULT_LOG_LEVEL,
    availableLevels: LOG_LEVEL_OPTIONS,
    loading,
    error,
    saving,
    setLevel,
  };
}
