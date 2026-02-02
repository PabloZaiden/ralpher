/**
 * Unit tests for workspace persistence layer.
 */

import { test, expect, describe, beforeEach, afterEach } from "bun:test";
import { mkdtemp, rm } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { randomUUID } from "crypto";
import type { Workspace } from "../../src/types/workspace";
import { getDefaultServerSettings } from "../../src/types/settings";

// We need to set the env var before importing the module
let testDataDir: string;

/**
 * Helper function to create a test workspace with all required fields.
 */
function createTestWorkspace(overrides: {
  id?: string;
  name?: string;
  directory?: string;
}): Workspace {
  const now = new Date().toISOString();
  return {
    id: overrides.id ?? randomUUID(),
    name: overrides.name ?? "Test Workspace",
    directory: overrides.directory ?? "/tmp/test-project",
    createdAt: now,
    updatedAt: now,
    serverSettings: getDefaultServerSettings(),
  };
}

describe("Workspace Persistence", () => {
  beforeEach(async () => {
    // Create a temp directory for each test
    testDataDir = await mkdtemp(join(tmpdir(), "ralpher-workspace-test-"));
    process.env["RALPHER_DATA_DIR"] = testDataDir;
  });

  afterEach(async () => {
    // Close the database before cleaning up
    const { closeDatabase } = await import("../../src/persistence/database");
    closeDatabase();

    // Clean up
    delete process.env["RALPHER_DATA_DIR"];
    await rm(testDataDir, { recursive: true });
  });

  describe("CRUD operations", () => {
    test("createWorkspace creates a new workspace", async () => {
      const { ensureDataDirectories } = await import("../../src/persistence/paths");
      const { createWorkspace, getWorkspace } = await import("../../src/persistence/workspaces");

      await ensureDataDirectories();

      const workspace = createTestWorkspace({
        name: "Test Workspace",
        directory: "/tmp/test-project",
      });

      await createWorkspace(workspace);

      // Verify it was persisted
      const loaded = await getWorkspace(workspace.id);
      expect(loaded).not.toBeNull();
      expect(loaded!.id).toBe(workspace.id);
      expect(loaded!.name).toBe("Test Workspace");
      expect(loaded!.directory).toBe("/tmp/test-project");
      expect(loaded!.createdAt).toBeDefined();
      expect(loaded!.updatedAt).toBeDefined();
    });

    test("getWorkspace returns null for non-existent workspace", async () => {
      const { ensureDataDirectories } = await import("../../src/persistence/paths");
      const { getWorkspace } = await import("../../src/persistence/workspaces");

      await ensureDataDirectories();

      const workspace = await getWorkspace("non-existent-id");
      expect(workspace).toBeNull();
    });

    test("listWorkspaces returns all workspaces sorted by name alphabetically", async () => {
      const { ensureDataDirectories } = await import("../../src/persistence/paths");
      const { createWorkspace, listWorkspaces } = await import("../../src/persistence/workspaces");

      await ensureDataDirectories();

      // Create workspaces with different names (out of alphabetical order)
      const ws1 = createTestWorkspace({ name: "Zeta Workspace", directory: "/tmp/zeta" });
      await createWorkspace(ws1);

      const ws2 = createTestWorkspace({ name: "Alpha Workspace", directory: "/tmp/alpha" });
      await createWorkspace(ws2);

      const ws3 = createTestWorkspace({ name: "beta workspace", directory: "/tmp/beta" });
      await createWorkspace(ws3);

      const workspaces = await listWorkspaces();
      expect(workspaces.length).toBe(3);
      // Should be sorted alphabetically by name (case-insensitive)
      expect(workspaces[0]!.name).toBe("Alpha Workspace");
      expect(workspaces[1]!.name).toBe("beta workspace");
      expect(workspaces[2]!.name).toBe("Zeta Workspace");
    });

    test("updateWorkspace updates workspace name", async () => {
      const { ensureDataDirectories } = await import("../../src/persistence/paths");
      const { createWorkspace, updateWorkspace, getWorkspace } = await import("../../src/persistence/workspaces");

      await ensureDataDirectories();

      const workspace = createTestWorkspace({
        name: "Original Name",
        directory: "/tmp/update-test",
      });
      await createWorkspace(workspace);

      const updated = await updateWorkspace(workspace.id, { name: "New Name" });
      expect(updated).not.toBeNull();
      expect(updated!.name).toBe("New Name");
      expect(updated!.directory).toBe("/tmp/update-test");

      // Verify persisted
      const loaded = await getWorkspace(workspace.id);
      expect(loaded!.name).toBe("New Name");
    });

    test("updateWorkspace returns null for non-existent workspace", async () => {
      const { ensureDataDirectories } = await import("../../src/persistence/paths");
      const { updateWorkspace } = await import("../../src/persistence/workspaces");

      await ensureDataDirectories();

      const result = await updateWorkspace("non-existent", { name: "New Name" });
      expect(result).toBeNull();
    });

    test("deleteWorkspace removes workspace", async () => {
      const { ensureDataDirectories } = await import("../../src/persistence/paths");
      const { createWorkspace, deleteWorkspace, getWorkspace, listWorkspaces } = await import("../../src/persistence/workspaces");

      await ensureDataDirectories();

      const workspace = createTestWorkspace({
        name: "Delete Me",
        directory: "/tmp/delete-test",
      });
      await createWorkspace(workspace);

      expect(await getWorkspace(workspace.id)).not.toBeNull();

      const result = await deleteWorkspace(workspace.id);
      expect(result.success).toBe(true);

      expect(await getWorkspace(workspace.id)).toBeNull();
      expect(await listWorkspaces()).toHaveLength(0);
    });

    test("deleteWorkspace returns failure for non-existent workspace", async () => {
      const { ensureDataDirectories } = await import("../../src/persistence/paths");
      const { deleteWorkspace } = await import("../../src/persistence/workspaces");

      await ensureDataDirectories();

      const result = await deleteWorkspace("non-existent");
      expect(result.success).toBe(false);
      expect(result.reason).toBe("Workspace not found");
    });
  });

  describe("getWorkspaceByDirectory", () => {
    test("returns workspace when directory matches", async () => {
      const { ensureDataDirectories } = await import("../../src/persistence/paths");
      const { createWorkspace, getWorkspaceByDirectory } = await import("../../src/persistence/workspaces");

      await ensureDataDirectories();

      const workspace = createTestWorkspace({
        name: "My Project",
        directory: "/home/user/projects/my-project",
      });
      await createWorkspace(workspace);

      const found = await getWorkspaceByDirectory("/home/user/projects/my-project");
      expect(found).not.toBeNull();
      expect(found!.name).toBe("My Project");
    });

    test("returns null when no workspace has the directory", async () => {
      const { ensureDataDirectories } = await import("../../src/persistence/paths");
      const { createWorkspace, getWorkspaceByDirectory } = await import("../../src/persistence/workspaces");

      await ensureDataDirectories();

      const workspace = createTestWorkspace({
        name: "Other Project",
        directory: "/home/user/other-project",
      });
      await createWorkspace(workspace);

      const found = await getWorkspaceByDirectory("/home/user/different-project");
      expect(found).toBeNull();
    });

    test("directory is unique across workspaces", async () => {
      const { ensureDataDirectories } = await import("../../src/persistence/paths");
      const { createWorkspace } = await import("../../src/persistence/workspaces");

      await ensureDataDirectories();

      const ws1 = createTestWorkspace({
        name: "First Workspace",
        directory: "/tmp/unique-dir",
      });
      await createWorkspace(ws1);

      // Attempting to create another workspace with same directory should fail
      const ws2 = createTestWorkspace({
        name: "Second Workspace",
        directory: "/tmp/unique-dir",
      });
      
      await expect(createWorkspace(ws2)).rejects.toThrow();
    });
  });

  describe("touchWorkspace", () => {
    test("updates updatedAt timestamp", async () => {
      const { ensureDataDirectories } = await import("../../src/persistence/paths");
      const { createWorkspace, touchWorkspace, getWorkspace } = await import("../../src/persistence/workspaces");

      await ensureDataDirectories();

      const workspace = createTestWorkspace({
        name: "Touch Test",
        directory: "/tmp/touch-test",
      });
      workspace.updatedAt = "2024-01-01T00:00:00Z";
      await createWorkspace(workspace);

      const original = await getWorkspace(workspace.id);
      const originalUpdatedAt = original!.updatedAt;

      await touchWorkspace(workspace.id);

      const updated = await getWorkspace(workspace.id);
      expect(updated!.updatedAt).not.toBe(originalUpdatedAt);
    });
  });

  describe("getWorkspaceLoopCount", () => {
    test("returns 0 when workspace has no loops", async () => {
      const { ensureDataDirectories } = await import("../../src/persistence/paths");
      const { createWorkspace, getWorkspaceLoopCount } = await import("../../src/persistence/workspaces");

      await ensureDataDirectories();

      const workspace = createTestWorkspace({
        name: "Empty Workspace",
        directory: "/tmp/empty-workspace",
      });
      await createWorkspace(workspace);

      const count = await getWorkspaceLoopCount(workspace.id);
      expect(count).toBe(0);
    });

    test("returns correct count when workspace has loops", async () => {
      const { ensureDataDirectories } = await import("../../src/persistence/paths");
      const { createWorkspace, getWorkspaceLoopCount } = await import("../../src/persistence/workspaces");
      const { saveLoop } = await import("../../src/persistence/loops");

      await ensureDataDirectories();

      const workspace = createTestWorkspace({
        name: "Workspace With Loops",
        directory: "/tmp/workspace-with-loops",
      });
      await createWorkspace(workspace);

      // Create loops with this workspace_id
      const now = new Date().toISOString();
      for (let i = 0; i < 3; i++) {
        await saveLoop({
          config: {
            id: `loop-${i}`,
            name: `Loop ${i}`,
            directory: workspace.directory,
            prompt: "Test",
            createdAt: now,
            updatedAt: now,
            stopPattern: "<promise>COMPLETE</promise>$",
            git: { branchPrefix: "ralph/", commitPrefix: "[Ralph]" },
            maxIterations: Infinity,
            maxConsecutiveErrors: 10,
            activityTimeoutSeconds: 180,
            clearPlanningFolder: false,
            planMode: false,
            workspaceId: workspace.id,
          },
          state: {
            id: `loop-${i}`,
            status: "idle",
            currentIteration: 0,
            recentIterations: [],
            logs: [],
            messages: [],
            toolCalls: [],
            todos: [],
          },
        });
      }

      const count = await getWorkspaceLoopCount(workspace.id);
      expect(count).toBe(3);
    });

    test("deleteWorkspace fails when workspace has loops", async () => {
      const { ensureDataDirectories } = await import("../../src/persistence/paths");
      const { createWorkspace, deleteWorkspace, getWorkspace } = await import("../../src/persistence/workspaces");
      const { saveLoop } = await import("../../src/persistence/loops");

      await ensureDataDirectories();

      const workspace = createTestWorkspace({
        name: "Workspace With Loops",
        directory: "/tmp/ws-with-loops",
      });
      await createWorkspace(workspace);

      // Create a loop with this workspace_id
      const now = new Date().toISOString();
      await saveLoop({
        config: {
          id: "loop-1",
          name: "Loop 1",
          directory: workspace.directory,
          prompt: "Test",
          createdAt: now,
          updatedAt: now,
          stopPattern: "<promise>COMPLETE</promise>$",
          git: { branchPrefix: "ralph/", commitPrefix: "[Ralph]" },
          maxIterations: Infinity,
          maxConsecutiveErrors: 10,
          activityTimeoutSeconds: 180,
          clearPlanningFolder: false,
          planMode: false,
          workspaceId: workspace.id,
        },
        state: {
          id: "loop-1",
          status: "idle",
          currentIteration: 0,
          recentIterations: [],
          logs: [],
          messages: [],
          toolCalls: [],
          todos: [],
        },
      });

      // Attempt to delete should fail
      const result = await deleteWorkspace(workspace.id);
      expect(result.success).toBe(false);
      expect(result.reason).toContain("1 loop");

      // Workspace should still exist
      expect(await getWorkspace(workspace.id)).not.toBeNull();
    });
  });

  describe("Server Settings Operations", () => {
    test("createWorkspace stores server settings", async () => {
      const { ensureDataDirectories } = await import("../../src/persistence/paths");
      const { createWorkspace, getWorkspace } = await import("../../src/persistence/workspaces");

      await ensureDataDirectories();

      const customSettings = {
        mode: "connect" as const,
        hostname: "custom.server.com",
        port: 9000,
        useHttps: true,
        allowInsecure: false,
      };

      const workspace = createTestWorkspace({
        name: "Custom Settings Workspace",
        directory: "/tmp/custom-settings",
      });
      workspace.serverSettings = customSettings;
      await createWorkspace(workspace);

      const loaded = await getWorkspace(workspace.id);
      expect(loaded).not.toBeNull();
      expect(loaded!.serverSettings).toEqual(customSettings);
    });

    test("updateWorkspace updates server settings", async () => {
      const { ensureDataDirectories } = await import("../../src/persistence/paths");
      const { createWorkspace, updateWorkspace, getWorkspace } = await import("../../src/persistence/workspaces");

      await ensureDataDirectories();

      const workspace = createTestWorkspace({
        name: "Update Settings Test",
        directory: "/tmp/update-settings",
      });
      await createWorkspace(workspace);

      const newSettings = {
        mode: "connect" as const,
        hostname: "updated.server.com",
        port: 8080,
        useHttps: true,
        allowInsecure: true,
      };

      const updated = await updateWorkspace(workspace.id, { serverSettings: newSettings });
      expect(updated).not.toBeNull();
      expect(updated!.serverSettings).toEqual(newSettings);

      // Verify persisted
      const loaded = await getWorkspace(workspace.id);
      expect(loaded!.serverSettings).toEqual(newSettings);
    });

    test("updateWorkspace preserves server settings when only updating name", async () => {
      const { ensureDataDirectories } = await import("../../src/persistence/paths");
      const { createWorkspace, updateWorkspace, getWorkspace } = await import("../../src/persistence/workspaces");

      await ensureDataDirectories();

      const customSettings = {
        mode: "connect" as const,
        hostname: "preserved.server.com",
        port: 7000,
        useHttps: false,
        allowInsecure: true,
      };

      const workspace = createTestWorkspace({
        name: "Original Name",
        directory: "/tmp/preserve-settings",
      });
      workspace.serverSettings = customSettings;
      await createWorkspace(workspace);

      // Update only name
      const updated = await updateWorkspace(workspace.id, { name: "New Name" });
      expect(updated).not.toBeNull();
      expect(updated!.name).toBe("New Name");
      expect(updated!.serverSettings).toEqual(customSettings);

      // Verify persisted
      const loaded = await getWorkspace(workspace.id);
      expect(loaded!.name).toBe("New Name");
      expect(loaded!.serverSettings).toEqual(customSettings);
    });

    test("listWorkspaces includes server settings", async () => {
      const { ensureDataDirectories } = await import("../../src/persistence/paths");
      const { createWorkspace, listWorkspaces } = await import("../../src/persistence/workspaces");

      await ensureDataDirectories();

      const customSettings = {
        mode: "connect" as const,
        hostname: "list.server.com",
        port: 6000,
        useHttps: true,
        allowInsecure: false,
      };

      const workspace = createTestWorkspace({
        name: "List Settings Test",
        directory: "/tmp/list-settings",
      });
      workspace.serverSettings = customSettings;
      await createWorkspace(workspace);

      const workspaces = await listWorkspaces();
      expect(workspaces.length).toBe(1);
      expect(workspaces[0]!.serverSettings).toEqual(customSettings);
    });

    test("getWorkspaceByDirectory includes server settings", async () => {
      const { ensureDataDirectories } = await import("../../src/persistence/paths");
      const { createWorkspace, getWorkspaceByDirectory } = await import("../../src/persistence/workspaces");

      await ensureDataDirectories();

      const customSettings = {
        mode: "connect" as const,
        hostname: "directory.server.com",
        port: 5000,
        useHttps: false,
        allowInsecure: true,
      };

      const workspace = createTestWorkspace({
        name: "Directory Settings Test",
        directory: "/tmp/directory-settings",
      });
      workspace.serverSettings = customSettings;
      await createWorkspace(workspace);

      const found = await getWorkspaceByDirectory("/tmp/directory-settings");
      expect(found).not.toBeNull();
      expect(found!.serverSettings).toEqual(customSettings);
    });
  });
});
