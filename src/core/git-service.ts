/**
 * Git service for Ralph Loops Management System.
 * Provides git operations using Bun.$ shell commands.
 * All operations are isolated to a specific directory.
 */

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
 * Uses Bun.$ for all shell commands.
 */
export class GitService {
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
   * Check if there are uncommitted changes (staged or unstaged).
   */
  async hasUncommittedChanges(directory: string): Promise<boolean> {
    const result = await this.runGitCommand(directory, ["status", "--porcelain"]);
    if (!result.success) {
      throw new Error(`Failed to check git status: ${result.stderr}`);
    }
    return result.stdout.trim().length > 0;
  }

  /**
   * Get list of changed files (staged and unstaged).
   */
  async getChangedFiles(directory: string): Promise<string[]> {
    const result = await this.runGitCommand(directory, ["status", "--porcelain"]);
    if (!result.success) {
      throw new Error(`Failed to get changed files: ${result.stderr}`);
    }

    const lines = result.stdout.trim().split("\n").filter(Boolean);
    return lines.map((line) => {
      // Format: "XY filename" or "XY original -> renamed"
      const match = line.match(/^..\s+(.+?)(?:\s+->\s+(.+))?$/);
      if (match) {
        return match[2] ?? match[1];
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
    const filesChanged = filesResult.stdout.trim().split("\n").filter(Boolean).length;

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
   * Get the diff between the current branch and a base branch.
   */
  async getDiff(directory: string, baseBranch: string): Promise<FileDiff[]> {
    const result = await this.runGitCommand(directory, [
      "diff",
      "--numstat",
      baseBranch,
    ]);
    if (!result.success) {
      throw new Error(`Failed to get diff: ${result.stderr}`);
    }

    const lines = result.stdout.trim().split("\n").filter(Boolean);
    const diffs: FileDiff[] = [];

    for (const line of lines) {
      const [additions, deletions, path] = line.split("\t");
      if (!path) continue;

      // Determine status
      let status: FileDiff["status"] = "modified";
      if (additions === "-" && deletions === "-") {
        // Binary file
        status = "modified";
      } else if (parseInt(deletions, 10) === 0 && parseInt(additions, 10) > 0) {
        // Could be added or modified, need more info
        const statusResult = await this.runGitCommand(directory, [
          "diff",
          "--name-status",
          baseBranch,
          "--",
          path,
        ]);
        if (statusResult.success) {
          const statusLine = statusResult.stdout.trim();
          if (statusLine.startsWith("A")) status = "added";
          else if (statusLine.startsWith("D")) status = "deleted";
          else if (statusLine.startsWith("R")) status = "renamed";
        }
      }

      diffs.push({
        path,
        status,
        additions: additions === "-" ? 0 : parseInt(additions, 10),
        deletions: deletions === "-" ? 0 : parseInt(deletions, 10),
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
      files: filesMatch ? parseInt(filesMatch[1], 10) : 0,
      insertions: insertionsMatch ? parseInt(insertionsMatch[1], 10) : 0,
      deletions: deletionsMatch ? parseInt(deletionsMatch[1], 10) : 0,
    };
  }

  /**
   * Run a git command in the specified directory.
   * Uses Bun.$ for shell execution.
   */
  private async runGitCommand(
    directory: string,
    args: string[]
  ): Promise<GitCommandResult> {
    try {
      const result = await Bun.$`git -C ${directory} ${args}`.quiet();
      return {
        success: true,
        stdout: result.stdout.toString(),
        stderr: result.stderr.toString(),
        exitCode: result.exitCode,
      };
    } catch (error) {
      // Bun.$ throws on non-zero exit codes by default
      const bunError = error as {
        stdout?: Buffer;
        stderr?: Buffer;
        exitCode?: number;
      };
      return {
        success: false,
        stdout: bunError.stdout?.toString() ?? "",
        stderr: bunError.stderr?.toString() ?? String(error),
        exitCode: bunError.exitCode ?? 1,
      };
    }
  }
}

/**
 * Singleton instance of GitService.
 */
export const gitService = new GitService();
