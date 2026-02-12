/**
 * Dashboard header component with title, settings, and action buttons.
 */

import type { DashboardViewMode } from "../types/preferences";
import { Button, GridIcon, ListIcon } from "./common";

export interface DashboardHeaderProps {
  version: string | null;
  viewMode: DashboardViewMode;
  onToggleViewMode: () => void;
  onOpenServerSettings: () => void;
  onOpenCreateWorkspace: () => void;
  onOpenCreateLoop: () => void;
  onOpenCreateChat: () => void;
}

export function DashboardHeader({
  version,
  viewMode,
  onToggleViewMode,
  onOpenServerSettings,
  onOpenCreateWorkspace,
  onOpenCreateLoop,
  onOpenCreateChat,
}: DashboardHeaderProps) {
  return (
    <header className="bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 flex-shrink-0 safe-area-top">
      <div className="px-4 sm:px-6 lg:px-8 py-3 sm:py-4">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div className="flex items-center justify-between sm:justify-start gap-2 sm:gap-4">
            <div>
              <h1 className="text-xl sm:text-2xl font-bold text-gray-900 dark:text-gray-100">
                Ralpher
              </h1>
              {version && (
                <p className="text-xs text-gray-500 dark:text-gray-400">
                  v{version}
                </p>
              )}
            </div>
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
          <div className="flex items-center gap-2 flex-shrink-0">
            {/* View mode toggle */}
            <div className="flex items-center rounded-md border border-gray-200 dark:border-gray-700 overflow-hidden">
              <button
                type="button"
                onClick={viewMode === "rows" ? undefined : onToggleViewMode}
                className={`p-1.5 sm:p-2 transition-colors ${
                  viewMode === "rows"
                    ? "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300"
                    : "bg-white text-gray-500 hover:bg-gray-100 dark:bg-gray-800 dark:text-gray-400 dark:hover:bg-gray-700"
                }`}
                title="Row view"
                aria-label="Switch to row view"
              >
                <ListIcon size="h-4 w-4" />
              </button>
              <button
                type="button"
                onClick={viewMode === "cards" ? undefined : onToggleViewMode}
                className={`p-1.5 sm:p-2 transition-colors ${
                  viewMode === "cards"
                    ? "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300"
                    : "bg-white text-gray-500 hover:bg-gray-100 dark:bg-gray-800 dark:text-gray-400 dark:hover:bg-gray-700"
                }`}
                title="Card view"
                aria-label="Switch to card view"
              >
                <GridIcon size="h-4 w-4" />
              </button>
            </div>
            {/* Button group: always side-by-side */}
            <div className="flex gap-2">
              <Button
                variant="secondary"
                onClick={onOpenCreateWorkspace}
                className="whitespace-nowrap"
              >
                New Workspace
              </Button>
              <Button
                variant="secondary"
                onClick={onOpenCreateChat}
                className="whitespace-nowrap"
              >
                New Chat
              </Button>
              <Button onClick={onOpenCreateLoop} className="whitespace-nowrap">
                New Loop
              </Button>
            </div>
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
