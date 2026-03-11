/**
 * Core manager for persistent SSH tmux sessions.
 */

import type { CreateSshSessionRequest, SshSession, SshSessionStatus, UpdateSshSessionRequest, Workspace } from "../types";
import { getWorkspace, touchWorkspace } from "../persistence/workspaces";
import {
  deleteSshSession,
  getSshSession,
  listSshSessions,
  listSshSessionsByWorkspace,
  saveSshSession,
} from "../persistence/ssh-sessions";
import { backendManager } from "./backend-manager";
import { createLogger } from "./logger";
import { sshSessionEventEmitter } from "./event-emitter";

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

  async createSession(request: CreateSshSessionRequest): Promise<SshSession> {
    const workspace = await requireSshWorkspace(request.workspaceId);
    await this.ensureTmuxAvailable(workspace);
    await touchWorkspace(workspace.id);

    const now = new Date().toISOString();
    const sessionId = crypto.randomUUID();
    const session: SshSession = {
      config: {
        id: sessionId,
        name: request.name.trim(),
        workspaceId: workspace.id,
        directory: workspace.directory,
        remoteSessionName: buildRemoteSessionName(sessionId),
        createdAt: now,
        updatedAt: now,
      },
      state: {
        status: "ready",
      },
    };

    await saveSshSession(session);
    sshSessionEventEmitter.emit({
      type: "ssh_session.created",
      sshSessionId: session.config.id,
      session,
      timestamp: now,
    });
    return session;
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

  private async requireSession(id: string): Promise<SshSession> {
    const session = await getSshSession(id);
    if (!session) {
      throw new Error(`SSH session not found: ${id}`);
    }
    return session;
  }
}

export const sshSessionManager = new SshSessionManager();
