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

    test("returns 0 when no migrations are defined", () => {
      expect(migrations.length).toBe(0);
      const applied = runMigrations(db);
      expect(applied).toBe(0);
    });

    test("is idempotent - safe to call multiple times", () => {
      runMigrations(db);
      runMigrations(db);
      runMigrations(db);
      expect(tableExists(db, "schema_migrations")).toBe(true);
    });
  });

  describe("getTableColumns", () => {
    test("returns column names for an existing table", () => {
      db.run("CREATE TABLE loops (id TEXT PRIMARY KEY, name TEXT NOT NULL)");
      const columns = getTableColumns(db, "loops");
      expect(columns).toContain("id");
      expect(columns).toContain("name");
    });

    test("returns empty array for an existing table with no rows", () => {
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
      db.run("CREATE TABLE workspaces (id TEXT PRIMARY KEY)");
      db.run("CREATE TABLE preferences (key TEXT PRIMARY KEY)");
      db.run("CREATE TABLE review_comments (id TEXT PRIMARY KEY)");
      db.run("CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY)");

      // All should work without throwing
      expect(getTableColumns(db, "loops")).toContain("id");
      expect(getTableColumns(db, "workspaces")).toContain("id");
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
      migrations.push({
        version: 1,
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
        expect(applied).toBe(1);

        // Verify the column was added
        const columns = getTableColumns(db, "loops");
        expect(columns).toContain("description");

        // Verify schema version
        expect(getSchemaVersion(db)).toBe(1);

        // Verify schema_migrations has the record
        const record = db.query("SELECT * FROM schema_migrations WHERE version = 1").get() as {
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
      migrations.push({
        version: 1,
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
      migrations.push({
        version: 3,
        name: "third",
        up: () => { appliedOrder.push(3); },
      });
      migrations.push({
        version: 1,
        name: "first",
        up: () => { appliedOrder.push(1); },
      });
      migrations.push({
        version: 2,
        name: "second",
        up: () => { appliedOrder.push(2); },
      });

      try {
        const applied = runMigrations(db);
        expect(applied).toBe(3);
        expect(appliedOrder).toEqual([1, 2, 3]);
      } finally {
        migrations.length = originalLength;
      }
    });

    test("rolls back individual migration on failure", () => {
      db.run("CREATE TABLE loops (id TEXT PRIMARY KEY)");

      const originalLength = migrations.length;
      migrations.push({
        version: 1,
        name: "good_migration",
        up: (database) => {
          const columns = getTableColumns(database, "loops");
          if (!columns.includes("good_column")) {
            database.run("ALTER TABLE loops ADD COLUMN good_column TEXT");
          }
        },
      });
      migrations.push({
        version: 2,
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
        expect(getSchemaVersion(db)).toBe(1);
      } finally {
        migrations.length = originalLength;
      }
    });
  });
});
