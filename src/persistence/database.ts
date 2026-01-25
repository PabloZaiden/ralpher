/**
 * SQLite database layer for Ralph Loops Management System.
 * Provides centralized database connection and schema management.
 * Uses Bun's native SQLite support.
 */

import { Database } from "bun:sqlite";
import { join } from "path";

let db: Database | null = null;

/**
 * Get the root data directory path.
 * Can be overridden via RALPHER_DATA_DIR environment variable.
 */
export function getDataDir(): string {
  return process.env["RALPHER_DATA_DIR"] ?? "./data";
}

/**
 * Get the path to the SQLite database file.
 */
export function getDatabasePath(): string {
  return join(getDataDir(), "ralpher.db");
}

/**
 * Get the database instance, initializing if needed.
 * This is a singleton pattern to avoid multiple connections.
 */
export function getDatabase(): Database {
  if (!db) {
    throw new Error("Database not initialized. Call initializeDatabase() first.");
  }
  return db;
}

/**
 * Initialize the database connection and create tables.
 * Must be called before any database operations.
 */
export async function initializeDatabase(): Promise<void> {
  // Ensure data directory exists
  const { mkdir } = await import("fs/promises");
  await mkdir(getDataDir(), { recursive: true });

  const dbPath = getDatabasePath();
  db = new Database(dbPath);
  
  // Enable WAL mode for better concurrency
  db.run("PRAGMA journal_mode = WAL");
  
  // Create tables
  createTables(db);
}

/**
 * Create all database tables if they don't exist.
 * Uses a transaction to ensure atomicity of schema creation.
 */
function createTables(database: Database): void {
  // Wrap all schema creation in a transaction
  const createAllTables = database.transaction(() => {
    // Loops table - stores both config and state
    database.run(`
      CREATE TABLE IF NOT EXISTS loops (
        id TEXT PRIMARY KEY,
        -- Config fields
        name TEXT NOT NULL,
        directory TEXT NOT NULL,
        prompt TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        model_provider_id TEXT,
        model_model_id TEXT,
        max_iterations INTEGER,
        max_consecutive_errors INTEGER,
        activity_timeout_seconds INTEGER,
        stop_pattern TEXT NOT NULL,
        git_branch_prefix TEXT NOT NULL,
        git_commit_prefix TEXT NOT NULL,
        base_branch TEXT,
        -- State fields
        status TEXT NOT NULL DEFAULT 'idle',
        current_iteration INTEGER NOT NULL DEFAULT 0,
        started_at TEXT,
        completed_at TEXT,
        last_activity_at TEXT,
        session_id TEXT,
        session_server_url TEXT,
        error_message TEXT,
        error_iteration INTEGER,
        error_timestamp TEXT,
        git_original_branch TEXT,
        git_working_branch TEXT,
        git_commits TEXT,
        recent_iterations TEXT,
        logs TEXT,
        messages TEXT,
        tool_calls TEXT,
        consecutive_errors TEXT,
        pending_prompt TEXT
      )
    `);

    // Sessions table - maps loops to backend sessions
    database.run(`
      CREATE TABLE IF NOT EXISTS sessions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        backend_name TEXT NOT NULL,
        loop_id TEXT NOT NULL,
        session_id TEXT NOT NULL,
        server_url TEXT,
        created_at TEXT NOT NULL,
        UNIQUE(backend_name, loop_id)
      )
    `);

    // Preferences table - key-value store for user preferences
    database.run(`
      CREATE TABLE IF NOT EXISTS preferences (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      )
    `);

    // Create index for faster loop listing
    database.run(`
      CREATE INDEX IF NOT EXISTS idx_loops_created_at ON loops(created_at DESC)
    `);

    // Create index for faster session lookups
    database.run(`
      CREATE INDEX IF NOT EXISTS idx_sessions_backend_loop ON sessions(backend_name, loop_id)
    `);
  });
  
  createAllTables();
}

/**
 * Close the database connection.
 * Should be called when the application shuts down.
 */
export function closeDatabase(): void {
  if (db) {
    db.close();
    db = null;
  }
}

/**
 * Check if the database is initialized and ready.
 */
export function isDatabaseReady(): boolean {
  return db !== null;
}

/**
 * Reset the database for testing purposes.
 * Drops all tables and recreates them.
 * Uses a transaction to ensure atomicity of DROP operations.
 */
export function resetDatabase(): void {
  if (!db) {
    throw new Error("Database not initialized");
  }
  
  // Wrap DROP operations in a transaction
  const dropAllTables = db.transaction(() => {
    db!.run("DROP TABLE IF EXISTS loops");
    db!.run("DROP TABLE IF EXISTS sessions");
    db!.run("DROP TABLE IF EXISTS preferences");
  });
  
  dropAllTables();
  createTables(db);
}
