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
const DEFAULT_TMUX_READY_TIMEOUT_MS = 15_000;
const DEFAULT_SSH_TERM = "xterm-256color";

export interface SshTerminalBridgeOptions {
  onOutput: (chunk: string) => void;
  onExit?: (code: number | null, signal: NodeJS.Signals | null) => void;
  onError?: (error: Error) => void;
  readyTimeoutMs?: number;
}

function quoteShell(value: string): string {
  return `'${value.replace(/'/g, `'\"'\"'`)}'`;
}

export function buildAttachCommand(session: SshSession): string {
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
    `tmux set-option -t ${sessionName} status off;`,
    `exec tmux attach-session -t ${sessionName}`,
  ].join(" ");
}

function buildSpawnEnv(extraEnv?: Record<string, string>): NodeJS.ProcessEnv {
  const configuredTerm = process.env["TERM"]?.trim();
  return {
    ...process.env,
    ...extraEnv,
    TERM: configuredTerm && configuredTerm.length > 0 ? configuredTerm : DEFAULT_SSH_TERM,
  };
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
      identityFile: settings.identityFile,
    }),
  ];

  if (settings.password && settings.password.trim().length > 0) {
    return {
      command: "sshpass",
      args: ["-e", "ssh", ...sharedArgs("password")],
      env: buildSpawnEnv({
        SSHPASS: settings.password,
      }),
    };
  }

  return {
    command: "ssh",
    args: sharedArgs("batch"),
    env: buildSpawnEnv(),
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
  private closePromise: Promise<void> | null = null;
  private skipCloseStatusUpdate = false;
  private startupError: string | undefined;
  private receivedStdout = false;

  constructor(
    private readonly sessionId: string,
    private readonly options: SshTerminalBridgeOptions,
  ) {}

  async connect(): Promise<void> {
    if (this.ready && this.proc && this.proc.exitCode === null && this.proc.signalCode === null) {
      return;
    }
    if (this.connectPromise) {
      return await this.connectPromise;
    }

    const pendingConnect = this.connectInternal();
    this.connectPromise = pendingConnect;
    try {
      await pendingConnect;
    } finally {
      if (this.connectPromise === pendingConnect) {
        this.connectPromise = null;
      }
    }
  }

  private async connectInternal(): Promise<void> {
    this.closing = false;
    this.ready = false;
    this.skipCloseStatusUpdate = false;
    this.startupError = undefined;
    this.receivedStdout = false;

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

    this.closePromise = new Promise((resolve) => {
      proc.on("close", (code: number | null, signal: NodeJS.Signals | null) => {
        void (async () => {
          this.ready = false;
          this.proc = null;
          const skipStatusUpdate = this.skipCloseStatusUpdate;
          this.skipCloseStatusUpdate = false;
          const nextStatus = this.closing ? "disconnected" : code === 0 ? "disconnected" : "failed";
          const error = !this.closing && code !== 0
            ? `SSH terminal exited with code ${String(code)}${signal ? ` (${signal})` : ""}`
            : undefined;
          if (error) {
            this.startupError = error;
          }

          try {
            if (!skipStatusUpdate) {
              await sshSessionManager.markStatus(this.sessionId, nextStatus, error);
            }
          } catch (statusError) {
            log.error("Failed to update SSH session status after terminal close", {
              sessionId: this.sessionId,
              error: String(statusError),
            });
          } finally {
            this.options.onExit?.(code, signal);
            this.closePromise = null;
            resolve();
          }
        })();
      });
    });

    proc.stdout.on("data", (chunk: string) => {
      if (chunk.length > 0) {
        this.receivedStdout = true;
      }
      this.options.onOutput(chunk);
    });
    proc.stderr.on("data", (chunk: string) => {
      this.options.onOutput(chunk);
    });
    proc.on("error", (error: Error) => {
      this.startupError = String(error);
      this.options.onError?.(error);
    });

    try {
      await this.waitForRemoteSessionReady();
      this.ready = true;
      await sshSessionManager.markStatus(this.sessionId, "connected");
    } catch (error) {
      const startupError = error instanceof Error ? error : new Error(String(error));
      this.ready = false;
      this.startupError = startupError.message;

      if (!this.closing) {
        this.options.onError?.(startupError);
        await sshSessionManager.markStatus(this.sessionId, "failed", startupError.message);
        this.skipCloseStatusUpdate = true;
      }

      if (this.proc && this.proc.exitCode === null && this.proc.signalCode === null) {
        this.proc.kill("SIGTERM");
      }
      await this.waitForClose();
      throw startupError;
    }
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
    const deadline = Date.now() + (this.options.readyTimeoutMs ?? DEFAULT_TMUX_READY_TIMEOUT_MS);
    while (Date.now() < deadline) {
      if (!this.proc) {
        throw new Error("SSH terminal is not connected");
      }
      if (this.proc.exitCode !== null || this.proc.signalCode !== null) {
        throw new Error(this.startupError ?? "SSH terminal exited before the tmux session was ready");
      }

      const result = await executor.exec("tmux", [
        "display-message",
        "-p",
        "-t",
        this.session.config.remoteSessionName,
        "#{session_attached}",
      ], {
        cwd: this.workspace.directory,
        timeout: 1_000,
      });
      if (result.success && Number.parseInt(result.stdout.trim(), 10) > 0) {
        return;
      }
      if (this.receivedStdout) {
        log.debug("Treating live terminal output as readiness fallback", {
          sessionId: this.sessionId,
        });
        return;
      }

      await Bun.sleep(TMUX_READY_POLL_INTERVAL_MS);
    }

    throw new Error(`Timed out waiting for tmux session ${this.session.config.remoteSessionName} to become ready`);
  }

  private async waitForClose(): Promise<void> {
    if (this.closePromise) {
      await this.closePromise;
    }
  }

  async dispose(): Promise<void> {
    this.closing = true;
    this.ready = false;
    if (!this.proc) {
      this.connectPromise = null;
      return;
    }

    const proc = this.proc;
    if (proc.exitCode === null && proc.signalCode === null) {
      proc.kill("SIGTERM");
    }
    await this.waitForClose();
    this.connectPromise = null;
    log.debug("Disposed SSH terminal bridge", { sessionId: this.sessionId });
  }
}
