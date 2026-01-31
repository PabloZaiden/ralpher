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

describe("migrations - review_comments table (migration #6)", () => {
  let tempDir: string;
  let db: Database;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "ralpher-migration-comments-test-"));
    db = new Database(join(tempDir, "test.db"));
    
    // Create base loops table without review_comments table (old database)
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

  test("migration creates review_comments table", () => {
    // Before migration
    expect(tableExists(db, "review_comments")).toBe(false);

    // Run migrations
    runMigrations(db);

    // After migration
    expect(tableExists(db, "review_comments")).toBe(true);
  });

  test("review_comments table has correct columns", () => {
    runMigrations(db);

    const columns = getTableColumns(db, "review_comments");
    expect(columns).toContain("id");
    expect(columns).toContain("loop_id");
    expect(columns).toContain("review_cycle");
    expect(columns).toContain("comment_text");
    expect(columns).toContain("created_at");
    expect(columns).toContain("status");
    expect(columns).toContain("addressed_at");
  });

  test("review_comments table has indexes", () => {
    runMigrations(db);

    // Check for indexes
    const indexes = db.query(`
      SELECT name FROM sqlite_master 
      WHERE type = 'index' 
      AND tbl_name = 'review_comments'
      AND name LIKE 'idx_%'
    `).all() as Array<{ name: string }>;

    const indexNames = indexes.map(idx => idx.name);
    expect(indexNames).toContain("idx_review_comments_loop_id");
    expect(indexNames).toContain("idx_review_comments_loop_cycle");
  });

  test("foreign key constraint from review_comments to loops works", () => {
    runMigrations(db);

    // Enable foreign keys
    db.run("PRAGMA foreign_keys = ON");

    // Insert a test loop
    db.run(`
      INSERT INTO loops (
        id, name, directory, prompt, created_at, updated_at, 
        stop_pattern, git_branch_prefix, git_commit_prefix
      ) VALUES (
        'test-loop-1', 'Test Loop', '/tmp/test', 'test prompt', 
        '2026-01-26T10:00:00Z', '2026-01-26T10:00:00Z',
        'STOP', 'review/', '[Review]'
      )
    `);

    // Insert a comment for this loop - should succeed
    expect(() => {
      db.run(`
        INSERT INTO review_comments (
          id, loop_id, review_cycle, comment_text, created_at, status
        ) VALUES (
          'comment-1', 'test-loop-1', 1, 'Test comment', '2026-01-26T10:05:00Z', 'pending'
        )
      `);
    }).not.toThrow();

    // Try to insert a comment for non-existent loop - should fail
    expect(() => {
      db.run(`
        INSERT INTO review_comments (
          id, loop_id, review_cycle, comment_text, created_at, status
        ) VALUES (
          'comment-2', 'non-existent-loop', 1, 'Test comment', '2026-01-26T10:05:00Z', 'pending'
        )
      `);
    }).toThrow();
  });

  test("cascade delete removes comments when loop is deleted", () => {
    runMigrations(db);

    // Enable foreign keys
    db.run("PRAGMA foreign_keys = ON");

    // Insert a test loop
    db.run(`
      INSERT INTO loops (
        id, name, directory, prompt, created_at, updated_at, 
        stop_pattern, git_branch_prefix, git_commit_prefix
      ) VALUES (
        'test-loop-1', 'Test Loop', '/tmp/test', 'test prompt', 
        '2026-01-26T10:00:00Z', '2026-01-26T10:00:00Z',
        'STOP', 'review/', '[Review]'
      )
    `);

    // Insert comments for this loop
    db.run(`
      INSERT INTO review_comments (
        id, loop_id, review_cycle, comment_text, created_at, status
      ) VALUES (
        'comment-1', 'test-loop-1', 1, 'Comment 1', '2026-01-26T10:05:00Z', 'pending'
      )
    `);
    db.run(`
      INSERT INTO review_comments (
        id, loop_id, review_cycle, comment_text, created_at, status
      ) VALUES (
        'comment-2', 'test-loop-1', 1, 'Comment 2', '2026-01-26T10:06:00Z', 'pending'
      )
    `);

    // Verify comments exist
    const commentsBefore = db.query("SELECT COUNT(*) as count FROM review_comments WHERE loop_id = 'test-loop-1'").get() as { count: number };
    expect(commentsBefore.count).toBe(2);

    // Delete the loop
    db.run("DELETE FROM loops WHERE id = 'test-loop-1'");

    // Verify comments are cascade deleted
    const commentsAfter = db.query("SELECT COUNT(*) as count FROM review_comments WHERE loop_id = 'test-loop-1'").get() as { count: number };
    expect(commentsAfter.count).toBe(0);
  });

  test("migration is idempotent - can run multiple times", () => {
    // Run migrations twice
    runMigrations(db);
    expect(() => runMigrations(db)).not.toThrow();

    // Table should still exist with correct structure
    expect(tableExists(db, "review_comments")).toBe(true);
    const columns = getTableColumns(db, "review_comments");
    expect(columns).toContain("id");
    expect(columns).toContain("loop_id");
    expect(columns).toContain("review_cycle");
  });

  test("default status value is 'pending'", () => {
    runMigrations(db);
    db.run("PRAGMA foreign_keys = ON");

    // Insert a test loop
    db.run(`
      INSERT INTO loops (
        id, name, directory, prompt, created_at, updated_at, 
        stop_pattern, git_branch_prefix, git_commit_prefix
      ) VALUES (
        'test-loop-1', 'Test Loop', '/tmp/test', 'test prompt', 
        '2026-01-26T10:00:00Z', '2026-01-26T10:00:00Z',
        'STOP', 'review/', '[Review]'
      )
    `);

    // Insert comment without specifying status
    db.run(`
      INSERT INTO review_comments (
        id, loop_id, review_cycle, comment_text, created_at
      ) VALUES (
        'comment-1', 'test-loop-1', 1, 'Test comment', '2026-01-26T10:05:00Z'
      )
    `);

    // Verify default status is 'pending'
    const comment = db.query("SELECT status FROM review_comments WHERE id = 'comment-1'").get() as { status: string };
    expect(comment.status).toBe("pending");
  });
});

describe("migrations - review_comments with fresh database", () => {
  let tempDir: string;
  let db: Database;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "ralpher-migration-comments-fresh-test-"));
    db = new Database(join(tempDir, "test.db"));
    
    // Create full schema including review_comments (fresh database)
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

    db.run(`CREATE INDEX IF NOT EXISTS idx_review_comments_loop_id ON review_comments(loop_id)`);
    db.run(`CREATE INDEX IF NOT EXISTS idx_review_comments_loop_cycle ON review_comments(loop_id, review_cycle)`);
  });

  afterEach(async () => {
    db.close();
    await rm(tempDir, { recursive: true });
  });

  test("migration handles fresh database with review_comments already present", () => {
    // Table already exists in fresh database
    expect(tableExists(db, "review_comments")).toBe(true);

    // Migration should not fail
    expect(() => runMigrations(db)).not.toThrow();

    // Table should still exist
    expect(tableExists(db, "review_comments")).toBe(true);
    const columns = getTableColumns(db, "review_comments");
    expect(columns).toContain("id");
    expect(columns).toContain("loop_id");
    expect(columns).toContain("review_cycle");
  });
});

describe("migrations - todos column (migration #7)", () => {
  let tempDir: string;
  let db: Database;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "ralpher-migration-todos-test-"));
    db = new Database(join(tempDir, "test.db"));
    
    // Create base loops table without todos column (old database)
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

  test("migration creates todos column", () => {
    // Before migration
    const columnsBefore = getTableColumns(db, "loops");
    expect(columnsBefore).not.toContain("todos");

    // Run migrations
    runMigrations(db);

    // After migration
    const columnsAfter = getTableColumns(db, "loops");
    expect(columnsAfter).toContain("todos");
  });

  test("todos column is correctly added to loops table", () => {
    runMigrations(db);

    const columns = getTableColumns(db, "loops");
    expect(columns).toContain("todos");
  });

  test("migration is idempotent - can run multiple times", () => {
    // Run migrations twice
    runMigrations(db);
    expect(() => runMigrations(db)).not.toThrow();

    // Column should still exist with correct structure
    const columns = getTableColumns(db, "loops");
    expect(columns).toContain("todos");
  });

  test("todos column accepts JSON data", () => {
    runMigrations(db);

    // Insert a test loop with todos
    db.run(`
      INSERT INTO loops (
        id, name, directory, prompt, created_at, updated_at, 
        stop_pattern, git_branch_prefix, git_commit_prefix, todos
      ) VALUES (
        'test-loop-1', 'Test Loop', '/tmp/test', 'test prompt', 
        '2026-01-27T10:00:00Z', '2026-01-27T10:00:00Z',
        'STOP', 'test/', '[Test]', 
        '[{"id":"1","content":"Test TODO","status":"pending","priority":"medium"}]'
      )
    `);

    // Verify the todos can be retrieved
    const result = db.query("SELECT todos FROM loops WHERE id = 'test-loop-1'").get() as { todos: string };
    expect(result.todos).toBeTruthy();
    
    // Verify it's valid JSON
    const parsed = JSON.parse(result.todos);
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed[0]).toMatchObject({
      id: "1",
      content: "Test TODO",
      status: "pending",
      priority: "medium",
    });
  });

  test("todos column can be null", () => {
    runMigrations(db);

    // Insert a test loop without todos
    db.run(`
      INSERT INTO loops (
        id, name, directory, prompt, created_at, updated_at, 
        stop_pattern, git_branch_prefix, git_commit_prefix
      ) VALUES (
        'test-loop-1', 'Test Loop', '/tmp/test', 'test prompt', 
        '2026-01-27T10:00:00Z', '2026-01-27T10:00:00Z',
        'STOP', 'test/', '[Test]'
      )
    `);

    // Verify todos is null by default
    const result = db.query("SELECT todos FROM loops WHERE id = 'test-loop-1'").get() as { todos: string | null };
    expect(result.todos).toBeNull();
  });
});

describe("migrations - todos with fresh database", () => {
  let tempDir: string;
  let db: Database;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "ralpher-migration-todos-fresh-test-"));
    db = new Database(join(tempDir, "test.db"));
    
    // Create full schema including todos column (fresh database)
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
        clear_planning_folder INTEGER DEFAULT 0,
        todos TEXT
      )
    `);
  });

  afterEach(async () => {
    db.close();
    await rm(tempDir, { recursive: true });
  });

  test("migration handles fresh database with todos column already present", () => {
    // Column already exists in fresh database
    const columnsBefore = getTableColumns(db, "loops");
    expect(columnsBefore).toContain("todos");

    // Migration should not fail
    expect(() => runMigrations(db)).not.toThrow();

    // Column should still exist
    const columnsAfter = getTableColumns(db, "loops");
    expect(columnsAfter).toContain("todos");
  });
});

describe("migrations - migrate existing loops to workspaces (migration #11)", () => {
  let tempDir: string;
  let db: Database;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "ralpher-migration-loop-workspace-test-"));
    db = new Database(join(tempDir, "test.db"));
    
    // Create the full schema without workspace_id column (old database before migration #10)
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
        clear_planning_folder INTEGER DEFAULT 0,
        todos TEXT
      )
    `);
  });

  afterEach(async () => {
    db.close();
    await rm(tempDir, { recursive: true });
  });

  test("migration creates workspaces from existing loops grouped by directory", () => {
    // Insert existing loops without workspace_id
    db.run(`
      INSERT INTO loops (id, name, directory, prompt, created_at, updated_at, stop_pattern, git_branch_prefix, git_commit_prefix)
      VALUES ('loop-1', 'Loop 1', '/home/user/project1', 'test prompt', '2026-01-26T10:00:00Z', '2026-01-26T10:00:00Z', 'STOP', 'loop/', '[Loop]')
    `);
    db.run(`
      INSERT INTO loops (id, name, directory, prompt, created_at, updated_at, stop_pattern, git_branch_prefix, git_commit_prefix)
      VALUES ('loop-2', 'Loop 2', '/home/user/project1', 'test prompt 2', '2026-01-26T11:00:00Z', '2026-01-26T11:00:00Z', 'STOP', 'loop/', '[Loop]')
    `);
    db.run(`
      INSERT INTO loops (id, name, directory, prompt, created_at, updated_at, stop_pattern, git_branch_prefix, git_commit_prefix)
      VALUES ('loop-3', 'Loop 3', '/home/user/project2', 'test prompt 3', '2026-01-26T12:00:00Z', '2026-01-26T12:00:00Z', 'STOP', 'loop/', '[Loop]')
    `);

    // Run migrations - this will create workspaces table and migrate loops
    runMigrations(db);

    // Verify workspaces were created
    expect(tableExists(db, "workspaces")).toBe(true);
    const workspaces = db.query("SELECT * FROM workspaces ORDER BY directory").all() as Array<{
      id: string;
      name: string;
      directory: string;
    }>;
    
    // Should have 2 workspaces (one for each unique directory)
    expect(workspaces.length).toBe(2);
    expect(workspaces[0]!.directory).toBe("/home/user/project1");
    expect(workspaces[0]!.name).toBe("project1");
    expect(workspaces[1]!.directory).toBe("/home/user/project2");
    expect(workspaces[1]!.name).toBe("project2");

    // Verify loops are linked to workspaces
    const loops = db.query("SELECT id, directory, workspace_id FROM loops ORDER BY id").all() as Array<{
      id: string;
      directory: string;
      workspace_id: string;
    }>;

    // loop-1 and loop-2 should share the same workspace
    expect(loops[0]!.workspace_id).toBe(loops[1]!.workspace_id);
    expect(loops[0]!.workspace_id).toBe(workspaces[0]!.id);
    
    // loop-3 should have a different workspace
    expect(loops[2]!.workspace_id).toBe(workspaces[1]!.id);
  });

  test("migration is idempotent - does not create duplicate workspaces", () => {
    // Insert an existing loop
    db.run(`
      INSERT INTO loops (id, name, directory, prompt, created_at, updated_at, stop_pattern, git_branch_prefix, git_commit_prefix)
      VALUES ('loop-1', 'Loop 1', '/home/user/project1', 'test prompt', '2026-01-26T10:00:00Z', '2026-01-26T10:00:00Z', 'STOP', 'loop/', '[Loop]')
    `);

    // Run migrations
    runMigrations(db);

    // Count workspaces
    const countBefore = db.query("SELECT COUNT(*) as count FROM workspaces").get() as { count: number };
    expect(countBefore.count).toBe(1);

    // Run migrations again
    runMigrations(db);

    // Should still have only 1 workspace
    const countAfter = db.query("SELECT COUNT(*) as count FROM workspaces").get() as { count: number };
    expect(countAfter.count).toBe(1);
  });

  test("migration skips loops that already have workspace_id", () => {
    // Run migrations to set up schema
    runMigrations(db);

    // Create a workspace manually
    db.run(`
      INSERT INTO workspaces (id, name, directory, created_at, updated_at)
      VALUES ('ws-existing', 'Existing Workspace', '/home/user/project1', '2026-01-26T09:00:00Z', '2026-01-26T09:00:00Z')
    `);

    // Insert a loop that already has a workspace_id
    db.run(`
      INSERT INTO loops (id, name, directory, prompt, created_at, updated_at, stop_pattern, git_branch_prefix, git_commit_prefix, workspace_id)
      VALUES ('loop-1', 'Loop 1', '/home/user/project1', 'test prompt', '2026-01-26T10:00:00Z', '2026-01-26T10:00:00Z', 'STOP', 'loop/', '[Loop]', 'ws-existing')
    `);

    // Run migrations again
    runMigrations(db);

    // Should still have only 1 workspace
    const workspaces = db.query("SELECT COUNT(*) as count FROM workspaces").get() as { count: number };
    expect(workspaces.count).toBe(1);

    // Loop should still have the original workspace_id
    const loop = db.query("SELECT workspace_id FROM loops WHERE id = 'loop-1'").get() as { workspace_id: string };
    expect(loop.workspace_id).toBe("ws-existing");
  });

  test("migration handles empty directory correctly", () => {
    // Insert a loop with empty directory
    db.run(`
      INSERT INTO loops (id, name, directory, prompt, created_at, updated_at, stop_pattern, git_branch_prefix, git_commit_prefix)
      VALUES ('loop-1', 'Loop 1', '', 'test prompt', '2026-01-26T10:00:00Z', '2026-01-26T10:00:00Z', 'STOP', 'loop/', '[Loop]')
    `);

    // Run migrations
    runMigrations(db);

    // Should not create workspace for empty directory
    const workspaces = db.query("SELECT COUNT(*) as count FROM workspaces").get() as { count: number };
    expect(workspaces.count).toBe(0);

    // Loop should still have no workspace_id
    const loop = db.query("SELECT workspace_id FROM loops WHERE id = 'loop-1'").get() as { workspace_id: string | null };
    expect(loop.workspace_id).toBeNull();
  });

  test("migration uses last path segment as workspace name", () => {
    db.run(`
      INSERT INTO loops (id, name, directory, prompt, created_at, updated_at, stop_pattern, git_branch_prefix, git_commit_prefix)
      VALUES ('loop-1', 'Loop 1', '/home/user/my-awesome-project', 'test prompt', '2026-01-26T10:00:00Z', '2026-01-26T10:00:00Z', 'STOP', 'loop/', '[Loop]')
    `);

    // Run migrations
    runMigrations(db);

    // Check workspace name
    const workspace = db.query("SELECT name FROM workspaces LIMIT 1").get() as { name: string };
    expect(workspace.name).toBe("my-awesome-project");
  });

  test("migration handles trailing slash in directory", () => {
    db.run(`
      INSERT INTO loops (id, name, directory, prompt, created_at, updated_at, stop_pattern, git_branch_prefix, git_commit_prefix)
      VALUES ('loop-1', 'Loop 1', '/home/user/project/', 'test prompt', '2026-01-26T10:00:00Z', '2026-01-26T10:00:00Z', 'STOP', 'loop/', '[Loop]')
    `);

    // Run migrations
    runMigrations(db);

    // Check workspace name (should handle trailing slash)
    const workspace = db.query("SELECT name FROM workspaces LIMIT 1").get() as { name: string };
    expect(workspace.name).toBe("project");
  });
});
