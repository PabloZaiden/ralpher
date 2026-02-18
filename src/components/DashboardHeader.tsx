/**
 * Dashboard header component with title, settings, and action buttons.
 */

import type { DashboardViewMode } from "../types/preferences";
import { Button, GearIcon, GridIcon, ListIcon } from "./common";

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
          <div className="flex items-center gap-2 sm:gap-4">
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
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            {/* View mode toggle */}
            <div className="flex items-center rounded-md sm:border sm:border-gray-200 sm:dark:border-gray-700 overflow-hidden">
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
            {/* App Settings Button */}
            <Button
              variant="ghost"
              size="sm"
              onClick={onOpenServerSettings}
              title="App Settings"
              aria-label="App Settings"
              className="px-1.5"
            >
              <GearIcon size="h-5 w-5" />
            </Button>
          </div>
        </div>
      </div>
    </header>
  );
}

