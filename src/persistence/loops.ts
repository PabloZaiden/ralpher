/**
 * Loop persistence layer for Ralph Loops Management System.
 * Handles reading and writing loop data to SQLite database.
 */

import type { Loop, LoopConfig, LoopState } from "../types";
import { getDatabase } from "./database";

/**
 * Allowed column names for the loops table.
 * This list must match the schema in database.ts.
 * Used to validate column names before SQL interpolation to prevent injection.
 */
const ALLOWED_LOOP_COLUMNS = new Set([
  "id",
  "name",
  "directory",
  "prompt",
  "created_at",
  "updated_at",
  "model_provider_id",
  "model_model_id",
  "max_iterations",
  "max_consecutive_errors",
  "activity_timeout_seconds",
  "stop_pattern",
  "git_branch_prefix",
  "git_commit_prefix",
  "base_branch",
  "status",
  "current_iteration",
  "started_at",
  "completed_at",
  "last_activity_at",
  "session_id",
  "session_server_url",
  "error_message",
  "error_iteration",
  "error_timestamp",
  "git_original_branch",
  "git_working_branch",
  "git_commits",
  "recent_iterations",
  "logs",
  "messages",
  "tool_calls",
  "consecutive_errors",
  "pending_prompt",
]);

/**
 * Validate that all column names are in the allowed list.
 * Throws an error if any column name is not allowed.
 */
function validateColumnNames(columns: string[]): void {
  for (const column of columns) {
    if (!ALLOWED_LOOP_COLUMNS.has(column)) {
      throw new Error(`Invalid column name: ${column}`);
    }
  }
}

/**
 * Convert a Loop to a flat object for database insertion.
 */
function loopToRow(loop: Loop): Record<string, unknown> {
  const { config, state } = loop;
  return {
    id: config.id,
    // Config fields
    name: config.name,
    directory: config.directory,
    prompt: config.prompt,
    created_at: config.createdAt,
    updated_at: config.updatedAt,
    model_provider_id: config.model?.providerID ?? null,
    model_model_id: config.model?.modelID ?? null,
    max_iterations: config.maxIterations ?? null,
    max_consecutive_errors: config.maxConsecutiveErrors ?? null,
    activity_timeout_seconds: config.activityTimeoutSeconds ?? null,
    stop_pattern: config.stopPattern,
    git_branch_prefix: config.git.branchPrefix,
    git_commit_prefix: config.git.commitPrefix,
    base_branch: config.baseBranch ?? null,
    // State fields
    status: state.status,
    current_iteration: state.currentIteration,
    started_at: state.startedAt ?? null,
    completed_at: state.completedAt ?? null,
    last_activity_at: state.lastActivityAt ?? null,
    session_id: state.session?.id ?? null,
    session_server_url: state.session?.serverUrl ?? null,
    error_message: state.error?.message ?? null,
    error_iteration: state.error?.iteration ?? null,
    error_timestamp: state.error?.timestamp ?? null,
    git_original_branch: state.git?.originalBranch ?? null,
    git_working_branch: state.git?.workingBranch ?? null,
    git_commits: state.git?.commits ? JSON.stringify(state.git.commits) : null,
    recent_iterations: JSON.stringify(state.recentIterations),
    logs: state.logs ? JSON.stringify(state.logs) : null,
    messages: state.messages ? JSON.stringify(state.messages) : null,
    tool_calls: state.toolCalls ? JSON.stringify(state.toolCalls) : null,
    consecutive_errors: state.consecutiveErrors ? JSON.stringify(state.consecutiveErrors) : null,
    pending_prompt: state.pendingPrompt ?? null,
  };
}

/**
 * Convert a database row to a Loop object.
 */
function rowToLoop(row: Record<string, unknown>): Loop {
  const config: LoopConfig = {
    id: row["id"] as string,
    name: row["name"] as string,
    directory: row["directory"] as string,
    prompt: row["prompt"] as string,
    createdAt: row["created_at"] as string,
    updatedAt: row["updated_at"] as string,
    stopPattern: row["stop_pattern"] as string,
    git: {
      branchPrefix: row["git_branch_prefix"] as string,
      commitPrefix: row["git_commit_prefix"] as string,
    },
  };

  // Optional config fields
  if (row["model_provider_id"] && row["model_model_id"]) {
    config.model = {
      providerID: row["model_provider_id"] as string,
      modelID: row["model_model_id"] as string,
    };
  }
  if (row["max_iterations"] !== null) {
    config.maxIterations = row["max_iterations"] as number;
  }
  if (row["max_consecutive_errors"] !== null) {
    config.maxConsecutiveErrors = row["max_consecutive_errors"] as number;
  }
  if (row["activity_timeout_seconds"] !== null) {
    config.activityTimeoutSeconds = row["activity_timeout_seconds"] as number;
  }
  if (row["base_branch"] !== null) {
    config.baseBranch = row["base_branch"] as string;
  }

  const state: LoopState = {
    id: row["id"] as string,
    status: row["status"] as LoopState["status"],
    currentIteration: row["current_iteration"] as number,
    recentIterations: row["recent_iterations"] 
      ? JSON.parse(row["recent_iterations"] as string) 
      : [],
  };

  // Optional state fields
  if (row["started_at"] !== null) {
    state.startedAt = row["started_at"] as string;
  }
  if (row["completed_at"] !== null) {
    state.completedAt = row["completed_at"] as string;
  }
  if (row["last_activity_at"] !== null) {
    state.lastActivityAt = row["last_activity_at"] as string;
  }
  if (row["session_id"] !== null) {
    state.session = {
      id: row["session_id"] as string,
      serverUrl: row["session_server_url"] as string | undefined,
    };
  }
  if (row["error_message"] !== null) {
    state.error = {
      message: row["error_message"] as string,
      iteration: row["error_iteration"] as number,
      timestamp: row["error_timestamp"] as string,
    };
  }
  if (row["git_original_branch"] !== null && row["git_working_branch"] !== null) {
    state.git = {
      originalBranch: row["git_original_branch"] as string,
      workingBranch: row["git_working_branch"] as string,
      commits: row["git_commits"] ? JSON.parse(row["git_commits"] as string) : [],
    };
  }
  if (row["logs"] !== null) {
    state.logs = JSON.parse(row["logs"] as string);
  }
  if (row["messages"] !== null) {
    state.messages = JSON.parse(row["messages"] as string);
  }
  if (row["tool_calls"] !== null) {
    state.toolCalls = JSON.parse(row["tool_calls"] as string);
  }
  if (row["consecutive_errors"] !== null) {
    state.consecutiveErrors = JSON.parse(row["consecutive_errors"] as string);
  }
  if (row["pending_prompt"] !== null) {
    state.pendingPrompt = row["pending_prompt"] as string;
  }

  return { config, state };
}

/**
 * Save a loop to the database.
 * Uses INSERT OR REPLACE for upsert behavior.
 */
export async function saveLoop(loop: Loop): Promise<void> {
  const db = getDatabase();
  const row = loopToRow(loop);
  
  const columns = Object.keys(row);
  // Validate column names to prevent SQL injection
  validateColumnNames(columns);
  
  const placeholders = columns.map(() => "?").join(", ");
  const values = Object.values(row) as (string | number | null | Uint8Array)[];
  
  const stmt = db.prepare(`
    INSERT OR REPLACE INTO loops (${columns.join(", ")})
    VALUES (${placeholders})
  `);
  
  stmt.run(...values);
}

/**
 * Load a loop from the database by ID.
 * Returns null if the loop doesn't exist.
 */
export async function loadLoop(loopId: string): Promise<Loop | null> {
  const db = getDatabase();
  
  const stmt = db.prepare("SELECT * FROM loops WHERE id = ?");
  const row = stmt.get(loopId) as Record<string, unknown> | null;
  
  if (!row) {
    return null;
  }
  
  return rowToLoop(row);
}

/**
 * Delete a loop from the database.
 * Returns true if deleted, false if it didn't exist.
 */
export async function deleteLoop(loopId: string): Promise<boolean> {
  const db = getDatabase();
  
  const stmt = db.prepare("DELETE FROM loops WHERE id = ?");
  const result = stmt.run(loopId);
  
  return result.changes > 0;
}

/**
 * List all loops from the database.
 * Sorted by creation date, newest first.
 */
export async function listLoops(): Promise<Loop[]> {
  const db = getDatabase();
  
  const stmt = db.prepare("SELECT * FROM loops ORDER BY created_at DESC");
  const rows = stmt.all() as Record<string, unknown>[];
  
  return rows.map(rowToLoop);
}

/**
 * Check if a loop exists.
 */
export async function loopExists(loopId: string): Promise<boolean> {
  const db = getDatabase();
  
  const stmt = db.prepare("SELECT 1 FROM loops WHERE id = ? LIMIT 1");
  const row = stmt.get(loopId);
  
  return row !== null;
}

/**
 * Update only the state portion of a loop.
 * Uses a transaction to ensure atomicity of SELECT + UPDATE.
 */
export async function updateLoopState(loopId: string, state: LoopState): Promise<boolean> {
  const db = getDatabase();
  
  // Prepare statements outside transaction
  const selectStmt = db.prepare("SELECT * FROM loops WHERE id = ?");
  
  // Use transaction to ensure atomic read-modify-write
  const updateInTransaction = db.transaction(() => {
    const row = selectStmt.get(loopId) as Record<string, unknown> | null;
    if (!row) {
      return false;
    }
    
    const loop = rowToLoop(row);
    loop.state = state;
    
    const newRow = loopToRow(loop);
    const columns = Object.keys(newRow);
    // Validate column names to prevent SQL injection
    validateColumnNames(columns);
    
    const placeholders = columns.map(() => "?").join(", ");
    const values = Object.values(newRow) as (string | number | null | Uint8Array)[];
    
    const insertStmt = db.prepare(`
      INSERT OR REPLACE INTO loops (${columns.join(", ")})
      VALUES (${placeholders})
    `);
    insertStmt.run(...values);
    
    return true;
  });
  
  return updateInTransaction();
}

/**
 * Update only the config portion of a loop.
 * Uses a transaction to ensure atomicity of SELECT + UPDATE.
 */
export async function updateLoopConfig(loopId: string, config: LoopConfig): Promise<boolean> {
  const db = getDatabase();
  
  // Prepare statements outside transaction
  const selectStmt = db.prepare("SELECT * FROM loops WHERE id = ?");
  
  // Use transaction to ensure atomic read-modify-write
  const updateInTransaction = db.transaction(() => {
    const row = selectStmt.get(loopId) as Record<string, unknown> | null;
    if (!row) {
      return false;
    }
    
    const loop = rowToLoop(row);
    loop.config = config;
    
    const newRow = loopToRow(loop);
    const columns = Object.keys(newRow);
    // Validate column names to prevent SQL injection
    validateColumnNames(columns);
    
    const placeholders = columns.map(() => "?").join(", ");
    const values = Object.values(newRow) as (string | number | null | Uint8Array)[];
    
    const insertStmt = db.prepare(`
      INSERT OR REPLACE INTO loops (${columns.join(", ")})
      VALUES (${placeholders})
    `);
    insertStmt.run(...values);
    
    return true;
  });
  
  return updateInTransaction();
}
