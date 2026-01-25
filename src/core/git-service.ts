/**
 * Git service for Ralph Loops Management System.
 * Provides git operations using a CommandExecutor abstraction.
 * All operations are isolated to a specific directory.
 */

import type { CommandExecutor } from "./command-executor";
import { log } from "./logger";

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
    const result = await this.runGitCommand(directory, ["rev-parse", "--abbrev-ref", "HEAD"]);
    if (!result.success) {
      throw new Error(`Failed to get current branch: ${result.stderr}`);
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
    const result = await this.runGitCommand(directory, ["branch", "--format=%(refname:short)|%(HEAD)"]);
    if (!result.success) {
      throw new Error(`Failed to get local branches: ${result.stderr}`);
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
   * Check if there are uncommitted changes (staged or unstaged).
   */
  async hasUncommittedChanges(directory: string): Promise<boolean> {
    const result = await this.runGitCommand(directory, ["status", "--porcelain"]);
    if (!result.success) {
      throw new Error(`Failed to check git status: ${result.stderr}`);
    }
    const hasChanges = result.stdout.trim().length > 0;
    // Debug logging for troubleshooting PTY output parsing
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
    const result = await this.runGitCommand(directory, ["status", "--porcelain"]);
    if (!result.success) {
      throw new Error(`Failed to get changed files: ${result.stderr}`);
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
    const result = await this.runGitCommand(directory, ["checkout", "-b", branchName]);
    if (!result.success) {
      throw new Error(`Failed to create branch ${branchName}: ${result.stderr}`);
    }
  }

  /**
   * Checkout an existing branch.
   */
  async checkoutBranch(directory: string, branchName: string): Promise<void> {
    const result = await this.runGitCommand(directory, ["checkout", branchName]);
    if (!result.success) {
      throw new Error(`Failed to checkout branch ${branchName}: ${result.stderr}`);
    }
  }

  /**
   * Delete a branch.
   */
  async deleteBranch(directory: string, branchName: string): Promise<void> {
    const result = await this.runGitCommand(directory, ["branch", "-D", branchName]);
    if (!result.success) {
      throw new Error(`Failed to delete branch ${branchName}: ${result.stderr}`);
    }
  }

  /**
   * Check if a branch exists.
   */
  async branchExists(directory: string, branchName: string): Promise<boolean> {
    const result = await this.runGitCommand(directory, [
      "rev-parse",
      "--verify",
      branchName,
    ]);
    return result.success;
  }

  /**
   * Stage all changes (new, modified, deleted files).
   */
  async stageAll(directory: string): Promise<void> {
    const result = await this.runGitCommand(directory, ["add", "-A"]);
    if (!result.success) {
      throw new Error(`Failed to stage changes: ${result.stderr}`);
    }
  }

  /**
   * Commit staged changes.
   * Returns the commit SHA.
   */
  async commit(directory: string, message: string): Promise<CommitInfo> {
    // First, stage all changes
    await this.stageAll(directory);

    // Check if there are changes to commit
    const hasChanges = await this.hasStagedChanges(directory);
    if (!hasChanges) {
      throw new Error("No changes to commit");
    }

    // Commit
    const result = await this.runGitCommand(directory, ["commit", "-m", message]);
    if (!result.success) {
      throw new Error(`Failed to commit: ${result.stderr}`);
    }

    // Get the commit SHA
    const shaResult = await this.runGitCommand(directory, ["rev-parse", "HEAD"]);
    if (!shaResult.success) {
      throw new Error(`Failed to get commit SHA: ${shaResult.stderr}`);
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
   */
  async stash(directory: string): Promise<void> {
    const result = await this.runGitCommand(directory, ["stash", "push", "-u"]);
    if (!result.success) {
      throw new Error(`Failed to stash changes: ${result.stderr}`);
    }
  }

  /**
   * Pop the most recent stash.
   */
  async stashPop(directory: string): Promise<void> {
    const result = await this.runGitCommand(directory, ["stash", "pop"]);
    if (!result.success) {
      throw new Error(`Failed to pop stash: ${result.stderr}`);
    }
  }

  /**
   * Hard reset to discard all uncommitted changes and untracked files.
   * This is a destructive operation!
   */
  async resetHard(directory: string): Promise<void> {
    // Reset tracked files
    const resetResult = await this.runGitCommand(directory, ["reset", "--hard"]);
    if (!resetResult.success) {
      throw new Error(`Failed to reset: ${resetResult.stderr}`);
    }

    // Clean untracked files and directories
    const cleanResult = await this.runGitCommand(directory, ["clean", "-fd"]);
    if (!cleanResult.success) {
      throw new Error(`Failed to clean untracked files: ${cleanResult.stderr}`);
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
    const result = await this.runGitCommand(directory, [
      "merge",
      sourceBranch,
      "--no-ff",
      "-m",
      `Merge branch '${sourceBranch}' into ${targetBranch}`,
    ]);
    if (!result.success) {
      throw new Error(`Failed to merge ${sourceBranch} into ${targetBranch}: ${result.stderr}`);
    }

    // Get the merge commit SHA
    const shaResult = await this.runGitCommand(directory, ["rev-parse", "HEAD"]);
    if (!shaResult.success) {
      throw new Error(`Failed to get merge commit SHA: ${shaResult.stderr}`);
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
    // First checkout the branch to push
    await this.checkoutBranch(directory, branchName);

    // Push to remote with -u flag to set upstream
    const result = await this.runGitCommand(directory, [
      "push",
      "-u",
      remote,
      branchName,
    ]);
    if (!result.success) {
      throw new Error(`Failed to push branch ${branchName} to ${remote}: ${result.stderr}`);
    }

    return `${remote}/${branchName}`;
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
   * Get the diff between the current branch and a base branch.
   */
  async getDiff(directory: string, baseBranch: string): Promise<FileDiff[]> {
    // Get numstat for additions/deletions counts
    const result = await this.runGitCommand(directory, [
      "diff",
      "--numstat",
      baseBranch,
    ]);
    if (!result.success) {
      throw new Error(`Failed to get diff: ${result.stderr}`);
    }

    // Get name-status for all files at once (more efficient than per-file calls)
    const statusResult = await this.runGitCommand(directory, [
      "diff",
      "--name-status",
      baseBranch,
    ]);
    
    // Build a map of file path -> status
    // Normalize line endings from PTY (may have \r\n)
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

    // Normalize line endings from PTY (may have \r\n)
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
    const result = await this.runGitCommand(directory, [
      "diff",
      "--shortstat",
      baseBranch,
    ]);
    if (!result.success) {
      throw new Error(`Failed to get diff summary: ${result.stderr}`);
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
    const result = await this.runGitCommand(directory, [
      "diff",
      baseBranch,
      "--",
      filePath,
    ]);
    if (!result.success) {
      throw new Error(`Failed to get file diff: ${result.stderr}`);
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

    // Normalize line endings from PTY (may have \r\n) to \n
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

  /**
   * Run a git command in the specified directory.
   * Uses the CommandExecutor for shell execution.
   */
  private async runGitCommand(
    directory: string,
    args: string[]
  ): Promise<GitCommandResult> {
    const cmdStr = `git ${args.join(" ")}`;
    log.trace(`[GitService] Running: ${cmdStr} in ${directory}`);
    
    // Use git with -C flag to run in the specified directory
    const result = await this.executor.exec("git", ["-C", directory, ...args], {
      cwd: directory,
    });
    
    if (!result.success) {
      log.error(`[GitService] Command failed: ${cmdStr}`);
      log.error(`[GitService]   exitCode: ${result.exitCode}`);
      log.error(`[GitService]   stderr: ${result.stderr || "(empty)"}`);
      if (result.stdout) {
        log.error(`[GitService]   stdout: ${result.stdout.slice(0, 300)}${result.stdout.length > 300 ? "..." : ""}`);
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
}

// Note: No singleton instance - GitService must be created with an executor
// Use backendManager.getCommandExecutorAsync() to get an executor
