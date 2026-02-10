/**
 * Dashboard header component with title, settings, connection status, and action buttons.
 */

import type { WebSocketConnectionStatus } from "../hooks/useWebSocket";
import { Button } from "./common";

export interface DashboardHeaderProps {
  version: string | null;
  connectionStatus: WebSocketConnectionStatus;
  onOpenServerSettings: () => void;
  onOpenCreateWorkspace: () => void;
  onOpenCreateLoop: () => void;
}

export function DashboardHeader({
  version,
  connectionStatus,
  onOpenServerSettings,
  onOpenCreateWorkspace,
  onOpenCreateLoop,
}: DashboardHeaderProps) {
  return (
    <header className="bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 flex-shrink-0 safe-area-top">
      <div className="px-4 sm:px-6 lg:px-8 py-3 sm:py-4">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div className="flex items-center justify-between sm:justify-start gap-2 sm:gap-4">
            <h1 className="text-xl sm:text-2xl font-bold text-gray-900 dark:text-gray-100">
              Ralpher
              {version && (
                <span className="ml-2 text-xs font-normal text-gray-500 dark:text-gray-400">
                  v{version}
                </span>
              )}
            </h1>
            {/* App Settings Button */}
            <button
              type="button"
              onClick={onOpenServerSettings}
              className="flex items-center gap-2 px-2 sm:px-3 py-1 sm:py-1.5 text-xs sm:text-sm rounded-md bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors"
              title="App Settings"
            >
              <span className="text-gray-500 dark:text-gray-400 font-medium hidden sm:inline">Settings</span>
              <GearIcon />
            </button>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            {/* WebSocket Status indicator - Ralpher connection */}
            <div className="flex items-center gap-2 text-xs sm:text-sm px-2 sm:px-3 py-1 sm:py-1.5 rounded-md bg-gray-100 dark:bg-gray-800">
              <span className="text-gray-500 dark:text-gray-400 font-medium hidden sm:inline">Ralpher:</span>
              <span
                className={`h-2 w-2 rounded-full ${
                  connectionStatus === "open"
                    ? "bg-green-500"
                    : connectionStatus === "connecting"
                    ? "bg-yellow-500"
                    : "bg-red-500"
                }`}
              />
              <span className="text-gray-700 dark:text-gray-300">
                {connectionStatus === "open"
                  ? "Connected"
                  : connectionStatus === "connecting"
                  ? "Connecting..."
                  : "Disconnected"}
              </span>
            </div>
            <Button
              variant="secondary"
              onClick={onOpenCreateWorkspace}
              className="flex-1 sm:flex-none"
            >
              New Workspace
            </Button>
            <Button onClick={onOpenCreateLoop} className="flex-1 sm:flex-none">
              New Loop
            </Button>
          </div>
        </div>
      </div>
    </header>
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
