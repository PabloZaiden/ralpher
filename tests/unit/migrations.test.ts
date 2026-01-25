/**
 * Tests for the database migration system.
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

describe("migrations", () => {
  let tempDir: string;
  let db: Database;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "ralpher-migration-test-"));
    db = new Database(join(tempDir, "test.db"));
    
    // Create the base loops table WITHOUT clear_planning_folder column
    // This simulates an old database before the migration
    db.run(`
      CREATE TABLE IF NOT EXISTS loops (
        id TEXT PRIMARY KEY,
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
  });

  afterEach(async () => {
    db.close();
    await rm(tempDir, { recursive: true });
  });

  test("getSchemaVersion returns 0 when no migrations applied", () => {
    const version = getSchemaVersion(db);
    expect(version).toBe(0);
  });

  test("tableExists returns true for existing table", () => {
    expect(tableExists(db, "loops")).toBe(true);
  });

  test("tableExists returns false for non-existing table", () => {
    expect(tableExists(db, "nonexistent")).toBe(false);
  });

  test("getTableColumns returns column names", () => {
    const columns = getTableColumns(db, "loops");
    expect(columns).toContain("id");
    expect(columns).toContain("name");
    expect(columns).toContain("prompt");
    expect(columns).not.toContain("clear_planning_folder");
  });

  test("runMigrations creates schema_migrations table", () => {
    expect(tableExists(db, "schema_migrations")).toBe(false);
    runMigrations(db);
    expect(tableExists(db, "schema_migrations")).toBe(true);
  });

  test("runMigrations applies migration 1 (add_clear_planning_folder)", () => {
    // Before migration
    const columnsBefore = getTableColumns(db, "loops");
    expect(columnsBefore).not.toContain("clear_planning_folder");

    // Run migrations
    const applied = runMigrations(db);
    expect(applied).toBeGreaterThanOrEqual(1);

    // After migration
    const columnsAfter = getTableColumns(db, "loops");
    expect(columnsAfter).toContain("clear_planning_folder");
  });

  test("runMigrations is idempotent", () => {
    // Run once
    const applied1 = runMigrations(db);
    expect(applied1).toBeGreaterThanOrEqual(1);

    // Run again - should apply nothing
    const applied2 = runMigrations(db);
    expect(applied2).toBe(0);

    // Columns should still be there
    const columns = getTableColumns(db, "loops");
    expect(columns).toContain("clear_planning_folder");
  });

  test("getSchemaVersion returns correct version after migrations", () => {
    runMigrations(db);
    const version = getSchemaVersion(db);
    expect(version).toBe(migrations.length);
  });

  test("migrations are applied in order", () => {
    runMigrations(db);

    // Check that all migrations are recorded
    const rows = db.query("SELECT version, name FROM schema_migrations ORDER BY version").all() as Array<{
      version: number;
      name: string;
    }>;

    expect(rows.length).toBe(migrations.length);
    for (let i = 0; i < migrations.length; i++) {
      expect(rows[i]!.version).toBe(migrations[i]!.version);
      expect(rows[i]!.name).toBe(migrations[i]!.name);
    }
  });

  test("migration records include applied_at timestamp", () => {
    runMigrations(db);

    const row = db.query("SELECT applied_at FROM schema_migrations WHERE version = 1").get() as {
      applied_at: string;
    } | null;

    expect(row).not.toBeNull();
    expect(row!.applied_at).toBeTruthy();
    // Should be a valid ISO date string
    expect(() => new Date(row!.applied_at)).not.toThrow();
  });

  test("migration handles column already existing", () => {
    // Manually add the column first
    db.run("ALTER TABLE loops ADD COLUMN clear_planning_folder INTEGER DEFAULT 0");

    // Migration should not fail
    expect(() => runMigrations(db)).not.toThrow();

    // Column should still exist
    const columns = getTableColumns(db, "loops");
    expect(columns).toContain("clear_planning_folder");
  });
});

describe("migrations - fresh database", () => {
  let tempDir: string;
  let db: Database;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "ralpher-migration-fresh-test-"));
    db = new Database(join(tempDir, "test.db"));
    
    // Create the full schema including clear_planning_folder (fresh database)
    db.run(`
      CREATE TABLE IF NOT EXISTS loops (
        id TEXT PRIMARY KEY,
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
        pending_prompt TEXT,
        clear_planning_folder INTEGER DEFAULT 0
      )
    `);
  });

  afterEach(async () => {
    db.close();
    await rm(tempDir, { recursive: true });
  });

  test("migration handles fresh database with column already present", () => {
    // Column already exists in fresh database
    const columnsBefore = getTableColumns(db, "loops");
    expect(columnsBefore).toContain("clear_planning_folder");

    // Migration should not fail
    expect(() => runMigrations(db)).not.toThrow();

    // Column should still exist
    const columnsAfter = getTableColumns(db, "loops");
    expect(columnsAfter).toContain("clear_planning_folder");
  });
});
