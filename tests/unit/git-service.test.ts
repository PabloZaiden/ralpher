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

  describe("getLocalBranches", () => {
    test("returns all local branches with current marked", async () => {
      // Get the default branch name (could be main or master depending on git config)
      const defaultBranch = await git.getCurrentBranch(testDir);
      
      // Create additional branches
      await git.createBranch(testDir, "feature-a");
      await git.checkoutBranch(testDir, defaultBranch);
      await git.createBranch(testDir, "feature-b");
      await git.checkoutBranch(testDir, defaultBranch);

      const branches = await git.getLocalBranches(testDir);
      
      expect(branches.length).toBeGreaterThanOrEqual(3);
      
      // Check that current branch is marked
      const currentBranch = branches.find(b => b.current);
      expect(currentBranch).toBeDefined();
      expect(currentBranch?.name).toBe(defaultBranch);
      
      // Check that feature branches exist
      const featureA = branches.find(b => b.name === "feature-a");
      const featureB = branches.find(b => b.name === "feature-b");
      expect(featureA).toBeDefined();
      expect(featureB).toBeDefined();
      expect(featureA?.current).toBe(false);
      expect(featureB?.current).toBe(false);
    });

    test("returns current branch for repo with no commits (empty repo)", async () => {
      // Create a new empty repo (no commits)
      const emptyRepoDir = await mkdtemp(join(tmpdir(), "ralpher-empty-repo-"));
      try {
        await Bun.$`git init ${emptyRepoDir}`.quiet();
        
        const branches = await git.getLocalBranches(emptyRepoDir);
        
        // Should return the current branch even though there are no commits
        expect(branches.length).toBe(1);
        expect(branches[0]?.current).toBe(true);
        // Branch name is typically "main" or "master" depending on git config
        const branchName = branches[0]?.name ?? "";
        expect(["main", "master"]).toContain(branchName);
      } finally {
        await rm(emptyRepoDir, { recursive: true });
      }
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

  describe("pull", () => {
    test("returns false when no remote is configured", async () => {
      // Our test repo has no remote configured
      const result = await git.pull(testDir);
      expect(result).toBe(false);
    });

    test("returns false when remote branch does not exist", async () => {
      // Create a bare remote repo
      const remoteDir = await mkdtemp(join(tmpdir(), "ralpher-remote-"));
      try {
        await Bun.$`git init --bare ${remoteDir}`.quiet();
        await Bun.$`git -C ${testDir} remote add origin ${remoteDir}`.quiet();
        
        // Try to pull a branch that doesn't exist on remote
        const result = await git.pull(testDir, "non-existent-branch");
        expect(result).toBe(false);
      } finally {
        await rm(remoteDir, { recursive: true });
      }
    });

    test("successfully pulls when remote has changes", async () => {
      // Create a bare remote repo
      const remoteDir = await mkdtemp(join(tmpdir(), "ralpher-remote-"));
      try {
        await Bun.$`git init --bare ${remoteDir}`.quiet();
        await Bun.$`git -C ${testDir} remote add origin ${remoteDir}`.quiet();
        
        // Push current branch to remote
        const currentBranch = await git.getCurrentBranch(testDir);
        await Bun.$`git -C ${testDir} push -u origin ${currentBranch}`.quiet();
        
        // Clone the remote to a second working copy and make a change
        const otherClone = await mkdtemp(join(tmpdir(), "ralpher-clone-"));
        try {
          await Bun.$`git clone ${remoteDir} ${otherClone}`.quiet();
          await Bun.$`git -C ${otherClone} config user.email "other@test.com"`.quiet();
          await Bun.$`git -C ${otherClone} config user.name "Other User"`.quiet();
          await writeFile(join(otherClone, "new-from-remote.txt"), "Remote content\n");
          await Bun.$`git -C ${otherClone} add -A`.quiet();
          await Bun.$`git -C ${otherClone} commit -m "Add file from other clone"`.quiet();
          await Bun.$`git -C ${otherClone} push`.quiet();
        } finally {
          await rm(otherClone, { recursive: true });
        }
        
        // Now pull in original repo - should succeed
        const result = await git.pull(testDir, currentBranch);
        expect(result).toBe(true);
        
        // Verify the file now exists
        const file = Bun.file(join(testDir, "new-from-remote.txt"));
        const exists = await file.exists();
        expect(exists).toBe(true);
      } finally {
        await rm(remoteDir, { recursive: true });
      }
    });

    test("uses current branch when no branch name is specified", async () => {
      // Create a bare remote repo
      const remoteDir = await mkdtemp(join(tmpdir(), "ralpher-remote-"));
      try {
        await Bun.$`git init --bare ${remoteDir}`.quiet();
        await Bun.$`git -C ${testDir} remote add origin ${remoteDir}`.quiet();
        
        // Push current branch to remote
        const currentBranch = await git.getCurrentBranch(testDir);
        await Bun.$`git -C ${testDir} push -u origin ${currentBranch}`.quiet();
        
        // Pull without specifying branch - should succeed and use current branch
        const result = await git.pull(testDir);
        expect(result).toBe(true);
      } finally {
        await rm(remoteDir, { recursive: true });
      }
    });
  });

  describe("getDefaultBranch", () => {
    test("returns branch from origin/HEAD when set", async () => {
      // Create a bare remote repo
      const remoteDir = await mkdtemp(join(tmpdir(), "ralpher-remote-"));
      try {
        await Bun.$`git init --bare ${remoteDir}`.quiet();
        await Bun.$`git -C ${testDir} remote add origin ${remoteDir}`.quiet();
        
        // Push current branch to remote
        const currentBranch = await git.getCurrentBranch(testDir);
        await Bun.$`git -C ${testDir} push -u origin ${currentBranch}`.quiet();
        
        // Set origin/HEAD to point to our branch
        await Bun.$`git -C ${testDir} remote set-head origin ${currentBranch}`.quiet();
        
        const defaultBranch = await git.getDefaultBranch(testDir);
        expect(defaultBranch).toBe(currentBranch);
      } finally {
        await rm(remoteDir, { recursive: true });
      }
    });

    test("falls back to main when origin/HEAD is not set but main exists", async () => {
      // Our test repo should already have main or master
      const currentBranch = await git.getCurrentBranch(testDir);
      
      // If the current branch is "main", this test is valid
      if (currentBranch === "main") {
        const defaultBranch = await git.getDefaultBranch(testDir);
        expect(defaultBranch).toBe("main");
      } else {
        // Create a "main" branch if it doesn't exist
        await git.createBranch(testDir, "main");
        await git.checkoutBranch(testDir, currentBranch);
        
        const defaultBranch = await git.getDefaultBranch(testDir);
        expect(defaultBranch).toBe("main");
      }
    });

    test("falls back to master when main does not exist but master does", async () => {
      const currentBranch = await git.getCurrentBranch(testDir);
      
      // If the current branch is "master", this test is valid
      if (currentBranch === "master") {
        const defaultBranch = await git.getDefaultBranch(testDir);
        expect(defaultBranch).toBe("master");
      } else {
        // Create a repo with only "master" branch
        const masterRepoDir = await mkdtemp(join(tmpdir(), "ralpher-master-repo-"));
        try {
          // Initialize with master as default branch
          await Bun.$`git -c init.defaultBranch=master init ${masterRepoDir}`.quiet();
          await Bun.$`git -C ${masterRepoDir} config user.email "test@test.com"`.quiet();
          await Bun.$`git -C ${masterRepoDir} config user.name "Test User"`.quiet();
          await writeFile(join(masterRepoDir, "README.md"), "# Test\n");
          await Bun.$`git -C ${masterRepoDir} add -A`.quiet();
          await Bun.$`git -C ${masterRepoDir} commit -m "Initial commit"`.quiet();
          
          // Create a new GitService for this repo
          const executor = new TestCommandExecutor();
          const masterGit = new GitService(executor);
          
          const defaultBranch = await masterGit.getDefaultBranch(masterRepoDir);
          expect(defaultBranch).toBe("master");
        } finally {
          await rm(masterRepoDir, { recursive: true });
        }
      }
    });

    test("falls back to current branch when neither main nor master exists", async () => {
      // Create a repo with a custom default branch name
      const customRepoDir = await mkdtemp(join(tmpdir(), "ralpher-custom-repo-"));
      try {
        // Initialize with a custom default branch
        await Bun.$`git -c init.defaultBranch=develop init ${customRepoDir}`.quiet();
        await Bun.$`git -C ${customRepoDir} config user.email "test@test.com"`.quiet();
        await Bun.$`git -C ${customRepoDir} config user.name "Test User"`.quiet();
        await writeFile(join(customRepoDir, "README.md"), "# Test\n");
        await Bun.$`git -C ${customRepoDir} add -A`.quiet();
        await Bun.$`git -C ${customRepoDir} commit -m "Initial commit"`.quiet();
        
        // Create a new GitService for this repo
        const executor = new TestCommandExecutor();
        const customGit = new GitService(executor);
        
        const defaultBranch = await customGit.getDefaultBranch(customRepoDir);
        expect(defaultBranch).toBe("develop");
      } finally {
        await rm(customRepoDir, { recursive: true });
      }
    });

    test("prefers origin/HEAD over local main branch", async () => {
      // Create a bare remote repo
      const remoteDir = await mkdtemp(join(tmpdir(), "ralpher-remote-"));
      try {
        await Bun.$`git init --bare ${remoteDir}`.quiet();
        await Bun.$`git -C ${testDir} remote add origin ${remoteDir}`.quiet();
        
        // Get current branch
        const currentBranch = await git.getCurrentBranch(testDir);
        
        // Create a "develop" branch and push it
        await git.createBranch(testDir, "develop");
        await writeFile(join(testDir, "develop.txt"), "develop\n");
        await git.commit(testDir, "Develop commit");
        await Bun.$`git -C ${testDir} push -u origin develop`.quiet();
        
        // Go back to original branch and push it
        await git.checkoutBranch(testDir, currentBranch);
        await Bun.$`git -C ${testDir} push -u origin ${currentBranch}`.quiet();
        
        // Set origin/HEAD to develop (not main/master)
        await Bun.$`git -C ${testDir} remote set-head origin develop`.quiet();
        
        const defaultBranch = await git.getDefaultBranch(testDir);
        expect(defaultBranch).toBe("develop");
      } finally {
        await rm(remoteDir, { recursive: true });
      }
    });
  });
});
