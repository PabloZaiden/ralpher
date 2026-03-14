/**
 * Core manager for saved SSH sessions on workspace hosts.
 */

import {
  DEFAULT_SSH_CONNECTION_MODE,
  type CreateSshSessionRequest,
  type SshConnectionMode,
  type SshSession,
  type SshSessionStatus,
  type UpdateSshSessionRequest,
  type Workspace,
} from "../types";
import { getWorkspace, touchWorkspace } from "../persistence/workspaces";
import {
  countSshSessionsByWorkspace,
  deleteSshSession,
  getSshSession,
  getSshSessionByLoopId,
  listSshSessions,
  listSshSessionsByWorkspace,
  saveSshSession,
} from "../persistence/ssh-sessions";
import { loadLoop } from "../persistence/loops";
import { backendManager } from "./backend-manager";
import { createLogger } from "./logger";
import { sshSessionEventEmitter } from "./event-emitter";
import { buildDefaultSshSessionName, buildLoopSshSessionName } from "../utils";
import { portForwardManager } from "./port-forward-manager";
import {
  buildPersistentSessionBackendProbeCommand,
  buildPersistentSessionDeleteCommand,
} from "./ssh-persistent-session";

const log = createLogger("core:ssh-session-manager");

function buildRemoteSessionName(id: string): string {
  return `ralpher-${id.replace(/-/g, "").slice(0, 24)}`;
}

async function requireSshWorkspace(workspaceId: string): Promise<Workspace> {
  const workspace = await getWorkspace(workspaceId);
  if (!workspace) {
    throw new Error(`Workspace not found: ${workspaceId}`);
  }
  if (workspace.serverSettings.agent.transport !== "ssh") {
    throw new Error("SSH sessions require a workspace configured with ssh transport");
  }
  return workspace;
}

export class SshSessionManager {
  async listSessions(workspaceId?: string): Promise<SshSession[]> {
    if (workspaceId) {
      return await listSshSessionsByWorkspace(workspaceId);
    }
    return await listSshSessions();
  }

  async getSession(id: string): Promise<SshSession | null> {
    return await getSshSession(id);
  }

  async getSessionByLoopId(loopId: string): Promise<SshSession | null> {
    return await getSshSessionByLoopId(loopId);
  }

  async createSession(request: CreateSshSessionRequest): Promise<SshSession> {
    const workspace = await requireSshWorkspace(request.workspaceId);
    const connectionMode = request.connectionMode ?? DEFAULT_SSH_CONNECTION_MODE;
    if (connectionMode !== "direct") {
      await this.ensurePersistentSessionBackendAvailable(workspace);
    }
    await touchWorkspace(workspace.id);

    const requestedName = request.name?.trim();
    const sessionName = requestedName && requestedName.length > 0
      ? requestedName
      : await this.buildDefaultSessionName(workspace);
    return await this.createAndSaveSession({
      workspace,
      name: sessionName,
      directory: workspace.directory,
      connectionMode,
    });
  }

  async updateSession(id: string, request: UpdateSshSessionRequest): Promise<SshSession> {
    const session = await this.requireSession(id);
    const updatedSession: SshSession = {
      config: {
        ...session.config,
        name: request.name.trim(),
        updatedAt: new Date().toISOString(),
      },
      state: session.state,
    };
    await saveSshSession(updatedSession);
    sshSessionEventEmitter.emit({
      type: "ssh_session.updated",
      sshSessionId: updatedSession.config.id,
      session: updatedSession,
      timestamp: updatedSession.config.updatedAt,
    });
    return updatedSession;
  }

  async deleteSession(id: string): Promise<boolean> {
    const session = await this.requireSession(id);
    await portForwardManager.deleteForwardsBySshSessionId(id);
    if (session.config.connectionMode !== "direct") {
      const workspace = await requireSshWorkspace(session.config.workspaceId);
      const executor = await backendManager.getCommandExecutorAsync(workspace.id, workspace.directory);
      const killResult = await executor.exec("bash", ["-lc", buildPersistentSessionDeleteCommand(session)], {
        cwd: workspace.directory,
      });
      if (!killResult.success) {
        throw new Error(killResult.stderr.trim() || killResult.stdout.trim() || "Failed to stop remote persistent SSH session");
      }
    }

    const deleted = await deleteSshSession(id);
    if (deleted) {
      sshSessionEventEmitter.emit({
        type: "ssh_session.deleted",
        sshSessionId: id,
        timestamp: new Date().toISOString(),
      });
    }
    return deleted;
  }

  async getOrCreateLoopSession(loopId: string): Promise<SshSession> {
    const existingSession = await getSshSessionByLoopId(loopId);
    if (existingSession) {
      return existingSession;
    }

    const { loopManager } = await import("./loop-manager");
    const loop = await loopManager.getLoop(loopId) ?? await loadLoop(loopId);
    if (!loop) {
      throw new Error(`Loop not found: ${loopId}`);
    }

    const workspace = await requireSshWorkspace(loop.config.workspaceId);
    await this.ensurePersistentSessionBackendAvailable(workspace);
    await touchWorkspace(workspace.id);

    const directory = loop.config.useWorktree
      ? loop.state.git?.worktreePath ?? null
      : loop.config.directory;
    if (!directory) {
      throw new Error("Loop working directory is not available");
    }

    return await this.createAndSaveSession({
      workspace,
      name: buildLoopSshSessionName(loop.config.name),
      directory,
      loopId,
      connectionMode: DEFAULT_SSH_CONNECTION_MODE,
    });
  }

  async deleteSessionByLoopId(loopId: string): Promise<boolean> {
    const session = await getSshSessionByLoopId(loopId);
    if (!session) {
      return false;
    }
    return await this.deleteSession(session.config.id);
  }

  async markStatus(id: string, status: SshSessionStatus, error?: string): Promise<SshSession> {
    const session = await this.requireSession(id);
    const updatedSession: SshSession = {
      config: {
        ...session.config,
        updatedAt: new Date().toISOString(),
      },
      state: {
        ...session.state,
        status,
        error: error?.trim() || undefined,
        lastConnectedAt: status === "connected"
          ? new Date().toISOString()
          : session.state.lastConnectedAt,
      },
    };
    await saveSshSession(updatedSession);
    sshSessionEventEmitter.emit({
      type: "ssh_session.status",
      sshSessionId: id,
      status,
      error: updatedSession.state.error,
      timestamp: updatedSession.config.updatedAt,
    });
    return updatedSession;
  }

  async ensurePersistentSessionBackendAvailable(workspace: Workspace): Promise<void> {
    const executor = await backendManager.getCommandExecutorAsync(workspace.id, workspace.directory);
    const result = await executor.exec("bash", ["-lc", buildPersistentSessionBackendProbeCommand()], {
      cwd: workspace.directory,
    });
    if (!result.success) {
      const detail = result.stderr.trim() || result.stdout.trim();
      const message = detail
        ? `dtach is not available on the remote host: ${detail}`
        : "dtach is not available on the remote host";
      throw new Error(message);
    }
    log.debug("Validated persistent SSH backend availability", {
      workspaceId: workspace.id,
      directory: workspace.directory,
      detail: result.stdout.trim(),
    });
  }

  private async buildDefaultSessionName(workspace: Workspace): Promise<string> {
    const existingSessionCount = await countSshSessionsByWorkspace(workspace.id);
    return buildDefaultSshSessionName(workspace.name, existingSessionCount);
  }

  private async createAndSaveSession(options: {
    workspace: Workspace;
    name: string;
    directory: string;
    loopId?: string;
    connectionMode: SshConnectionMode;
  }): Promise<SshSession> {
    const now = new Date().toISOString();
    const sessionId = crypto.randomUUID();
    const session: SshSession = {
      config: {
        id: sessionId,
        name: options.name,
        workspaceId: options.workspace.id,
        loopId: options.loopId,
        directory: options.directory,
        connectionMode: options.connectionMode,
        remoteSessionName: buildRemoteSessionName(sessionId),
        createdAt: now,
        updatedAt: now,
      },
      state: {
        status: "ready",
      },
    };

    try {
      await saveSshSession(session);
    } catch (error) {
      if (options.loopId && String(error).includes("ssh_sessions.loop_id")) {
        const existingSession = await getSshSessionByLoopId(options.loopId);
        if (existingSession) {
          return existingSession;
        }
      }
      throw error;
    }

    sshSessionEventEmitter.emit({
      type: "ssh_session.created",
      sshSessionId: session.config.id,
      session,
      timestamp: now,
    });
    return session;
  }

  private async requireSession(id: string): Promise<SshSession> {
    const session = await getSshSession(id);
    if (!session) {
      throw new Error(`SSH session not found: ${id}`);
    }
    return session;
  }
}

export const sshSessionManager = new SshSessionManager();
