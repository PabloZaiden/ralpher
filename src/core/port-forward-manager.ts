/**
 * Core manager for loop-scoped SSH port forwards.
 */

import { createServer } from "node:net";
import { spawn, type ChildProcess } from "node:child_process";
import type { PortForward, Workspace } from "../types";
import { getWorkspace, touchWorkspace } from "../persistence/workspaces";
import {
  deletePortForward,
  findPortForwardByWorkspaceAndRemotePort,
  getPortForward,
  listPortForwardsByLoopId,
  listPortForwardsBySshSessionId,
  listPortForwardsByStatuses,
  savePortForward,
} from "../persistence/forwarded-ports";
import { loadLoop } from "../persistence/loops";
import { createLogger } from "./logger";
import { sshSessionEventEmitter } from "./event-emitter";
import { buildSshCommandArgs } from "./remote-command-executor";

const log = createLogger("core:port-forward-manager");
const LOCAL_FORWARD_HOST = "127.0.0.1";
const REMOTE_FORWARD_HOST = "localhost";
const STARTUP_GRACE_MS = 300;
const STOP_TIMEOUT_MS = 2_000;
const LOCAL_PORT_RESERVATION_RETRY_LIMIT = 5;
const ACTIVE_PORT_FORWARD_STATUSES: Array<PortForward["state"]["status"]> = ["starting", "active", "stopping"];
const RESERVED_STATUSES = new Set<PortForward["state"]["status"]>(ACTIVE_PORT_FORWARD_STATUSES);

type PortForwardSpawnFactory = (options: {
  command: string;
  args: string[];
  env: NodeJS.ProcessEnv;
}) => ChildProcess;
type LocalPortAllocator = (reservedPorts: Set<number>) => Promise<number>;

interface RuntimeHandle {
  child: ChildProcess;
  deleting: boolean;
}

function getSshWorkspaceSettings(workspace: Workspace) {
  const settings = workspace.serverSettings.agent;
  if (settings.transport !== "ssh") {
    throw new Error("Port forwarding requires a workspace configured with ssh transport");
  }

  return settings;
}

function getWorkspaceSshHost(workspace: Workspace): string {
  const hostname = getSshWorkspaceSettings(workspace).hostname.trim();
  if (!hostname) {
    throw new Error("Port forwarding requires a workspace configured with an ssh hostname");
  }

  return hostname;
}

function buildSshTarget(workspace: Workspace): string {
  const settings = getSshWorkspaceSettings(workspace);
  const hostname = getWorkspaceSshHost(workspace);

  return settings.username?.trim()
    ? `${settings.username.trim()}@${hostname}`
    : hostname;
}

function buildSpawnConfig(workspace: Workspace, forward: PortForward): {
  command: string;
  args: string[];
  env: NodeJS.ProcessEnv;
} {
  const settings = getSshWorkspaceSettings(workspace);

  const sharedArgs = (authMode: "batch" | "password") => [
    "-N",
    "-T",
    "-o",
    "ExitOnForwardFailure=yes",
    "-L",
    `${LOCAL_FORWARD_HOST}:${forward.config.localPort}:${forward.config.remoteHost}:${forward.config.remotePort}`,
    ...buildSshCommandArgs({
      authMode,
      port: settings.port ?? 22,
      target: buildSshTarget(workspace),
      identityFile: settings.identityFile,
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

async function waitForProcessStartup(child: ChildProcess): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    let settled = false;
    let stderr = "";
    const timer = setTimeout(() => {
      if (settled) {
        return;
      }
      settled = true;
      cleanup();
      resolve();
    }, STARTUP_GRACE_MS);

    const onError = (error: Error) => {
      if (settled) {
        return;
      }
      settled = true;
      cleanup();
      reject(error);
    };

    const onExit = (code: number | null, signal: NodeJS.Signals | null) => {
      if (settled) {
        return;
      }
      settled = true;
      cleanup();
      const detail = stderr.trim() || `SSH tunnel exited early (code=${String(code)}, signal=${String(signal)})`;
      reject(new Error(detail));
    };

    const onStderr = (chunk: Buffer | string) => {
      stderr += chunk.toString();
    };

    const cleanup = () => {
      clearTimeout(timer);
      child.off("error", onError);
      child.off("exit", onExit);
      child.stderr?.off("data", onStderr);
    };

    child.on("error", onError);
    child.on("exit", onExit);
    child.stderr?.on("data", onStderr);
  });
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function allocateEphemeralPort(): Promise<number> {
  return await new Promise<number>((resolve, reject) => {
    const server = createServer();
    server.on("error", reject);
    server.listen(0, LOCAL_FORWARD_HOST, () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        server.close(() => reject(new Error("Failed to determine allocated local port")));
        return;
      }
      const port = address.port;
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve(port);
      });
    });
  });
}

async function assertPortIsBindable(port: number): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(port, LOCAL_FORWARD_HOST, () => {
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve();
      });
    });
  });
}

async function ensureLocalPortAvailable(reservedPorts: Set<number>): Promise<number> {
  for (let attempt = 0; attempt < 25; attempt++) {
    const candidate = await allocateEphemeralPort();
    if (reservedPorts.has(candidate)) {
      continue;
    }
    await assertPortIsBindable(candidate);
    return candidate;
  }

  throw new Error("Failed to allocate a local port for forwarding");
}

function isActiveLocalPortConstraintError(error: unknown): boolean {
  const message = String(error);
  return message.includes("UNIQUE constraint failed: forwarded_ports.local_port")
    || message.includes("idx_forwarded_ports_local_port_active");
}

function isActiveWorkspaceRemotePortConstraintError(error: unknown): boolean {
  const message = String(error);
  return message.includes("UNIQUE constraint failed: forwarded_ports.workspace_id, forwarded_ports.remote_port")
    || message.includes("idx_forwarded_ports_workspace_remote_port_active");
}

function buildDuplicateRemotePortError(remotePort: number): Error {
  return new Error(`Port ${remotePort} is already being forwarded for this workspace`);
}

async function assertWorkspaceRemotePortAvailable(workspaceId: string, remotePort: number): Promise<void> {
  const existing = await findPortForwardByWorkspaceAndRemotePort(
    workspaceId,
    remotePort,
    ACTIVE_PORT_FORWARD_STATUSES,
  );
  if (existing) {
    throw buildDuplicateRemotePortError(remotePort);
  }
}

async function waitForProcessExit(child: ChildProcess, timeoutMs: number): Promise<void> {
  if (child.exitCode !== null) {
    return;
  }

  await new Promise<void>((resolve) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) {
        return;
      }
      settled = true;
      resolve();
    }, timeoutMs);

    child.once("exit", () => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      resolve();
    });
  });
}

export class PortForwardManager {
  private readonly runtimeHandles = new Map<string, RuntimeHandle>();
  private spawnFactory: PortForwardSpawnFactory = ({ command, args, env }) => spawn(command, args, {
    env,
    stdio: ["ignore", "ignore", "pipe"],
  });
  private localPortAllocator: LocalPortAllocator = ensureLocalPortAvailable;
  private initialized = false;
  private initializing: Promise<void> | null = null;

  async initialize(): Promise<void> {
    if (this.initialized) {
      return;
    }
    if (this.initializing) {
      await this.initializing;
      return;
    }

    this.initializing = this.reconcilePersistedForwards();
    try {
      await this.initializing;
      this.initialized = true;
    } finally {
      this.initializing = null;
    }
  }

  async listLoopPortForwards(loopId: string): Promise<PortForward[]> {
    await this.initialize();
    return await listPortForwardsByLoopId(loopId);
  }

  async getPortForward(id: string): Promise<PortForward | null> {
    await this.initialize();
    return await getPortForward(id);
  }

  async createLoopPortForward(options: {
    loopId: string;
    remotePort: number;
  }): Promise<PortForward> {
    await this.initialize();

    const loop = await loadLoop(options.loopId);
    if (!loop) {
      throw new Error(`Loop not found: ${options.loopId}`);
    }

    const workspace = await getWorkspace(loop.config.workspaceId);
    if (!workspace) {
      throw new Error(`Workspace not found: ${loop.config.workspaceId}`);
    }

    await assertWorkspaceRemotePortAvailable(workspace.id, options.remotePort);
    await touchWorkspace(workspace.id);
    const { sshSessionManager } = await import("./ssh-session-manager");
    const linkedSession = await sshSessionManager.getSessionByLoopId(options.loopId);
    const forward = await this.reserveStartingForward({
      loopId: options.loopId,
      workspaceId: workspace.id,
      sshSessionId: linkedSession?.config.id,
      remoteHost: REMOTE_FORWARD_HOST,
      remotePort: options.remotePort,
    });
    this.emitForwardCreated(forward);

    try {
      const child = this.spawnForwardProcess(workspace, forward);
      this.attachRuntimeHandle(forward, child);
      await waitForProcessStartup(child);

      const activeForward: PortForward = {
        config: {
          ...forward.config,
          updatedAt: new Date().toISOString(),
        },
        state: {
          status: "active",
          pid: child.pid ?? undefined,
          connectedAt: new Date().toISOString(),
        },
      };
      await savePortForward(activeForward);
      this.emitForwardUpdated(activeForward);
      return activeForward;
    } catch (error) {
      const failedForward: PortForward = {
        config: {
          ...forward.config,
          updatedAt: new Date().toISOString(),
        },
        state: {
          status: "failed",
          error: String(error),
        },
      };
      this.runtimeHandles.delete(forward.config.id);
      await savePortForward(failedForward);
      this.emitForwardUpdated(failedForward);
      throw error;
    }
  }

  async deletePortForward(id: string): Promise<boolean> {
    await this.initialize();
    const forward = await getPortForward(id);
    if (!forward) {
      return false;
    }

    await this.stopForward(forward);
    const deleted = await deletePortForward(id);
    if (deleted) {
      sshSessionEventEmitter.emit({
        type: "ssh_session.port_forward.deleted",
        portForwardId: id,
        loopId: forward.config.loopId,
        sshSessionId: forward.config.sshSessionId,
        timestamp: new Date().toISOString(),
      });
    }
    return deleted;
  }

  async deleteForwardsByLoopId(loopId: string): Promise<void> {
    const forwards = await listPortForwardsByLoopId(loopId);
    for (const forward of forwards) {
      await this.deletePortForward(forward.config.id);
    }
  }

  async deleteForwardsBySshSessionId(sshSessionId: string): Promise<void> {
    const forwards = await listPortForwardsBySshSessionId(sshSessionId);
    for (const forward of forwards) {
      await this.deletePortForward(forward.config.id);
    }
  }

  setSpawnFactoryForTesting(factory: PortForwardSpawnFactory | null): void {
    this.spawnFactory = factory ?? (({ command, args, env }) => spawn(command, args, {
      env,
      stdio: ["ignore", "ignore", "pipe"],
    }));
    this.runtimeHandles.clear();
    this.initialized = false;
    this.initializing = null;
  }

  setLocalPortAllocatorForTesting(allocator: LocalPortAllocator | null): void {
    this.localPortAllocator = allocator ?? ensureLocalPortAvailable;
  }

  private spawnForwardProcess(workspace: Workspace, forward: PortForward): ChildProcess {
    const spawnConfig = buildSpawnConfig(workspace, forward);
    log.debug("Starting port forward", {
      portForwardId: forward.config.id,
      loopId: forward.config.loopId,
      localPort: forward.config.localPort,
      remoteHost: forward.config.remoteHost,
      remotePort: forward.config.remotePort,
      command: spawnConfig.command,
    });
    return this.spawnFactory(spawnConfig);
  }

  private attachRuntimeHandle(forward: PortForward, child: ChildProcess): void {
    const runtimeHandle: RuntimeHandle = {
      child,
      deleting: false,
    };
    this.runtimeHandles.set(forward.config.id, runtimeHandle);

    child.once("exit", (code, signal) => {
      const handle = this.runtimeHandles.get(forward.config.id);
      const deleting = handle?.deleting ?? false;
      this.runtimeHandles.delete(forward.config.id);
      void this.handleUnexpectedExit(forward.config.id, deleting, code, signal);
    });
  }

  private async handleUnexpectedExit(
    portForwardId: string,
    deleting: boolean,
    code: number | null,
    signal: NodeJS.Signals | null,
  ): Promise<void> {
    const forward = await getPortForward(portForwardId);
    if (!forward || deleting || !RESERVED_STATUSES.has(forward.state.status)) {
      return;
    }

    const nextStatus: PortForward = {
      config: {
        ...forward.config,
        updatedAt: new Date().toISOString(),
      },
      state: {
        status: "failed",
        error: `SSH tunnel exited unexpectedly (code=${String(code)}, signal=${String(signal)})`,
      },
    };
    await savePortForward(nextStatus);
    this.emitForwardUpdated(nextStatus);
  }

  private async stopForward(forward: PortForward): Promise<void> {
    const stoppingForward: PortForward = {
      config: {
        ...forward.config,
        updatedAt: new Date().toISOString(),
      },
      state: {
        ...forward.state,
        status: "stopping",
      },
    };
    await savePortForward(stoppingForward);
    this.emitForwardUpdated(stoppingForward);

    const handle = this.runtimeHandles.get(forward.config.id);
    if (handle) {
      handle.deleting = true;
      try {
        handle.child.kill("SIGTERM");
      } catch {
        // Ignore termination errors; cleanup continues below.
      }
      await waitForProcessExit(handle.child, STOP_TIMEOUT_MS);
      if (handle.child.exitCode === null) {
        try {
          handle.child.kill("SIGKILL");
        } catch {
          // Ignore force-kill failures during cleanup.
        }
      }
      this.runtimeHandles.delete(forward.config.id);
      return;
    }

    if (forward.state.pid && isProcessAlive(forward.state.pid)) {
      try {
        process.kill(forward.state.pid, "SIGTERM");
      } catch {
        // Ignore external-process termination failures during cleanup.
      }
    }
  }

  private async getReservedLocalPorts(): Promise<Set<number>> {
    const reserved = new Set<number>();
    const forwards = await listPortForwardsByStatuses(["starting", "active", "stopping"]);
    for (const forward of forwards) {
      reserved.add(forward.config.localPort);
    }
    return reserved;
  }

  private async reserveStartingForward(options: {
    loopId: string;
    workspaceId: string;
    sshSessionId?: string;
    remoteHost: string;
    remotePort: number;
  }): Promise<PortForward> {
    for (let attempt = 0; attempt < LOCAL_PORT_RESERVATION_RETRY_LIMIT; attempt++) {
      const reservedPorts = await this.getReservedLocalPorts();
      const localPort = await this.localPortAllocator(reservedPorts);
      const now = new Date().toISOString();
      const forward: PortForward = {
        config: {
          id: crypto.randomUUID(),
          loopId: options.loopId,
          workspaceId: options.workspaceId,
          sshSessionId: options.sshSessionId,
          remoteHost: options.remoteHost,
          remotePort: options.remotePort,
          localPort,
          createdAt: now,
          updatedAt: now,
        },
        state: {
          status: "starting",
        },
      };

      try {
        await savePortForward(forward);
        return forward;
      } catch (error) {
        if (isActiveWorkspaceRemotePortConstraintError(error)) {
          throw buildDuplicateRemotePortError(options.remotePort);
        }
        if (!isActiveLocalPortConstraintError(error) || attempt === LOCAL_PORT_RESERVATION_RETRY_LIMIT - 1) {
          throw error;
        }
        log.debug("Retrying port-forward reservation after local port conflict", {
          loopId: options.loopId,
          remoteHost: options.remoteHost,
          remotePort: options.remotePort,
          localPort,
          attempt: attempt + 1,
        });
      }
    }

    throw new Error("Failed to reserve a unique local port for forwarding");
  }

  private async reconcilePersistedForwards(): Promise<void> {
    const forwards = await listPortForwardsByStatuses(["starting", "active", "stopping"]);
    for (const forward of forwards) {
      if (forward.state.pid && isProcessAlive(forward.state.pid)) {
        try {
          process.kill(forward.state.pid, "SIGTERM");
        } catch {
          // Ignore kill failures; stale records will still be marked stopped below.
        }
      }

      const reconciledForward: PortForward = {
        config: {
          ...forward.config,
          updatedAt: new Date().toISOString(),
        },
        state: {
          status: "stopped",
          error: "Port forward was reset during server startup and must be recreated",
        },
      };
      await savePortForward(reconciledForward);
      this.emitForwardUpdated(reconciledForward);
    }
  }

  private emitForwardCreated(forward: PortForward): void {
    sshSessionEventEmitter.emit({
      type: "ssh_session.port_forward.created",
      portForwardId: forward.config.id,
      loopId: forward.config.loopId,
      sshSessionId: forward.config.sshSessionId,
      forward,
      timestamp: forward.config.createdAt,
    });
  }

  private emitForwardUpdated(forward: PortForward): void {
    sshSessionEventEmitter.emit({
      type: "ssh_session.port_forward.updated",
      portForwardId: forward.config.id,
      loopId: forward.config.loopId,
      sshSessionId: forward.config.sshSessionId,
      forward,
      timestamp: forward.config.updatedAt,
    });
    sshSessionEventEmitter.emit({
      type: "ssh_session.port_forward.status",
      portForwardId: forward.config.id,
      loopId: forward.config.loopId,
      sshSessionId: forward.config.sshSessionId,
      status: forward.state.status,
      error: forward.state.error,
      timestamp: forward.config.updatedAt,
    });
  }
}

export const portForwardManager = new PortForwardManager();
