/**
 * Dashboard section for SSH sessions.
 */

import type { SshSession } from "../types";
import { getEffectiveSshConnectionMode, getSshConnectionModeLabel, isPersistentSshSession } from "../utils";
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
              <button
                key={session.config.id}
                type="button"
                onClick={() => onSelect(session.config.id)}
                className="rounded-lg border border-gray-200 bg-white p-4 text-left transition-colors hover:border-gray-300 hover:shadow-sm dark:border-gray-700 dark:bg-gray-800 dark:hover:border-gray-600"
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
                  Mode: {getSshConnectionModeLabel(effectiveConnectionMode)}
                </p>
                {isPersistentSshSession(session) && (
                  <p className="mt-1 text-xs text-gray-500 dark:text-gray-400 truncate">
                    Persistent ID: {session.config.remoteSessionName}
                  </p>
                )}
              </button>
            );
          })}
        </div>
      )}
    </Card>
  );
}
