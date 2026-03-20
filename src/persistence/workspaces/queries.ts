/**
 * Query operations for workspace persistence.
 *
 * Note: Most exported functions are marked `async` despite using synchronous
 * bun:sqlite APIs. This is intentional for interface consistency — callers
 * already `await` these functions, and the persistence layer may switch to
 * async storage in the future.
 */

import type { Workspace } from "../../types/workspace";
import type { ServerSettings } from "../../types/settings";
import { getServerFingerprint } from "../../types/settings";
import { getDatabase } from "../database";
import { createLogger } from "../../core/logger";
import { rowToWorkspace } from "./helpers";

const log = createLogger("persistence:workspaces");

/**
 * List workspaces by directory path.
 *
 * @deprecated Prefer looking up workspaces by ID. This function exists for
 * backward-compatible API endpoints that accept a directory path.
 */
export async function listWorkspacesByDirectory(directory: string): Promise<Workspace[]> {
  log.debug("Listing workspaces by directory", { directory });
  const db = getDatabase();
  const stmt = db.prepare(`
    SELECT * FROM workspaces
    WHERE directory = ?
    ORDER BY name COLLATE NOCASE ASC, created_at ASC
  `);
  const rows = stmt.all(directory) as Array<Record<string, unknown>>;
  return rows.map(rowToWorkspace);
}

/**
 * Get a workspace by directory path when the match is unambiguous.
 *
 * @deprecated Prefer looking up workspaces by ID. This function exists for
 * backward-compatible API endpoints that accept a directory path.
 */
export async function getWorkspaceByDirectory(directory: string): Promise<Workspace | null> {
  const matches = await listWorkspacesByDirectory(directory);
  if (matches.length === 0) {
    log.debug("Workspace not found for directory", { directory });
    return null;
  }
  if (matches.length > 1) {
    throw new Error(`Multiple workspaces found for directory: ${directory}`);
  }
  return matches[0] ?? null;
}

/**
 * Get a workspace by directory and server settings.
 *
 * @deprecated Prefer looking up workspaces by ID. Multiple workspaces may
 * share the same directory and server fingerprint after migration 13 relaxed
 * the unique constraint. This function throws if multiple matches are found
 * to surface ambiguity instead of returning a nondeterministic result.
 */
export async function getWorkspaceByDirectoryAndServerSettings(
  directory: string,
  serverSettings: ServerSettings,
): Promise<Workspace | null> {
  const serverFingerprint = getServerFingerprint(serverSettings);
  log.debug("Getting workspace by directory and server fingerprint", {
    directory,
    serverFingerprint,
  });
  const db = getDatabase();
  const stmt = db.prepare(`
    SELECT * FROM workspaces
    WHERE directory = ? AND server_fingerprint = ?
  `);
  const rows = stmt.all(directory, serverFingerprint) as Record<string, unknown>[];
  if (rows.length === 0) {
    return null;
  }
  if (rows.length > 1) {
    throw new Error(
      `Multiple workspaces found for directory "${directory}" with server fingerprint "${serverFingerprint}". Use workspace ID for lookup instead.`,
    );
  }
  return rowToWorkspace(rows[0]!);
}

/**
 * List all workspaces sorted by name alphabetically.
 */
export async function listWorkspaces(): Promise<Workspace[]> {
  log.debug("Listing all workspaces");
  const db = getDatabase();
  const stmt = db.prepare(`
    SELECT * FROM workspaces
    ORDER BY name COLLATE NOCASE ASC
  `);
  const rows = stmt.all() as Array<Record<string, unknown>>;
  const workspaces = rows.map(rowToWorkspace);
  log.debug("Workspaces listed", { count: workspaces.length });
  return workspaces;
}

/**
 * Get the count of loops for a workspace.
 */
export async function getWorkspaceLoopCount(workspaceId: string): Promise<number> {
  log.debug("Getting workspace loop count", { workspaceId });
  const db = getDatabase();
  const stmt = db.prepare("SELECT COUNT(*) as count FROM loops WHERE workspace_id = ?");
  const row = stmt.get(workspaceId) as { count: number };
  log.debug("Workspace loop count retrieved", { workspaceId, count: row.count });
  return row.count;
}

/**
 * Touch a workspace to update its updated_at timestamp.
 * Called when a loop is created in this workspace.
 */
export async function touchWorkspace(id: string): Promise<void> {
  log.debug("Touching workspace", { id });
  const db = getDatabase();
  db.run("UPDATE workspaces SET updated_at = ? WHERE id = ?", [
    new Date().toISOString(),
    id,
  ]);
}
