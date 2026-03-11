/**
 * Interactive SSH/tmux bridge used by terminal websocket connections.
 */

import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import type { SshSession, Workspace } from "../types";
import { getWorkspace } from "../persistence/workspaces";
import { buildSshCommandArgs, buildSshRemoteShellCommand } from "./remote-command-executor";
import { sshSessionManager } from "./ssh-session-manager";
import { createLogger } from "./logger";
import { backendManager } from "./backend-manager";

const log = createLogger("core:ssh-terminal-bridge");
const TMUX_READY_POLL_INTERVAL_MS = 100;
const TMUX_READY_TIMEOUT_MS = 10_000;

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
  const sharedArgs = (authMode: "batch" | "password") => [
    "-tt",
    ...buildSshCommandArgs({
      authMode,
      port: settings.port ?? 22,
      target,
      remoteCommand,
    }),
  ];

  if (settings.password && settings.password.trim().length > 0) {
    return {
      command: "sshpass",
      args: ["-e", "ssh", ...sharedArgs("password")],
      env: {
        ...process.env,
        SSHPASS: settings.password,
      },
    };
  }

  return {
    command: "ssh",
    args: sharedArgs("batch"),
    env: process.env,
  };
}

function buildResizeCommand(sessionName: string, cols: number, rows: number): string {
  const quotedSessionName = quoteShell(sessionName);
  return [
    `session_name=${quotedSessionName}`,
    `cols=${String(cols)}`,
    `rows=${String(rows)}`,
    "resized=0",
    "client_ttys=$(tmux list-clients -F '#{session_name} #{client_tty}' 2>/dev/null | while IFS=' ' read -r listed_session client_tty; do",
    "  if [ \"$listed_session\" = \"$session_name\" ]; then",
    "    printf '%s\\n' \"$client_tty\"",
    "  fi",
    "done)",
    "if [ -n \"$client_ttys\" ]; then",
    "  for client_tty in $client_ttys; do",
    "    if stty cols \"$cols\" rows \"$rows\" < \"$client_tty\"; then",
    "      resized=1",
    "    fi",
    "  done",
    "fi",
    "if [ \"$resized\" -eq 1 ]; then",
    "  exit 0",
    "fi",
    "exec tmux resize-window -t \"$session_name\" -x \"$cols\" -y \"$rows\"",
  ].join("\n");
}

export class SshTerminalBridge {
  private proc: ChildProcessWithoutNullStreams | null = null;
  private session: SshSession | null = null;
  private workspace: Workspace | null = null;
  private closing = false;
  private ready = false;
  private connectPromise: Promise<void> | null = null;
  private startupError: string | undefined;

  constructor(
    private readonly sessionId: string,
    private readonly options: SshTerminalBridgeOptions,
  ) {}

  async connect(): Promise<void> {
    if (this.connectPromise) {
      return await this.connectPromise;
    }

    this.connectPromise = this.connectInternal();
    try {
      await this.connectPromise;
    } catch (error) {
      this.connectPromise = null;
      throw error;
    }
  }

  private async connectInternal(): Promise<void> {
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
      this.startupError = String(error);
      this.options.onError?.(error);
      await sshSessionManager.markStatus(this.sessionId, "failed", String(error));
    });
    proc.on("close", async (code: number | null, signal: NodeJS.Signals | null) => {
      this.ready = false;
      const nextStatus = this.closing ? "disconnected" : code === 0 ? "disconnected" : "failed";
      const error = !this.closing && code !== 0
        ? `SSH terminal exited with code ${String(code)}${signal ? ` (${signal})` : ""}`
        : undefined;
      if (error) {
        this.startupError = error;
      }
      await sshSessionManager.markStatus(this.sessionId, nextStatus, error);
      this.options.onExit?.(code, signal);
    });

    await this.waitForRemoteSessionReady();
    this.ready = true;
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
    await this.ensureReady();
    const normalizedCols = Math.max(2, Math.floor(cols));
    const normalizedRows = Math.max(1, Math.floor(rows));
    const executor = await backendManager.getCommandExecutorAsync(this.workspace.id, this.workspace.directory);
    const result = await executor.exec("bash", [
      "-lc",
      buildResizeCommand(this.session.config.remoteSessionName, normalizedCols, normalizedRows),
    ], {
      cwd: this.workspace.directory,
      timeout: 5_000,
    });
    if (!result.success) {
      throw new Error(result.stderr.trim() || result.stdout.trim() || "Failed to resize tmux window");
    }
  }

  private async ensureReady(): Promise<void> {
    if (this.ready) {
      return;
    }
    if (!this.connectPromise) {
      throw new Error("SSH terminal is not connected");
    }
    await this.connectPromise;
  }

  private async waitForRemoteSessionReady(): Promise<void> {
    if (!this.session || !this.workspace) {
      throw new Error("SSH terminal is not connected");
    }

    const executor = await backendManager.getCommandExecutorAsync(this.workspace.id, this.workspace.directory);
    const deadline = Date.now() + TMUX_READY_TIMEOUT_MS;
    while (Date.now() < deadline) {
      if (!this.proc) {
        throw new Error("SSH terminal is not connected");
      }
      if (this.proc.exitCode !== null || this.proc.signalCode !== null) {
        throw new Error(this.startupError ?? "SSH terminal exited before the tmux session was ready");
      }

      const result = await executor.exec("tmux", [
        "has-session",
        "-t",
        this.session.config.remoteSessionName,
      ], {
        cwd: this.workspace.directory,
        timeout: 1_000,
      });
      if (result.success) {
        return;
      }

      await Bun.sleep(TMUX_READY_POLL_INTERVAL_MS);
    }

    throw new Error(`Timed out waiting for tmux session ${this.session.config.remoteSessionName} to become ready`);
  }

  async dispose(): Promise<void> {
    this.closing = true;
    this.ready = false;
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
