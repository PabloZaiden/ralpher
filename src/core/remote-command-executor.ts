/**
 * Command executor for deterministic local/SSH command and file operations.
 * Uses direct process execution and does not depend on any agent SDK transport.
 */

import { mkdir, readdir } from "node:fs/promises";
import { dirname } from "node:path";
import type { CommandExecutor, CommandResult, CommandOptions } from "./command-executor";
import { log } from "./logger";

/** Log prefix for executor messages */
const LOG_PREFIX = "[CommandExecutor]";
const DEFAULT_TIMEOUT_MS = 120_000;

/**
 * Configuration for the command executor.
 */
export interface CommandExecutorConfig {
  /** Execution provider */
  provider?: "local" | "ssh";
  /** Base working directory */
  directory: string;
  /** SSH host (required for provider=ssh) */
  host?: string;
  /** SSH port (default 22) */
  port?: number;
  /** SSH user (optional) */
  user?: string;
  /** SSH password (optional, uses sshpass) */
  password?: string;
  /** Default timeout in milliseconds */
  timeoutMs?: number;
}

function quoteShell(value: string): string {
  return `'${value.replace(/'/g, `'\"'\"'`)}'`;
}

export function buildSshRemoteShellCommand(remoteCommand: string): string {
  const wrappedRemoteCommand = `if [ -f ~/.profile ]; then source ~/.profile >/dev/null 2>&1; fi; ${remoteCommand}`;
  return `bash -lc ${quoteShell(wrappedRemoteCommand)}`;
}

/**
 * CommandExecutorImpl executes commands either locally or over SSH.
 * Commands are queued to ensure only one runs at a time per executor instance.
 */
export class CommandExecutorImpl implements CommandExecutor {
  private readonly provider: "local" | "ssh";
  private readonly directory: string;
  private readonly host?: string;
  private readonly port: number;
  private readonly user?: string;
  private readonly password?: string;
  private readonly defaultTimeoutMs: number;

  /** Queue of pending commands */
  private commandQueue: Array<{
    execute: () => Promise<CommandResult>;
    resolve: (result: CommandResult) => void;
    reject: (error: Error) => void;
  }> = [];

  /** Whether a command is currently executing */
  private isExecuting = false;

  constructor(config: CommandExecutorConfig) {
    this.provider = config.provider ?? "local";
    this.directory = config.directory;
    this.host = config.host;
    this.port = config.port ?? 22;
    this.user = config.user;
    this.password = config.password;
    this.defaultTimeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  /**
   * Execute a shell command.
   * Commands are queued and executed one at a time.
   */
  async exec(command: string, args: string[], options?: CommandOptions): Promise<CommandResult> {
    const cmdStr = `${command} ${args.join(" ")}`;

    return new Promise<CommandResult>((resolve, reject) => {
      const executeCommand = async (): Promise<CommandResult> => {
        const cwd = options?.cwd ?? this.directory;
        const timeout = options?.timeout ?? this.defaultTimeoutMs;
        const result = this.provider === "ssh"
          ? await this.execSsh(command, args, cwd, timeout)
          : await this.execLocal(command, args, cwd, timeout);

        if (!result.success) {
          log.error(`${LOG_PREFIX} Command failed: ${cmdStr}`);
          log.error(`${LOG_PREFIX}   exitCode: ${result.exitCode}`);
          if (result.stderr) {
            log.error(`${LOG_PREFIX}   stderr: ${result.stderr}`);
          }
        }
        return result;
      };

      this.commandQueue.push({ execute: executeCommand, resolve, reject });
      void this.processQueue();
    });
  }

  private async processQueue(): Promise<void> {
    if (this.isExecuting) {
      return;
    }
    this.isExecuting = true;

    while (this.commandQueue.length > 0) {
      const item = this.commandQueue.shift();
      if (!item) break;
      try {
        const result = await item.execute();
        item.resolve(result);
      } catch (error) {
        item.reject(error instanceof Error ? error : new Error(String(error)));
      }
    }

    this.isExecuting = false;
  }

  private async execLocal(
    command: string,
    args: string[],
    cwd: string,
    timeoutMs: number,
    env?: Record<string, string>,
  ): Promise<CommandResult> {
    try {
      const proc = Bun.spawn([command, ...args], {
        cwd,
        stdout: "pipe",
        stderr: "pipe",
        ...(env ? { env: { ...process.env, ...env } } : {}),
      });

      let timedOut = false;
      let timeoutId: ReturnType<typeof setTimeout> | undefined;
      const timeoutPromise = new Promise<number>((resolve) => {
        timeoutId = setTimeout(() => {
          timedOut = true;
          try {
            proc.kill();
          } catch {
            // Ignore kill errors during timeout cleanup
          }
          resolve(124);
        }, timeoutMs);
      });

      const exitCode = await Promise.race([proc.exited, timeoutPromise]);
      clearTimeout(timeoutId);

      const stdout = await new Response(proc.stdout).text();
      const stderr = await new Response(proc.stderr).text();

      if (timedOut) {
        return {
          success: false,
          stdout,
          stderr: stderr || `Command timed out after ${timeoutMs}ms`,
          exitCode,
        };
      }

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

  private async execSsh(
    command: string,
    args: string[],
    cwd: string,
    timeoutMs: number,
  ): Promise<CommandResult> {
    if (!this.host) {
      return {
        success: false,
        stdout: "",
        stderr: "SSH execution requires execution host",
        exitCode: 1,
      };
    }

    const remoteCommand = [
      `cd ${quoteShell(cwd)}`,
      "&&",
      quoteShell(command),
      ...args.map((arg) => quoteShell(arg)),
    ].join(" ");
    const remoteShellCommand = buildSshRemoteShellCommand(remoteCommand);

    const sshArgs = [
      "-o",
      "ConnectTimeout=10",
      "-o",
      "StrictHostKeyChecking=no",
      "-o",
      "UserKnownHostsFile=/dev/null",
      "-o",
      "LogLevel=ERROR",
      "-o",
      "ServerAliveInterval=15",
      "-o",
      "ServerAliveCountMax=1",
      "-p",
      String(this.port),
      this.user ? `${this.user}@${this.host}` : this.host,
      "--",
      remoteShellCommand,
    ];

    if (this.password && this.password.trim().length > 0) {
      return await this.execLocal(
        "sshpass",
        ["-e", "ssh", "-o", "NumberOfPasswordPrompts=1", ...sshArgs],
        "/",
        timeoutMs,
        { SSHPASS: this.password },
      );
    }

    return await this.execLocal("ssh", ["-o", "BatchMode=yes", ...sshArgs], "/", timeoutMs);
  }

  async fileExists(path: string): Promise<boolean> {
    const result = await this.exec("test", ["-f", path]);
    return result.success;
  }

  async directoryExists(path: string): Promise<boolean> {
    const result = await this.exec("test", ["-d", path]);
    return result.success;
  }

  async readFile(path: string): Promise<string | null> {
    if (this.provider === "local") {
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

    const result = await this.exec("cat", [path]);
    if (!result.success) {
      return null;
    }
    return result.stdout;
  }

  async listDirectory(path: string): Promise<string[]> {
    if (this.provider === "local") {
      try {
        return await readdir(path);
      } catch {
        return [];
      }
    }

    const result = await this.exec("ls", ["-1", path]);
    if (!result.success) {
      return [];
    }
    return result.stdout
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0);
  }

  async writeFile(path: string, content: string): Promise<boolean> {
    if (this.provider === "local") {
      try {
        await mkdir(dirname(path), { recursive: true });
        await Bun.write(path, content);
        return true;
      } catch {
        return false;
      }
    }

    const parentDir = dirname(path);
    const base64Content = Buffer.from(content, "utf8").toString("base64");
    const result = await this.exec("sh", [
      "-lc",
      `mkdir -p ${quoteShell(parentDir)} && printf %s ${quoteShell(base64Content)} | base64 -d > ${quoteShell(path)}`,
    ]);
    return result.success;
  }
}
