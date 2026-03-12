/**
 * Tests for the database migration system.
 *
 * These tests verify that the migration infrastructure works correctly.
 * Legacy migration tests (v1-v16) were removed as part of the clean-cut
 * schema reset. The base schema now contains all columns directly.
 */

import { test, expect, describe, beforeEach, afterEach } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtemp, rm } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import {
  runMigrations,
  getSchemaVersion,
  migrations,
  getTableColumns,
  tableExists,
} from "../../src/persistence/migrations";

function nextMigrationVersion(offset = 1): number {
  const highestExisting = migrations.reduce((max, migration) => Math.max(max, migration.version), 0);
  return highestExisting + offset;
}

describe("migration infrastructure", () => {
  let tempDir: string;
  let db: Database;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "ralpher-migration-test-"));
    db = new Database(join(tempDir, "test.db"));
    db.run("PRAGMA foreign_keys = ON");
  });

  afterEach(async () => {
    db.close();
    await rm(tempDir, { recursive: true, force: true });
  });

  describe("getSchemaVersion", () => {
    test("returns 0 when no schema_migrations table exists", () => {
      expect(getSchemaVersion(db)).toBe(0);
    });

    test("returns 0 when schema_migrations table exists but is empty", () => {
      db.run(`
        CREATE TABLE schema_migrations (
          version INTEGER PRIMARY KEY,
          name TEXT NOT NULL,
          applied_at TEXT NOT NULL
        )
      `);
      expect(getSchemaVersion(db)).toBe(0);
    });

    test("returns the highest version number", () => {
      db.run(`
        CREATE TABLE schema_migrations (
          version INTEGER PRIMARY KEY,
          name TEXT NOT NULL,
          applied_at TEXT NOT NULL
        )
      `);
      db.run("INSERT INTO schema_migrations (version, name, applied_at) VALUES (1, 'first', '2025-01-01')");
      db.run("INSERT INTO schema_migrations (version, name, applied_at) VALUES (3, 'third', '2025-01-03')");
      db.run("INSERT INTO schema_migrations (version, name, applied_at) VALUES (2, 'second', '2025-01-02')");
      expect(getSchemaVersion(db)).toBe(3);
    });
  });

  describe("runMigrations", () => {
    test("creates schema_migrations table when it does not exist", () => {
      expect(tableExists(db, "schema_migrations")).toBe(false);
      runMigrations(db);
      expect(tableExists(db, "schema_migrations")).toBe(true);
    });

    test("applies all pending migrations and returns the applied count", () => {
      expect(migrations.length).toBeGreaterThan(0);
      const applied = runMigrations(db);
      expect(applied).toBe(migrations.length);
    });

    test("is idempotent - safe to call multiple times", () => {
      runMigrations(db);
      runMigrations(db);
      runMigrations(db);
      expect(tableExists(db, "schema_migrations")).toBe(true);
    });

    test("adds use_worktree for an existing saved draft loop", () => {
      db.run(`
        CREATE TABLE loops (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'draft'
        )
      `);
      db.run("INSERT INTO loops (id, name, status) VALUES ('draft-1', 'Draft loop', 'draft')");

      runMigrations(db);

      expect(getTableColumns(db, "loops")).toContain("use_worktree");
      const row = db.query("SELECT status, use_worktree FROM loops WHERE id = ?").get("draft-1") as {
        status: string;
        use_worktree: number;
      };
      expect(row.status).toBe("draft");
      expect(row.use_worktree).toBe(1);
    });

    test("rebuilds workspaces for server-aware uniqueness", () => {
      db.run(`
        CREATE TABLE workspaces (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          directory TEXT UNIQUE NOT NULL,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          server_settings TEXT NOT NULL DEFAULT '{}'
        )
      `);
      db.run(`
        CREATE TABLE loops (
          id TEXT PRIMARY KEY,
          workspace_id TEXT,
          FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
        )
      `);

      db.run(
        `INSERT INTO workspaces (id, name, directory, server_settings, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [
          "ws-1",
          "Workspace One",
          "/tmp/shared-dir",
          JSON.stringify({
            agent: {
              provider: "opencode",
              transport: "stdio",
            },
          }),
          "2025-01-01T00:00:00.000Z",
          "2025-01-01T00:00:00.000Z",
        ],
      );
      db.run(`INSERT INTO loops (id, workspace_id) VALUES ('loop-1', 'ws-1')`);

      runMigrations(db);

      expect(getTableColumns(db, "workspaces")).toContain("server_fingerprint");
      db.run(
        `INSERT INTO workspaces (
          id,
          name,
          directory,
          server_fingerprint,
          server_settings,
          created_at,
          updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [
          "ws-2",
          "Workspace Two",
          "/tmp/shared-dir",
          "opencode:ssh:host.example:22:",
          JSON.stringify({
            agent: {
              provider: "opencode",
              transport: "ssh",
              hostname: "host.example",
              port: 22,
            },
          }),
          "2025-01-02T00:00:00.000Z",
          "2025-01-02T00:00:00.000Z",
        ],
      );

      const rows = db.query(
        "SELECT id, directory, server_fingerprint FROM workspaces ORDER BY id ASC"
      ).all() as Array<{ id: string; directory: string; server_fingerprint: string }>;
      expect(rows).toHaveLength(2);
      expect(rows[0]?.server_fingerprint).toBe("opencode:stdio");

      const loopRow = db.query("SELECT workspace_id FROM loops WHERE id = 'loop-1'").get() as {
        workspace_id: string;
      };
      expect(loopRow.workspace_id).toBe("ws-1");
    });

    test("adds loop_id to ssh_sessions and enforces one session per loop", () => {
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
          error_message TEXT
        )
      `);

      runMigrations(db);

      expect(getTableColumns(db, "ssh_sessions")).toContain("loop_id");
      db.run(
        `INSERT INTO ssh_sessions (
          id,
          name,
          workspace_id,
          loop_id,
          directory,
          remote_session_name,
          created_at,
          updated_at,
          status
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          "ssh-1",
          "Linked Session",
          "workspace-1",
          "loop-1",
          "/tmp/worktree",
          "ralpher-ssh1",
          "2025-01-01T00:00:00.000Z",
          "2025-01-01T00:00:00.000Z",
          "ready",
        ],
      );

      expect(() => {
        db.run(
          `INSERT INTO ssh_sessions (
            id,
            name,
            workspace_id,
            loop_id,
            directory,
            remote_session_name,
            created_at,
            updated_at,
            status
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            "ssh-2",
            "Duplicate Linked Session",
            "workspace-1",
            "loop-1",
            "/tmp/worktree",
            "ralpher-ssh2",
            "2025-01-01T00:00:00.000Z",
            "2025-01-01T00:00:00.000Z",
            "ready",
          ],
        );
      }).toThrow();
    });

    test("creates forwarded_ports with active local-port uniqueness", () => {
      db.run(`
        CREATE TABLE schema_migrations (
          version INTEGER PRIMARY KEY,
          name TEXT NOT NULL,
          applied_at TEXT NOT NULL
        )
      `);
      for (const migration of migrations.filter((migration) => migration.version <= 4)) {
        db.run(
          "INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)",
          [migration.version, migration.name, "2025-01-01T00:00:00.000Z"],
        );
      }
      db.run("CREATE TABLE workspaces (id TEXT PRIMARY KEY)");
      db.run("CREATE TABLE loops (id TEXT PRIMARY KEY, workspace_id TEXT)");
      db.run("CREATE TABLE ssh_sessions (id TEXT PRIMARY KEY)");

      runMigrations(db);

      expect(tableExists(db, "forwarded_ports")).toBe(true);
      expect(getTableColumns(db, "forwarded_ports")).toContain("local_port");
      db.run("INSERT INTO workspaces (id) VALUES ('workspace-1')");
      db.run("INSERT INTO loops (id, workspace_id) VALUES ('loop-1', 'workspace-1')");
      db.run(
        `INSERT INTO forwarded_ports (
          id,
          loop_id,
          workspace_id,
          remote_host,
          remote_port,
          local_port,
          created_at,
          updated_at,
          status
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          "forward-1",
          "loop-1",
          "workspace-1",
          "127.0.0.1",
          3000,
          43001,
          "2025-01-01T00:00:00.000Z",
          "2025-01-01T00:00:00.000Z",
          "active",
        ],
      );

      expect(() => {
        db.run(
          `INSERT INTO forwarded_ports (
            id,
            loop_id,
            workspace_id,
            remote_host,
            remote_port,
            local_port,
            created_at,
            updated_at,
            status
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            "forward-2",
            "loop-1",
            "workspace-1",
            "127.0.0.1",
            3001,
            43001,
            "2025-01-01T00:00:00.000Z",
            "2025-01-01T00:00:00.000Z",
            "active",
          ],
        );
      }).toThrow();
    });

    test("enforces one active remote port per workspace for forwarded ports", () => {
      db.run(`
        CREATE TABLE schema_migrations (
          version INTEGER PRIMARY KEY,
          name TEXT NOT NULL,
          applied_at TEXT NOT NULL
        )
      `);
      for (const migration of migrations.filter((migration) => migration.version < 6)) {
        db.run(
          "INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)",
          [migration.version, migration.name, "2025-01-01T00:00:00.000Z"],
        );
      }
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
          error_message TEXT
        )
      `);
      db.run(`
        CREATE UNIQUE INDEX IF NOT EXISTS idx_forwarded_ports_local_port_active
        ON forwarded_ports(local_port)
        WHERE status IN ('starting', 'active', 'stopping')
      `);
      db.run(
        `INSERT INTO forwarded_ports (
          id,
          loop_id,
          workspace_id,
          remote_host,
          remote_port,
          local_port,
          created_at,
          updated_at,
          status,
          pid,
          connected_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          "forward-older",
          "loop-1",
          "workspace-1",
          "localhost",
          3000,
          43001,
          "2025-01-01T00:00:00.000Z",
          "2025-01-01T00:00:00.000Z",
          "active",
          12345,
          "2025-01-01T00:00:01.000Z",
        ],
      );
      db.run(
        `INSERT INTO forwarded_ports (
          id,
          loop_id,
          workspace_id,
          remote_host,
          remote_port,
          local_port,
          created_at,
          updated_at,
          status
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          "forward-newer",
          "loop-2",
          "workspace-1",
          "localhost",
          3000,
          43002,
          "2025-01-02T00:00:00.000Z",
          "2025-01-02T00:00:00.000Z",
          "active",
        ],
      );

      runMigrations(db);

      const rows = db.query(
        "SELECT id, status, pid, connected_at, error_message FROM forwarded_ports ORDER BY id ASC",
      ).all() as Array<{
        id: string;
        status: string;
        pid: number | null;
        connected_at: string | null;
        error_message: string | null;
      }>;
      expect(rows).toEqual([
        {
          id: "forward-newer",
          status: "active",
          pid: null,
          connected_at: null,
          error_message: null,
        },
        {
          id: "forward-older",
          status: "stopped",
          pid: null,
          connected_at: null,
          error_message: "Stopped during duplicate port-forward cleanup",
        },
      ]);

      expect(() => {
        db.run(
          `INSERT INTO forwarded_ports (
            id,
            loop_id,
            workspace_id,
            remote_host,
            remote_port,
            local_port,
            created_at,
            updated_at,
            status
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            "forward-duplicate-active",
            "loop-3",
            "workspace-1",
            "localhost",
            3000,
            43003,
            "2025-01-03T00:00:00.000Z",
            "2025-01-03T00:00:00.000Z",
            "active",
          ],
        );
      }).toThrow();

      expect(() => {
        db.run(
          `INSERT INTO forwarded_ports (
            id,
            loop_id,
            workspace_id,
            remote_host,
            remote_port,
            local_port,
            created_at,
            updated_at,
            status
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            "forward-stopped",
            "loop-4",
            "workspace-1",
            "localhost",
            3000,
            43004,
            "2025-01-03T00:00:00.000Z",
            "2025-01-03T00:00:00.000Z",
            "stopped",
          ],
        );
      }).not.toThrow();

      expect(() => {
        db.run(
          `INSERT INTO forwarded_ports (
            id,
            loop_id,
            workspace_id,
            remote_host,
            remote_port,
            local_port,
            created_at,
            updated_at,
            status
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            "forward-other-workspace",
            "loop-5",
            "workspace-2",
            "localhost",
            3000,
            43005,
            "2025-01-03T00:00:00.000Z",
            "2025-01-03T00:00:00.000Z",
            "active",
          ],
        );
      }).not.toThrow();
    });
  });

  describe("getTableColumns", () => {
    test("returns column names for an existing table", () => {
      db.run("CREATE TABLE loops (id TEXT PRIMARY KEY, name TEXT NOT NULL)");
      const columns = getTableColumns(db, "loops");
      expect(columns).toContain("id");
      expect(columns).toContain("name");
    });

    test("returns column names even when table has no rows", () => {
      db.run("CREATE TABLE loops (id TEXT PRIMARY KEY)");
      const columns = getTableColumns(db, "loops");
      expect(columns).toEqual(["id"]);
    });

    test("throws for unknown table names (SQL injection prevention)", () => {
      expect(() => getTableColumns(db, "malicious_table")).toThrow(
        'Unknown table name: "malicious_table"'
      );
    });

    test("throws for SQL injection attempts", () => {
      expect(() => getTableColumns(db, "loops; DROP TABLE loops")).toThrow();
    });

    test("works for all known table names", () => {
      // Create all known tables
      db.run("CREATE TABLE loops (id TEXT PRIMARY KEY)");
      db.run("CREATE TABLE ssh_sessions (id TEXT PRIMARY KEY)");
      db.run("CREATE TABLE workspaces (id TEXT PRIMARY KEY)");
      db.run("CREATE TABLE forwarded_ports (id TEXT PRIMARY KEY)");
      db.run("CREATE TABLE preferences (key TEXT PRIMARY KEY)");
      db.run("CREATE TABLE review_comments (id TEXT PRIMARY KEY)");
      db.run("CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY)");

      // All should work without throwing
      expect(getTableColumns(db, "loops")).toContain("id");
      expect(getTableColumns(db, "ssh_sessions")).toContain("id");
      expect(getTableColumns(db, "workspaces")).toContain("id");
      expect(getTableColumns(db, "forwarded_ports")).toContain("id");
      expect(getTableColumns(db, "preferences")).toContain("key");
      expect(getTableColumns(db, "review_comments")).toContain("id");
      expect(getTableColumns(db, "schema_migrations")).toContain("version");
    });
  });

  describe("tableExists", () => {
    test("returns false for non-existing table", () => {
      expect(tableExists(db, "loops")).toBe(false);
    });

    test("returns true for existing table", () => {
      db.run("CREATE TABLE loops (id TEXT PRIMARY KEY)");
      expect(tableExists(db, "loops")).toBe(true);
    });

    test("returns false after table is dropped", () => {
      db.run("CREATE TABLE loops (id TEXT PRIMARY KEY)");
      expect(tableExists(db, "loops")).toBe(true);
      db.run("DROP TABLE loops");
      expect(tableExists(db, "loops")).toBe(false);
    });
  });

  describe("migration execution with mock migration", () => {
    test("applies a mock migration and records it", () => {
      // Create a table to migrate
      db.run("CREATE TABLE loops (id TEXT PRIMARY KEY, name TEXT NOT NULL)");

      // Temporarily add a mock migration
      const originalLength = migrations.length;
      const version = nextMigrationVersion();
      migrations.push({
        version,
        name: "test_add_description",
        up: (database) => {
          const columns = getTableColumns(database, "loops");
          if (!columns.includes("description")) {
            database.run("ALTER TABLE loops ADD COLUMN description TEXT");
          }
        },
      });

      try {
        const applied = runMigrations(db);
        expect(applied).toBe(originalLength + 1);

        // Verify the column was added
        const columns = getTableColumns(db, "loops");
        expect(columns).toContain("description");

        // Verify schema version
        expect(getSchemaVersion(db)).toBe(version);

        // Verify schema_migrations has the record
        const record = db.query(`SELECT * FROM schema_migrations WHERE version = ${version}`).get() as {
          version: number;
          name: string;
          applied_at: string;
        };
        expect(record).not.toBeNull();
        expect(record.name).toBe("test_add_description");
        expect(record.applied_at).toBeTruthy();
      } finally {
        // Restore the original migrations array
        migrations.length = originalLength;
      }
    });

    test("does not re-apply already applied migrations", () => {
      db.run("CREATE TABLE loops (id TEXT PRIMARY KEY, name TEXT NOT NULL)");

      let callCount = 0;
      const originalLength = migrations.length;
      const version = nextMigrationVersion();
      migrations.push({
        version,
        name: "test_counting",
        up: () => {
          callCount++;
        },
      });

      try {
        runMigrations(db);
        expect(callCount).toBe(1);

        // Run again - should not re-apply
        runMigrations(db);
        expect(callCount).toBe(1);
      } finally {
        migrations.length = originalLength;
      }
    });

    test("applies migrations in version order", () => {
      db.run("CREATE TABLE loops (id TEXT PRIMARY KEY)");

      const appliedOrder: number[] = [];
      const originalLength = migrations.length;

      // Add migrations in reverse order
      const version1 = nextMigrationVersion();
      const version2 = nextMigrationVersion(2);
      const version3 = nextMigrationVersion(3);
      migrations.push({
        version: version3,
        name: "third",
        up: () => { appliedOrder.push(3); },
      });
      migrations.push({
        version: version1,
        name: "first",
        up: () => { appliedOrder.push(1); },
      });
      migrations.push({
        version: version2,
        name: "second",
        up: () => { appliedOrder.push(2); },
      });

      try {
        const applied = runMigrations(db);
        expect(applied).toBe(originalLength + 3);
        expect(appliedOrder).toEqual([1, 2, 3]);
      } finally {
        migrations.length = originalLength;
      }
    });

    test("rolls back individual migration on failure", () => {
      db.run("CREATE TABLE loops (id TEXT PRIMARY KEY)");

      const originalLength = migrations.length;
      const goodVersion = nextMigrationVersion();
      const badVersion = nextMigrationVersion(2);
      migrations.push({
        version: goodVersion,
        name: "good_migration",
        up: (database) => {
          const columns = getTableColumns(database, "loops");
          if (!columns.includes("good_column")) {
            database.run("ALTER TABLE loops ADD COLUMN good_column TEXT");
          }
        },
      });
      migrations.push({
        version: badVersion,
        name: "bad_migration",
        up: () => {
          throw new Error("Migration failed deliberately");
        },
      });

      try {
        expect(() => runMigrations(db)).toThrow("Migration failed deliberately");

        // Good migration should have been applied (it ran in its own transaction)
        const columns = getTableColumns(db, "loops");
        expect(columns).toContain("good_column");
        expect(getSchemaVersion(db)).toBe(goodVersion);
      } finally {
        migrations.length = originalLength;
      }
    });
  });
});
