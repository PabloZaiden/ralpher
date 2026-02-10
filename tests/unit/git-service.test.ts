/**
 * Unit tests for GitService.
 */

import { test, expect, describe, beforeEach, afterEach } from "bun:test";
import { mkdtemp, rm, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { GitService, BranchMismatchError } from "../../src/core/git-service";
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

  describe("verifyBranch", () => {
    test("returns matches: true when on expected branch", async () => {
      const currentBranch = await git.getCurrentBranch(testDir);
      const result = await git.verifyBranch(testDir, currentBranch);
      
      expect(result.matches).toBe(true);
      expect(result.currentBranch).toBe(currentBranch);
      expect(result.expectedBranch).toBe(currentBranch);
    });

    test("returns matches: false when on different branch", async () => {
      const originalBranch = await git.getCurrentBranch(testDir);
      await git.createBranch(testDir, "other-branch");
      
      const result = await git.verifyBranch(testDir, originalBranch);
      
      expect(result.matches).toBe(false);
      expect(result.currentBranch).toBe("other-branch");
      expect(result.expectedBranch).toBe(originalBranch);
    });
  });

  describe("ensureBranch", () => {
    test("returns wasOnExpectedBranch: true when already on expected branch", async () => {
      const currentBranch = await git.getCurrentBranch(testDir);
      const result = await git.ensureBranch(testDir, currentBranch);
      
      expect(result.wasOnExpectedBranch).toBe(true);
      expect(result.currentBranch).toBe(currentBranch);
      expect(result.expectedBranch).toBe(currentBranch);
      expect(result.checkedOut).toBe(false);
    });

    test("throws BranchMismatchError when on different branch without autoCheckout", async () => {
      const originalBranch = await git.getCurrentBranch(testDir);
      await git.createBranch(testDir, "other-branch");
      
      try {
        await git.ensureBranch(testDir, originalBranch);
        expect(true).toBe(false); // Should not reach here
      } catch (error) {
        expect(error).toBeInstanceOf(BranchMismatchError);
        const branchError = error as BranchMismatchError;
        expect(branchError.code).toBe("BRANCH_MISMATCH");
        expect(branchError.currentBranch).toBe("other-branch");
        expect(branchError.expectedBranch).toBe(originalBranch);
      }
    });

    test("auto-checkouts to expected branch when autoCheckout is true", async () => {
      const originalBranch = await git.getCurrentBranch(testDir);
      await git.createBranch(testDir, "other-branch");
      
      // Should be on other-branch now
      expect(await git.getCurrentBranch(testDir)).toBe("other-branch");
      
      const result = await git.ensureBranch(testDir, originalBranch, { autoCheckout: true });
      
      expect(result.wasOnExpectedBranch).toBe(false);
      expect(result.currentBranch).toBe("other-branch");
      expect(result.expectedBranch).toBe(originalBranch);
      expect(result.checkedOut).toBe(true);
      
      // Should now be on the original branch
      expect(await git.getCurrentBranch(testDir)).toBe(originalBranch);
    });

    test("throws error when autoCheckout fails due to uncommitted changes", async () => {
      const originalBranch = await git.getCurrentBranch(testDir);
      await git.createBranch(testDir, "other-branch");
      
      // Create uncommitted changes
      await writeFile(join(testDir, "uncommitted.txt"), "uncommitted\n");
      
      try {
        await git.ensureBranch(testDir, originalBranch, { autoCheckout: true });
        expect(true).toBe(false); // Should not reach here
      } catch (error) {
        expect(String(error)).toContain("uncommitted changes exist");
      }
    });
  });

  describe("BranchMismatchError", () => {
    test("has correct properties", () => {
      const error = new BranchMismatchError("current-branch", "expected-branch");
      
      expect(error.name).toBe("BranchMismatchError");
      expect(error.code).toBe("BRANCH_MISMATCH");
      expect(error.currentBranch).toBe("current-branch");
      expect(error.expectedBranch).toBe("expected-branch");
      expect(error.message).toBe("Branch mismatch: expected 'expected-branch' but on 'current-branch'");
    });
  });

  describe("commit with expectedBranch", () => {
    test("commits successfully when on expected branch", async () => {
      const currentBranch = await git.getCurrentBranch(testDir);
      await writeFile(join(testDir, "new-file.txt"), "new content\n");
      
      const commitInfo = await git.commit(testDir, "Test commit", {
        expectedBranch: currentBranch,
      });
      
      expect(commitInfo.sha).toBeDefined();
      expect(commitInfo.filesChanged).toBe(1);
    });

    test("auto-checkouts to expected branch when working tree is clean", async () => {
      const originalBranch = await git.getCurrentBranch(testDir);
      
      // Create and switch to another branch
      await git.createBranch(testDir, "other-branch");
      
      // Now we're on other-branch with clean working tree
      // Verify we can auto-checkout to original (even though no changes to commit)
      // We'll test ensureBranch directly since commit requires changes
      const result = await git.ensureBranch(testDir, originalBranch, { autoCheckout: true });
      
      expect(result.wasOnExpectedBranch).toBe(false);
      expect(result.checkedOut).toBe(true);
      expect(await git.getCurrentBranch(testDir)).toBe(originalBranch);
    });
    
    test("fails to auto-recover when uncommitted changes exist on wrong branch", async () => {
      const originalBranch = await git.getCurrentBranch(testDir);
      
      // Create and switch to another branch
      await git.createBranch(testDir, "other-branch-2");
      
      // Create uncommitted changes on the wrong branch
      await writeFile(join(testDir, "uncommitted.txt"), "uncommitted content\n");
      
      // Try to commit with expectedBranch pointing to original - should fail
      await expect(
        git.commit(testDir, "Test commit", { expectedBranch: originalBranch })
      ).rejects.toThrow(/Cannot auto-checkout.*uncommitted changes exist/);
      
      // Verify we're still on the wrong branch
      expect(await git.getCurrentBranch(testDir)).toBe("other-branch-2");
    });
  });

  describe("resetHard with expectedBranch", () => {
    test("resets successfully when on expected branch", async () => {
      const currentBranch = await git.getCurrentBranch(testDir);
      await writeFile(join(testDir, "new-file.txt"), "new content\n");
      
      await git.resetHard(testDir, { expectedBranch: currentBranch });
      
      const hasChanges = await git.hasUncommittedChanges(testDir);
      expect(hasChanges).toBe(false);
    });

    test("switches to expected branch before reset when on wrong branch", async () => {
      const originalBranch = await git.getCurrentBranch(testDir);
      
      // Create another branch with a file
      await git.createBranch(testDir, "other-branch");
      await writeFile(join(testDir, "other-file.txt"), "other content\n");
      await git.commit(testDir, "Other commit");
      
      // Create uncommitted changes
      await writeFile(join(testDir, "uncommitted.txt"), "uncommitted\n");
      
      // Reset with expectedBranch pointing to original
      // This should switch to original branch (discarding changes) then reset
      await git.resetHard(testDir, { expectedBranch: originalBranch });
      
      // Should now be on original branch with clean state
      expect(await git.getCurrentBranch(testDir)).toBe(originalBranch);
      const hasChanges = await git.hasUncommittedChanges(testDir);
      expect(hasChanges).toBe(false);
    });

    test("handles conflicting tracked file changes when switching branches", async () => {
      const originalBranch = await git.getCurrentBranch(testDir);
      
      // Create a tracked file on original branch
      await writeFile(join(testDir, "shared-file.txt"), "original content\n");
      await git.commit(testDir, "Add shared file");
      
      // Create another branch and modify the tracked file
      await git.createBranch(testDir, "feature-branch");
      await writeFile(join(testDir, "shared-file.txt"), "feature content\n");
      await git.commit(testDir, "Modify shared file on feature branch");
      
      // Now modify the same tracked file WITHOUT committing
      // This creates a scenario where regular git checkout would fail
      await writeFile(join(testDir, "shared-file.txt"), "uncommitted changes that conflict\n");
      
      // Verify we have uncommitted changes to a tracked file
      expect(await git.hasUncommittedChanges(testDir)).toBe(true);
      
      // Reset with expectedBranch pointing to original - this previously would fail
      // because regular checkout fails when tracked files have conflicting changes
      await git.resetHard(testDir, { expectedBranch: originalBranch });
      
      // Should now be on original branch with clean state
      expect(await git.getCurrentBranch(testDir)).toBe(originalBranch);
      expect(await git.hasUncommittedChanges(testDir)).toBe(false);
      
      // Verify the file contains the original branch content
      const content = await Bun.file(join(testDir, "shared-file.txt")).text();
      expect(content).toBe("original content\n");
    });
  });

  describe("cleanupStaleLockFiles", () => {
    test("removes existing lock file", async () => {
      const { stat } = await import("fs/promises");
      
      // Ensure .git directory exists (it should from beforeEach)
      const lockFile = join(testDir, ".git", "index.lock");
      
      // Create a stale lock file
      await writeFile(lockFile, "");
      
      // Verify lock file exists
      const statBefore = await stat(lockFile).catch(() => null);
      expect(statBefore).not.toBeNull();
      
      // Clean up
      const cleaned = await GitService.cleanupStaleLockFiles(testDir);
      expect(cleaned).toBe(true);
      
      // Verify lock file is removed
      const statAfter = await stat(lockFile).catch(() => null);
      expect(statAfter).toBeNull();
    });

    test("returns false when no lock file exists", async () => {
      // No lock file exists by default
      const cleaned = await GitService.cleanupStaleLockFiles(testDir);
      expect(cleaned).toBe(false);
    });

    test("handles repeated cleanup with retries", async () => {
      const { stat } = await import("fs/promises");
      
      const lockFile = join(testDir, ".git", "index.lock");
      
      // Create a stale lock file
      await writeFile(lockFile, "");
      
      // Clean up with retries
      const cleaned = await GitService.cleanupStaleLockFiles(testDir, 3, 10);
      expect(cleaned).toBe(true);
      
      // Verify lock file is removed
      const statAfter = await stat(lockFile).catch(() => null);
      expect(statAfter).toBeNull();
    });

    test("works on non-existent directory gracefully", async () => {
      // Should not throw for non-existent directory
      const cleaned = await GitService.cleanupStaleLockFiles("/tmp/nonexistent-dir-12345");
      expect(cleaned).toBe(false);
    });
  });

  describe("fetchBranch", () => {
    test("returns false when no remote is configured", async () => {
      const result = await git.fetchBranch(testDir, "main");
      expect(result).toBe(false);
    });

    test("returns false when remote branch does not exist", async () => {
      const remoteDir = await mkdtemp(join(tmpdir(), "ralpher-remote-"));
      try {
        await Bun.$`git init --bare ${remoteDir}`.quiet();
        await Bun.$`git -C ${testDir} remote add origin ${remoteDir}`.quiet();

        const currentBranch = await git.getCurrentBranch(testDir);
        await Bun.$`git -C ${testDir} push -u origin ${currentBranch}`.quiet();

        const result = await git.fetchBranch(testDir, "non-existent-branch");
        expect(result).toBe(false);
      } finally {
        await rm(remoteDir, { recursive: true });
      }
    });

    test("successfully fetches an existing remote branch", async () => {
      const remoteDir = await mkdtemp(join(tmpdir(), "ralpher-remote-"));
      try {
        await Bun.$`git init --bare ${remoteDir}`.quiet();
        await Bun.$`git -C ${testDir} remote add origin ${remoteDir}`.quiet();

        const currentBranch = await git.getCurrentBranch(testDir);
        await Bun.$`git -C ${testDir} push -u origin ${currentBranch}`.quiet();

        // Create a second clone, add a commit, push
        const otherClone = await mkdtemp(join(tmpdir(), "ralpher-clone-"));
        try {
          await Bun.$`git clone ${remoteDir} ${otherClone}`.quiet();
          await Bun.$`git -C ${otherClone} config user.email "other@test.com"`.quiet();
          await Bun.$`git -C ${otherClone} config user.name "Other User"`.quiet();
          await writeFile(join(otherClone, "remote-file.txt"), "remote content\n");
          await Bun.$`git -C ${otherClone} add -A`.quiet();
          await Bun.$`git -C ${otherClone} commit -m "Remote commit"`.quiet();
          await Bun.$`git -C ${otherClone} push`.quiet();
        } finally {
          await rm(otherClone, { recursive: true });
        }

        // Fetch should succeed and update the remote tracking ref
        const result = await git.fetchBranch(testDir, currentBranch);
        expect(result).toBe(true);

        // Verify the remote tracking ref was updated (origin/<branch> has the new commit)
        const logResult = await Bun.$`git -C ${testDir} log --oneline origin/${currentBranch} -1`.text();
        expect(logResult).toContain("Remote commit");
      } finally {
        await rm(remoteDir, { recursive: true });
      }
    });
  });

  describe("isAncestor", () => {
    test("returns true when ref is an ancestor", async () => {
      // The initial commit is an ancestor of any subsequent commit
      const initialSha = (await Bun.$`git -C ${testDir} rev-parse HEAD`.text()).trim();

      await writeFile(join(testDir, "new-file.txt"), "content\n");
      await git.commit(testDir, "Second commit");
      const secondSha = (await Bun.$`git -C ${testDir} rev-parse HEAD`.text()).trim();

      const result = await git.isAncestor(testDir, initialSha, secondSha);
      expect(result).toBe(true);
    });

    test("returns false when ref is not an ancestor (diverged)", async () => {
      const currentBranch = await git.getCurrentBranch(testDir);

      // Create two divergent branches
      await git.createBranch(testDir, "branch-a");
      await writeFile(join(testDir, "a-file.txt"), "a content\n");
      await git.commit(testDir, "Commit on branch A");
      const shaA = (await Bun.$`git -C ${testDir} rev-parse HEAD`.text()).trim();

      await git.checkoutBranch(testDir, currentBranch);
      await git.createBranch(testDir, "branch-b");
      await writeFile(join(testDir, "b-file.txt"), "b content\n");
      await git.commit(testDir, "Commit on branch B");
      const shaB = (await Bun.$`git -C ${testDir} rev-parse HEAD`.text()).trim();

      // Neither is an ancestor of the other
      expect(await git.isAncestor(testDir, shaA, shaB)).toBe(false);
      expect(await git.isAncestor(testDir, shaB, shaA)).toBe(false);
    });

    test("returns true when both refs point to the same commit", async () => {
      const sha = (await Bun.$`git -C ${testDir} rev-parse HEAD`.text()).trim();
      const result = await git.isAncestor(testDir, sha, sha);
      expect(result).toBe(true);
    });
  });

  describe("mergeWithConflictDetection", () => {
    test("returns success for a clean merge", async () => {
      const currentBranch = await git.getCurrentBranch(testDir);

      // Create a feature branch with a new file
      await git.createBranch(testDir, "feature-clean");
      await writeFile(join(testDir, "feature.txt"), "feature content\n");
      await git.commit(testDir, "Add feature");

      // Go back to the original branch
      await git.checkoutBranch(testDir, currentBranch);

      // Merge the feature branch
      const result = await git.mergeWithConflictDetection(testDir, "feature-clean");
      expect(result.success).toBe(true);
      expect(result.alreadyUpToDate).toBe(false);
      expect(result.hasConflicts).toBe(false);
      expect(result.mergeCommitSha).toBeDefined();
      expect(result.mergeCommitSha).toHaveLength(40);
    });

    test("returns alreadyUpToDate when branches have not diverged", async () => {
      const currentBranch = await git.getCurrentBranch(testDir);

      // Create a branch at the same point (no new commits)
      await git.createBranch(testDir, "same-point");
      await git.checkoutBranch(testDir, currentBranch);

      const result = await git.mergeWithConflictDetection(testDir, "same-point");
      expect(result.success).toBe(true);
      expect(result.alreadyUpToDate).toBe(true);
      expect(result.hasConflicts).toBe(false);
    });

    test("detects conflicts and returns conflict info", async () => {
      const currentBranch = await git.getCurrentBranch(testDir);

      // Create a feature branch that modifies README.md
      await git.createBranch(testDir, "feature-conflict");
      await writeFile(join(testDir, "README.md"), "# Feature Version\n");
      await git.commit(testDir, "Modify README on feature");

      // Go back and modify README.md on the original branch too
      await git.checkoutBranch(testDir, currentBranch);
      await writeFile(join(testDir, "README.md"), "# Main Version\n");
      await git.commit(testDir, "Modify README on main");

      // Attempt merge — should conflict
      const result = await git.mergeWithConflictDetection(testDir, "feature-conflict");
      expect(result.success).toBe(false);
      expect(result.alreadyUpToDate).toBe(false);
      expect(result.hasConflicts).toBe(true);
      expect(result.conflictedFiles).toBeDefined();
      expect(result.conflictedFiles).toContain("README.md");
    });

    test("uses custom merge commit message when provided", async () => {
      const currentBranch = await git.getCurrentBranch(testDir);

      await git.createBranch(testDir, "feature-msg");
      await writeFile(join(testDir, "msg-file.txt"), "content\n");
      await git.commit(testDir, "Add file on feature");

      await git.checkoutBranch(testDir, currentBranch);

      const result = await git.mergeWithConflictDetection(
        testDir,
        "feature-msg",
        "Custom merge message"
      );
      expect(result.success).toBe(true);

      // Verify the merge commit message
      const logMsg = (await Bun.$`git -C ${testDir} log -1 --format=%s`.text()).trim();
      expect(logMsg).toBe("Custom merge message");
    });
  });

  describe("abortMerge", () => {
    test("aborts a conflicted merge and restores clean state", async () => {
      const currentBranch = await git.getCurrentBranch(testDir);

      // Set up a conflict
      await git.createBranch(testDir, "conflict-abort");
      await writeFile(join(testDir, "README.md"), "# Conflict Branch\n");
      await git.commit(testDir, "Change README on conflict branch");

      await git.checkoutBranch(testDir, currentBranch);
      await writeFile(join(testDir, "README.md"), "# Original Branch\n");
      await git.commit(testDir, "Change README on original");

      // Merge to create conflict
      const mergeResult = await git.mergeWithConflictDetection(testDir, "conflict-abort");
      expect(mergeResult.hasConflicts).toBe(true);

      // Abort the merge
      await git.abortMerge(testDir);

      // Verify working tree is clean
      const hasChanges = await git.hasUncommittedChanges(testDir);
      expect(hasChanges).toBe(false);

      // Verify we're still on the original branch
      const branch = await git.getCurrentBranch(testDir);
      expect(branch).toBe(currentBranch);

      // Verify README has the original branch content
      const content = await Bun.file(join(testDir, "README.md")).text();
      expect(content).toBe("# Original Branch\n");
    });

    test("throws when no merge is in progress", async () => {
      await expect(git.abortMerge(testDir)).rejects.toThrow();
    });
  });

  describe("getConflictedFiles", () => {
    test("returns empty array when no conflicts", async () => {
      const files = await git.getConflictedFiles(testDir);
      expect(files).toEqual([]);
    });

    test("lists conflicted files during a merge conflict", async () => {
      const currentBranch = await git.getCurrentBranch(testDir);

      // Create conflicts in multiple files
      await writeFile(join(testDir, "file-a.txt"), "original a\n");
      await writeFile(join(testDir, "file-b.txt"), "original b\n");
      await git.commit(testDir, "Add original files");

      await git.createBranch(testDir, "conflict-files");
      await writeFile(join(testDir, "file-a.txt"), "conflict branch a\n");
      await writeFile(join(testDir, "file-b.txt"), "conflict branch b\n");
      await git.commit(testDir, "Modify files on conflict branch");

      await git.checkoutBranch(testDir, currentBranch);
      await writeFile(join(testDir, "file-a.txt"), "main branch a\n");
      await writeFile(join(testDir, "file-b.txt"), "main branch b\n");
      await git.commit(testDir, "Modify files on main");

      // Trigger merge conflict
      await git.mergeWithConflictDetection(testDir, "conflict-files");

      // Get conflicted files
      const conflictedFiles = await git.getConflictedFiles(testDir);
      expect(conflictedFiles).toContain("file-a.txt");
      expect(conflictedFiles).toContain("file-b.txt");
      expect(conflictedFiles.length).toBe(2);

      // Clean up: abort the merge
      await git.abortMerge(testDir);
    });
  });
});
