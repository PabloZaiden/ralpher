/**
 * Git service for Ralph Loops Management System.
 * Provides git operations using a CommandExecutor abstraction.
 * All operations are isolated to a specific directory.
 */

import type { CommandExecutor } from "./command-executor";
import { realpath } from "node:fs/promises";
import { log } from "./logger";

/**
 * Error thrown when the current branch doesn't match the expected branch.
 * Used for branch safety verification before git operations.
 */
export class BranchMismatchError extends Error {
  readonly code = "BRANCH_MISMATCH";
  readonly currentBranch: string;
  readonly expectedBranch: string;

  constructor(currentBranch: string, expectedBranch: string) {
    super(`Branch mismatch: expected '${expectedBranch}' but on '${currentBranch}'`);
    this.name = "BranchMismatchError";
    this.currentBranch = currentBranch;
    this.expectedBranch = expectedBranch;
  }
}

/**
 * Error thrown when a git command fails.
 * Preserves the command, exit code, and stderr for debugging.
 */
export class GitCommandError extends Error {
  readonly code = "GIT_COMMAND_FAILED";
  readonly command: string;
  readonly exitCode: number;
  readonly gitStderr: string;

  constructor(message: string, command: string, exitCode: number, stderr: string) {
    super(message);
    this.name = "GitCommandError";
    this.command = command;
    this.exitCode = exitCode;
    this.gitStderr = stderr;
  }
}

/**
 * Result of a git command execution.
 */
export interface GitCommandResult {
  success: boolean;
  stdout: string;
  stderr: string;
  exitCode: number;
}

/**
 * Result of verifying the current branch.
 */
export interface BranchVerificationResult {
  /** Whether the current branch matches the expected branch */
  matches: boolean;
  /** The current branch name */
  currentBranch: string;
  /** The expected branch name */
  expectedBranch: string;
}

/**
 * Options for ensureBranch() method.
 */
export interface EnsureBranchOptions {
  /** If true, checkout the expected branch if mismatch (default: false) */
  autoCheckout?: boolean;
}

/**
 * Result of ensuring the correct branch.
 */
export interface EnsureBranchResult {
  /** Whether the repo was already on the expected branch */
  wasOnExpectedBranch: boolean;
  /** The current branch name (before any checkout) */
  currentBranch: string;
  /** The expected branch name */
  expectedBranch: string;
  /** True if auto-checkout was performed */
  checkedOut?: boolean;
}

/**
 * Options for commit operation with branch verification.
 */
export interface CommitOptions {
  /** Expected branch to verify before committing. If set and mismatch, will auto-checkout. */
  expectedBranch?: string;
}

/**
 * Options for resetHard operation with branch verification.
 */
export interface ResetHardOptions {
  /**
   * Expected branch to verify before resetting.
   * If set and there is a mismatch, resetHard will directly checkout the expected branch
   * without performing the additional safety checks used by other operations.
   */
  expectedBranch?: string;
}

/**
 * Options for stash operations with branch verification.
 */
export interface StashOptions {
  /** Expected branch to verify before stashing. If set and mismatch, will auto-checkout. */
  expectedBranch?: string;
}

/**
 * Result of a merge attempt with conflict detection.
 */
export interface MergeAttemptResult {
  /** Whether the merge was successful (no conflicts) */
  success: boolean;
  /** Whether the branches were already up to date (no merge needed) */
  alreadyUpToDate: boolean;
  /** Whether there were merge conflicts */
  hasConflicts: boolean;
  /** The merge commit SHA (if successful) */
  mergeCommitSha?: string;
  /** List of files with conflicts (if any) */
  conflictedFiles?: string[];
  /** Raw stderr output from the merge command */
  stderr?: string;
}

/**
 * File diff information.
 */
export interface FileDiff {
  path: string;
  status: "added" | "modified" | "deleted" | "renamed";
  additions: number;
  deletions: number;
  oldPath?: string;
}

/**
 * Extended file diff with actual diff content.
 */
export interface FileDiffWithContent extends FileDiff {
  /** The actual diff patch content */
  patch?: string;
}

/**
 * Git commit information.
 */
export interface CommitInfo {
  sha: string;
  message: string;
  filesChanged: number;
}

/**
 * GitService provides git operations for Ralph Loops.
 * Uses a CommandExecutor for running git commands, allowing for both
 * local execution (spawn mode) and remote execution (connect mode).
 */
export class GitService {
  private executor: CommandExecutor;

  /**
   * Create a new GitService.
   * @param executor - The command executor to use (required)
   */
  constructor(executor: CommandExecutor) {
    this.executor = executor;
  }

  /**
   * Create a new GitService with the specified executor.
   */
  static withExecutor(executor: CommandExecutor): GitService {
    return new GitService(executor);
  }

  /**
   * Clean up stale git lock files that may have been left behind by crashed processes.
   * This is especially important when a loop is forcefully stopped while git operations
   * are in progress.
   * 
   * Handles both regular repos (lock at `.git/index.lock`) and worktrees
   * (lock at the gitdir path referenced by the `.git` file).
   * 
   * @param directory - The git repository or worktree directory
   * @param retries - Number of times to retry cleanup (default: 3)
   * @param delayMs - Delay between retries in milliseconds (default: 100)
   * @returns true if any lock files were cleaned up, false otherwise
   */
  static async cleanupStaleLockFiles(directory: string, retries = 3, delayMs = 100): Promise<boolean> {
    const path = await import("path");
    const { rm, stat, readFile } = await import("fs/promises");
    
    // Determine the correct lock file path.
    // In a worktree, .git is a file containing "gitdir: <path>".
    // In a regular repo, .git is a directory.
    let lockFile: string;
    const dotGitPath = path.join(directory, ".git");
    
    try {
      const dotGitStat = await stat(dotGitPath);
      if (dotGitStat.isFile()) {
        // Worktree: read the gitdir reference
        const content = await readFile(dotGitPath, "utf-8");
        const match = content.match(/^gitdir:\s*(.+)$/m);
        if (match?.[1]) {
          const gitDir = match[1].trim();
          // Resolve relative paths against the worktree directory
          const resolvedGitDir = path.isAbsolute(gitDir) ? gitDir : path.resolve(directory, gitDir);
          lockFile = path.join(resolvedGitDir, "index.lock");
        } else {
          lockFile = path.join(directory, ".git", "index.lock");
        }
      } else {
        lockFile = path.join(directory, ".git", "index.lock");
      }
    } catch {
      // .git doesn't exist at all, nothing to clean
      return false;
    }
    
    let cleaned = false;
    
    for (let attempt = 0; attempt < retries; attempt++) {
      try {
        // Check if lock file exists
        await stat(lockFile);
        
        // Lock file exists - try to remove it
        // We assume it's stale since we're only calling this before starting new operations
        // when the loop engine is not running
        log.info(`[GitService] Removing stale lock file: ${lockFile} (attempt ${attempt + 1}/${retries})`);
        await rm(lockFile, { force: true });
        cleaned = true;
        
        // Wait a bit to let any in-flight operations complete
        if (attempt < retries - 1) {
          await new Promise(resolve => setTimeout(resolve, delayMs));
        }
      } catch {
        // Lock file doesn't exist - we're done
        break;
      }
    }
    
    return cleaned;
  }

  /**
   * Check if a directory is a git repository.
   */
  async isGitRepo(directory: string): Promise<boolean> {
    const result = await this.runGitCommand(directory, ["rev-parse", "--is-inside-work-tree"]);
    return result.success && result.stdout.trim() === "true";
  }

  /**
   * Get the current branch name.
   */
  async getCurrentBranch(directory: string): Promise<string> {
    const args = ["rev-parse", "--abbrev-ref", "HEAD"];
    const result = await this.runGitCommand(directory, args);
    if (!result.success) {
      throw this.gitError("Failed to get current branch", result, args);
    }
    return result.stdout.trim();
  }

  /**
   * Get all local branch names.
   * Returns branches sorted by name, with the current branch marked.
   * 
   * Handles the edge case of a newly initialized repo with no commits,
   * where `git branch` returns nothing but the repo still has a current branch.
   */
  async getLocalBranches(directory: string): Promise<{ name: string; current: boolean }[]> {
    const args = ["branch", "--format=%(refname:short)|%(HEAD)"];
    const result = await this.runGitCommand(directory, args);
    if (!result.success) {
      throw this.gitError("Failed to get local branches", result, args);
    }

    const lines = result.stdout.replace(/\r\n?/g, "\n").trim().split("\n").filter(Boolean);
    const branches = lines.map((line) => {
      const [name, head] = line.split("|");
      return {
        name: name?.trim() ?? "",
        current: head?.trim() === "*",
      };
    }).filter((b) => b.name.length > 0);

    // Handle newly initialized repos with no commits.
    // In this case, `git branch` returns nothing, but the repo still has
    // a current branch (e.g., "main" or "master") that we can get via symbolic-ref.
    if (branches.length === 0) {
      const symbolicResult = await this.runGitCommand(directory, ["symbolic-ref", "--short", "HEAD"]);
      if (symbolicResult.success && symbolicResult.stdout.trim()) {
        const currentBranchName = symbolicResult.stdout.trim();
        branches.push({
          name: currentBranchName,
          current: true,
        });
      }
    }

    // Sort by name
    branches.sort((a, b) => a.name.localeCompare(b.name));

    return branches;
  }

  /**
   * Get the repository's default branch.
   * 
   * Detection strategy:
   * 1. Try to get origin/HEAD reference (set by git clone or manually)
   * 2. Check if 'main' branch exists locally
   * 3. Check if 'master' branch exists locally
   * 4. Fall back to the current branch
   * 
   * @param directory - The git repository directory
   * @returns The name of the default branch
   */
  async getDefaultBranch(directory: string): Promise<string> {
    // Strategy 1: Try to get origin/HEAD reference
    // This is typically set by 'git clone' or can be set manually with:
    // git remote set-head origin <branch>
    // Use allowFailure since missing origin/HEAD is expected in repos without remotes
    const originHeadResult = await this.runGitCommand(directory, [
      "symbolic-ref",
      "refs/remotes/origin/HEAD",
    ], { allowFailure: true });
    if (originHeadResult.success) {
      // Output is like "refs/remotes/origin/main"
      const ref = originHeadResult.stdout.trim();
      const match = ref.match(/^refs\/remotes\/origin\/(.+)$/);
      if (match?.[1]) {
        log.trace(`[GitService] Default branch from origin/HEAD: ${match[1]}`);
        return match[1];
      }
    }

    // Strategy 2: Check if 'main' branch exists locally
    const mainExists = await this.branchExists(directory, "main");
    if (mainExists) {
      log.trace(`[GitService] Default branch: main (exists locally)`);
      return "main";
    }

    // Strategy 3: Check if 'master' branch exists locally
    const masterExists = await this.branchExists(directory, "master");
    if (masterExists) {
      log.trace(`[GitService] Default branch: master (exists locally)`);
      return "master";
    }

    // Strategy 4: Fall back to current branch
    const currentBranch = await this.getCurrentBranch(directory);
    log.trace(`[GitService] Default branch fallback to current: ${currentBranch}`);
    return currentBranch;
  }

  /**
   * Verify that the current branch matches the expected branch.
   * This is a read-only check that doesn't modify the repository.
   * 
   * @param directory - The git repository directory
   * @param expectedBranch - The expected branch name
   * @returns BranchVerificationResult with match status and branch names
   */
  async verifyBranch(directory: string, expectedBranch: string): Promise<BranchVerificationResult> {
    const currentBranch = await this.getCurrentBranch(directory);
    const matches = currentBranch === expectedBranch;
    
    if (!matches) {
      log.trace(`[GitService] Branch verification failed: expected '${expectedBranch}' but on '${currentBranch}'`);
    } else {
      log.trace(`[GitService] Branch verification passed: on '${currentBranch}'`);
    }
    
    return {
      matches,
      currentBranch,
      expectedBranch,
    };
  }

  /**
   * Ensure the repository is on the expected branch.
   * If not on the expected branch:
   * - With autoCheckout: true, will checkout the expected branch
   * - With autoCheckout: false (default), will throw BranchMismatchError
   * 
   * This method checks for uncommitted changes before attempting checkout
   * to avoid leaving the repository in a bad state.
   * 
   * @param directory - The git repository directory
   * @param expectedBranch - The expected branch name
   * @param options - Options for auto-checkout behavior
   * @returns EnsureBranchResult with verification and checkout status
   * @throws BranchMismatchError if not on expected branch and autoCheckout is false
   * @throws Error if checkout fails (e.g., uncommitted changes)
   */
  async ensureBranch(
    directory: string,
    expectedBranch: string,
    options: EnsureBranchOptions = {}
  ): Promise<EnsureBranchResult> {
    const { autoCheckout = false } = options;
    
    const verification = await this.verifyBranch(directory, expectedBranch);
    
    if (verification.matches) {
      return {
        wasOnExpectedBranch: true,
        currentBranch: verification.currentBranch,
        expectedBranch: verification.expectedBranch,
        checkedOut: false,
      };
    }
    
    // Branch mismatch - handle based on autoCheckout option
    if (!autoCheckout) {
      throw new BranchMismatchError(verification.currentBranch, expectedBranch);
    }
    
    // Auto-checkout requested - check for uncommitted changes first
    const hasChanges = await this.hasUncommittedChanges(directory);
    if (hasChanges) {
      throw new Error(
        `Cannot auto-checkout to '${expectedBranch}': uncommitted changes exist. ` +
        `Currently on '${verification.currentBranch}'.`
      );
    }
    
    // Perform checkout
    log.info(`[GitService] Auto-checkout: switching from '${verification.currentBranch}' to '${expectedBranch}'`);
    await this.checkoutBranch(directory, expectedBranch);
    
    return {
      wasOnExpectedBranch: false,
      currentBranch: verification.currentBranch,
      expectedBranch,
      checkedOut: true,
    };
  }

  /**
   * Check if there are uncommitted changes (staged or unstaged).
   */
  async hasUncommittedChanges(directory: string): Promise<boolean> {
    const result = await this.runGitCommand(directory, ["status", "--porcelain"]);
    if (!result.success) {
      throw this.gitError("Failed to check git status", result, ["status", "--porcelain"]);
    }
    const hasChanges = result.stdout.trim().length > 0;
    // Debug logging for troubleshooting command output parsing
    log.trace(`[GitService] hasUncommittedChanges: ${hasChanges}`);
    log.trace(`[GitService]   stdout length: ${result.stdout.length}`);
    log.trace(`[GitService]   stdout trimmed length: ${result.stdout.trim().length}`);
    if (hasChanges) {
      log.trace(`[GitService]   stdout (raw): ${JSON.stringify(result.stdout)}`);
      log.trace(`[GitService]   stdout (visible): "${result.stdout.trim()}"`);
    }
    return hasChanges;
  }

  /**
   * Get list of changed files (staged and unstaged).
   */
  async getChangedFiles(directory: string): Promise<string[]> {
    const args = ["status", "--porcelain"];
    const result = await this.runGitCommand(directory, args);
    if (!result.success) {
      throw this.gitError("Failed to get changed files", result, args);
    }

    // Use trimEnd() instead of trim() to preserve leading spaces (important for git status format)
    // Git status format is "XY filename" where X and Y are status chars - X can be a space
    const lines = result.stdout.replace(/\r\n/g, "\n").trimEnd().split("\n").filter(Boolean);
    return lines.map((line) => {
      // Format: "XY filename" or "XY original -> renamed"
      const match = line.match(/^..\s+(.+?)(?:\s+->\s+(.+))?$/);
      if (match) {
        return match[2] ?? match[1] ?? line.slice(3).trim();
      }
      return line.slice(3).trim();
    });
  }

  /**
   * Create a new branch from the current HEAD.
   */
  async createBranch(directory: string, branchName: string): Promise<void> {
    const args = ["checkout", "-b", branchName];
    const result = await this.runGitCommand(directory, args);
    if (!result.success) {
      throw this.gitError(`Failed to create branch ${branchName}`, result, args);
    }
  }

  /**
   * Checkout an existing branch.
   */
  async checkoutBranch(directory: string, branchName: string): Promise<void> {
    const args = ["checkout", branchName];
    const result = await this.runGitCommand(directory, args);
    if (!result.success) {
      throw this.gitError(`Failed to checkout branch ${branchName}`, result, args);
    }
  }

  /**
   * Delete a branch.
   */
  async deleteBranch(directory: string, branchName: string): Promise<void> {
    const args = ["branch", "-D", branchName];
    const result = await this.runGitCommand(directory, args);
    if (!result.success) {
      throw this.gitError(`Failed to delete branch ${branchName}`, result, args);
    }
  }

  /**
   * Check if a branch exists.
   * @param directory - The git repository directory
   * @param branchName - The branch name to check
   * @param options - Optional configuration (allowFailure defaults to true since branch absence is expected)
   */
  async branchExists(
    directory: string,
    branchName: string,
    options: { allowFailure?: boolean } = { allowFailure: true }
  ): Promise<boolean> {
    const result = await this.runGitCommand(directory, [
      "rev-parse",
      "--verify",
      branchName,
    ], { allowFailure: options.allowFailure ?? true });
    return result.success;
  }

  /**
   * Stage all changes (new, modified, deleted files).
   */
  async stageAll(directory: string): Promise<void> {
    const args = ["add", "-A"];
    const result = await this.runGitCommand(directory, args);
    if (!result.success) {
      throw this.gitError("Failed to stage changes", result, args);
    }
  }

  /**
   * Commit staged changes.
   * Returns the commit SHA.
   * 
   * @param directory - The git repository directory
   * @param message - The commit message
   * @param options - Optional commit options including branch verification
   */
  async commit(directory: string, message: string, options: CommitOptions = {}): Promise<CommitInfo> {
    // Verify branch if expectedBranch is provided (with auto-checkout)
    if (options.expectedBranch) {
      const result = await this.ensureBranch(directory, options.expectedBranch, { autoCheckout: true });
      if (result.checkedOut) {
        log.info(`[GitService] commit: Auto-recovered to branch '${options.expectedBranch}' before commit`);
      }
    }

    // First, stage all changes
    await this.stageAll(directory);

    // Check if there are changes to commit
    const hasChanges = await this.hasStagedChanges(directory);
    if (!hasChanges) {
      throw new Error("No changes to commit");
    }

    // Commit
    const commitArgs = ["commit", "-m", message];
    const result = await this.runGitCommand(directory, commitArgs);
    if (!result.success) {
      throw this.gitError("Failed to commit", result, commitArgs);
    }

    // Get the commit SHA
    const shaArgs = ["rev-parse", "HEAD"];
    const shaResult = await this.runGitCommand(directory, shaArgs);
    if (!shaResult.success) {
      throw this.gitError("Failed to get commit SHA", shaResult, shaArgs);
    }
    const sha = shaResult.stdout.trim();

    // Get files changed count
    const filesResult = await this.runGitCommand(directory, [
      "diff-tree",
      "--no-commit-id",
      "--name-only",
      "-r",
      sha,
    ]);
    const filesChanged = filesResult.stdout.replace(/\r\n/g, "\n").trim().split("\n").filter(Boolean).length;

    return {
      sha,
      message,
      filesChanged,
    };
  }

  /**
   * Check if there are staged changes ready to commit.
   */
  async hasStagedChanges(directory: string): Promise<boolean> {
    const result = await this.runGitCommand(directory, ["diff", "--cached", "--quiet"]);
    // Exit code 0 = no changes, 1 = changes exist
    return result.exitCode === 1;
  }

  /**
   * Stash current changes.
   * 
   * @param directory - The git repository directory
   * @param options - Optional stash options including branch verification
   */
  async stash(directory: string, options: StashOptions = {}): Promise<void> {
    // Verify branch if expectedBranch is provided (with auto-checkout)
    if (options.expectedBranch) {
      const result = await this.ensureBranch(directory, options.expectedBranch, { autoCheckout: true });
      if (result.checkedOut) {
        log.info(`[GitService] stash: Auto-recovered to branch '${options.expectedBranch}' before stash`);
      }
    }

    const args = ["stash", "push", "-u"];
    const result = await this.runGitCommand(directory, args);
    if (!result.success) {
      throw this.gitError("Failed to stash changes", result, args);
    }
  }

  /**
   * Pop the most recent stash.
   * 
   * @param directory - The git repository directory
   * @param options - Optional stash options including branch verification
   */
  async stashPop(directory: string, options: StashOptions = {}): Promise<void> {
    // Verify branch if expectedBranch is provided (with auto-checkout)
    if (options.expectedBranch) {
      const result = await this.ensureBranch(directory, options.expectedBranch, { autoCheckout: true });
      if (result.checkedOut) {
        log.info(`[GitService] stashPop: Auto-recovered to branch '${options.expectedBranch}' before stash pop`);
      }
    }

    const args = ["stash", "pop"];
    const result = await this.runGitCommand(directory, args);
    if (!result.success) {
      throw this.gitError("Failed to pop stash", result, args);
    }
  }

  /**
   * Hard reset to discard all uncommitted changes and untracked files.
   * This is a destructive operation!
   * 
   * @param directory - The git repository directory
   * @param options - Optional reset options including branch verification
   */
  async resetHard(directory: string, options: ResetHardOptions = {}): Promise<void> {
    // Verify branch if expectedBranch is provided
    // Note: For resetHard, we use force checkout (-f) to switch branches even with uncommitted changes.
    // Since resetHard is meant to discard all changes anyway, force checkout is appropriate.
    // Regular checkout would fail if tracked files have conflicting uncommitted changes.
    if (options.expectedBranch) {
      const verification = await this.verifyBranch(directory, options.expectedBranch);
      if (!verification.matches) {
        log.info(`[GitService] resetHard: Force switching from '${verification.currentBranch}' to '${options.expectedBranch}' before reset`);
        const checkoutArgs = ["checkout", "-f", options.expectedBranch];
        const checkoutResult = await this.runGitCommand(directory, checkoutArgs);
        if (!checkoutResult.success) {
          throw this.gitError(`Failed to force checkout branch ${options.expectedBranch}`, checkoutResult, checkoutArgs);
        }
      }
    }

    // Reset tracked files
    const resetArgs = ["reset", "--hard"];
    const resetResult = await this.runGitCommand(directory, resetArgs);
    if (!resetResult.success) {
      throw this.gitError("Failed to reset", resetResult, resetArgs);
    }

    // Clean untracked files and directories
    const cleanArgs = ["clean", "-fd"];
    const cleanResult = await this.runGitCommand(directory, cleanArgs);
    if (!cleanResult.success) {
      throw this.gitError("Failed to clean untracked files", cleanResult, cleanArgs);
    }
  }

  /**
   * Merge a source branch into a target branch.
   * Returns the merge commit SHA.
   */
  async mergeBranch(
    directory: string,
    sourceBranch: string,
    targetBranch: string
  ): Promise<string> {
    // Checkout target branch
    await this.checkoutBranch(directory, targetBranch);

    // Merge source branch
    const mergeArgs = [
      "merge",
      sourceBranch,
      "--no-ff",
      "-m",
      `Merge branch '${sourceBranch}' into ${targetBranch}`,
    ];
    const result = await this.runGitCommand(directory, mergeArgs);
    if (!result.success) {
      throw this.gitError(`Failed to merge ${sourceBranch} into ${targetBranch}`, result, mergeArgs);
    }

    // Get the merge commit SHA
    const shaArgs = ["rev-parse", "HEAD"];
    const shaResult = await this.runGitCommand(directory, shaArgs);
    if (!shaResult.success) {
      throw this.gitError("Failed to get merge commit SHA", shaResult, shaArgs);
    }

    return shaResult.stdout.trim();
  }

  /**
   * Push a branch to the remote.
   * Creates the remote branch if it doesn't exist.
   * @param directory - The git repository directory
   * @param branchName - The branch to push
   * @param remote - The remote name (default: "origin")
   * @returns The remote branch name (e.g., "origin/branch-name")
   */
  async pushBranch(
    directory: string,
    branchName: string,
    remote = "origin"
  ): Promise<string> {
    // Push to remote with -u flag to set upstream
    // No checkout needed - git push works on branch refs directly
    const pushArgs = [
      "push",
      "-u",
      remote,
      branchName,
    ];
    const result = await this.runGitCommand(directory, pushArgs);
    if (!result.success) {
      throw this.gitError(`Failed to push branch ${branchName} to ${remote}`, result, pushArgs);
    }

    return `${remote}/${branchName}`;
  }

  /**
   * Fetch a specific branch from the remote without merging.
   * Unlike `pull()` which also merges, this only updates the remote tracking ref.
   * Useful when you need to merge manually (e.g., in a worktree).
   * 
   * @param directory - The git repository directory (fetch from main repo, shared object store)
   * @param branchName - The branch to fetch
   * @param remote - The remote name (default: "origin")
   * @returns true if fetch succeeded, false if skipped (no remote, branch doesn't exist)
   */
  async fetchBranch(
    directory: string,
    branchName: string,
    remote = "origin"
  ): Promise<boolean> {
    // Check if the remote exists
    const remoteResult = await this.runGitCommand(directory, ["remote", "get-url", remote]);
    if (!remoteResult.success) {
      log.trace(`[GitService] No remote '${remote}' configured, skipping fetch`);
      return false;
    }

    // Fetch the specific branch
    const fetchResult = await this.runGitCommand(directory, ["fetch", remote, branchName]);
    if (!fetchResult.success) {
      if (fetchResult.stderr.includes("couldn't find remote ref") ||
          fetchResult.stderr.includes("fatal: couldn't find remote ref")) {
        log.trace(`[GitService] Remote branch '${branchName}' does not exist, skipping fetch`);
        return false;
      }
      log.trace(`[GitService] Fetch failed: ${fetchResult.stderr}`);
      return false;
    }

    return true;
  }

  /**
   * Check if a branch's commits are already an ancestor of another branch.
   * Used to determine if a merge is needed (i.e., the base branch has new commits).
   * 
   * @param directory - The git repository directory
   * @param ancestorRef - The ref to check as potential ancestor (e.g., "origin/main")
   * @param descendantRef - The ref to check as potential descendant (e.g., "working-branch")
   * @returns true if ancestorRef is already an ancestor of descendantRef (no merge needed)
   */
  async isAncestor(
    directory: string,
    ancestorRef: string,
    descendantRef: string
  ): Promise<boolean> {
    const result = await this.runGitCommand(directory, [
      "merge-base",
      "--is-ancestor",
      ancestorRef,
      descendantRef,
    ], { allowFailure: true });
    return result.success;
  }

  /**
   * Attempt to merge a branch into the current HEAD with conflict detection.
   * Unlike `mergeBranch()`, this method does NOT throw on conflicts — it returns
   * a result object indicating success or failure. On conflict, the merge is left
   * in a conflicted state (caller must abort or resolve).
   * 
   * @param directory - The git repository/worktree directory
   * @param sourceBranch - The branch or ref to merge (e.g., "origin/main")
   * @param message - Optional merge commit message
   * @returns MergeAttemptResult with conflict info
   */
  async mergeWithConflictDetection(
    directory: string,
    sourceBranch: string,
    message?: string
  ): Promise<MergeAttemptResult> {
    const args = ["merge", "--no-ff", sourceBranch];
    if (message) {
      args.push("-m", message);
    }

    const result = await this.runGitCommand(directory, args, { allowFailure: true });

    // Check for "already up to date"
    if (result.success && (
      result.stdout.toLowerCase().includes("already up to date") ||
      result.stdout.toLowerCase().includes("already up-to-date")
    )) {
      return {
        success: true,
        alreadyUpToDate: true,
        hasConflicts: false,
      };
    }

    // Clean merge succeeded
    if (result.success) {
      // Get the merge commit SHA
      const shaResult = await this.runGitCommand(directory, ["rev-parse", "HEAD"]);
      return {
        success: true,
        alreadyUpToDate: false,
        hasConflicts: false,
        mergeCommitSha: shaResult.success ? shaResult.stdout.trim() : undefined,
      };
    }

    // Merge failed — check if it's due to conflicts
    const hasConflicts = result.stderr.includes("CONFLICT") ||
      result.stderr.includes("Automatic merge failed") ||
      result.stdout.includes("CONFLICT") ||
      result.stdout.includes("Automatic merge failed");

    if (hasConflicts) {
      // Get list of conflicted files
      const conflictedFiles = await this.getConflictedFiles(directory);
      return {
        success: false,
        alreadyUpToDate: false,
        hasConflicts: true,
        conflictedFiles,
        stderr: result.stderr,
      };
    }

    // Some other merge failure (not conflicts)
    return {
      success: false,
      alreadyUpToDate: false,
      hasConflicts: false,
      stderr: result.stderr,
    };
  }

  /**
   * Abort a merge in progress.
   * Restores the working tree to the state before the merge attempt.
   * 
   * @param directory - The git repository/worktree directory
   */
  async abortMerge(directory: string): Promise<void> {
    const args = ["merge", "--abort"];
    const result = await this.runGitCommand(directory, args);
    if (!result.success) {
      throw this.gitError("Failed to abort merge", result, args);
    }
  }

  /**
   * Get the list of files with unresolved merge conflicts.
   * 
   * @param directory - The git repository/worktree directory
   * @returns Array of file paths with conflicts, empty if none
   */
  async getConflictedFiles(directory: string): Promise<string[]> {
    // Use git diff --name-only --diff-filter=U to get unmerged files
    const result = await this.runGitCommand(directory, [
      "diff",
      "--name-only",
      "--diff-filter=U",
    ], { allowFailure: true });

    if (!result.success || !result.stdout.trim()) {
      return [];
    }

    return result.stdout.replace(/\r\n/g, "\n").trim().split("\n").filter(Boolean);
  }

  /**
   * Pull latest changes from a remote branch using fetch + fast-forward merge.
   * 
   * Uses `git fetch` + `git merge --ff-only` instead of `git pull` to ensure
   * the operation is truly a no-op when it fails. Regular `git pull` can leave
   * the repository in a conflicted/partial-merge state on failure.
   * 
   * With --ff-only:
   * - If the merge is a fast-forward, it succeeds and returns true
   * - If fast-forward isn't possible (diverged branches), it fails cleanly
   *   without modifying the working tree, and returns false
   * 
   * @param directory - The git repository directory
   * @param branchName - The branch to pull (optional, uses current branch if not specified)
   * @param remote - The remote name (default: "origin")
   * @returns true if pull succeeded, false if skipped (no remote, no upstream, or not fast-forwardable)
   */
  async pull(
    directory: string,
    branchName?: string,
    remote = "origin"
  ): Promise<boolean> {
    // First check if the remote exists
    const remoteResult = await this.runGitCommand(directory, ["remote", "get-url", remote]);
    if (!remoteResult.success) {
      log.trace(`[GitService] No remote '${remote}' configured, skipping pull`);
      return false;
    }

    // Determine the branch to pull
    const branch = branchName ?? await this.getCurrentBranch(directory);

    // Fetch the remote branch
    const fetchResult = await this.runGitCommand(directory, ["fetch", remote, branch]);
    if (!fetchResult.success) {
      // Check if the failure is because the remote branch doesn't exist
      if (fetchResult.stderr.includes("couldn't find remote ref") || 
          fetchResult.stderr.includes("fatal: couldn't find remote ref")) {
        log.trace(`[GitService] Remote branch '${branch}' does not exist, skipping pull`);
        return false;
      }
      // For other fetch errors (network issues, etc.), log and return false
      log.trace(`[GitService] Fetch failed: ${fetchResult.stderr}`);
      return false;
    }

    // Try to fast-forward merge
    // --ff-only ensures we only merge if it's a fast-forward (no conflicts possible)
    const mergeResult = await this.runGitCommand(directory, [
      "merge",
      "--ff-only",
      `${remote}/${branch}`,
    ]);

    if (!mergeResult.success) {
      // --ff-only failed means branches have diverged, not a fast-forward
      // This is safe - working tree is unchanged
      log.trace(`[GitService] Fast-forward merge not possible for '${branch}': ${mergeResult.stderr}`);
      return false;
    }

    return true;
  }

  /**
   * Ensure a merge strategy is configured for the repository.
   * 
   * Some environments don't have `pull.rebase` configured, which can cause
   * git merge/pull operations to fail or warn. This method sets `pull.rebase false`
   * (standard merge behavior) if no merge strategy is currently configured.
   * 
   * @param directory - The git repository directory
   * @returns true if the strategy was already set or was successfully configured
   */
  async ensureMergeStrategy(directory: string): Promise<boolean> {
    // Check if pull.rebase is already configured
    const checkResult = await this.runGitCommand(
      directory,
      ["config", "pull.rebase"],
      { allowFailure: true }
    );

    if (checkResult.success) {
      // Already configured — no-op
      log.trace(`[GitService] pull.rebase already configured: ${checkResult.stdout.trim()}`);
      return true;
    }

    // Not configured — set to false (standard merge behavior)
    const setResult = await this.runGitCommand(directory, [
      "config",
      "pull.rebase",
      "false",
    ]);

    if (!setResult.success) {
      log.warn(`[GitService] Failed to set pull.rebase: ${setResult.stderr}`);
      return false;
    }

    log.trace(`[GitService] Set pull.rebase to false`);
    return true;
  }

  /**
   * Get the diff between the current branch and a base branch.
   */
  async getDiff(directory: string, baseBranch: string): Promise<FileDiff[]> {
    // Get numstat for additions/deletions counts
    const numstatArgs = [
      "diff",
      "--numstat",
      baseBranch,
    ];
    const result = await this.runGitCommand(directory, numstatArgs);
    if (!result.success) {
      throw this.gitError("Failed to get diff", result, numstatArgs);
    }

    // Get name-status for all files at once (more efficient than per-file calls)
    const statusResult = await this.runGitCommand(directory, [
      "diff",
      "--name-status",
      baseBranch,
    ]);
    
    // Build a map of file path -> status
    // Normalize command output line endings (may have \r\n)
    const statusMap = new Map<string, string>();
    if (statusResult.success) {
      const statusLines = statusResult.stdout.replace(/\r\n/g, "\n").trim().split("\n").filter(Boolean);
      for (const line of statusLines) {
        // Format: "A\tfilename" or "R100\told\tnew" for renames
        const parts = line.split("\t");
        const statusChar = parts[0]?.charAt(0) ?? "M";
        const filePath = parts[parts.length - 1] ?? ""; // Last part is the current filename
        if (filePath) {
          statusMap.set(filePath, statusChar);
        }
      }
    }

    // Normalize command output line endings (may have \r\n)
    const lines = result.stdout.replace(/\r\n/g, "\n").trim().split("\n").filter(Boolean);
    const diffs: FileDiff[] = [];

    for (const line of lines) {
      const [additions, deletions, path] = line.split("\t");
      if (!path) continue;

      // Get status from the pre-fetched map
      const statusChar = statusMap.get(path) ?? "M";
      let status: FileDiff["status"] = "modified";
      if (statusChar === "A") status = "added";
      else if (statusChar === "D") status = "deleted";
      else if (statusChar === "R") status = "renamed";

      diffs.push({
        path,
        status,
        additions: additions === "-" ? 0 : parseInt(additions ?? "0", 10),
        deletions: deletions === "-" ? 0 : parseInt(deletions ?? "0", 10),
      });
    }

    return diffs;
  }

  /**
   * Get the summary of changes between current HEAD and a base branch.
   */
  async getDiffSummary(
    directory: string,
    baseBranch: string
  ): Promise<{ files: number; insertions: number; deletions: number }> {
    const shortstatArgs = [
      "diff",
      "--shortstat",
      baseBranch,
    ];
    const result = await this.runGitCommand(directory, shortstatArgs);
    if (!result.success) {
      throw this.gitError("Failed to get diff summary", result, shortstatArgs);
    }

    const output = result.stdout.trim();
    if (!output) {
      return { files: 0, insertions: 0, deletions: 0 };
    }

    // Parse "X files changed, Y insertions(+), Z deletions(-)"
    const filesMatch = output.match(/(\d+) files? changed/);
    const insertionsMatch = output.match(/(\d+) insertions?\(\+\)/);
    const deletionsMatch = output.match(/(\d+) deletions?\(-\)/);

    return {
      files: filesMatch?.[1] ? parseInt(filesMatch[1], 10) : 0,
      insertions: insertionsMatch?.[1] ? parseInt(insertionsMatch[1], 10) : 0,
      deletions: deletionsMatch?.[1] ? parseInt(deletionsMatch[1], 10) : 0,
    };
  }

  /**
   * Get the actual diff patch content for a specific file.
   */
  async getFileDiffContent(
    directory: string,
    baseBranch: string,
    filePath: string
  ): Promise<string> {
    const diffArgs = [
      "diff",
      baseBranch,
      "--",
      filePath,
    ];
    const result = await this.runGitCommand(directory, diffArgs);
    if (!result.success) {
      throw this.gitError("Failed to get file diff", result, diffArgs);
    }
    return result.stdout;
  }

  /**
   * Get diffs with actual patch content for all files.
   */
  async getDiffWithContent(
    directory: string,
    baseBranch: string
  ): Promise<FileDiffWithContent[]> {
    // First get the basic diff info
    const diffs = await this.getDiff(directory, baseBranch);
    
    // Then get the full diff with patches
    const result = await this.runGitCommand(directory, [
      "diff",
      baseBranch,
    ]);
    
    if (!result.success) {
      // Return diffs without patches if we can't get the full diff
      return diffs;
    }

    // Normalize command output line endings (may have \r\n) to \n
    const fullDiff = result.stdout.replace(/\r\n/g, "\n");
    const diffsWithContent: FileDiffWithContent[] = [];

    // Parse the full diff to extract per-file patches
    // Git diff format: "diff --git a/path b/path" separates files
    const fileSections = fullDiff.split(/^diff --git /m).filter(Boolean);

    for (const diff of diffs) {
      // Find the section for this file
      const section = fileSections.find(s => {
        // Match "a/path b/path" at the start (handle both \n and \r\n)
        const headerMatch = s.match(/^a\/(.+?) b\/(.+?)[\r\n]/);
        if (headerMatch) {
          return headerMatch[1] === diff.path || headerMatch[2] === diff.path;
        }
        return false;
      });

      diffsWithContent.push({
        ...diff,
        patch: section ? `diff --git ${section}` : undefined,
      });
    }

    return diffsWithContent;
  }

  // ─────────────────────────────────────────────────────────────
  // Git Worktree Operations
  // ─────────────────────────────────────────────────────────────

  /**
   * Create a new git worktree with a new branch.
   * 
   * This creates a worktree at `worktreePath` and checks out a new branch
   * `branchName` based on `baseBranch`. Also ensures the worktree directory
   * is excluded from git tracking via `.git/info/exclude`.
   * 
   * @param repoDirectory - The main git repository directory
   * @param worktreePath - Absolute path for the new worktree
   * @param branchName - The new branch name to create
   * @param baseBranch - The base branch to create the worktree from (optional, defaults to HEAD)
   */
  async createWorktree(
    repoDirectory: string,
    worktreePath: string,
    branchName: string,
    baseBranch?: string
  ): Promise<void> {
    // Ensure .ralph-worktrees is excluded from git tracking
    await this.ensureWorktreeExcluded(repoDirectory);

    // Ensure the parent directory exists
    await this.executor.exec("mkdir", ["-p", worktreePath]);

    // Remove the directory we just created — git worktree add requires the target not to exist
    await this.executor.exec("rmdir", [worktreePath]);

    // Build the git worktree add command
    const args = ["worktree", "add", worktreePath, "-b", branchName];
    if (baseBranch) {
      args.push(baseBranch);
    }

    const result = await this.runGitCommand(repoDirectory, args);
    if (!result.success) {
      throw this.gitError(`Failed to create worktree at ${worktreePath}`, result, args);
    }

    log.info(`[GitService] Created worktree at ${worktreePath} with branch ${branchName}`);
  }

  /**
   * Add an existing branch to a new worktree (without creating a new branch).
   * 
   * Used when a worktree needs to be recreated for an existing branch
   * (e.g., after manual deletion, or for jumpstart/review reuse).
   * 
   * @param repoDirectory - The main git repository directory
   * @param worktreePath - Absolute path for the new worktree
   * @param branchName - The existing branch name to checkout in the worktree
   */
  async addWorktreeForExistingBranch(
    repoDirectory: string,
    worktreePath: string,
    branchName: string
  ): Promise<void> {
    // Ensure .ralph-worktrees is excluded from git tracking
    await this.ensureWorktreeExcluded(repoDirectory);

    // Ensure the parent directory exists
    await this.executor.exec("mkdir", ["-p", worktreePath]);

    // Remove the directory we just created — git worktree add requires the target not to exist
    await this.executor.exec("rmdir", [worktreePath]);

    const args = ["worktree", "add", worktreePath, branchName];
    const result = await this.runGitCommand(repoDirectory, args);
    if (!result.success) {
      throw this.gitError(`Failed to add worktree for branch ${branchName} at ${worktreePath}`, result, args);
    }

    log.info(`[GitService] Added worktree at ${worktreePath} for existing branch ${branchName}`);
  }

  /**
   * Remove a git worktree.
   * 
   * @param repoDirectory - The main git repository directory
   * @param worktreePath - Absolute path of the worktree to remove
   * @param options - Options for removal (force: true to remove even with uncommitted changes)
   */
  async removeWorktree(
    repoDirectory: string,
    worktreePath: string,
    options?: { force?: boolean }
  ): Promise<void> {
    const args = ["worktree", "remove", worktreePath];
    if (options?.force) {
      args.push("--force");
    }

    const result = await this.runGitCommand(repoDirectory, args);
    if (!result.success) {
      throw this.gitError(`Failed to remove worktree at ${worktreePath}`, result, args);
    }

    log.info(`[GitService] Removed worktree at ${worktreePath}`);
  }

  /**
   * List all worktrees for a repository.
   * 
   * @param repoDirectory - The main git repository directory
   * @returns Array of worktree entries with path, HEAD SHA, and branch name
   */
  async listWorktrees(
    repoDirectory: string
  ): Promise<Array<{ path: string; head: string; branch: string }>> {
    const listArgs = ["worktree", "list", "--porcelain"];
    const result = await this.runGitCommand(repoDirectory, listArgs);
    if (!result.success) {
      throw this.gitError("Failed to list worktrees", result, listArgs);
    }

    const output = result.stdout.replace(/\r\n/g, "\n").trim();
    if (!output) return [];

    // Parse porcelain output: blocks separated by blank lines
    // Each block has: worktree <path>\nHEAD <sha>\nbranch <ref>\n
    const entries: Array<{ path: string; head: string; branch: string }> = [];
    const blocks = output.split("\n\n");

    for (const block of blocks) {
      const lines = block.trim().split("\n");
      let path = "";
      let head = "";
      let branch = "";

      for (const line of lines) {
        if (line.startsWith("worktree ")) {
          path = line.substring("worktree ".length);
        } else if (line.startsWith("HEAD ")) {
          head = line.substring("HEAD ".length);
        } else if (line.startsWith("branch ")) {
          // branch refs/heads/main -> main
          const ref = line.substring("branch ".length);
          branch = ref.replace(/^refs\/heads\//, "");
        }
      }

      if (path) {
        entries.push({ path, head, branch });
      }
    }

    return entries;
  }

  /**
   * Prune stale worktree entries (worktrees whose directory no longer exists).
   * 
   * @param repoDirectory - The main git repository directory
   */
  async pruneWorktrees(repoDirectory: string): Promise<void> {
    const pruneArgs = ["worktree", "prune"];
    const result = await this.runGitCommand(repoDirectory, pruneArgs);
    if (!result.success) {
      throw this.gitError("Failed to prune worktrees", result, pruneArgs);
    }

    log.info(`[GitService] Pruned stale worktree entries in ${repoDirectory}`);
  }

  /**
   * Check if a worktree exists at the given path.
   * 
   * @param repoDirectory - The main git repository directory
   * @param worktreePath - The worktree path to check
   * @returns true if the worktree exists in the git worktree list
   */
  async worktreeExists(
    repoDirectory: string,
    worktreePath: string
  ): Promise<boolean> {
    const worktrees = await this.listWorktrees(repoDirectory);
    // Resolve symlinks in the worktree path before comparing, because
    // git resolves symlinks in its output (e.g., macOS /var → /private/var).
    let resolvedPath: string;
    try {
      resolvedPath = await realpath(worktreePath);
    } catch {
      // If the path doesn't exist, it can't be a worktree
      return false;
    }
    return worktrees.some(wt => wt.path === resolvedPath);
  }

  /**
   * Ensure that `.ralph-worktrees` is listed in `.git/info/exclude` for the repo.
   * This prevents the worktree directory from being tracked by git.
   * 
   * Called on every worktree creation to guard against the exclude entry
   * being manually removed or `.git/info/exclude` being reset.
   * 
   * @param repoDirectory - The main git repository directory
   */
  async ensureWorktreeExcluded(repoDirectory: string): Promise<void> {
    const excludePattern = ".ralph-worktrees";

    // Resolve the correct exclude file path via git.
    // This handles both regular repos (where .git is a directory) and worktree
    // checkouts (where .git is a file containing a gitdir pointer).
    // `git rev-parse --git-path info/exclude` returns the correct path in both cases.
    let excludePath: string;
    try {
      const result = await this.runGitCommand(repoDirectory, ["rev-parse", "--git-path", "info/exclude"]);
      if (result.success && result.stdout.trim()) {
        const resolvedPath = result.stdout.trim();
        // git rev-parse --git-path may return a relative path; resolve against repoDirectory
        if (resolvedPath.startsWith("/")) {
          excludePath = resolvedPath;
        } else {
          excludePath = `${repoDirectory}/${resolvedPath}`;
        }
      } else {
        // Fallback if rev-parse fails (shouldn't happen in a valid git repo)
        excludePath = `${repoDirectory}/.git/info/exclude`;
      }
    } catch {
      excludePath = `${repoDirectory}/.git/info/exclude`;
    }

    // Derive the parent directory of the exclude file for mkdir -p
    const excludeDir = excludePath.substring(0, excludePath.lastIndexOf("/"));

    try {
      // Read the current exclude file
      const content = await this.executor.readFile(excludePath);
      
      if (content === null) {
        throw new Error("File not found");
      }

      // Check if already excluded
      const lines = content.split("\n");
      const alreadyExcluded = lines.some(
        (line) => line.trim() === excludePattern || line.trim() === `${excludePattern}/`
      );

      if (alreadyExcluded) {
        log.trace(`[GitService] .ralph-worktrees already in .git/info/exclude`);
        return;
      }

      // Append the exclude pattern
      const newContent = content.endsWith("\n")
        ? `${content}${excludePattern}\n`
        : `${content}\n${excludePattern}\n`;

      // Write back via a shell command (using executor for remote compat)
      await this.executor.exec("sh", ["-c", `cat > "${excludePath}" << 'EXCLUDE_EOF'\n${newContent}EXCLUDE_EOF`]);
      log.info(`[GitService] Added .ralph-worktrees to .git/info/exclude`);
    } catch {
      // If the exclude file doesn't exist, create it
      log.trace(`[GitService] .git/info/exclude not found, creating it`);
      // Ensure the info directory exists
      await this.executor.exec("mkdir", ["-p", excludeDir]);
      const content = `# git ls-files --others --exclude-from=.git/info/exclude\n# Lines that start with '#' are comments.\n${excludePattern}\n`;
      await this.executor.exec("sh", ["-c", `cat > "${excludePath}" << 'EXCLUDE_EOF'\n${content}EXCLUDE_EOF`]);
      log.info(`[GitService] Created .git/info/exclude with .ralph-worktrees entry`);
    }
  }

  /**
   * Run a git command in the specified directory.
   * Uses the CommandExecutor for shell execution.
   * 
   * @param directory - The git repository directory
   * @param args - Arguments to pass to git
   * @param options - Optional configuration for the command
   */
  private async runGitCommand(
    directory: string,
    args: string[],
    options: { allowFailure?: boolean } = {}
  ): Promise<GitCommandResult> {
    const { allowFailure = false } = options;
    const cmdStr = `git ${args.join(" ")}`;
    log.trace(`[GitService] Running: ${cmdStr} in ${directory}`);
    
    // Use git with -C flag to run in the specified directory
    const result = await this.executor.exec("git", ["-C", directory, ...args], {
      cwd: directory,
    });
    
    if (!result.success) {
      // Log at trace level if failure is expected (e.g., probing for existence)
      // Log at error level if failure is unexpected
      if (allowFailure) {
        log.trace(`[GitService] Command failed (expected): ${cmdStr}`);
        log.trace(`[GitService]   exitCode: ${result.exitCode}`);
        log.trace(`[GitService]   stderr: ${result.stderr || "(empty)"}`);
        if (result.stdout) {
          log.trace(`[GitService]   stdout: ${result.stdout.slice(0, 300)}${result.stdout.length > 300 ? "..." : ""}`);
        }
      } else {
        log.error(`[GitService] Command failed: ${cmdStr}`);
        log.error(`[GitService]   exitCode: ${result.exitCode}`);
        log.error(`[GitService]   stderr: ${result.stderr || "(empty)"}`);
        if (result.stdout) {
          log.error(`[GitService]   stdout: ${result.stdout.slice(0, 300)}${result.stdout.length > 300 ? "..." : ""}`);
        }
      }
    } else {
      log.trace(`[GitService] Command succeeded: ${cmdStr}`);
    }
    
    return {
      success: result.success,
      stdout: result.stdout,
      stderr: result.stderr,
      exitCode: result.exitCode,
    };
  }

  /**
   * Create a GitCommandError from a failed git command result.
   * Preserves the command string, exit code, and stderr for debugging,
   * so callers catching this error have full context without losing stack info.
   */
  private gitError(message: string, result: GitCommandResult, args: string[]): GitCommandError {
    const command = `git ${args.join(" ")}`;
    return new GitCommandError(
      `${message}: ${result.stderr || "(no stderr)"}`,
      command,
      result.exitCode,
      result.stderr,
    );
  }
}

// Note: No singleton instance - GitService must be created with an executor
// Use backendManager.getCommandExecutorAsync() to get an executor
