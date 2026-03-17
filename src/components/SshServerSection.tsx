import type { SshServer, SshServerSession } from "../types";
import { getEffectiveSshConnectionMode, getSshConnectionModeLabel, isPersistentSshSession } from "../utils";
import { Badge, Button, Card } from "./common";

function getBadgeVariant(status: SshServerSession["state"]["status"]) {
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

export interface SshServerSectionProps {
  servers: SshServer[];
  sessionsByServerId: Record<string, SshServerSession[]>;
  loading: boolean;
  error: string | null;
  hasStoredCredential: (serverId: string) => boolean;
  onOpenCreateServer: () => void;
  onOpenEditServer: (server: SshServer) => void;
  onDeleteServer: (serverId: string) => Promise<void>;
  onCreateSession: (server: SshServer) => void;
  onSelectSession: (sessionId: string) => void;
}

export function SshServerSection({
  servers,
  sessionsByServerId,
  loading,
  error,
  hasStoredCredential,
  onOpenCreateServer,
  onOpenEditServer,
  onDeleteServer,
  onCreateSession,
  onSelectSession,
}: SshServerSectionProps) {
  return (
    <Card>
      <div className="mb-4 flex items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">Standalone SSH Servers</h3>
          <p className="text-xs text-gray-500 dark:text-gray-400">
            Saved server metadata stays on the Ralpher server, while passwords stay encrypted in this browser.
          </p>
        </div>
        <Button size="sm" onClick={onOpenCreateServer}>
          Add Server
        </Button>
      </div>
      {loading ? (
        <p className="text-sm text-gray-500 dark:text-gray-400">Loading standalone SSH servers...</p>
      ) : error ? (
        <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
      ) : servers.length === 0 ? (
        <p className="text-sm text-gray-500 dark:text-gray-400">
          No standalone SSH servers yet. Add one to create saved remote sessions outside a workspace.
        </p>
      ) : (
        <div className="space-y-4">
          {servers.map((server) => {
            const sessions = sessionsByServerId[server.config.id] ?? [];
            return (
              <div
                key={server.config.id}
                className="rounded-lg border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-neutral-800"
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h4 className="text-sm font-semibold text-gray-900 dark:text-gray-100">
                        {server.config.name}
                      </h4>
                      <Badge variant={hasStoredCredential(server.config.id) ? "success" : "warning"}>
                        {hasStoredCredential(server.config.id) ? "password saved" : "password needed"}
                      </Badge>
                    </div>
                    <p className="mt-1 text-xs font-mono text-gray-500 dark:text-gray-400">
                      {server.config.username}@{server.config.address}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button size="sm" variant="ghost" onClick={() => onOpenEditServer(server)}>
                      Edit
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => onCreateSession(server)}>
                      New Session
                    </Button>
                    <Button size="sm" variant="danger" onClick={() => void onDeleteServer(server.config.id)}>
                      Delete
                    </Button>
                  </div>
                </div>
                <div className="mt-4">
                  {sessions.length === 0 ? (
                    <p className="text-xs text-gray-500 dark:text-gray-400">
                      No standalone sessions for this server yet.
                    </p>
                  ) : (
                    <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                      {sessions.map((session) => {
                        const effectiveConnectionMode = getEffectiveSshConnectionMode(session);
                        return (
                          <button
                            key={session.config.id}
                            type="button"
                            onClick={() => onSelectSession(session.config.id)}
                            className="rounded-md border border-gray-200 bg-gray-50 p-3 text-left transition-colors hover:border-gray-300 hover:bg-white dark:border-gray-700 dark:bg-neutral-900/40 dark:hover:border-gray-600 dark:hover:bg-neutral-900"
                          >
                            <div className="flex items-start justify-between gap-3">
                              <div className="min-w-0">
                                <p className="truncate text-sm font-medium text-gray-900 dark:text-gray-100">
                                  {session.config.name}
                                </p>
                                <p className="mt-1 truncate text-xs text-gray-500 dark:text-gray-400">
                                  Mode: {getSshConnectionModeLabel(effectiveConnectionMode)}
                                </p>
                                {isPersistentSshSession(session) && (
                                  <p className="mt-1 truncate text-xs font-mono text-gray-500 dark:text-gray-400">
                                    Persistent ID: {session.config.remoteSessionName}
                                  </p>
                                )}
                              </div>
                              <Badge variant={getBadgeVariant(session.state.status)}>
                                {session.state.status}
                              </Badge>
                            </div>
                          </button>
                        );
                      })}
                    </div>
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
