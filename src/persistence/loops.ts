/**
 * Loop persistence layer for Ralph Loops Management System.
 * Handles reading and writing loop data to SQLite database.
 */

import type { Loop, LoopConfig, LoopState } from "../types";
import { getDatabase } from "./database";
import { createLogger } from "../core/logger";

const log = createLogger("persistence:loops");

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
  "workspace_id",
  "model_provider_id",
  "model_model_id",
  "model_variant",
  "max_iterations",
  "max_consecutive_errors",
  "activity_timeout_seconds",
  "stop_pattern",
  "git_branch_prefix",
  "git_commit_prefix",
  "base_branch",
  "clear_planning_folder",
  "plan_mode",
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
  "pending_model_provider_id",
  "pending_model_model_id",
  "pending_model_variant",
  "plan_mode_active",
  "plan_session_id",
  "plan_server_url",
  "plan_feedback_rounds",
  "plan_content",
  "planning_folder_cleared",
  "plan_is_ready",
  "review_mode",
  "todos",
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
    workspace_id: config.workspaceId,
    model_provider_id: config.model?.providerID ?? null,
    model_model_id: config.model?.modelID ?? null,
    model_variant: config.model?.variant ?? null,
    max_iterations: config.maxIterations ?? null,
    max_consecutive_errors: config.maxConsecutiveErrors ?? null,
    activity_timeout_seconds: config.activityTimeoutSeconds ?? null,
    stop_pattern: config.stopPattern,
    git_branch_prefix: config.git.branchPrefix,
    git_commit_prefix: config.git.commitPrefix,
    base_branch: config.baseBranch ?? null,
    clear_planning_folder: config.clearPlanningFolder ? 1 : 0,
    plan_mode: config.planMode ? 1 : 0,
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
    pending_model_provider_id: state.pendingModel?.providerID ?? null,
    pending_model_model_id: state.pendingModel?.modelID ?? null,
    pending_model_variant: state.pendingModel?.variant ?? null,
    plan_mode_active: state.planMode?.active ? 1 : 0,
    plan_session_id: state.planMode?.planSessionId ?? null,
    plan_server_url: state.planMode?.planServerUrl ?? null,
    plan_feedback_rounds: state.planMode?.feedbackRounds ?? 0,
    plan_content: state.planMode?.planContent ?? null,
    planning_folder_cleared: state.planMode?.planningFolderCleared ? 1 : 0,
    plan_is_ready: state.planMode?.isPlanReady ? 1 : 0,
    review_mode: state.reviewMode ? JSON.stringify(state.reviewMode) : null,
    todos: state.todos ? JSON.stringify(state.todos) : null,
  };
}

/**
 * Convert a database row to a Loop object.
 */
function rowToLoop(row: Record<string, unknown>): Loop {
  // Handle model - required field, but may be missing in legacy data
  let model: { providerID: string; modelID: string; variant?: string };
  if (row["model_provider_id"] && row["model_model_id"]) {
    model = {
      providerID: row["model_provider_id"] as string,
      modelID: row["model_model_id"] as string,
    };
    if (row["model_variant"]) {
      model.variant = row["model_variant"] as string;
    }
  } else {
    // Legacy loops without model - provide a placeholder that indicates missing config
    model = {
      providerID: "unknown",
      modelID: "not-configured",
    };
  }

  const config: LoopConfig = {
    id: row["id"] as string,
    name: row["name"] as string,
    directory: row["directory"] as string,
    prompt: row["prompt"] as string,
    createdAt: row["created_at"] as string,
    updatedAt: row["updated_at"] as string,
    workspaceId: row["workspace_id"] as string,
    stopPattern: row["stop_pattern"] as string,
    git: {
      branchPrefix: row["git_branch_prefix"] as string,
      commitPrefix: row["git_commit_prefix"] as string,
    },
    model,
    // Mandatory fields with defaults for backward compatibility with old data
    maxIterations: (row["max_iterations"] as number | null) ?? Infinity,
    maxConsecutiveErrors: (row["max_consecutive_errors"] as number | null) ?? 10,
    activityTimeoutSeconds: (row["activity_timeout_seconds"] as number | null) ?? 180,
    clearPlanningFolder: row["clear_planning_folder"] === 1,
    planMode: row["plan_mode"] === 1,
  };

  // Optional config fields
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
    // Mandatory array fields - always initialize as empty arrays if null
    logs: row["logs"] ? JSON.parse(row["logs"] as string) : [],
    messages: row["messages"] ? JSON.parse(row["messages"] as string) : [],
    toolCalls: row["tool_calls"] ? JSON.parse(row["tool_calls"] as string) : [],
    todos: row["todos"] ? JSON.parse(row["todos"] as string) : [],
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
  if (row["consecutive_errors"] !== null) {
    state.consecutiveErrors = JSON.parse(row["consecutive_errors"] as string);
  }
  if (row["pending_prompt"] !== null) {
    state.pendingPrompt = row["pending_prompt"] as string;
  }
  // Reconstruct pendingModel from provider/model columns
  if (row["pending_model_provider_id"] !== null && row["pending_model_model_id"] !== null) {
    state.pendingModel = {
      providerID: row["pending_model_provider_id"] as string,
      modelID: row["pending_model_model_id"] as string,
    };
    if (row["pending_model_variant"]) {
      state.pendingModel.variant = row["pending_model_variant"] as string;
    }
  }
  // Reconstruct planMode if any plan mode field is set (not just when active)
  if (row["plan_mode_active"] !== null || row["planning_folder_cleared"] === 1 || 
      row["plan_session_id"] !== null || row["plan_feedback_rounds"] !== null) {
    state.planMode = {
      active: row["plan_mode_active"] === 1,
      planSessionId: row["plan_session_id"] as string | undefined,
      planServerUrl: row["plan_server_url"] as string | undefined,
      feedbackRounds: (row["plan_feedback_rounds"] as number) ?? 0,
      planContent: row["plan_content"] as string | undefined,
      planningFolderCleared: row["planning_folder_cleared"] === 1,
      isPlanReady: row["plan_is_ready"] === 1,
    };
  }
  // Reconstruct reviewMode from JSON
  if (row["review_mode"] !== null) {
    state.reviewMode = JSON.parse(row["review_mode"] as string);
  }

  return { config, state };
}

/**
 * Save a loop to the database.
 * Uses INSERT OR REPLACE for upsert behavior.
 */
export async function saveLoop(loop: Loop): Promise<void> {
  log.debug("Saving loop", { id: loop.config.id, name: loop.config.name, status: loop.state.status });
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
  log.trace("Loop saved to database", { id: loop.config.id });
}

/**
 * Load a loop from the database by ID.
 * Returns null if the loop doesn't exist.
 */
export async function loadLoop(loopId: string): Promise<Loop | null> {
  log.debug("Loading loop", { loopId });
  const db = getDatabase();
  
  const stmt = db.prepare("SELECT * FROM loops WHERE id = ?");
  const row = stmt.get(loopId) as Record<string, unknown> | null;
  
  if (!row) {
    log.trace("Loop not found", { loopId });
    return null;
  }
  
  const loop = rowToLoop(row);
  log.trace("Loop loaded", { loopId, status: loop.state.status });
  return loop;
}

/**
 * Delete a loop from the database.
 * Returns true if deleted, false if it didn't exist.
 */
export async function deleteLoop(loopId: string): Promise<boolean> {
  log.debug("Deleting loop", { loopId });
  const db = getDatabase();
  
  const stmt = db.prepare("DELETE FROM loops WHERE id = ?");
  const result = stmt.run(loopId);
  
  const deleted = result.changes > 0;
  if (deleted) {
    log.info("Loop deleted", { loopId });
  } else {
    log.trace("Loop not found for deletion", { loopId });
  }
  return deleted;
}

/**
 * List all loops from the database.
 * Sorted by creation date, newest first.
 */
export async function listLoops(): Promise<Loop[]> {
  log.debug("Listing all loops");
  const db = getDatabase();
  
  const stmt = db.prepare("SELECT * FROM loops ORDER BY created_at DESC");
  const rows = stmt.all() as Record<string, unknown>[];
  
  const loops = rows.map(rowToLoop);
  log.trace("Loops listed", { count: loops.length });
  return loops;
}

/**
 * Check if a loop exists.
 */
export async function loopExists(loopId: string): Promise<boolean> {
  log.trace("Checking if loop exists", { loopId });
  const db = getDatabase();
  
  const stmt = db.prepare("SELECT 1 FROM loops WHERE id = ? LIMIT 1");
  const row = stmt.get(loopId);
  
  const exists = row !== null;
  log.trace("Loop exists check result", { loopId, exists });
  return exists;
}

/**
 * Active loop statuses that should block new loops on the same directory.
 * These are non-terminal, non-draft states where the loop is actively
 * using or about to use the working directory.
 */
const ACTIVE_LOOP_STATUSES = [
  "idle",      // Created but not started (transitional)
  "planning",  // Loop is in plan creation/review mode
  "starting",  // Initializing backend connection and git branch
  "running",   // Actively executing an iteration
  "waiting",   // Between iterations, preparing for next
];

/**
 * Get an active (non-draft, non-terminal) loop for a specific directory.
 * 
 * Active loops are those in states: idle, planning, starting, running, waiting.
 * Draft and terminal states (completed, stopped, failed, max_iterations, merged, pushed, deleted)
 * are not considered active.
 * 
 * @param directory - The absolute path to the working directory
 * @returns The active loop if one exists, null otherwise
 */
export async function getActiveLoopByDirectory(directory: string): Promise<Loop | null> {
  log.debug("Getting active loop by directory", { directory });
  const db = getDatabase();
  
  // Build placeholders for the IN clause
  const placeholders = ACTIVE_LOOP_STATUSES.map(() => "?").join(", ");
  
  const stmt = db.prepare(`
    SELECT * FROM loops 
    WHERE directory = ? AND status IN (${placeholders})
    LIMIT 1
  `);
  
  const row = stmt.get(directory, ...ACTIVE_LOOP_STATUSES) as Record<string, unknown> | null;
  
  if (!row) {
    log.trace("No active loop found for directory", { directory });
    return null;
  }
  
  const loop = rowToLoop(row);
  log.trace("Active loop found", { directory, loopId: loop.config.id, status: loop.state.status });
  return loop;
}

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
      log.trace("Loop not found for state update", { loopId });
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
    
    log.trace("Loop state updated", { loopId, status: state.status });
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
      log.trace("Loop not found for config update", { loopId });
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
    
    log.trace("Loop config updated", { loopId, name: config.name });
    return true;
  });
  
  return updateInTransaction();
}

/**
 * Stale loop statuses that should be reset when force-resetting connections.
 * These are non-planning active states where the loop appears to be running
 * but may have a stale in-memory engine.
 * 
 * Note: "planning" is excluded because planning loops can reconnect to their
 * session when the user sends feedback. We don't want to break their state.
 */
const STALE_LOOP_STATUSES = [
  "idle",      // Created but not started (transitional)
  "starting",  // Initializing backend connection and git branch
  "running",   // Actively executing an iteration
  "waiting",   // Between iterations, preparing for next
];

/**
 * Reset all stale loops to "stopped" status.
 * 
 * This is used when force-resetting connections to clear loops that appear
 * active in the database but have no running engine (e.g., after a crash or
 * when connections become stale).
 * 
 * Loops in "planning" status are NOT reset because they can reconnect to
 * their existing session when the user sends feedback.
 * 
 * @returns The number of loops that were reset
 */
export async function resetStaleLoops(): Promise<number> {
  log.debug("Resetting stale loops");
  const db = getDatabase();
  const now = new Date().toISOString();
  
  // Build placeholders for the IN clause
  const placeholders = STALE_LOOP_STATUSES.map(() => "?").join(", ");
  
  const stmt = db.prepare(`
    UPDATE loops 
    SET status = 'stopped',
        error_message = 'Forcefully stopped by connection reset',
        error_timestamp = ?,
        completed_at = ?
    WHERE status IN (${placeholders})
  `);
  
  const result = stmt.run(now, now, ...STALE_LOOP_STATUSES);
  
  if (result.changes > 0) {
    log.info("Reset stale loops", { count: result.changes });
  } else {
    log.trace("No stale loops to reset");
  }
  return result.changes;
}
