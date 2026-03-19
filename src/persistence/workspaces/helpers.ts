/**
 * Internal row-conversion helpers for workspace persistence.
 */

import type { Workspace } from "../../types/workspace";
import { getServerFingerprint, parseServerSettings } from "../../types/settings";

export function workspaceToRow(workspace: Workspace): Record<string, unknown> {
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

export function rowToWorkspace(row: Record<string, unknown>): Workspace {
  return {
    id: row["id"] as string,
    name: row["name"] as string,
    directory: row["directory"] as string,
    serverSettings: parseServerSettings(row["server_settings"] as string | null),
    createdAt: row["created_at"] as string,
    updatedAt: row["updated_at"] as string,
  };
}
