/**
 * Workspace persistence layer for Ralph Loops Management System.
 * Handles reading and writing workspace data to SQLite database.
 * 
 * Note: Most exported functions are marked `async` despite using synchronous
 * bun:sqlite APIs. This is intentional for interface consistency — callers
 * already `await` these functions, and the persistence layer may switch to
 * async storage in the future.
 */

import type { Workspace, WorkspaceImportResult } from "../types/workspace";
import type { ServerSettings } from "../types/settings";
import type { WorkspaceConfig, WorkspaceExportData } from "../types/schemas";
import {
  getServerFingerprint,
  parseServerSettings,
} from "../types/settings";
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
    server_fingerprint: getServerFingerprint(workspace.serverSettings),
    server_settings: JSON.stringify(workspace.serverSettings),
    created_at: workspace.createdAt,
    updated_at: workspace.updatedAt,
  };
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
    log.debug("Workspace not found", { id });
    return null;
  }
  const workspace = rowToWorkspace(row);
  log.debug("Workspace retrieved", { id, name: workspace.name });
  return workspace;
}

/**
 * List workspaces by directory path.
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
  const row = stmt.get(directory, serverFingerprint) as Record<string, unknown> | null;
  if (!row) {
    return null;
  }
  return rowToWorkspace(row);
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
    setClauses.push("server_fingerprint = ?");
    values.push(getServerFingerprint(updates.serverSettings));
  }
  
  if (setClauses.length === 0) {
    // No updates provided, just return the existing workspace
    log.debug("No updates provided, returning existing workspace", { id });
    return getWorkspace(id);
  }
  
  // Always update updated_at
  setClauses.push("updated_at = ?");
  values.push(new Date().toISOString());
  
  values.push(id);
  
  const sql = `UPDATE workspaces SET ${setClauses.join(", ")} WHERE id = ?`;
  const stmt = db.prepare(sql);
  stmt.run(...values);
  
  log.debug("Workspace updated", { id });
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
    log.debug("Workspace not found for deletion", { id });
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

/**
 * Export all workspaces as a portable config format.
 * Strips internal fields (id, timestamps) and returns only portable config.
 */
export async function exportWorkspaces(): Promise<WorkspaceExportData> {
  log.debug("Exporting all workspaces");
  const db = getDatabase();
  const stmt = db.prepare("SELECT * FROM workspaces ORDER BY name COLLATE NOCASE ASC");
  const rows = stmt.all() as Array<Record<string, unknown>>;

  const workspaces: WorkspaceConfig[] = rows.map((row) => {
    const workspace = rowToWorkspace(row);
    return {
      name: workspace.name,
      directory: workspace.directory,
      serverSettings: workspace.serverSettings,
    };
  });

  log.info("Workspaces exported", { count: workspaces.length });
  return {
    version: 1,
    exportedAt: new Date().toISOString(),
    workspaces,
  };
}

/**
 * Import workspaces from a portable config format.
 * Creates new workspaces, skipping any whose directory already exists.
 */
export async function importWorkspaces(data: WorkspaceExportData): Promise<WorkspaceImportResult> {
  log.debug("Importing workspaces", { count: data.workspaces.length });

  const result: WorkspaceImportResult = {
    created: 0,
    skipped: 0,
    failed: 0,
    details: [],
  };

  for (const config of data.workspaces) {
    // Normalize inputs: trim whitespace from name and directory
    const name = config.name.trim();
    const directory = config.directory.trim();

    // Check if a workspace with this directory already exists
    const existing = await getWorkspaceByDirectoryAndServerSettings(directory, config.serverSettings);
    if (existing) {
      log.debug("Skipping workspace import - directory already exists", {
        name,
        directory,
        existingId: existing.id,
      });
      result.skipped++;
      result.details.push({
        name,
        directory,
        status: "skipped",
        reason: `A workspace already exists for directory: ${directory}`,
      });
      continue;
    }

    const now = new Date().toISOString();
    const workspace: Workspace = {
      id: crypto.randomUUID(),
      name,
      directory,
      serverSettings: config.serverSettings,
      createdAt: now,
      updatedAt: now,
    };

    await createWorkspace(workspace);
    result.created++;
    result.details.push({
      name,
      directory,
      status: "created",
    });
  }

  log.info("Workspaces imported", { created: result.created, skipped: result.skipped });
  return result;
}
