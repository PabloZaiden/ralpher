/**
 * Core manager for standalone SSH servers and server-owned SSH sessions.
 */

import {
  DEFAULT_SSH_CONNECTION_MODE,
  type CreateSshServerRequest,
  type CreateSshServerSessionRequest,
  type DeleteSshServerSessionRequest,
  type SshConnectionMode,
  type SshServer,
  type SshServerConfig,
  type SshSessionStatus,
  type SshServerSession,
  type UpdateSshServerRequest,
  type UpdateSshSessionRequest,
} from "../types";
import type { CommandExecutor } from "./command-executor";
import {
  countSshServerSessionsByServerId,
  deleteSshServer,
  deleteSshServerSession,
  getSshServer,
  getSshServerConfig,
  getSshServerSession,
  listSshServerSessionsByServerId,
  listSshServers,
  saveSshServerConfig,
  saveSshServerSession,
} from "../persistence/ssh-servers";
import { buildDefaultSshSessionName } from "../utils";
import { sshServerKeyManager } from "./ssh-server-key-manager";
import { sshCredentialManager } from "./ssh-credential-manager";
import { createLogger } from "./logger";
import { CommandExecutorImpl } from "./remote-command-executor";
import { sshSessionEventEmitter } from "./event-emitter";
import type { SshConnectionTarget } from "./ssh-connection-target";
import { getSshConnectionTargetFromServer } from "./ssh-connection-target";

const log = createLogger("core:ssh-server-manager");

type SshServerExecutorFactory = (server: SshServerConfig, password: string) => CommandExecutor;

function buildRemoteSessionName(id: string): string {
  return `ralpher-${id.replace(/-/g, "").slice(0, 24)}`;
}

export class SshServerManager {
  private testExecutorFactory: SshServerExecutorFactory | null = null;

  async listServers(): Promise<SshServer[]> {
    return await listSshServers();
  }

  async getServer(id: string): Promise<SshServer | null> {
    return await getSshServer(id);
  }

  async createServer(request: CreateSshServerRequest): Promise<SshServer> {
    const now = new Date().toISOString();
    const config: SshServerConfig = {
      id: crypto.randomUUID(),
      name: request.name.trim(),
      address: request.address.trim(),
      username: request.username.trim(),
      createdAt: now,
      updatedAt: now,
    };
    await saveSshServerConfig(config);
    await sshServerKeyManager.ensurePublicKey(config.id);
    const server = await getSshServer(config.id);
    if (!server) {
      throw new Error(`Failed to reload SSH server after creation: ${config.id}`);
    }
    return server;
  }

  async updateServer(id: string, request: UpdateSshServerRequest): Promise<SshServer> {
    const existing = await this.requireServerConfig(id);
    await saveSshServerConfig({
      ...existing,
      ...(request.name !== undefined ? { name: request.name.trim() } : {}),
      ...(request.address !== undefined ? { address: request.address.trim() } : {}),
      ...(request.username !== undefined ? { username: request.username.trim() } : {}),
      updatedAt: new Date().toISOString(),
    });
    const updated = await getSshServer(id);
    if (!updated) {
      throw new Error(`Failed to reload SSH server after update: ${id}`);
    }
    return updated;
  }

  async deleteServer(id: string): Promise<boolean> {
    sshCredentialManager.clearTokensForServer(id);
    return await deleteSshServer(id);
  }

  async listSessions(serverId: string): Promise<SshServerSession[]> {
    await this.requireServerConfig(serverId);
    return await listSshServerSessionsByServerId(serverId);
  }

  async getSession(id: string): Promise<SshServerSession | null> {
    return await getSshServerSession(id);
  }

  async createSession(serverId: string, request: CreateSshServerSessionRequest): Promise<SshServerSession> {
    const server = await this.requireServerConfig(serverId);
    const connectionMode = this.getConnectionMode(request);
    const password = sshCredentialManager.consumeToken(serverId, request.credentialToken);
    if (connectionMode === "tmux") {
      await this.ensureTmuxAvailable(server, password);
    }

    const now = new Date().toISOString();
    const sessionCount = await countSshServerSessionsByServerId(serverId);
    const sessionId = crypto.randomUUID();
    const session: SshServerSession = {
      config: {
        id: sessionId,
        sshServerId: serverId,
        name: request.name?.trim() || buildDefaultSshSessionName(server.name, sessionCount),
        connectionMode,
        remoteSessionName: buildRemoteSessionName(sessionId),
        createdAt: now,
        updatedAt: now,
      },
      state: {
        status: "ready",
      },
    };
    await saveSshServerSession(session);
    return session;
  }

  async updateSession(id: string, request: UpdateSshSessionRequest): Promise<SshServerSession> {
    const session = await this.requireSession(id);
    const updated: SshServerSession = {
      config: {
        ...session.config,
        name: request.name.trim(),
        updatedAt: new Date().toISOString(),
      },
      state: session.state,
    };
    await saveSshServerSession(updated);
    return updated;
  }

  async deleteSession(id: string, request: DeleteSshServerSessionRequest): Promise<boolean> {
    const session = await this.requireSession(id);
    if (session.config.connectionMode === "tmux") {
      const server = await this.requireServerConfig(session.config.sshServerId);
      const credentialToken = request.credentialToken?.trim();
      if (!credentialToken) {
        throw new Error("SSH credential token is required to delete tmux-backed standalone SSH sessions");
      }
      const password = sshCredentialManager.consumeToken(server.id, credentialToken);
      const executor = this.buildExecutor(server, password);
      const result = await executor.exec("tmux", ["kill-session", "-t", session.config.remoteSessionName], {
        cwd: "/",
      });
      if (!result.success) {
        const stderr = result.stderr.trim();
        if (!stderr.includes("can't find session")) {
          throw new Error(stderr || result.stdout || "Failed to kill remote tmux session");
        }
      }
    }
    return await deleteSshServerSession(id);
  }

  async getTerminalConnection(
    sessionId: string,
    credentialToken: string,
  ): Promise<{ session: SshServerSession; server: SshServerConfig; target: SshConnectionTarget; executor: CommandExecutor }> {
    const session = await this.requireSession(sessionId);
    const server = await this.requireServerConfig(session.config.sshServerId);
    const trimmedToken = credentialToken.trim();
    if (!trimmedToken) {
      throw new Error("SSH credential token is required for standalone terminal connections");
    }
    const password = sshCredentialManager.consumeToken(server.id, trimmedToken);
    const target = getSshConnectionTargetFromServer(server, password);
    return {
      session,
      server,
      target,
      executor: this.buildExecutor(server, password),
    };
  }

  async markStatus(id: string, status: SshSessionStatus, error?: string): Promise<SshServerSession> {
    const session = await this.requireSession(id);
    const updatedSession: SshServerSession = {
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
    await saveSshServerSession(updatedSession);
    sshSessionEventEmitter.emit({
      type: "ssh_session.status",
      sshSessionId: id,
      status,
      error: updatedSession.state.error,
      timestamp: updatedSession.config.updatedAt,
    });
    return updatedSession;
  }

  private async ensureTmuxAvailable(server: SshServerConfig, password: string): Promise<void> {
    const executor = this.buildExecutor(server, password);
    const result = await executor.exec("tmux", ["-V"], { cwd: "/" });
    if (!result.success) {
      const detail = result.stderr.trim() || result.stdout.trim();
      throw new Error(detail ? `tmux is not available on the remote host: ${detail}` : "tmux is not available");
    }
    log.debug("Validated standalone SSH tmux availability", {
      serverId: server.id,
      address: server.address,
      version: result.stdout.trim(),
    });
  }

  setExecutorFactoryForTesting(factory: SshServerExecutorFactory | null): void {
    this.testExecutorFactory = factory;
  }

  private getConnectionMode(request: { connectionMode?: SshConnectionMode }): SshConnectionMode {
    return request.connectionMode ?? DEFAULT_SSH_CONNECTION_MODE;
  }

  private buildExecutor(server: SshServerConfig, password: string): CommandExecutor {
    if (this.testExecutorFactory) {
      return this.testExecutorFactory(server, password);
    }
    const sshTarget = getSshConnectionTargetFromServer(server, password);
    return new CommandExecutorImpl({
      provider: "ssh",
      directory: "/",
      host: sshTarget.host,
      port: sshTarget.port,
      user: sshTarget.username,
      password: sshTarget.password,
      identityFile: sshTarget.identityFile,
    });
  }

  private async requireServerConfig(id: string): Promise<SshServerConfig> {
    const server = await getSshServerConfig(id);
    if (!server) {
      throw new Error(`SSH server not found: ${id}`);
    }
    return server;
  }

  private async requireSession(id: string): Promise<SshServerSession> {
    const session = await getSshServerSession(id);
    if (!session) {
      throw new Error(`SSH server session not found: ${id}`);
    }
    return session;
  }
}

export const sshServerManager = new SshServerManager();
