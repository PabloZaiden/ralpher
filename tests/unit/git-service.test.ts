/**
 * Unit tests for GitService.
 */

import { test, expect, describe, beforeEach, afterEach } from "bun:test";
import { mkdtemp, rm, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { GitService } from "../../src/core/git-service";

describe("GitService", () => {
  let testDir: string;
  let git: GitService;

  beforeEach(async () => {
    // Create a temp directory for each test
    testDir = await mkdtemp(join(tmpdir(), "ralpher-git-test-"));
    git = new GitService();

    // Initialize a git repo
    await Bun.$`git init ${testDir}`.quiet();
    await Bun.$`git -C ${testDir} config user.email "test@test.com"`.quiet();
    await Bun.$`git -C ${testDir} config user.name "Test User"`.quiet();

    // Create an initial commit so we have a branch
    await writeFile(join(testDir, "README.md"), "# Test\n");
    await Bun.$`git -C ${testDir} add -A`.quiet();
    await Bun.$`git -C ${testDir} commit -m "Initial commit"`.quiet();
  });

  afterEach(async () => {
    await rm(testDir, { recursive: true });
  });

  describe("isGitRepo", () => {
    test("returns true for a git repo", async () => {
      const result = await git.isGitRepo(testDir);
      expect(result).toBe(true);
    });

    test("returns false for a non-repo directory", async () => {
      const nonRepoDir = await mkdtemp(join(tmpdir(), "non-repo-"));
      try {
        const result = await git.isGitRepo(nonRepoDir);
        expect(result).toBe(false);
      } finally {
        await rm(nonRepoDir, { recursive: true });
      }
    });
  });

  describe("getCurrentBranch", () => {
    test("returns the current branch name", async () => {
      const branch = await git.getCurrentBranch(testDir);
      // Default branch could be main or master
      expect(["main", "master"]).toContain(branch);
    });
  });

  describe("hasUncommittedChanges", () => {
    test("returns false when no changes", async () => {
      const result = await git.hasUncommittedChanges(testDir);
      expect(result).toBe(false);
    });

    test("returns true when there are changes", async () => {
      await writeFile(join(testDir, "new-file.txt"), "Hello\n");
      const result = await git.hasUncommittedChanges(testDir);
      expect(result).toBe(true);
    });
  });

  describe("getChangedFiles", () => {
    test("returns empty array when no changes", async () => {
      const files = await git.getChangedFiles(testDir);
      expect(files).toEqual([]);
    });

    test("returns list of changed files", async () => {
      await writeFile(join(testDir, "file1.txt"), "Hello\n");
      await writeFile(join(testDir, "file2.txt"), "World\n");

      const files = await git.getChangedFiles(testDir);
      expect(files.length).toBe(2);
      expect(files).toContain("file1.txt");
      expect(files).toContain("file2.txt");
    });
  });

  describe("createBranch and checkoutBranch", () => {
    test("creates a new branch and checks it out", async () => {
      await git.createBranch(testDir, "test-branch");
      const branch = await git.getCurrentBranch(testDir);
      expect(branch).toBe("test-branch");
    });

    test("checkoutBranch switches to an existing branch", async () => {
      const originalBranch = await git.getCurrentBranch(testDir);

      await git.createBranch(testDir, "other-branch");
      expect(await git.getCurrentBranch(testDir)).toBe("other-branch");

      await git.checkoutBranch(testDir, originalBranch);
      expect(await git.getCurrentBranch(testDir)).toBe(originalBranch);
    });
  });

  describe("branchExists", () => {
    test("returns true for existing branch", async () => {
      const currentBranch = await git.getCurrentBranch(testDir);
      const exists = await git.branchExists(testDir, currentBranch);
      expect(exists).toBe(true);
    });

    test("returns false for non-existent branch", async () => {
      const exists = await git.branchExists(testDir, "non-existent-branch");
      expect(exists).toBe(false);
    });
  });

  describe("commit", () => {
    test("commits staged changes and returns commit info", async () => {
      await writeFile(join(testDir, "new-file.txt"), "Content\n");

      const commitInfo = await git.commit(testDir, "Test commit message");

      expect(commitInfo.sha).toHaveLength(40);
      expect(commitInfo.message).toBe("Test commit message");
      expect(commitInfo.filesChanged).toBe(1);

      // Verify no uncommitted changes
      const hasChanges = await git.hasUncommittedChanges(testDir);
      expect(hasChanges).toBe(false);
    });

    test("throws when no changes to commit", async () => {
      await expect(git.commit(testDir, "Empty commit")).rejects.toThrow(
        "No changes to commit"
      );
    });
  });

  describe("deleteBranch", () => {
    test("deletes a branch", async () => {
      const originalBranch = await git.getCurrentBranch(testDir);

      await git.createBranch(testDir, "to-delete");
      await git.checkoutBranch(testDir, originalBranch);
      await git.deleteBranch(testDir, "to-delete");

      const exists = await git.branchExists(testDir, "to-delete");
      expect(exists).toBe(false);
    });
  });

  describe("stash and stashPop", () => {
    test("stashes and restores changes", async () => {
      await writeFile(join(testDir, "stash-file.txt"), "Stash me\n");
      expect(await git.hasUncommittedChanges(testDir)).toBe(true);

      await git.stash(testDir);
      expect(await git.hasUncommittedChanges(testDir)).toBe(false);

      await git.stashPop(testDir);
      expect(await git.hasUncommittedChanges(testDir)).toBe(true);
    });
  });

  describe("mergeBranch", () => {
    test("merges source branch into target branch", async () => {
      const originalBranch = await git.getCurrentBranch(testDir);

      // Create a feature branch with a commit
      await git.createBranch(testDir, "feature");
      await writeFile(join(testDir, "feature-file.txt"), "Feature\n");
      await git.commit(testDir, "Add feature");

      // Merge back to original
      const mergeCommit = await git.mergeBranch(testDir, "feature", originalBranch);

      expect(mergeCommit).toHaveLength(40);
      expect(await git.getCurrentBranch(testDir)).toBe(originalBranch);
    });
  });
});
