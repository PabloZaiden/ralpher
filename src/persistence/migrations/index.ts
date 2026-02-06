/**
 * Database migration system for Ralpher.
 * 
 * Migrations allow the database schema to evolve over time while maintaining
 * backward compatibility with existing databases.
 * 
 * ## Adding a New Migration
 * 
 * 1. Add a new entry to the `migrations` array with:
 *    - `version`: Next sequential integer (check the last migration's version)
 *    - `name`: Descriptive snake_case name (e.g., "add_user_preferences")
 *    - `up`: Function that applies the migration
 * 
 * 2. The `up` function receives the Database instance and should:
 *    - Use `ALTER TABLE ... ADD COLUMN` for new columns
 *    - Use `CREATE TABLE IF NOT EXISTS` for new tables
 *    - Handle the case where the change already exists (idempotent)
 * 
 * 3. Add a test in `tests/unit/migrations.test.ts`
 * 
 * ## Example Migration
 * 
 * ```typescript
 * {
 *   version: 2,
 *   name: "add_user_avatar",
 *   up: (db) => {
 *     const columns = getTableColumns(db, "users");
 *     if (!columns.includes("avatar_url")) {
 *       db.run("ALTER TABLE users ADD COLUMN avatar_url TEXT");
 *     }
 *   },
 * }
 * ```
 */

import type { Database } from "bun:sqlite";
import { log } from "../../core/logger";

/**
 * A database migration definition.
 */
export interface Migration {
  /** Unique version number (sequential integer starting from 1) */
  version: number;
  /** Descriptive name in snake_case */
  name: string;
  /** Function to apply the migration */
  up: (db: Database) => void;
}

/**
 * Get the column names for a table.
 * Useful for checking if a column already exists before adding it.
 */
export function getTableColumns(db: Database, tableName: string): string[] {
  const result = db.query(`PRAGMA table_info(${tableName})`).all() as Array<{ name: string }>;
  return result.map((row) => row.name);
}

/**
 * Check if a table exists in the database.
 */
export function tableExists(db: Database, tableName: string): boolean {
  const result = db.query(
    "SELECT name FROM sqlite_master WHERE type='table' AND name=?"
  ).get(tableName) as { name: string } | null;
  return result !== null;
}

/**
 * All migrations in order. Add new migrations to the end of this array.
 * 
 * IMPORTANT: Never modify or remove existing migrations. Only add new ones.
 */
export const migrations: Migration[] = [
  {
    version: 1,
    name: "add_clear_planning_folder",
    up: (db) => {
      // Check if the loops table exists (it should, but be safe)
      if (!tableExists(db, "loops")) {
        log.debug("loops table does not exist, skipping migration 1");
        return;
      }
      
      // Check if the column already exists
      const columns = getTableColumns(db, "loops");
      if (columns.includes("clear_planning_folder")) {
        log.debug("clear_planning_folder column already exists");
        return;
      }
      
      // Add the column
      db.run("ALTER TABLE loops ADD COLUMN clear_planning_folder INTEGER DEFAULT 0");
      log.info("Added clear_planning_folder column to loops table");
    },
  },
  {
    version: 2,
    name: "add_plan_mode_columns",
    up: (db) => {
      // Check if the loops table exists
      if (!tableExists(db, "loops")) {
        log.debug("loops table does not exist, skipping migration 2");
        return;
      }
      
      const columns = getTableColumns(db, "loops");
      
      // Add plan_mode_active column
      if (!columns.includes("plan_mode_active")) {
        db.run("ALTER TABLE loops ADD COLUMN plan_mode_active INTEGER DEFAULT 0");
        log.info("Added plan_mode_active column to loops table");
      }
      
      // Add plan_session_id column
      if (!columns.includes("plan_session_id")) {
        db.run("ALTER TABLE loops ADD COLUMN plan_session_id TEXT");
        log.info("Added plan_session_id column to loops table");
      }
      
      // Add plan_server_url column
      if (!columns.includes("plan_server_url")) {
        db.run("ALTER TABLE loops ADD COLUMN plan_server_url TEXT");
        log.info("Added plan_server_url column to loops table");
      }
      
      // Add plan_feedback_rounds column
      if (!columns.includes("plan_feedback_rounds")) {
        db.run("ALTER TABLE loops ADD COLUMN plan_feedback_rounds INTEGER DEFAULT 0");
        log.info("Added plan_feedback_rounds column to loops table");
      }
      
      // Add plan_content column
      if (!columns.includes("plan_content")) {
        db.run("ALTER TABLE loops ADD COLUMN plan_content TEXT");
        log.info("Added plan_content column to loops table");
      }
      
      // Add planning_folder_cleared column
      if (!columns.includes("planning_folder_cleared")) {
        db.run("ALTER TABLE loops ADD COLUMN planning_folder_cleared INTEGER DEFAULT 0");
        log.info("Added planning_folder_cleared column to loops table");
      }
    },
  },
  {
    version: 3,
    name: "add_review_mode_support",
    up: (db) => {
      // Check if the loops table exists
      if (!tableExists(db, "loops")) {
        log.debug("loops table does not exist, skipping migration 3");
        return;
      }
      
      const columns = getTableColumns(db, "loops");
      
      // Add review_mode column to store review mode state as JSON
      if (!columns.includes("review_mode")) {
        db.run("ALTER TABLE loops ADD COLUMN review_mode TEXT");
        log.info("Added review_mode column to loops table");
      }
    },
  },
  {
    version: 4,
    name: "add_draft_status_support",
    up: (db) => {
      // Check if the loops table exists
      if (!tableExists(db, "loops")) {
        log.debug("loops table does not exist, skipping migration 4");
        return;
      }
      
      // No schema changes needed - draft status uses existing status column
      // This migration exists for documentation purposes and to track the feature addition
      log.info("Draft status support enabled (no schema changes required)");
    },
  },
  {
    version: 5,
    name: "add_plan_mode_config_column",
    up: (db) => {
      // Check if the loops table exists
      if (!tableExists(db, "loops")) {
        log.debug("loops table does not exist, skipping migration 5");
        return;
      }
      
      const columns = getTableColumns(db, "loops");
      
      // Add plan_mode column to config (stores user's preference for plan mode)
      // This is different from plan_mode_active which is runtime state
      if (!columns.includes("plan_mode")) {
        db.run("ALTER TABLE loops ADD COLUMN plan_mode INTEGER DEFAULT 0");
        log.info("Added plan_mode column to loops table");
      }
    },
  },
  {
    version: 6,
    name: "add_review_comments_table",
    up: (db) => {
      // Create the review_comments table (CREATE TABLE IF NOT EXISTS is idempotent)
      db.run(`
        CREATE TABLE IF NOT EXISTS review_comments (
          id TEXT PRIMARY KEY,
          loop_id TEXT NOT NULL,
          review_cycle INTEGER NOT NULL,
          comment_text TEXT NOT NULL,
          created_at TEXT NOT NULL,
          status TEXT DEFAULT 'pending',
          addressed_at TEXT,
          FOREIGN KEY (loop_id) REFERENCES loops(id) ON DELETE CASCADE
        )
      `);
      
      // Always ensure indexes exist (CREATE INDEX IF NOT EXISTS is idempotent)
      db.run("CREATE INDEX IF NOT EXISTS idx_review_comments_loop_id ON review_comments(loop_id)");
      db.run("CREATE INDEX IF NOT EXISTS idx_review_comments_loop_cycle ON review_comments(loop_id, review_cycle)");
      
      log.info("Ensured review_comments table and indexes exist");
    },
  },
  {
    version: 7,
    name: "add_todos_to_loop_state",
    up: (db) => {
      // Check if the loops table exists
      if (!tableExists(db, "loops")) {
        log.debug("loops table does not exist, skipping migration 7");
        return;
      }
      
      const columns = getTableColumns(db, "loops");
      
      // Add todos column to store TODO items from the session
      if (!columns.includes("todos")) {
        db.run("ALTER TABLE loops ADD COLUMN todos TEXT");
        log.info("Added todos column to loops table");
      }
    },
  },
  {
    version: 8,
    name: "add_plan_is_ready_flag",
    up: (db) => {
      // Check if the loops table exists
      if (!tableExists(db, "loops")) {
        log.debug("loops table does not exist, skipping migration 8");
        return;
      }
      
      const columns = getTableColumns(db, "loops");
      
      // Add plan_is_ready column to track when plan is ready for acceptance
      if (!columns.includes("plan_is_ready")) {
        db.run("ALTER TABLE loops ADD COLUMN plan_is_ready INTEGER DEFAULT 0");
        log.info("Added plan_is_ready column to loops table");
      }
    },
  },
  {
    version: 9,
    name: "add_pending_model_columns",
    up: (db) => {
      // Check if the loops table exists
      if (!tableExists(db, "loops")) {
        log.debug("loops table does not exist, skipping migration 9");
        return;
      }
      
      const columns = getTableColumns(db, "loops");
      
      // Add pending_model_provider_id column for pending model changes
      if (!columns.includes("pending_model_provider_id")) {
        db.run("ALTER TABLE loops ADD COLUMN pending_model_provider_id TEXT");
        log.info("Added pending_model_provider_id column to loops table");
      }
      
      // Add pending_model_model_id column for pending model changes
      if (!columns.includes("pending_model_model_id")) {
        db.run("ALTER TABLE loops ADD COLUMN pending_model_model_id TEXT");
        log.info("Added pending_model_model_id column to loops table");
      }
    },
  },
  {
    version: 10,
    name: "add_workspaces_table",
    up: (db) => {
      // Create the workspaces table (CREATE TABLE IF NOT EXISTS is idempotent)
      db.run(`
        CREATE TABLE IF NOT EXISTS workspaces (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          directory TEXT UNIQUE NOT NULL,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        )
      `);
      
      // Create index on directory for efficient lookups
      db.run("CREATE INDEX IF NOT EXISTS idx_workspaces_directory ON workspaces(directory)");
      
      log.info("Created workspaces table with directory index");
      
      // Add workspace_id column to loops table
      if (tableExists(db, "loops")) {
        const columns = getTableColumns(db, "loops");
        if (!columns.includes("workspace_id")) {
          db.run("ALTER TABLE loops ADD COLUMN workspace_id TEXT REFERENCES workspaces(id)");
          log.info("Added workspace_id column to loops table");
        }
        
        // Create index on workspace_id for efficient queries
        db.run("CREATE INDEX IF NOT EXISTS idx_loops_workspace_id ON loops(workspace_id)");
        log.info("Created workspace_id index on loops table");
      }
    },
  },
  {
    version: 11,
    name: "migrate_existing_loops_to_workspaces",
    up: (db) => {
      // This migration creates workspaces for existing loops that don't have a workspace_id
      // It groups loops by directory and creates a workspace for each unique directory
      
      if (!tableExists(db, "loops") || !tableExists(db, "workspaces")) {
        log.debug("loops or workspaces table does not exist, skipping migration 11");
        return;
      }
      
      // Find all distinct directories from loops without a workspace_id
      const orphanedDirectories = db.query(`
        SELECT DISTINCT directory 
        FROM loops 
        WHERE workspace_id IS NULL AND directory IS NOT NULL AND directory != ''
      `).all() as Array<{ directory: string }>;
      
      if (orphanedDirectories.length === 0) {
        log.debug("No orphaned loops found, skipping workspace migration");
        return;
      }
      
      log.info(`Found ${orphanedDirectories.length} directories with orphaned loops, creating workspaces...`);
      
      const now = new Date().toISOString();
      
      for (const { directory } of orphanedDirectories) {
        // Check if a workspace already exists for this directory
        const existing = db.query("SELECT id FROM workspaces WHERE directory = ?").get(directory) as { id: string } | null;
        
        let workspaceId: string;
        
        if (existing) {
          workspaceId = existing.id;
          log.debug(`Workspace already exists for directory: ${directory}`);
        } else {
          // Generate a workspace ID (simple UUID-like format)
          workspaceId = `ws_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
          
          // Create workspace name from the directory path (use last path segment)
          const pathParts = directory.replace(/\/$/, "").split("/");
          const name = pathParts[pathParts.length - 1] || directory;
          
          // Create the workspace
          db.run(
            "INSERT INTO workspaces (id, name, directory, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
            [workspaceId, name, directory, now, now]
          );
          log.info(`Created workspace "${name}" for directory: ${directory}`);
        }
        
        // Update all loops in this directory to point to the workspace
        const result = db.run(
          "UPDATE loops SET workspace_id = ? WHERE directory = ? AND workspace_id IS NULL",
          [workspaceId, directory]
        );
        log.info(`Updated ${result.changes} loops to use workspace: ${workspaceId}`);
      }
      
      log.info("Completed migration of existing loops to workspaces");
    },
  },
  {
    version: 12,
    name: "add_server_settings_to_workspaces",
    up: (db) => {
      // This migration adds server_settings column to workspaces table
      // and migrates existing global server settings to all workspaces
      
      if (!tableExists(db, "workspaces")) {
        log.debug("workspaces table does not exist, skipping migration 12");
        return;
      }
      
      const columns = getTableColumns(db, "workspaces");
      
      // Add server_settings column if it doesn't exist
      if (!columns.includes("server_settings")) {
        db.run("ALTER TABLE workspaces ADD COLUMN server_settings TEXT NOT NULL DEFAULT '{}'");
        log.info("Added server_settings column to workspaces table");
      }
      
      // Default server settings (spawn mode)
      const defaultSettings = JSON.stringify({
        mode: "spawn",
        useHttps: false,
        allowInsecure: false,
      });
      
      // Get the current global server settings from preferences (if table exists)
      let serverSettingsJson = defaultSettings;
      if (tableExists(db, "preferences")) {
        const prefsRow = db.query("SELECT value FROM preferences WHERE key = ?").get("serverSettings") as { value: string } | null;
        if (prefsRow?.value) {
          serverSettingsJson = prefsRow.value;
        }
      }
      
      // Update all existing workspaces that have empty or default server_settings
      const result = db.run(
        "UPDATE workspaces SET server_settings = ? WHERE server_settings = '{}' OR server_settings IS NULL",
        [serverSettingsJson]
      );
      log.info(`Updated ${result.changes} workspaces with server settings`);
      
      // Delete the global serverSettings from preferences (no longer needed)
      if (tableExists(db, "preferences")) {
        db.run("DELETE FROM preferences WHERE key = ?", ["serverSettings"]);
        log.info("Removed global serverSettings from preferences table");
      }
    },
  },

  // Migration 13: Add model_variant columns for model variant support
  {
    version: 13,
    name: "add_model_variant_columns",
    up: (db) => {
      const columns = getTableColumns(db, "loops");
      
      // Add model_variant column for config model variant
      if (!columns.includes("model_variant")) {
        db.run("ALTER TABLE loops ADD COLUMN model_variant TEXT");
        log.info("Added model_variant column to loops table");
      }
      
      // Add pending_model_variant column for pending model variant
      if (!columns.includes("pending_model_variant")) {
        db.run("ALTER TABLE loops ADD COLUMN pending_model_variant TEXT");
        log.info("Added pending_model_variant column to loops table");
      }
    },
  },
];

/**
 * Create the schema_migrations table if it doesn't exist.
 */
function ensureMigrationsTable(db: Database): void {
  db.run(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at TEXT NOT NULL
    )
  `);
}

/**
 * Get the list of already-applied migration versions.
 */
function getAppliedVersions(db: Database): Set<number> {
  const rows = db.query("SELECT version FROM schema_migrations").all() as Array<{ version: number }>;
  return new Set(rows.map((row) => row.version));
}

/**
 * Record a migration as applied.
 */
function recordMigration(db: Database, migration: Migration): void {
  db.run(
    "INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)",
    [migration.version, migration.name, new Date().toISOString()]
  );
}

/**
 * Run all pending migrations.
 * 
 * This function is idempotent - it only runs migrations that haven't been applied yet.
 * Each migration is run in its own transaction for safety.
 * 
 * @param db The database instance
 * @returns The number of migrations applied
 */
export function runMigrations(db: Database): number {
  ensureMigrationsTable(db);
  
  const appliedVersions = getAppliedVersions(db);
  const pendingMigrations = migrations.filter((m) => !appliedVersions.has(m.version));
  
  if (pendingMigrations.length === 0) {
    log.debug("No pending migrations");
    return 0;
  }
  
  // Sort by version to ensure correct order
  pendingMigrations.sort((a, b) => a.version - b.version);
  
  log.info(`Running ${pendingMigrations.length} pending migration(s)...`);
  
  let appliedCount = 0;
  for (const migration of pendingMigrations) {
    log.info(`Applying migration ${migration.version}: ${migration.name}`);
    
    try {
      // Run each migration in a transaction
      const runMigration = db.transaction(() => {
        migration.up(db);
        recordMigration(db, migration);
      });
      
      runMigration();
      appliedCount++;
      log.info(`Migration ${migration.version} applied successfully`);
    } catch (error) {
      log.error(`Failed to apply migration ${migration.version}: ${String(error)}`);
      throw error;
    }
  }
  
  log.info(`Applied ${appliedCount} migration(s)`);
  return appliedCount;
}

/**
 * Get the current schema version (highest applied migration version).
 * Returns 0 if no migrations have been applied.
 */
export function getSchemaVersion(db: Database): number {
  if (!tableExists(db, "schema_migrations")) {
    return 0;
  }
  
  const result = db.query("SELECT MAX(version) as version FROM schema_migrations").get() as { version: number | null };
  return result.version ?? 0;
}
