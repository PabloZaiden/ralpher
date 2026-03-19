/**
 * Partial update operations for loops persistence.
 * Handles atomic state and config updates via transactions.
 */

import type { LoopConfig, LoopState } from "../../types";
import { getDatabase } from "../database";
import { createLogger } from "../../core/logger";
import { loopToRow, rowToLoop, validateColumnNames } from "./helpers";

const log = createLogger("persistence:loops");

/**
 * Update only the state portion of a loop.
 * Uses a transaction to ensure atomicity of SELECT + UPDATE.
 */
export async function updateLoopState(loopId: string, state: LoopState): Promise<boolean> {
  log.debug("Updating loop state", { loopId, status: state.status });
  const db = getDatabase();

  // Prepare statements outside transaction
  const selectStmt = db.prepare("SELECT * FROM loops WHERE id = ?");

  // Use transaction to ensure atomic read-modify-write
  const updateInTransaction = db.transaction(() => {
    const row = selectStmt.get(loopId) as Record<string, unknown> | null;
    if (!row) {
      log.debug("Loop not found for state update", { loopId });
      return false;
    }

    const loop = rowToLoop(row);
    loop.state = state;

    const newRow = loopToRow(loop);
    const columns = Object.keys(newRow).filter(col => col !== "id");
    // Validate column names to prevent SQL injection
    validateColumnNames(columns);

    // Use UPDATE instead of INSERT OR REPLACE to avoid triggering ON DELETE CASCADE
    // which would delete related records in review_comments table
    const setClause = columns.map(col => `${col} = ?`).join(", ");
    const values = columns.map(col => newRow[col as keyof typeof newRow]) as (string | number | null | Uint8Array)[];
    values.push(loopId); // Add id for WHERE clause

    const updateStmt = db.prepare(`
      UPDATE loops SET ${setClause} WHERE id = ?
    `);
    updateStmt.run(...values);

    log.debug("Loop state updated", { loopId, status: state.status });
    return true;
  });

  return updateInTransaction();
}

/**
 * Update only the config portion of a loop.
 * Uses a transaction to ensure atomicity of SELECT + UPDATE.
 */
export async function updateLoopConfig(loopId: string, config: LoopConfig): Promise<boolean> {
  log.debug("Updating loop config", { loopId, name: config.name });
  const db = getDatabase();

  // Prepare statements outside transaction
  const selectStmt = db.prepare("SELECT * FROM loops WHERE id = ?");

  // Use transaction to ensure atomic read-modify-write
  const updateInTransaction = db.transaction(() => {
    const row = selectStmt.get(loopId) as Record<string, unknown> | null;
    if (!row) {
      log.debug("Loop not found for config update", { loopId });
      return false;
    }

    const loop = rowToLoop(row);
    loop.config = config;

    const newRow = loopToRow(loop);
    const columns = Object.keys(newRow).filter(col => col !== "id");
    // Validate column names to prevent SQL injection
    validateColumnNames(columns);

    // Use UPDATE instead of INSERT OR REPLACE to avoid triggering ON DELETE CASCADE
    // which would delete related records in review_comments table
    const setClause = columns.map(col => `${col} = ?`).join(", ");
    const values = columns.map(col => newRow[col as keyof typeof newRow]) as (string | number | null | Uint8Array)[];
    values.push(loopId); // Add id for WHERE clause

    const updateStmt = db.prepare(`
      UPDATE loops SET ${setClause} WHERE id = ?
    `);
    updateStmt.run(...values);

    log.debug("Loop config updated", { loopId, name: config.name });
    return true;
  });

  return updateInTransaction();
}
