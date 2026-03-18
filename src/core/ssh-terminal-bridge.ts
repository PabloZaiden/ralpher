/**
 * Interactive SSH terminal bridge used by terminal websocket connections.
 */

import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import type { CommandExecutor } from "./command-executor";
import type { SshConnectionMode, SshServerSession, SshSession, Workspace } from "../types";
import { getWorkspace } from "../persistence/workspaces";
import { buildSshRemoteShellCommand } from "./remote-command-executor";
import {
  buildPersistentSessionAttachCommand,
  buildPersistentSessionBackendInstallHint,
  buildPersistentSessionBackendProbeCommand,
  buildPersistentSessionReadyCommand,
  buildPersistentSessionResizeCommand,
} from "./ssh-persistent-session";
import { DEFAULT_SSH_COLOR_TERM, DEFAULT_SSH_TERM } from "./ssh-terminal-env";
import { sshSessionManager } from "./ssh-session-manager";
import { sshServerManager } from "./ssh-server-manager";
import { createLogger } from "./logger";
import { backendManager } from "./backend-manager";
import {
  buildSshProcessConfig,
  type SshConnectionTarget,
  getSshConnectionTargetFromWorkspace,
} from "./ssh-connection-target";
import { getEffectiveSshConnectionMode } from "../utils";

const log = createLogger("core:ssh-terminal-bridge");
const SESSION_READY_POLL_INTERVAL_MS = 100;
const DEFAULT_SESSION_READY_TIMEOUT_MS = 15_000;
const MAX_SESSION_READY_PROBE_TIMEOUT_MS = 10_000;
const DEFAULT_SSH_TERMINAL_COMMAND_TIMEOUT_MS = 10_000;
const OSC_52_SEQUENCE_START = "\u001b]52;";
const OSC_SEQUENCE_BELL = "\u0007";
const OSC_SEQUENCE_STRING_TERMINATOR = "\u001b\\";
const MAX_PENDING_OSC_SEQUENCE_BYTES = 1024 * 1024;

export interface SshTerminalBridgeOptions {
  onOutput: (chunk: string) => void;
  onClipboardCopy?: (text: string) => void;
  onExit?: (code: number | null, signal: NodeJS.Signals | null) => void;
  onError?: (error: Error) => void;
  readyTimeoutMs?: number;
}

export interface SshTerminalBridgeConnectOptions {
  sessionKind?: "workspace" | "standalone";
  credentialToken?: string;
}

interface ClipboardSequenceResult {
  visibleOutput: string;
  clipboardCopies: string[];
  remainder: string;
}

function quoteShell(value: string): string {
  return `'${value.replace(/'/g, `'\"'\"'`)}'`;
}

export function buildAttachCommand(session: { config: { id: string; remoteSessionName: string; directory?: string } }): string {
  return buildPersistentSessionAttachCommand(session);
}

function buildDirectTtyFilePath(sessionId: string): string {
  return `/tmp/ralpher-terminal-${sessionId}.tty`;
}

function buildDirectShellCommand(session: { config: { id: string; directory?: string } }): string {
  const ttyFile = quoteShell(buildDirectTtyFilePath(session.config.id));
  const changeDirectoryCommand = session.config.directory
    ? `cd ${quoteShell(session.config.directory)} || exit 1;`
    : "";
  return [
    `tty_file=${ttyFile}`,
    "tty_path=$(tty);",
    "if [ -z \"$tty_path\" ] || [ \"$tty_path\" = \"not a tty\" ]; then",
    "echo 'Failed to determine remote SSH tty.' >&2;",
    "exit 1;",
    "fi;",
    "printf '%s\\n' \"$tty_path\" > \"$tty_file\";",
    "trap 'rm -f \"$tty_file\"' EXIT HUP INT TERM;",
    changeDirectoryCommand,
    `COLORTERM=${quoteShell(DEFAULT_SSH_COLOR_TERM)};`,
    "export COLORTERM;",
    "shell=\"${SHELL:-/bin/sh}\";",
    "\"$shell\" -i",
  ].filter((part) => part.length > 0).join(" ");
}

function buildSessionStartupCommand(
  session: {
    config: { id: string; remoteSessionName: string; directory?: string; connectionMode: SshConnectionMode };
    state?: { runtimeConnectionMode?: SshConnectionMode };
  },
): string {
  return getEffectiveSshConnectionMode(session) === "direct"
    ? buildDirectShellCommand(session)
    : buildPersistentSessionAttachCommand(session);
}

function buildSpawnEnv(extraEnv?: Record<string, string>): NodeJS.ProcessEnv {
  const configuredTerm = process.env["TERM"]?.trim();
  const configuredColorTerm = process.env["COLORTERM"]?.trim();
  return {
    ...process.env,
    ...extraEnv,
    TERM: configuredTerm && configuredTerm.length > 0 ? configuredTerm : DEFAULT_SSH_TERM,
    COLORTERM: configuredColorTerm && configuredColorTerm.length > 0 ? configuredColorTerm : DEFAULT_SSH_COLOR_TERM,
  };
}

function buildSshSpawnConfig(workspace: Workspace, session: SshSession): {
  command: string;
  args: string[];
  env: NodeJS.ProcessEnv;
} {
  const target = getSshConnectionTargetFromWorkspace(workspace);
  const remoteCommand = buildSshRemoteShellCommand(buildSessionStartupCommand(session));
  return buildSshProcessConfig({
    target,
    remoteCommand,
    extraArgs: ["-tt"],
    passwordHandling: "environment",
    baseEnv: buildSpawnEnv(),
  });
}

function buildStandaloneSshSpawnConfig(target: SshConnectionTarget, session: SshServerSession): {
  command: string;
  args: string[];
  env: NodeJS.ProcessEnv;
} {
  const remoteCommand = buildSshRemoteShellCommand(buildSessionStartupCommand(session));
  return buildSshProcessConfig({
    target,
    remoteCommand,
    extraArgs: ["-tt"],
    passwordHandling: "environment",
    baseEnv: buildSpawnEnv(),
  });
}

function buildDirectReadyCommand(sessionId: string): string {
  const ttyFile = quoteShell(buildDirectTtyFilePath(sessionId));
  return [
    `tty_file=${ttyFile}`,
    "if [ ! -r \"$tty_file\" ]; then",
    "exit 1;",
    "fi;",
    "tty_path=$(cat \"$tty_file\" 2>/dev/null || true);",
    "[ -n \"$tty_path\" ]",
  ].join("\n");
}

function buildDirectResizeCommand(sessionId: string, cols: number, rows: number): string {
  const ttyFile = quoteShell(buildDirectTtyFilePath(sessionId));
  return [
    `tty_file=${ttyFile}`,
    `cols=${String(cols)}`,
    `rows=${String(rows)}`,
    "if [ ! -r \"$tty_file\" ]; then",
    "echo 'Direct SSH tty is not ready' >&2;",
    "exit 1;",
    "fi;",
    "tty_path=$(cat \"$tty_file\" 2>/dev/null || true);",
    "if [ -z \"$tty_path\" ]; then",
    "echo 'Direct SSH tty is not ready' >&2;",
    "exit 1;",
    "fi;",
    "exec stty cols \"$cols\" rows \"$rows\" < \"$tty_path\"",
  ].join("\n");
}

function getOsc52CarryoverLength(buffer: string): number {
  const maxCarryoverLength = Math.min(buffer.length, OSC_52_SEQUENCE_START.length - 1);
  for (let length = maxCarryoverLength; length > 0; length--) {
    if (OSC_52_SEQUENCE_START.startsWith(buffer.slice(-length))) {
      return length;
    }
  }
  return 0;
}

function findOsc52Terminator(buffer: string, searchStart: number): { index: number; length: number } | null {
  const bellIndex = buffer.indexOf(OSC_SEQUENCE_BELL, searchStart);
  const stringTerminatorIndex = buffer.indexOf(OSC_SEQUENCE_STRING_TERMINATOR, searchStart);
  if (bellIndex === -1 && stringTerminatorIndex === -1) {
    return null;
  }
  if (bellIndex !== -1 && (stringTerminatorIndex === -1 || bellIndex < stringTerminatorIndex)) {
    return {
      index: bellIndex,
      length: OSC_SEQUENCE_BELL.length,
    };
  }
  return {
    index: stringTerminatorIndex,
    length: OSC_SEQUENCE_STRING_TERMINATOR.length,
  };
}

function decodeClipboardPayload(payload: string): string | null {
  const separatorIndex = payload.indexOf(";");
  if (separatorIndex < 0) {
    return null;
  }
  const encodedText = payload.slice(separatorIndex + 1);
  if (encodedText === "?") {
    return null;
  }
  return Buffer.from(encodedText, "base64").toString("utf8");
}

function extractClipboardSequences(buffer: string): ClipboardSequenceResult {
  let cursor = 0;
  let visibleOutput = "";
  const clipboardCopies: string[] = [];

  while (cursor < buffer.length) {
    const sequenceStart = buffer.indexOf(OSC_52_SEQUENCE_START, cursor);
    if (sequenceStart < 0) {
      const carryoverLength = getOsc52CarryoverLength(buffer.slice(cursor));
      const flushEnd = buffer.length - carryoverLength;
      visibleOutput += buffer.slice(cursor, flushEnd);
      return {
        visibleOutput,
        clipboardCopies,
        remainder: buffer.slice(flushEnd),
      };
    }

    visibleOutput += buffer.slice(cursor, sequenceStart);
    const terminator = findOsc52Terminator(buffer, sequenceStart + OSC_52_SEQUENCE_START.length);
    if (!terminator) {
      return {
        visibleOutput,
        clipboardCopies,
        remainder: buffer.slice(sequenceStart),
      };
    }

    const payload = buffer.slice(sequenceStart + OSC_52_SEQUENCE_START.length, terminator.index);
    const clipboardText = decodeClipboardPayload(payload);
    if (clipboardText !== null) {
      clipboardCopies.push(clipboardText);
    }
    cursor = terminator.index + terminator.length;
  }

  return {
    visibleOutput,
    clipboardCopies,
    remainder: "",
  };
}

export class SshTerminalBridge {
  private proc: ChildProcessWithoutNullStreams | null = null;
  private session: SshSession | null = null;
  private standaloneSession: SshServerSession | null = null;
  private workspace: Workspace | null = null;
  private standaloneExecutor: CommandExecutor | null = null;
  private commandCwd = "/";
  private closing = false;
  private ready = false;
  private connectPromise: Promise<void> | null = null;
  private closePromise: Promise<void> | null = null;
  private skipCloseStatusUpdate = false;
  private startupError: string | undefined;
  private stdoutBuffer = "";
  private stderrBuffer = "";

  constructor(
    private readonly sessionId: string,
    private readonly options: SshTerminalBridgeOptions,
    private readonly connectOptions: SshTerminalBridgeConnectOptions = {},
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
    this.stdoutBuffer = "";
    this.stderrBuffer = "";

    this.session = await sshSessionManager.getSession(this.sessionId);
    let spawnConfig: { command: string; args: string[]; env: NodeJS.ProcessEnv };
    if (this.connectOptions.sessionKind === "standalone") {
      const connection = await sshServerManager.getTerminalConnection(
        this.sessionId,
        this.connectOptions.credentialToken ?? "",
      );
      this.session = null;
      this.workspace = null;
      this.standaloneSession = await this.resolveStandaloneSessionMode(connection.session, connection.executor);
      this.standaloneExecutor = connection.executor;
      this.commandCwd = "/";
      await sshServerManager.markStatus(this.sessionId, "connecting");
      spawnConfig = buildStandaloneSshSpawnConfig(connection.target, this.standaloneSession);
    } else {
      if (!this.session) {
        throw new Error(`SSH session not found: ${this.sessionId}`);
      }

      this.workspace = await getWorkspace(this.session.config.workspaceId);
      if (!this.workspace) {
        throw new Error(`Workspace not found: ${this.session.config.workspaceId}`);
      }

      this.standaloneSession = null;
      this.standaloneExecutor = null;
      this.commandCwd = this.workspace.directory;

      this.session = await this.resolveWorkspaceSessionMode(this.session, this.workspace);
      await sshSessionManager.markStatus(this.sessionId, "connecting");

      spawnConfig = buildSshSpawnConfig(this.workspace, this.session);
    }
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
          this.flushBufferedOutput();
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
              await this.markStatus(nextStatus, error);
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
      this.handleOutputChunk(chunk, "stdout");
    });
    proc.stderr.on("data", (chunk: string) => {
      this.handleOutputChunk(chunk, "stderr");
    });
    proc.on("error", (error: Error) => {
      this.startupError = String(error);
      this.options.onError?.(error);
    });

    try {
      await this.waitForRemoteSessionReady();
      this.ready = true;
      await this.markStatus("connected");
    } catch (error) {
      const startupError = error instanceof Error ? error : new Error(String(error));
      this.ready = false;
      this.startupError = startupError.message;

      if (!this.closing) {
        this.options.onError?.(startupError);
        await this.markStatus("failed", startupError.message);
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
    if (!this.session && !this.standaloneSession) {
      throw new Error("SSH terminal is not connected");
    }
    await this.ensureReady();
    const normalizedCols = Math.max(2, Math.floor(cols));
    const normalizedRows = Math.max(1, Math.floor(rows));
    const executor = await this.getCommandExecutor();
    const resizeCommand = this.getConnectionMode() === "direct"
      ? buildDirectResizeCommand(this.getTrackedSessionId(), normalizedCols, normalizedRows)
      : buildPersistentSessionResizeCommand(this.getTrackedSessionId(), normalizedCols, normalizedRows);
    const result = await executor.exec("bash", [
      "-lc",
      resizeCommand,
    ], {
      cwd: this.commandCwd,
      timeout: DEFAULT_SSH_TERMINAL_COMMAND_TIMEOUT_MS,
    });
    if (!result.success) {
      throw new Error(result.stderr.trim() || result.stdout.trim() || "Failed to resize SSH terminal");
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

  private handleOutputChunk(chunk: string, stream: "stdout" | "stderr"): void {
    const buffer = (stream === "stdout" ? this.stdoutBuffer : this.stderrBuffer) + chunk;
    const parsed = extractClipboardSequences(buffer);
    let visibleOutput = parsed.visibleOutput;
    let remainder = parsed.remainder;
    const remainderBytes = Buffer.byteLength(remainder, "utf8");
    if (remainder.length > 0 && remainderBytes > MAX_PENDING_OSC_SEQUENCE_BYTES) {
      log.warn("Flushing oversized OSC 52 buffer", {
        sessionId: this.sessionId,
        stream,
        bufferedBytes: remainderBytes,
        limitBytes: MAX_PENDING_OSC_SEQUENCE_BYTES,
      });
      visibleOutput += remainder;
      remainder = "";
    }
    if (stream === "stdout") {
      this.stdoutBuffer = remainder;
    } else {
      this.stderrBuffer = remainder;
    }
    if (visibleOutput.length > 0) {
      this.options.onOutput(visibleOutput);
    }
    for (const clipboardText of parsed.clipboardCopies) {
      this.options.onClipboardCopy?.(clipboardText);
    }
  }

  private flushBufferedOutput(): void {
    if (this.stdoutBuffer.length > 0) {
      this.options.onOutput(this.stdoutBuffer);
      this.stdoutBuffer = "";
    }
    if (this.stderrBuffer.length > 0) {
      this.options.onOutput(this.stderrBuffer);
      this.stderrBuffer = "";
    }
  }

  private async waitForRemoteSessionReady(): Promise<void> {
    if (!this.session && !this.standaloneSession) {
      throw new Error("SSH terminal is not connected");
    }

    const executor = await this.getCommandExecutor();
    const deadline = Date.now() + (this.options.readyTimeoutMs ?? DEFAULT_SESSION_READY_TIMEOUT_MS);
    if (this.getConnectionMode() === "direct") {
      while (Date.now() < deadline) {
        if (!this.proc) {
          throw new Error("SSH terminal is not connected");
        }
        if (this.proc.exitCode !== null || this.proc.signalCode !== null) {
          throw new Error(this.startupError ?? "SSH terminal exited before the direct session was ready");
        }

        const result = await executor.exec("bash", [
          "-lc",
          buildDirectReadyCommand(this.getTrackedSessionId()),
        ], {
          cwd: this.commandCwd,
          timeout: this.getReadyProbeTimeout(deadline),
          logFailures: false,
        });
        if (result.success) {
          return;
        }

        await Bun.sleep(SESSION_READY_POLL_INTERVAL_MS);
      }

      throw new Error("Timed out waiting for the direct SSH shell to become ready");
    }

    while (Date.now() < deadline) {
      if (!this.proc) {
        throw new Error("SSH terminal is not connected");
      }
      if (this.proc.exitCode !== null || this.proc.signalCode !== null) {
        throw new Error(this.startupError ?? "SSH terminal exited before the persistent SSH session was ready");
      }

      const result = await executor.exec("bash", [
        "-lc",
        buildPersistentSessionReadyCommand({
          config: {
            id: this.getTrackedSessionId(),
            remoteSessionName: this.getRemoteSessionName(),
          },
        }),
      ], {
        cwd: this.commandCwd,
        timeout: this.getReadyProbeTimeout(deadline),
        logFailures: false,
      });
      if (result.success) {
        return;
      }

      await Bun.sleep(SESSION_READY_POLL_INTERVAL_MS);
    }

    throw new Error(`Timed out waiting for persistent SSH session ${this.getRemoteSessionName()} to become ready`);
  }

  private getReadyProbeTimeout(deadline: number): number {
    const remainingMs = Math.max(0, deadline - Date.now());
    return Math.min(MAX_SESSION_READY_PROBE_TIMEOUT_MS, remainingMs);
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

  private async markStatus(status: "connecting" | "connected" | "disconnected" | "failed", error?: string): Promise<void> {
    if (this.connectOptions.sessionKind === "standalone") {
      await sshServerManager.markStatus(this.sessionId, status, error);
      return;
    }
    await sshSessionManager.markStatus(this.sessionId, status, error);
  }

  private async getCommandExecutor(): Promise<CommandExecutor> {
    if (this.connectOptions.sessionKind === "standalone") {
      if (!this.standaloneExecutor) {
        throw new Error("SSH terminal is not connected");
      }
      return this.standaloneExecutor;
    }
    if (!this.workspace) {
      throw new Error("SSH terminal is not connected");
    }
    return await backendManager.getCommandExecutorAsync(this.workspace.id, this.workspace.directory);
  }

  private getConnectionMode(): SshConnectionMode {
    if (this.connectOptions.sessionKind === "standalone") {
      if (!this.standaloneSession) {
        throw new Error("SSH terminal is not connected");
      }
      return getEffectiveSshConnectionMode(this.standaloneSession);
    }
    if (!this.session) {
      throw new Error("SSH terminal is not connected");
    }
    return getEffectiveSshConnectionMode(this.session);
  }

  private async resolveWorkspaceSessionMode(session: SshSession, workspace: Workspace): Promise<SshSession> {
    const executor = await backendManager.getCommandExecutorAsync(workspace.id, workspace.directory);
    return await this.resolvePersistentBackendMode(
      session,
      executor,
      async (options) => await sshSessionManager.updateRuntimeConnectionState(session.config.id, options),
    );
  }

  private async resolveStandaloneSessionMode(
    session: SshServerSession,
    executor: CommandExecutor,
  ): Promise<SshServerSession> {
    return await this.resolvePersistentBackendMode(
      session,
      executor,
      async (options) => await sshServerManager.updateRuntimeConnectionState(session.config.id, options),
    );
  }

  private async resolvePersistentBackendMode<TSession extends {
    config: { id: string; connectionMode: SshConnectionMode };
    state: { runtimeConnectionMode?: SshConnectionMode; notice?: string };
  }>(
    session: TSession,
    executor: CommandExecutor,
    updateRuntimeState: (options: { runtimeConnectionMode?: SshConnectionMode; notice?: string }) => Promise<TSession>,
  ): Promise<TSession> {
    if (session.config.connectionMode === "direct") {
      if (session.state.runtimeConnectionMode || session.state.notice) {
        return await updateRuntimeState({});
      }
      return session;
    }

    const result = await executor.exec("bash", ["-lc", buildPersistentSessionBackendProbeCommand()], {
      cwd: "/",
      timeout: DEFAULT_SSH_TERMINAL_COMMAND_TIMEOUT_MS,
    });
    if (result.success) {
      if (session.state.runtimeConnectionMode || session.state.notice) {
        return await updateRuntimeState({});
      }
      return session;
    }

    if (!this.isMissingPersistentBackendResult(result.exitCode)) {
      const detail = result.stderr.trim() || result.stdout.trim();
      throw new Error(detail || "Failed to verify persistent SSH backend availability");
    }

    const notice = buildPersistentSessionBackendInstallHint();
    log.warn("Persistent SSH backend unavailable, falling back to direct mode", {
      sessionId: session.config.id,
      exitCode: result.exitCode,
      detail: result.stderr.trim() || result.stdout.trim(),
    });
    return await updateRuntimeState({
      runtimeConnectionMode: "direct",
      notice,
    });
  }

  private isMissingPersistentBackendResult(exitCode: number): boolean {
    return exitCode === 1 || exitCode === 127;
  }

  private getTrackedSessionId(): string {
    if (this.connectOptions.sessionKind === "standalone") {
      if (!this.standaloneSession) {
        throw new Error("SSH terminal is not connected");
      }
      return this.standaloneSession.config.id;
    }
    if (!this.session) {
      throw new Error("SSH terminal is not connected");
    }
    return this.session.config.id;
  }

  private getRemoteSessionName(): string {
    if (this.connectOptions.sessionKind === "standalone") {
      if (!this.standaloneSession) {
        throw new Error("SSH terminal is not connected");
      }
      return this.standaloneSession.config.remoteSessionName;
    }
    if (!this.session) {
      throw new Error("SSH terminal is not connected");
    }
    return this.session.config.remoteSessionName;
  }
}
