/**
 * Mock command executor for testing.
 * Runs commands locally using Bun.spawn and Bun.file APIs.
 * This is only used in tests - production code uses CommandExecutorImpl via PTY.
 */

import { readdir } from "node:fs/promises";
import type { CommandExecutor, CommandResult, CommandOptions } from "../../src/core/command-executor";

/**
 * TestCommandExecutor runs commands locally for testing purposes.
 * Uses Bun.spawn for shell commands and Bun.file for file operations.
 */
export class TestCommandExecutor implements CommandExecutor {
  /**
   * Execute a shell command locally.
   */
  async exec(command: string, args: string[], options?: CommandOptions): Promise<CommandResult> {
    try {
      const cwd = options?.cwd ?? process.cwd();
      // Use Bun.spawn which handles cwd more reliably than Bun.$
      const proc = Bun.spawn([command, ...args], {
        cwd,
        stdout: "pipe",
        stderr: "pipe",
      });
      
      // Wait for process to complete
      const exitCode = await proc.exited;
      const stdout = await new Response(proc.stdout).text();
      const stderr = await new Response(proc.stderr).text();
      
      return {
        success: exitCode === 0,
        stdout,
        stderr,
        exitCode,
      };
    } catch (error) {
      return {
        success: false,
        stdout: "",
        stderr: String(error),
        exitCode: 1,
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
