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
  const defaults = getDefaultServerSettings();
  if (!jsonString) {
    return defaults;
  }
  try {
    const parsed = JSON.parse(jsonString) as unknown;
    if (!parsed || typeof parsed !== "object") {
      return defaults;
    }

    const parsedRecord = parsed as Record<string, unknown>;

    // Legacy shape support for existing persisted rows:
    // { mode, hostname, port, password, useHttps, allowInsecure }
    if (typeof parsedRecord["mode"] === "string") {
      const mode = parsedRecord["mode"] === "connect" ? "tcp" : "stdio";
      return {
        agent: {
          provider: "opencode",
          transport: mode,
          hostname: typeof parsedRecord["hostname"] === "string" ? parsedRecord["hostname"] : defaults.agent.hostname,
          port: typeof parsedRecord["port"] === "number" ? parsedRecord["port"] : defaults.agent.port,
          password: typeof parsedRecord["password"] === "string" ? parsedRecord["password"] : undefined,
          useHttps: typeof parsedRecord["useHttps"] === "boolean" ? parsedRecord["useHttps"] : defaults.agent.useHttps,
          allowInsecure:
            typeof parsedRecord["allowInsecure"] === "boolean"
              ? parsedRecord["allowInsecure"]
              : defaults.agent.allowInsecure,
        },
        execution: defaults.execution,
      };
    }

    const partial = parsedRecord as Partial<ServerSettings>;
    return {
      agent: {
        ...defaults.agent,
        ...(partial.agent ?? {}),
        useHttps: partial.agent?.useHttps ?? defaults.agent.useHttps,
        allowInsecure: partial.agent?.allowInsecure ?? defaults.agent.allowInsecure,
      },
      execution: {
        ...defaults.execution,
        ...(partial.execution ?? {}),
      },
    };
  } catch {
    return defaults;
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
    const existing = await getWorkspaceByDirectory(directory);
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
