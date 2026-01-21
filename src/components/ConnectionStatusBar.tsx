/**
 * ConnectionStatusBar component for displaying server connection status.
 * Shows the current connection mode and status in a compact bar.
 */

import type { ConnectionStatus, ServerSettings } from "../types/settings";

export interface ConnectionStatusBarProps {
  /** Current server settings */
  settings: ServerSettings | null;
  /** Current connection status */
  status: ConnectionStatus | null;
  /** Whether settings are loading */
  loading?: boolean;
  /** Callback when clicked (to open settings) */
  onClick?: () => void;
}

/**
 * ConnectionStatusBar displays the current server connection status.
 * Clicking opens the settings modal.
 */
export function ConnectionStatusBar({
  settings,
  status,
  loading = false,
  onClick,
}: ConnectionStatusBarProps) {
  // Loading state
  if (loading || !settings) {
    return (
      <button
        type="button"
        onClick={onClick}
        className="flex items-center gap-2 px-3 py-1.5 text-sm rounded-md bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors"
      >
        <span className="font-medium">OpenCode:</span>
        <span className="w-2 h-2 rounded-full bg-gray-400 animate-pulse" />
        <span>Loading...</span>
        <GearIcon />
      </button>
    );
  }

  // Determine status indicator color and text
  const isConnected = status?.connected ?? false;
  const hasError = !!status?.error;

  let indicatorColor: string;
  let statusText: string;

  if (hasError) {
    indicatorColor = "bg-red-500";
    statusText = "Error";
  } else if (isConnected) {
    indicatorColor = "bg-green-500";
    statusText = settings.mode === "spawn" ? "Local Server" : "Connected";
  } else {
    indicatorColor = "bg-yellow-500";
    statusText = settings.mode === "spawn" ? "Local (Idle)" : "Disconnected";
  }

  // Mode label
  const modeLabel = settings.mode === "spawn" 
    ? "Spawn" 
    : settings.hostname 
      ? `${settings.hostname}:${settings.port ?? 4096}`
      : "Remote";

  return (
    <button
      type="button"
      onClick={onClick}
      className="flex items-center gap-2 px-3 py-1.5 text-sm rounded-md bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors"
      title={hasError ? `Error: ${status?.error}` : `Server: ${modeLabel}`}
    >
      {/* OpenCode label */}
      <span className="text-gray-500 dark:text-gray-400 font-medium">OpenCode:</span>
      
      {/* Status indicator */}
      <span className={`w-2 h-2 rounded-full ${indicatorColor}`} />
      
      {/* Status text */}
      <span>{statusText}</span>
      
      {/* Mode/Server info */}
      <span className="text-gray-500 dark:text-gray-400 hidden sm:inline">
        ({modeLabel})
      </span>
      
      {/* Gear icon */}
      <GearIcon />
    </button>
  );
}

/**
 * Simple gear icon component.
 */
function GearIcon() {
  return (
    <svg
      className="w-4 h-4 text-gray-500 dark:text-gray-400"
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={2}
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"
      />
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
      />
    </svg>
  );
}

export default ConnectionStatusBar;
