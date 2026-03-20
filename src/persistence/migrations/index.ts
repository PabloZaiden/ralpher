/**
 * Database migration system for Ralpher.
 *
 * Migrations allow the database schema to evolve over time. The base schema
 * in `database.ts` contains the complete current schema. Migrations are used
 * only for changes added after the base schema was established.
 *
 * ## Adding a New Migration
 *
 * 1. Add a new entry to the `migrations` array with:
 *    - `version`: Next sequential integer starting from 1
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
 *   version: 1,
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
import { createLogger } from "../../core/logger";
import { getServerFingerprint, parseServerSettings } from "../../types/settings";

const log = createLogger("persistence:migrations");

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
  /** Whether the migration should be wrapped in the default transaction */
  transactional?: boolean;
}

/**
 * Known table names that are used in migrations.
 * Used to validate tableName before interpolation into PRAGMA queries,
 * since PRAGMA does not support parameterized queries.
 */
const KNOWN_TABLE_NAMES = new Set([
  "loops",
  "ssh_sessions",
  "ssh_servers",
  "ssh_server_sessions",
  "forwarded_ports",
  "workspaces",
  "preferences",
  "review_comments",
  "schema_migrations",
]);

/**
 * Get the column names for a table.
 * Useful for checking if a column already exists before adding it.
 *
 * @throws Error if tableName is not in the KNOWN_TABLE_NAMES whitelist.
 */
export function getTableColumns(db: Database, tableName: string): string[] {
  // Validate table name against whitelist to prevent SQL injection.
  // PRAGMA queries do not support parameterized values, so we must
  // ensure the table name is safe before interpolation.
  if (!KNOWN_TABLE_NAMES.has(tableName)) {
    throw new Error(`Unknown table name: "${tableName}". Add it to KNOWN_TABLE_NAMES if it is a valid table.`);
  }
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
 * Version numbers start from 1.
 *
 * Note: Legacy migrations (v1-v16) were removed in a clean-cut reset.
 * Their schema changes are now part of the base schema in database.ts.
 */
export const migrations: Migration[] = [
  {
    version: 1,
    name: "create_ssh_sessions",
    up: (db) => {
      if (!tableExists(db, "ssh_sessions")) {
        db.run(`
          CREATE TABLE ssh_sessions (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            workspace_id TEXT NOT NULL,
            directory TEXT NOT NULL,
            remote_session_name TEXT NOT NULL,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            status TEXT NOT NULL DEFAULT 'ready',
            last_connected_at TEXT,
            error_message TEXT,
            FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
          )
        `);
      }
      db.run(`
        CREATE INDEX IF NOT EXISTS idx_ssh_sessions_workspace_id
        ON ssh_sessions(workspace_id)
      `);
      db.run(`
        CREATE INDEX IF NOT EXISTS idx_ssh_sessions_created_at
        ON ssh_sessions(created_at DESC)
      `);
    },
  },
  {
    version: 2,
    name: "add_use_worktree_to_loops",
    up: (db) => {
      if (!tableExists(db, "loops")) {
        return;
      }
      const columns = getTableColumns(db, "loops");
      if (columns.includes("use_worktree")) {
        return;
      }
      // Retain this upgrade path narrowly for already-saved draft loops on
      // existing databases so they can still be edited or started after the
      // new useWorktree setting became part of persisted loop config.
      db.run("ALTER TABLE loops ADD COLUMN use_worktree INTEGER NOT NULL DEFAULT 1");
    },
  },
  {
    version: 3,
    name: "make_workspaces_server_aware",
    transactional: false,
    up: (db) => {
      if (!tableExists(db, "workspaces")) {
        return;
      }

      const columns = getTableColumns(db, "workspaces");
      if (columns.includes("server_fingerprint")) {
        db.run(`
          CREATE UNIQUE INDEX IF NOT EXISTS idx_workspaces_directory_server_fingerprint
          ON workspaces(directory, server_fingerprint)
        `);
        return;
      }

      const rows = db.query(`
        SELECT id, name, directory, server_settings, created_at, updated_at
        FROM workspaces
      `).all() as Array<{
        id: string;
        name: string;
        directory: string;
        server_settings: string | null;
        created_at: string;
        updated_at: string;
      }>;

      db.run("PRAGMA foreign_keys = OFF");
      try {
        const migrate = db.transaction(() => {
          db.run(`
            CREATE TABLE workspaces_new (
              id TEXT PRIMARY KEY,
              name TEXT NOT NULL,
              directory TEXT NOT NULL,
              server_fingerprint TEXT NOT NULL,
              created_at TEXT NOT NULL,
              updated_at TEXT NOT NULL,
              server_settings TEXT NOT NULL DEFAULT '{}'
            )
          `);

          const insertStmt = db.prepare(`
            INSERT INTO workspaces_new (
              id,
              name,
              directory,
              server_fingerprint,
              server_settings,
              created_at,
              updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?)
          `);

          for (const row of rows) {
            const serverSettings = parseServerSettings(row.server_settings);
            insertStmt.run(
              row.id,
              row.name,
              row.directory,
              getServerFingerprint(serverSettings),
              row.server_settings ?? "{}",
              row.created_at,
              row.updated_at,
            );
          }

          db.run("DROP TABLE workspaces");
          db.run("ALTER TABLE workspaces_new RENAME TO workspaces");
          db.run(`
            CREATE UNIQUE INDEX idx_workspaces_directory_server_fingerprint
            ON workspaces(directory, server_fingerprint)
          `);
        });

        migrate();
      } finally {
        db.run("PRAGMA foreign_keys = ON");
      }
    },
  },
  {
    version: 4,
    name: "add_loop_id_to_ssh_sessions",
    up: (db) => {
      if (!tableExists(db, "ssh_sessions")) {
        return;
      }
      const columns = getTableColumns(db, "ssh_sessions");
      if (!columns.includes("loop_id")) {
        db.run("ALTER TABLE ssh_sessions ADD COLUMN loop_id TEXT");
      }
      db.run(`
        CREATE UNIQUE INDEX IF NOT EXISTS idx_ssh_sessions_loop_id_unique
        ON ssh_sessions(loop_id)
        WHERE loop_id IS NOT NULL
      `);
    },
  },
  {
    version: 5,
    name: "create_forwarded_ports",
    up: (db) => {
      if (!tableExists(db, "forwarded_ports")) {
        db.run(`
          CREATE TABLE forwarded_ports (
            id TEXT PRIMARY KEY,
            loop_id TEXT NOT NULL,
            workspace_id TEXT NOT NULL,
            ssh_session_id TEXT,
            remote_host TEXT NOT NULL,
            remote_port INTEGER NOT NULL,
            local_port INTEGER NOT NULL,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            status TEXT NOT NULL DEFAULT 'starting',
            pid INTEGER,
            connected_at TEXT,
            error_message TEXT,
            FOREIGN KEY (loop_id) REFERENCES loops(id) ON DELETE CASCADE,
            FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,
            FOREIGN KEY (ssh_session_id) REFERENCES ssh_sessions(id) ON DELETE CASCADE
          )
        `);
      }
      db.run(`
        CREATE INDEX IF NOT EXISTS idx_forwarded_ports_loop_id
        ON forwarded_ports(loop_id, created_at DESC)
      `);
      db.run(`
        CREATE INDEX IF NOT EXISTS idx_forwarded_ports_ssh_session_id
        ON forwarded_ports(ssh_session_id)
      `);
      db.run(`
        CREATE UNIQUE INDEX IF NOT EXISTS idx_forwarded_ports_local_port_active
        ON forwarded_ports(local_port)
        WHERE status IN ('starting', 'active', 'stopping')
      `);
    },
  },
  {
    version: 6,
    name: "enforce_unique_active_workspace_remote_ports",
    up: (db) => {
      if (!tableExists(db, "forwarded_ports")) {
        return;
      }

      db.run(`
        UPDATE forwarded_ports
        SET
          status = 'stopped',
          pid = NULL,
          connected_at = NULL,
          updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
          error_message = COALESCE(
            error_message,
            'Stopped during duplicate port-forward cleanup'
          )
        WHERE status IN ('starting', 'active', 'stopping')
          AND EXISTS (
            SELECT 1
            FROM forwarded_ports AS newer
            WHERE newer.workspace_id = forwarded_ports.workspace_id
              AND newer.remote_port = forwarded_ports.remote_port
              AND newer.status IN ('starting', 'active', 'stopping')
              AND (
                newer.created_at > forwarded_ports.created_at
                OR (
                  newer.created_at = forwarded_ports.created_at
                  AND newer.id > forwarded_ports.id
                )
              )
          )
      `);
      db.run(`
        CREATE UNIQUE INDEX IF NOT EXISTS idx_forwarded_ports_workspace_remote_port_active
        ON forwarded_ports(workspace_id, remote_port)
        WHERE status IN ('starting', 'active', 'stopping')
      `);
    },
  },
  {
    version: 7,
    name: "add_plan_question_persistence",
    up: (db) => {
      if (!tableExists(db, "loops")) {
        return;
      }
      const columns = getTableColumns(db, "loops");
      if (!columns.includes("plan_mode_auto_reply")) {
        db.run("ALTER TABLE loops ADD COLUMN plan_mode_auto_reply INTEGER NOT NULL DEFAULT 1");
      }
      if (!columns.includes("pending_plan_question")) {
        db.run("ALTER TABLE loops ADD COLUMN pending_plan_question TEXT");
      }
    },
  },
  {
    version: 8,
    name: "create_ssh_servers_and_sessions",
    up: (db) => {
      if (!tableExists(db, "ssh_servers")) {
        db.run(`
          CREATE TABLE ssh_servers (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            address TEXT NOT NULL,
            username TEXT NOT NULL,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
          )
        `);
      }
      db.run(`
        CREATE INDEX IF NOT EXISTS idx_ssh_servers_name
        ON ssh_servers(name COLLATE NOCASE, created_at ASC)
      `);

      if (!tableExists(db, "ssh_server_sessions")) {
        db.run(`
          CREATE TABLE ssh_server_sessions (
            id TEXT PRIMARY KEY,
            ssh_server_id TEXT NOT NULL,
            name TEXT NOT NULL,
            remote_session_name TEXT NOT NULL,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            status TEXT NOT NULL DEFAULT 'ready',
            last_connected_at TEXT,
            error_message TEXT,
            FOREIGN KEY (ssh_server_id) REFERENCES ssh_servers(id) ON DELETE CASCADE
          )
        `);
      }
      db.run(`
        CREATE INDEX IF NOT EXISTS idx_ssh_server_sessions_server_id
        ON ssh_server_sessions(ssh_server_id, created_at DESC)
      `);
      db.run(`
        CREATE INDEX IF NOT EXISTS idx_ssh_server_sessions_created_at
        ON ssh_server_sessions(created_at DESC)
      `);
    },
  },
  {
    version: 9,
    name: "add_ssh_connection_mode",
    up: (db) => {
      if (tableExists(db, "ssh_sessions")) {
        const sshSessionColumns = getTableColumns(db, "ssh_sessions");
        if (!sshSessionColumns.includes("connection_mode")) {
          db.run("ALTER TABLE ssh_sessions ADD COLUMN connection_mode TEXT NOT NULL DEFAULT 'dtach'");
        }
      }

      if (tableExists(db, "ssh_server_sessions")) {
        const sshServerSessionColumns = getTableColumns(db, "ssh_server_sessions");
        if (!sshServerSessionColumns.includes("connection_mode")) {
          db.run("ALTER TABLE ssh_server_sessions ADD COLUMN connection_mode TEXT NOT NULL DEFAULT 'dtach'");
        }
      }
    },
  },
  {
    version: 10,
    name: "normalize_ssh_connection_modes_and_add_notices",
    up: (db) => {
      if (tableExists(db, "ssh_sessions")) {
        const sshSessionColumns = getTableColumns(db, "ssh_sessions");
        if (!sshSessionColumns.includes("runtime_connection_mode")) {
          db.run("ALTER TABLE ssh_sessions ADD COLUMN runtime_connection_mode TEXT");
        }
        if (!sshSessionColumns.includes("notice_message")) {
          db.run("ALTER TABLE ssh_sessions ADD COLUMN notice_message TEXT");
        }
        db.run(`
          UPDATE ssh_sessions
          SET connection_mode = 'dtach'
          WHERE connection_mode IS NULL
            OR (connection_mode <> 'direct' AND connection_mode <> 'dtach')
        `);
      }

      if (tableExists(db, "ssh_server_sessions")) {
        const sshServerSessionColumns = getTableColumns(db, "ssh_server_sessions");
        if (!sshServerSessionColumns.includes("runtime_connection_mode")) {
          db.run("ALTER TABLE ssh_server_sessions ADD COLUMN runtime_connection_mode TEXT");
        }
        if (!sshServerSessionColumns.includes("notice_message")) {
          db.run("ALTER TABLE ssh_server_sessions ADD COLUMN notice_message TEXT");
        }
        db.run(`
          UPDATE ssh_server_sessions
          SET connection_mode = 'dtach'
          WHERE connection_mode IS NULL
            OR (connection_mode <> 'direct' AND connection_mode <> 'dtach')
        `);
      }
    },
  },
  {
    version: 11,
    name: "add_repositories_base_path_to_ssh_servers",
    up: (db) => {
      if (!tableExists(db, "ssh_servers")) {
        return;
      }
      const columns = getTableColumns(db, "ssh_servers");
      if (!columns.includes("repositories_base_path")) {
        db.run("ALTER TABLE ssh_servers ADD COLUMN repositories_base_path TEXT");
      }
    },
  },
  {
    version: 12,
    name: "add_provisioning_metadata_to_workspaces",
    up: (db) => {
      if (!tableExists(db, "workspaces")) {
        return;
      }
      const columns = getTableColumns(db, "workspaces");
      if (!columns.includes("source_directory")) {
        db.run("ALTER TABLE workspaces ADD COLUMN source_directory TEXT");
      }
      if (!columns.includes("ssh_server_id")) {
        db.run("ALTER TABLE workspaces ADD COLUMN ssh_server_id TEXT");
      }
      if (!columns.includes("repo_url")) {
        db.run("ALTER TABLE workspaces ADD COLUMN repo_url TEXT");
      }
      if (!columns.includes("base_path")) {
        db.run("ALTER TABLE workspaces ADD COLUMN base_path TEXT");
      }
      if (!columns.includes("provider")) {
        db.run("ALTER TABLE workspaces ADD COLUMN provider TEXT");
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
      if (migration.transactional === false) {
        migration.up(db);
        recordMigration(db, migration);
      } else {
        const runMigration = db.transaction(() => {
          migration.up(db);
          recordMigration(db, migration);
        });

        runMigration();
      }
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
