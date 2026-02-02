/**
 * Workspace persistence layer for Ralph Loops Management System.
 * Handles reading and writing workspace data to SQLite database.
 */

import type { Workspace, WorkspaceWithLoopCount } from "../types/workspace";
import type { ServerSettings } from "../types/settings";
import { getDefaultServerSettings } from "../types/settings";
import { getDatabase } from "./database";

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
  const db = getDatabase();
  const row = workspaceToRow(workspace);

  const columns = Object.keys(row);
  const placeholders = columns.map(() => "?").join(", ");
  const values = Object.values(row) as (string | number | null)[];

  const sql = `INSERT INTO workspaces (${columns.join(", ")}) VALUES (${placeholders})`;
  const stmt = db.prepare(sql);
  stmt.run(...values);
}

/**
 * Get a workspace by ID.
 */
export async function getWorkspace(id: string): Promise<Workspace | null> {
  const db = getDatabase();
  const stmt = db.prepare("SELECT * FROM workspaces WHERE id = ?");
  const row = stmt.get(id) as Record<string, unknown> | null;
  return row ? rowToWorkspace(row) : null;
}

/**
 * Get a workspace by directory path.
 */
export async function getWorkspaceByDirectory(directory: string): Promise<Workspace | null> {
  const db = getDatabase();
  const stmt = db.prepare("SELECT * FROM workspaces WHERE directory = ?");
  const row = stmt.get(directory) as Record<string, unknown> | null;
  return row ? rowToWorkspace(row) : null;
}

/**
 * List all workspaces with loop counts, sorted by name alphabetically.
 */
export async function listWorkspaces(): Promise<WorkspaceWithLoopCount[]> {
  const db = getDatabase();
  const stmt = db.prepare(`
    SELECT w.*, COUNT(l.id) as loop_count
    FROM workspaces w
    LEFT JOIN loops l ON l.workspace_id = w.id
    GROUP BY w.id
    ORDER BY w.name COLLATE NOCASE ASC
  `);
  const rows = stmt.all() as Array<Record<string, unknown>>;
  return rows.map((row) => ({
    ...rowToWorkspace(row),
    loopCount: (row["loop_count"] as number) ?? 0,
  }));
}

/**
 * Update a workspace.
 */
export async function updateWorkspace(
  id: string, 
  updates: Partial<Pick<Workspace, "name" | "serverSettings">>
): Promise<Workspace | null> {
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
    return getWorkspace(id);
  }
  
  // Always update updated_at
  setClauses.push("updated_at = ?");
  values.push(new Date().toISOString());
  
  values.push(id);
  
  const sql = `UPDATE workspaces SET ${setClauses.join(", ")} WHERE id = ?`;
  const stmt = db.prepare(sql);
  stmt.run(...values);
  
  return getWorkspace(id);
}

/**
 * Delete a workspace by ID.
 * Only succeeds if the workspace has no associated loops.
 * 
 * @returns true if deleted, false if not found or has loops
 */
export async function deleteWorkspace(id: string): Promise<{ success: boolean; reason?: string }> {
  const db = getDatabase();
  
  // Check if workspace exists
  const workspace = await getWorkspace(id);
  if (!workspace) {
    return { success: false, reason: "Workspace not found" };
  }
  
  // Check if workspace has any loops
  const loopCountStmt = db.prepare("SELECT COUNT(*) as count FROM loops WHERE workspace_id = ?");
  const loopCountRow = loopCountStmt.get(id) as { count: number };
  
  if (loopCountRow.count > 0) {
    return { 
      success: false, 
      reason: `Workspace has ${loopCountRow.count} loop(s). Delete all loops first.` 
    };
  }
  
  // Delete the workspace
  db.run("DELETE FROM workspaces WHERE id = ?", [id]);
  return { success: true };
}

/**
 * Get the count of loops for a workspace.
 */
export async function getWorkspaceLoopCount(workspaceId: string): Promise<number> {
  const db = getDatabase();
  const stmt = db.prepare("SELECT COUNT(*) as count FROM loops WHERE workspace_id = ?");
  const row = stmt.get(workspaceId) as { count: number };
  return row.count;
}

/**
 * Touch a workspace to update its updated_at timestamp.
 * Called when a loop is created in this workspace.
 */
export async function touchWorkspace(id: string): Promise<void> {
  const db = getDatabase();
  db.run("UPDATE workspaces SET updated_at = ? WHERE id = ?", [
    new Date().toISOString(),
    id,
  ]);
}
