/**
 * Mock command executor for testing.
 * Runs commands locally using Bun.$ and Bun.file APIs.
 * This is only used in tests - production code uses CommandExecutorImpl via PTY.
 */

import { readdir } from "node:fs/promises";
import type { CommandExecutor, CommandResult, CommandOptions } from "../../src/core/command-executor";

/**
 * TestCommandExecutor runs commands locally for testing purposes.
 * Uses Bun.$ for shell commands and Bun.file for file operations.
 */
export class TestCommandExecutor implements CommandExecutor {
  /**
   * Execute a shell command locally.
   */
  async exec(command: string, args: string[], options?: CommandOptions): Promise<CommandResult> {
    try {
      const cwd = options?.cwd ?? ".";
      // Use Bun.$ with the command and args
      // The quiet() method prevents throwing on non-zero exit codes
      const result = await Bun.$`${command} ${args}`.cwd(cwd).quiet();
      return {
        success: result.exitCode === 0,
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

  /**
   * Check if a file exists locally.
   */
  async fileExists(path: string): Promise<boolean> {
    return Bun.file(path).exists();
  }

  /**
   * Check if a directory exists locally.
   */
  async directoryExists(path: string): Promise<boolean> {
    try {
      const entries = await readdir(path);
      // If readdir succeeds, it's a directory
      return entries !== undefined;
    } catch {
      return false;
    }
  }

  /**
   * Read a file's contents locally.
   */
  async readFile(path: string): Promise<string | null> {
    try {
      const file = Bun.file(path);
      if (!(await file.exists())) {
        return null;
      }
      return await file.text();
    } catch {
      return null;
    }
  }

  /**
   * List files in a directory locally.
   */
  async listDirectory(path: string): Promise<string[]> {
    try {
      return await readdir(path);
    } catch {
      return [];
    }
  }
}

/**
 * Singleton instance for convenience in tests.
 */
export const testCommandExecutor = new TestCommandExecutor();
