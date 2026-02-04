/**
 * Workspace persistence layer for Ralph Loops Management System.
 * Handles reading and writing workspace data to SQLite database.
 */

import type { Workspace, WorkspaceWithLoopCount } from "../types/workspace";
import type { ServerSettings } from "../types/settings";
import { getDefaultServerSettings } from "../types/settings";
import { getDatabase } from "./database";
import { createLogger } from "../core/logger";

const log = createLogger("persistence:workspaces");

/**
 * Convert a Workspace to a flat object for database insertion.
 */
function workspaceToRow(workspace: Workspace): Record<string, unknown> {
  return {
    id: workspace.id,
    name: workspace.name,
    directory: workspace.directory,
    server_settings: JSON.stringify(workspace.serverSettings),
    created_at: workspace.createdAt,
    updated_at: workspace.updatedAt,
  };
}

/**
 * Parse server settings from database, with fallback to defaults.
 */
function parseServerSettings(jsonString: string | null): ServerSettings {
  if (!jsonString) {
    return getDefaultServerSettings();
  }
  try {
    const parsed = JSON.parse(jsonString);
    const defaults = getDefaultServerSettings();
    return {
      ...defaults,
      ...parsed,
      useHttps: parsed.useHttps ?? defaults.useHttps,
      allowInsecure: parsed.allowInsecure ?? defaults.allowInsecure,
    };
  } catch {
    return getDefaultServerSettings();
  }
}

/**
 * Convert a database row to a Workspace object.
 */
function rowToWorkspace(row: Record<string, unknown>): Workspace {
  return {
    id: row["id"] as string,
    name: row["name"] as string,
    directory: row["directory"] as string,
    serverSettings: parseServerSettings(row["server_settings"] as string | null),
    createdAt: row["created_at"] as string,
    updatedAt: row["updated_at"] as string,
  };
}

/**
 * Create a new workspace.
 */
export async function createWorkspace(workspace: Workspace): Promise<void> {
  log.debug("Creating workspace", { id: workspace.id, name: workspace.name, directory: workspace.directory });
  const db = getDatabase();
  const row = workspaceToRow(workspace);

  const columns = Object.keys(row);
  const placeholders = columns.map(() => "?").join(", ");
  const values = Object.values(row) as (string | number | null)[];

  const sql = `INSERT INTO workspaces (${columns.join(", ")}) VALUES (${placeholders})`;
  const stmt = db.prepare(sql);
  stmt.run(...values);
  log.info("Workspace created", { id: workspace.id, name: workspace.name });
}

/**
 * Get a workspace by ID.
 */
export async function getWorkspace(id: string): Promise<Workspace | null> {
  log.debug("Getting workspace", { id });
  const db = getDatabase();
  const stmt = db.prepare("SELECT * FROM workspaces WHERE id = ?");
  const row = stmt.get(id) as Record<string, unknown> | null;
  if (!row) {
    log.trace("Workspace not found", { id });
    return null;
  }
  const workspace = rowToWorkspace(row);
  log.trace("Workspace retrieved", { id, name: workspace.name });
  return workspace;
}

/**
 * Get a workspace by directory path.
 */
export async function getWorkspaceByDirectory(directory: string): Promise<Workspace | null> {
  log.debug("Getting workspace by directory", { directory });
  const db = getDatabase();
  const stmt = db.prepare("SELECT * FROM workspaces WHERE directory = ?");
  const row = stmt.get(directory) as Record<string, unknown> | null;
  if (!row) {
    log.trace("Workspace not found for directory", { directory });
    return null;
  }
  const workspace = rowToWorkspace(row);
  log.trace("Workspace found for directory", { directory, id: workspace.id, name: workspace.name });
  return workspace;
}

/**
 * List all workspaces with loop counts, sorted by name alphabetically.
 */
export async function listWorkspaces(): Promise<WorkspaceWithLoopCount[]> {
  log.debug("Listing all workspaces");
  const db = getDatabase();
  const stmt = db.prepare(`
    SELECT w.*, COUNT(l.id) as loop_count
    FROM workspaces w
    LEFT JOIN loops l ON l.workspace_id = w.id
    GROUP BY w.id
    ORDER BY w.name COLLATE NOCASE ASC
  `);
  const rows = stmt.all() as Array<Record<string, unknown>>;
  const workspaces = rows.map((row) => ({
    ...rowToWorkspace(row),
    loopCount: (row["loop_count"] as number) ?? 0,
  }));
  log.trace("Workspaces listed", { count: workspaces.length });
  return workspaces;
}

/**
 * Update a workspace.
 */
export async function updateWorkspace(
  id: string, 
  updates: Partial<Pick<Workspace, "name" | "serverSettings">>
): Promise<Workspace | null> {
  log.debug("Updating workspace", { id, hasNameUpdate: updates.name !== undefined, hasSettingsUpdate: updates.serverSettings !== undefined });
  const db = getDatabase();
  
  // Build the update query dynamically based on provided fields
  const setClauses: string[] = [];
  const values: (string | number | null)[] = [];
  
  if (updates.name !== undefined) {
    setClauses.push("name = ?");
    values.push(updates.name);
  }
  
  if (updates.serverSettings !== undefined) {
    setClauses.push("server_settings = ?");
    values.push(JSON.stringify(updates.serverSettings));
  }
  
  if (setClauses.length === 0) {
    // No updates provided, just return the existing workspace
    log.trace("No updates provided, returning existing workspace", { id });
    return getWorkspace(id);
  }
  
  // Always update updated_at
  setClauses.push("updated_at = ?");
  values.push(new Date().toISOString());
  
  values.push(id);
  
  const sql = `UPDATE workspaces SET ${setClauses.join(", ")} WHERE id = ?`;
  const stmt = db.prepare(sql);
  stmt.run(...values);
  
  log.trace("Workspace updated", { id });
  return getWorkspace(id);
}

/**
 * Delete a workspace by ID.
 * Only succeeds if the workspace has no associated loops.
 * 
 * @returns true if deleted, false if not found or has loops
 */
export async function deleteWorkspace(id: string): Promise<{ success: boolean; reason?: string }> {
  log.debug("Deleting workspace", { id });
  const db = getDatabase();
  
  // Check if workspace exists
  const workspace = await getWorkspace(id);
  if (!workspace) {
    log.trace("Workspace not found for deletion", { id });
    return { success: false, reason: "Workspace not found" };
  }
  
  // Check if workspace has any loops
  const loopCountStmt = db.prepare("SELECT COUNT(*) as count FROM loops WHERE workspace_id = ?");
  const loopCountRow = loopCountStmt.get(id) as { count: number };
  
  if (loopCountRow.count > 0) {
    log.warn("Cannot delete workspace with loops", { id, loopCount: loopCountRow.count });
    return { 
      success: false, 
      reason: `Workspace has ${loopCountRow.count} loop(s). Delete all loops first.` 
    };
  }
  
  // Delete the workspace
  db.run("DELETE FROM workspaces WHERE id = ?", [id]);
  log.info("Workspace deleted", { id, name: workspace.name });
  return { success: true };
}

/**
 * Get the count of loops for a workspace.
 */
export async function getWorkspaceLoopCount(workspaceId: string): Promise<number> {
  log.trace("Getting workspace loop count", { workspaceId });
  const db = getDatabase();
  const stmt = db.prepare("SELECT COUNT(*) as count FROM loops WHERE workspace_id = ?");
  const row = stmt.get(workspaceId) as { count: number };
  log.trace("Workspace loop count retrieved", { workspaceId, count: row.count });
  return row.count;
}

/**
 * Touch a workspace to update its updated_at timestamp.
 * Called when a loop is created in this workspace.
 */
export async function touchWorkspace(id: string): Promise<void> {
  log.trace("Touching workspace", { id });
  const db = getDatabase();
  db.run("UPDATE workspaces SET updated_at = ? WHERE id = ?", [
    new Date().toISOString(),
    id,
  ]);
}
