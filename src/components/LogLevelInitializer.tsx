/**
 * LogLevelInitializer component.
 * Fetches the log level preference on app startup and applies it to the frontend logger.
 * This ensures the frontend logger has the correct log level before any components render.
 */

import { useEffect, useState, type ReactNode } from "react";
import { setLogLevel, type LogLevelName, DEFAULT_LOG_LEVEL } from "../lib/logger";

interface LogLevelInitializerProps {
  children: ReactNode;
}

/**
 * Fetches the log level preference and applies it to the frontend logger.
 * Renders children immediately (doesn't block on loading).
 */
export function LogLevelInitializer({ children }: LogLevelInitializerProps) {
  const [initialized, setInitialized] = useState(false);

  useEffect(() => {
    // Only initialize once
    if (initialized) return;

    async function initLogLevel() {
      try {
        const response = await fetch("/api/preferences/log-level");
        if (response.ok) {
          const data = (await response.json()) as { level: LogLevelName };
          setLogLevel(data.level);
        } else {
          // Use default if fetch fails
          setLogLevel(DEFAULT_LOG_LEVEL);
        }
      } catch {
        // Use default if fetch fails
        setLogLevel(DEFAULT_LOG_LEVEL);
      } finally {
        setInitialized(true);
      }
    }

    initLogLevel();
  }, [initialized]);

  // Render children immediately - don't block on log level loading
  return <>{children}</>;
}

export default LogLevelInitializer;
