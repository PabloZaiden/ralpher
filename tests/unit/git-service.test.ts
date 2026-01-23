/**
 * Unit tests for GitService.
 */

import { test, expect, describe, beforeEach, afterEach } from "bun:test";
import { mkdtemp, rm, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { GitService } from "../../src/core/git-service";
import { TestCommandExecutor } from "../mocks/mock-executor";

describe("GitService", () => {
  let testDir: string;
  let git: GitService;

  beforeEach(async () => {
    // Create a temp directory for each test
    testDir = await mkdtemp(join(tmpdir(), "ralpher-git-test-"));
    const executor = new TestCommandExecutor();
    git = new GitService(executor);

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

  describe("getDiff", () => {
    test("returns empty array when no changes between branches", async () => {
      const originalBranch = await git.getCurrentBranch(testDir);
      await git.createBranch(testDir, "feature-no-changes");
      
      const diffs = await git.getDiff(testDir, originalBranch);
      expect(diffs).toEqual([]);
    });

    test("returns file diffs for added files", async () => {
      const originalBranch = await git.getCurrentBranch(testDir);
      await git.createBranch(testDir, "feature-add");
      
      await writeFile(join(testDir, "new-file.txt"), "Hello World\n");
      await git.commit(testDir, "Add new file");
      
      const diffs = await git.getDiff(testDir, originalBranch);
      expect(diffs.length).toBe(1);
      expect(diffs[0]?.path).toBe("new-file.txt");
      expect(diffs[0]?.status).toBe("added");
      expect(diffs[0]?.additions).toBeGreaterThan(0);
    });

    test("returns file diffs for modified files", async () => {
      const originalBranch = await git.getCurrentBranch(testDir);
      await git.createBranch(testDir, "feature-modify");
      
      // Modify existing README.md
      await writeFile(join(testDir, "README.md"), "# Test\n\nModified content\n");
      await git.commit(testDir, "Modify README");
      
      const diffs = await git.getDiff(testDir, originalBranch);
      expect(diffs.length).toBe(1);
      expect(diffs[0]?.path).toBe("README.md");
      expect(diffs[0]?.status).toBe("modified");
    });

    test("returns file diffs for deleted files", async () => {
      const originalBranch = await git.getCurrentBranch(testDir);
      await git.createBranch(testDir, "feature-delete");
      
      // Delete README.md
      await Bun.$`rm ${join(testDir, "README.md")}`.quiet();
      await git.commit(testDir, "Delete README");
      
      const diffs = await git.getDiff(testDir, originalBranch);
      expect(diffs.length).toBe(1);
      expect(diffs[0]?.path).toBe("README.md");
      expect(diffs[0]?.status).toBe("deleted");
      expect(diffs[0]?.deletions).toBeGreaterThan(0);
    });

    test("returns multiple file diffs", async () => {
      const originalBranch = await git.getCurrentBranch(testDir);
      await git.createBranch(testDir, "feature-multiple");
      
      await writeFile(join(testDir, "file1.txt"), "Content 1\n");
      await writeFile(join(testDir, "file2.txt"), "Content 2\n");
      await writeFile(join(testDir, "README.md"), "# Updated\n");
      await git.commit(testDir, "Multiple changes");
      
      const diffs = await git.getDiff(testDir, originalBranch);
      expect(diffs.length).toBe(3);
      
      const paths = diffs.map(d => d.path).sort();
      expect(paths).toEqual(["README.md", "file1.txt", "file2.txt"]);
    });
  });

  describe("getDiffWithContent", () => {
    test("returns diffs with patch content for added files", async () => {
      const originalBranch = await git.getCurrentBranch(testDir);
      await git.createBranch(testDir, "feature-patch-add");
      
      await writeFile(join(testDir, "new-file.txt"), "Hello World\nLine 2\n");
      await git.commit(testDir, "Add new file");
      
      const diffs = await git.getDiffWithContent(testDir, originalBranch);
      expect(diffs.length).toBe(1);
      expect(diffs[0]?.path).toBe("new-file.txt");
      expect(diffs[0]?.patch).toBeDefined();
      expect(diffs[0]?.patch).toContain("diff --git");
      expect(diffs[0]?.patch).toContain("+Hello World");
      expect(diffs[0]?.patch).toContain("+Line 2");
    });

    test("returns diffs with patch content for modified files", async () => {
      const originalBranch = await git.getCurrentBranch(testDir);
      await git.createBranch(testDir, "feature-patch-modify");
      
      await writeFile(join(testDir, "README.md"), "# Updated Title\n\nNew content here\n");
      await git.commit(testDir, "Update README");
      
      const diffs = await git.getDiffWithContent(testDir, originalBranch);
      expect(diffs.length).toBe(1);
      expect(diffs[0]?.path).toBe("README.md");
      expect(diffs[0]?.patch).toBeDefined();
      expect(diffs[0]?.patch).toContain("diff --git");
      expect(diffs[0]?.patch).toContain("-# Test");
      expect(diffs[0]?.patch).toContain("+# Updated Title");
    });

    test("returns diffs with patch content for multiple files", async () => {
      const originalBranch = await git.getCurrentBranch(testDir);
      await git.createBranch(testDir, "feature-patch-multi");
      
      await writeFile(join(testDir, "file1.txt"), "File 1 content\n");
      await writeFile(join(testDir, "file2.txt"), "File 2 content\n");
      await git.commit(testDir, "Add two files");
      
      const diffs = await git.getDiffWithContent(testDir, originalBranch);
      expect(diffs.length).toBe(2);
      
      // Both files should have patches
      for (const diff of diffs) {
        expect(diff.patch).toBeDefined();
        expect(diff.patch).toContain("diff --git");
      }
      
      // Check specific content
      const file1Diff = diffs.find(d => d.path === "file1.txt");
      const file2Diff = diffs.find(d => d.path === "file2.txt");
      
      expect(file1Diff?.patch).toContain("+File 1 content");
      expect(file2Diff?.patch).toContain("+File 2 content");
    });

    test("returns empty patch for files with no diff content available", async () => {
      const originalBranch = await git.getCurrentBranch(testDir);
      
      // No changes on the branch
      await git.createBranch(testDir, "feature-no-patch");
      
      const diffs = await git.getDiffWithContent(testDir, originalBranch);
      expect(diffs).toEqual([]);
    });

    test("handles files with special characters in path", async () => {
      const originalBranch = await git.getCurrentBranch(testDir);
      await git.createBranch(testDir, "feature-special-path");
      
      // Create a file in a subdirectory
      await Bun.$`mkdir -p ${join(testDir, "src/components")}`.quiet();
      await writeFile(join(testDir, "src/components/Button.tsx"), "export const Button = () => <button />;\n");
      await git.commit(testDir, "Add component");
      
      const diffs = await git.getDiffWithContent(testDir, originalBranch);
      expect(diffs.length).toBe(1);
      expect(diffs[0]?.path).toBe("src/components/Button.tsx");
      expect(diffs[0]?.patch).toBeDefined();
      expect(diffs[0]?.patch).toContain("diff --git");
    });
  });

  describe("getFileDiffContent", () => {
    test("returns patch content for a specific file", async () => {
      const originalBranch = await git.getCurrentBranch(testDir);
      await git.createBranch(testDir, "feature-file-diff");
      
      await writeFile(join(testDir, "specific-file.txt"), "Specific content\n");
      await writeFile(join(testDir, "other-file.txt"), "Other content\n");
      await git.commit(testDir, "Add files");
      
      const patch = await git.getFileDiffContent(testDir, originalBranch, "specific-file.txt");
      expect(patch).toContain("diff --git");
      expect(patch).toContain("+Specific content");
      expect(patch).not.toContain("Other content");
    });
  });

  describe("getDiffSummary", () => {
    test("returns summary of changes", async () => {
      const originalBranch = await git.getCurrentBranch(testDir);
      await git.createBranch(testDir, "feature-summary");
      
      await writeFile(join(testDir, "file1.txt"), "Line 1\nLine 2\nLine 3\n");
      await writeFile(join(testDir, "file2.txt"), "Content\n");
      await git.commit(testDir, "Add files");
      
      const summary = await git.getDiffSummary(testDir, originalBranch);
      expect(summary.files).toBe(2);
      expect(summary.insertions).toBe(4); // 3 lines in file1 + 1 line in file2
      expect(summary.deletions).toBe(0);
    });

    test("returns zero summary when no changes", async () => {
      const originalBranch = await git.getCurrentBranch(testDir);
      await git.createBranch(testDir, "feature-no-summary");
      
      const summary = await git.getDiffSummary(testDir, originalBranch);
      expect(summary.files).toBe(0);
      expect(summary.insertions).toBe(0);
      expect(summary.deletions).toBe(0);
    });
  });
});
