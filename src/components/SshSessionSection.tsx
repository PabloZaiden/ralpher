/**
 * Dashboard section for SSH sessions.
 */

import type { SshSession } from "../types";
import { Badge, Card } from "./common";

export interface SshSessionSectionProps {
  sessions: SshSession[];
  loading: boolean;
  error: string | null;
  onSelect: (sessionId: string) => void;
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
}: SshSessionSectionProps) {
  return (
    <div className="px-4 sm:px-6 lg:px-8 py-4 border-b border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-900">
      <Card title="SSH Sessions">
        {loading ? (
          <p className="text-sm text-gray-500 dark:text-gray-400">Loading SSH sessions...</p>
        ) : error ? (
          <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
        ) : sessions.length === 0 ? (
          <p className="text-sm text-gray-500 dark:text-gray-400">
            No SSH sessions yet. Create one to start a persistent remote terminal.
          </p>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
            {sessions.map((session) => (
              <button
                key={session.config.id}
                type="button"
                onClick={() => onSelect(session.config.id)}
                className="rounded-lg border border-gray-200 dark:border-gray-700 p-4 text-left hover:border-gray-300 hover:shadow-sm dark:hover:border-gray-600 transition-colors bg-white dark:bg-gray-800"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h3 className="font-medium text-gray-900 dark:text-gray-100 truncate">
                      {session.config.name}
                    </h3>
                    <p className="mt-1 text-xs font-mono text-gray-500 dark:text-gray-400 truncate">
                      {session.config.directory}
                    </p>
                  </div>
                  <Badge variant={getBadgeVariant(session.state.status)}>
                    {session.state.status}
                  </Badge>
                </div>
                <p className="mt-3 text-xs text-gray-500 dark:text-gray-400">
                  Last connected: {session.state.lastConnectedAt ?? "Never"}
                </p>
                <p className="mt-1 text-xs text-gray-500 dark:text-gray-400 truncate">
                  tmux: {session.config.remoteSessionName}
                </p>
              </button>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}
