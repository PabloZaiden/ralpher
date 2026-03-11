/**
 * SSH session persistence layer.
 */

import type { SshSession } from "../types";
import { getDatabase } from "./database";
import { createLogger } from "../core/logger";

const log = createLogger("persistence:ssh-sessions");

const ALLOWED_SSH_SESSION_COLUMNS = new Set([
  "id",
  "name",
  "workspace_id",
  "directory",
  "remote_session_name",
  "created_at",
  "updated_at",
  "status",
  "last_connected_at",
  "error_message",
]);

function validateColumnNames(columns: string[]): void {
  for (const column of columns) {
    if (!ALLOWED_SSH_SESSION_COLUMNS.has(column)) {
      throw new Error(`Invalid SSH session column name: ${column}`);
    }
  }
}

function sshSessionToRow(session: SshSession): Record<string, unknown> {
  return {
    id: session.config.id,
    name: session.config.name,
    workspace_id: session.config.workspaceId,
    directory: session.config.directory,
    remote_session_name: session.config.remoteSessionName,
    created_at: session.config.createdAt,
    updated_at: session.config.updatedAt,
    status: session.state.status,
    last_connected_at: session.state.lastConnectedAt ?? null,
    error_message: session.state.error ?? null,
  };
}

function rowToSshSession(row: Record<string, unknown>): SshSession {
  return {
    config: {
      id: row["id"] as string,
      name: row["name"] as string,
      workspaceId: row["workspace_id"] as string,
      directory: row["directory"] as string,
      remoteSessionName: row["remote_session_name"] as string,
      createdAt: row["created_at"] as string,
      updatedAt: row["updated_at"] as string,
    },
    state: {
      status: row["status"] as SshSession["state"]["status"],
      lastConnectedAt: (row["last_connected_at"] as string | null) ?? undefined,
      error: (row["error_message"] as string | null) ?? undefined,
    },
  };
}

export async function saveSshSession(session: SshSession): Promise<void> {
  const db = getDatabase();
  const row = sshSessionToRow(session);
  const columns = Object.keys(row);
  validateColumnNames(columns);

  const placeholders = columns.map(() => "?").join(", ");
  const values = Object.values(row) as Array<string | null>;
  const updateClause = columns
    .filter((column) => column !== "id")
    .map((column) => `${column} = excluded.${column}`)
    .join(", ");

  db.run(
    `INSERT INTO ssh_sessions (${columns.join(", ")}) VALUES (${placeholders})
     ON CONFLICT(id) DO UPDATE SET ${updateClause}`,
    values,
  );
  log.debug("Saved SSH session", {
    id: session.config.id,
    workspaceId: session.config.workspaceId,
    status: session.state.status,
  });
}

export async function getSshSession(id: string): Promise<SshSession | null> {
  const db = getDatabase();
  const row = db.query("SELECT * FROM ssh_sessions WHERE id = ?").get(id) as Record<string, unknown> | null;
  return row ? rowToSshSession(row) : null;
}

export async function listSshSessions(): Promise<SshSession[]> {
  const db = getDatabase();
  const rows = db.query("SELECT * FROM ssh_sessions ORDER BY created_at DESC").all() as Record<string, unknown>[];
  return rows.map(rowToSshSession);
}

export async function listSshSessionsByWorkspace(workspaceId: string): Promise<SshSession[]> {
  const db = getDatabase();
  const rows = db.query(
    "SELECT * FROM ssh_sessions WHERE workspace_id = ? ORDER BY created_at DESC",
  ).all(workspaceId) as Record<string, unknown>[];
  return rows.map(rowToSshSession);
}

export async function countSshSessionsByWorkspace(workspaceId: string): Promise<number> {
  const db = getDatabase();
  const row = db.query("SELECT COUNT(*) AS count FROM ssh_sessions WHERE workspace_id = ?").get(workspaceId) as {
    count?: number;
  } | null;
  return row?.count ?? 0;
}

export async function deleteSshSession(id: string): Promise<boolean> {
  const db = getDatabase();
  const result = db.run("DELETE FROM ssh_sessions WHERE id = ?", [id]);
  return result.changes > 0;
}
