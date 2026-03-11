/**
 * Interactive SSH/tmux bridge used by terminal websocket connections.
 */

import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import type { SshSession, Workspace } from "../types";
import { getWorkspace } from "../persistence/workspaces";
import { buildSshRemoteShellCommand } from "./remote-command-executor";
import { sshSessionManager } from "./ssh-session-manager";
import { createLogger } from "./logger";
import { backendManager } from "./backend-manager";

const log = createLogger("core:ssh-terminal-bridge");

export interface SshTerminalBridgeOptions {
  onOutput: (chunk: string) => void;
  onExit?: (code: number | null, signal: NodeJS.Signals | null) => void;
  onError?: (error: Error) => void;
}

function quoteShell(value: string): string {
  return `'${value.replace(/'/g, `'\"'\"'`)}'`;
}

function buildAttachCommand(session: SshSession): string {
  const directory = quoteShell(session.config.directory);
  const sessionName = quoteShell(session.config.remoteSessionName);
  return [
    "if ! command -v tmux >/dev/null 2>&1; then",
    "echo 'tmux is not installed on the remote host.' >&2;",
    "exit 127;",
    "fi;",
    `if ! tmux has-session -t ${sessionName} 2>/dev/null; then`,
    `tmux new-session -d -s ${sessionName} -c ${directory};`,
    "fi;",
    `exec tmux attach-session -t ${sessionName}`,
  ].join(" ");
}

function buildSshSpawnConfig(workspace: Workspace, session: SshSession): {
  command: string;
  args: string[];
  env: NodeJS.ProcessEnv;
} {
  const settings = workspace.serverSettings.agent;
  if (settings.transport !== "ssh") {
    throw new Error("SSH terminal bridge requires an SSH workspace");
  }

  const target = settings.username?.trim()
    ? `${settings.username.trim()}@${settings.hostname}`
    : settings.hostname;
  const remoteCommand = buildSshRemoteShellCommand(buildAttachCommand(session));
  const sshArgs = [
    "-tt",
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
    String(settings.port ?? 22),
    target,
    "--",
    remoteCommand,
  ];

  if (settings.password && settings.password.trim().length > 0) {
    return {
      command: "sshpass",
      args: ["-e", "ssh", "-o", "NumberOfPasswordPrompts=1", ...sshArgs],
      env: {
        ...process.env,
        SSHPASS: settings.password,
      },
    };
  }

  return {
    command: "ssh",
    args: ["-o", "BatchMode=yes", ...sshArgs],
    env: process.env,
  };
}

export class SshTerminalBridge {
  private proc: ChildProcessWithoutNullStreams | null = null;
  private session: SshSession | null = null;
  private workspace: Workspace | null = null;
  private closing = false;

  constructor(
    private readonly sessionId: string,
    private readonly options: SshTerminalBridgeOptions,
  ) {}

  async connect(): Promise<void> {
    this.session = await sshSessionManager.getSession(this.sessionId);
    if (!this.session) {
      throw new Error(`SSH session not found: ${this.sessionId}`);
    }

    this.workspace = await getWorkspace(this.session.config.workspaceId);
    if (!this.workspace) {
      throw new Error(`Workspace not found: ${this.session.config.workspaceId}`);
    }

    await sshSessionManager.ensureTmuxAvailable(this.workspace);
    await sshSessionManager.markStatus(this.sessionId, "connecting");

    const spawnConfig = buildSshSpawnConfig(this.workspace, this.session);
    const proc = spawn(spawnConfig.command, spawnConfig.args, {
      env: spawnConfig.env,
      stdio: ["pipe", "pipe", "pipe"],
    });
    this.proc = proc;

    proc.stdout.setEncoding("utf8");
    proc.stderr.setEncoding("utf8");

    proc.stdout.on("data", (chunk: string) => {
      this.options.onOutput(chunk);
    });
    proc.stderr.on("data", (chunk: string) => {
      this.options.onOutput(chunk);
    });
    proc.on("error", async (error: Error) => {
      this.options.onError?.(error);
      await sshSessionManager.markStatus(this.sessionId, "failed", String(error));
    });
    proc.on("close", async (code: number | null, signal: NodeJS.Signals | null) => {
      const nextStatus = this.closing ? "disconnected" : code === 0 ? "disconnected" : "failed";
      const error = !this.closing && code !== 0
        ? `SSH terminal exited with code ${String(code)}${signal ? ` (${signal})` : ""}`
        : undefined;
      await sshSessionManager.markStatus(this.sessionId, nextStatus, error);
      this.options.onExit?.(code, signal);
    });

    await sshSessionManager.markStatus(this.sessionId, "connected");
  }

  sendInput(data: string): void {
    if (!this.proc?.stdin.writable) {
      throw new Error("SSH terminal is not connected");
    }
    this.proc.stdin.write(data);
  }

  async resize(cols: number, rows: number): Promise<void> {
    if (!this.session || !this.workspace) {
      throw new Error("SSH terminal is not connected");
    }
    const executor = await backendManager.getCommandExecutorAsync(this.workspace.id, this.workspace.directory);
    const result = await executor.exec("tmux", [
      "resize-window",
      "-t",
      this.session.config.remoteSessionName,
      "-x",
      String(cols),
      "-y",
      String(rows),
    ], {
      cwd: this.workspace.directory,
    });
    if (!result.success) {
      throw new Error(result.stderr.trim() || result.stdout.trim() || "Failed to resize tmux window");
    }
  }

  async dispose(): Promise<void> {
    this.closing = true;
    if (!this.proc) {
      if (this.sessionId) {
        await sshSessionManager.markStatus(this.sessionId, "disconnected");
      }
      return;
    }

    const proc = this.proc;
    this.proc = null;
    proc.kill("SIGTERM");
    log.debug("Disposed SSH terminal bridge", { sessionId: this.sessionId });
  }
}

