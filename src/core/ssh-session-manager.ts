/**
 * Core manager for persistent SSH tmux sessions.
 */

import type { CreateSshSessionRequest, SshSession, SshSessionStatus, UpdateSshSessionRequest, Workspace } from "../types";
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
    await this.ensureTmuxAvailable(workspace);
    await touchWorkspace(workspace.id);

    const requestedName = request.name?.trim();
    const sessionName = requestedName && requestedName.length > 0
      ? requestedName
      : await this.buildDefaultSessionName(workspace);
    return await this.createAndSaveSession({
      workspace,
      name: sessionName,
      directory: workspace.directory,
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
    const workspace = await requireSshWorkspace(session.config.workspaceId);
    const executor = await backendManager.getCommandExecutorAsync(workspace.id, workspace.directory);
    const killResult = await executor.exec("tmux", ["kill-session", "-t", session.config.remoteSessionName], {
      cwd: workspace.directory,
    });
    if (!killResult.success) {
      const stderr = killResult.stderr.trim();
      if (!stderr.includes("can't find session")) {
        throw new Error(stderr || killResult.stdout || "Failed to kill remote tmux session");
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
    await this.ensureTmuxAvailable(workspace);
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

  async ensureTmuxAvailable(workspace: Workspace): Promise<void> {
    const executor = await backendManager.getCommandExecutorAsync(workspace.id, workspace.directory);
    const result = await executor.exec("tmux", ["-V"], { cwd: workspace.directory });
    if (!result.success) {
      const detail = result.stderr.trim() || result.stdout.trim();
      const message = detail
        ? `tmux is not available on the remote host: ${detail}`
        : "tmux is not available on the remote host";
      throw new Error(message);
    }
    log.debug("Validated tmux availability", {
      workspaceId: workspace.id,
      directory: workspace.directory,
      version: result.stdout.trim(),
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
