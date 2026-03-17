/**
 * Dashboard section for SSH sessions.
 */

import type { SshSession } from "../types";
import { getEffectiveSshConnectionMode, getSshConnectionModeLabel, isPersistentSshSession } from "../utils";
import { Badge, Card, EditIcon } from "./common";

export interface SshSessionSectionProps {
  sessions: SshSession[];
  loading: boolean;
  error: string | null;
  onSelect: (sessionId: string) => void;
  onRename: (sessionId: string) => void;
}

function getBadgeVariant(status: SshSession["state"]["status"]) {
  switch (status) {
    case "connected":
      return "success";
    case "connecting":
      return "info";
    case "failed":
      return "error";
    case "disconnected":
      return "warning";
    default:
      return "default";
  }
}

export function SshSessionSection({
  sessions,
  loading,
  error,
  onSelect,
  onRename,
}: SshSessionSectionProps) {
  return (
    <Card>
      {loading ? (
        <p className="text-sm text-gray-500 dark:text-gray-400">Loading SSH sessions...</p>
      ) : error ? (
        <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
      ) : sessions.length === 0 ? (
        <p className="text-sm text-gray-500 dark:text-gray-400">
          No SSH sessions yet. Create one to start a saved remote terminal.
        </p>
      ) : (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
          {sessions.map((session) => {
            const effectiveConnectionMode = getEffectiveSshConnectionMode(session);
            return (
              <div
                key={session.config.id}
                className="relative rounded-lg border border-gray-200 bg-white transition-colors hover:border-gray-300 hover:shadow-sm dark:border-gray-700 dark:bg-neutral-800 dark:hover:border-gray-600"
              >
                <button
                  type="button"
                  onClick={() => onSelect(session.config.id)}
                  className="absolute inset-0 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 dark:focus:ring-offset-gray-800"
                  aria-label={`Open SSH session ${session.config.name}`}
                />
                <div className="pointer-events-none relative z-10 p-4">
                  <div className="flex items-start justify-between gap-3 pr-8">
                    <div className="min-w-0">
                      <h3 className="truncate font-medium text-gray-900 dark:text-gray-100">
                        {session.config.name}
                      </h3>
                      <p className="mt-1 truncate text-xs font-mono text-gray-500 dark:text-gray-400">
                        {session.config.directory}
                      </p>
                    </div>
                    <Badge variant={getBadgeVariant(session.state.status)}>
                      {session.state.status}
                    </Badge>
                  </div>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      onRename(session.config.id);
                    }}
                    className="pointer-events-auto absolute right-4 top-4 rounded p-0.5 text-gray-400 hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-neutral-700 dark:hover:text-gray-300"
                    aria-label="Rename SSH session"
                    title="Rename SSH session"
                  >
                    <EditIcon size="h-3.5 w-3.5" />
                  </button>
                  <p className="mt-3 text-xs text-gray-500 dark:text-gray-400">
                    Last connected: {session.state.lastConnectedAt ?? "Never"}
                  </p>
                  <p className="mt-1 truncate text-xs text-gray-500 dark:text-gray-400">
                    Mode: {getSshConnectionModeLabel(effectiveConnectionMode)}
                  </p>
                  {isPersistentSshSession(session) && (
                    <p className="mt-1 truncate text-xs text-gray-500 dark:text-gray-400">
                      Persistent ID: {session.config.remoteSessionName}
                    </p>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </Card>
  );
}
