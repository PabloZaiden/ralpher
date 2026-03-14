import type {
  CreateSshServerRequest,
  SshServer,
  SshServerSession,
  UpdateSshServerRequest,
} from "../types";
import { createLogger } from "../lib/logger";
import { appFetch } from "../lib/public-path";
import {
  getStoredSshCredentialToken,
  getStoredSshServerCredential,
  storeSshServerPassword,
} from "../lib/ssh-browser-credentials";

const log = createLogger("sshServerActions");

async function apiCall<T = unknown>(
  url: string,
  options: RequestInit,
  actionName: string,
): Promise<T> {
  const response = await appFetch(url, options);
  if (!response.ok) {
    const errorData = await response.json() as { message?: string };
    throw new Error(errorData.message || `Failed to ${actionName.toLowerCase()}`);
  }
  return await response.json() as T;
}

async function resolveCredentialToken(serverId: string, password?: string): Promise<string> {
  const trimmedPassword = password?.trim();
  if (trimmedPassword) {
    await storeSshServerPassword(serverId, trimmedPassword);
  }

  const token = await getStoredSshCredentialToken(serverId);
  if (!token) {
    if (getStoredSshServerCredential(serverId)) {
      throw new Error("Stored SSH password is no longer valid. Enter the password again.");
    }
    throw new Error("Enter the SSH password for this server.");
  }
  return token;
}

export async function listSshServersApi(): Promise<SshServer[]> {
  return await apiCall<SshServer[]>("/api/ssh-servers", { method: "GET" }, "List SSH servers");
}

export async function listSshServerSessionsApi(serverId: string): Promise<SshServerSession[]> {
  return await apiCall<SshServerSession[]>(
    `/api/ssh-servers/${serverId}/sessions`,
    { method: "GET" },
    "List SSH server sessions",
  );
}

export async function createSshServerApi(request: CreateSshServerRequest): Promise<SshServer> {
  return await apiCall<SshServer>(
    "/api/ssh-servers",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(request),
    },
    "Create SSH server",
  );
}

export async function updateSshServerApi(id: string, request: UpdateSshServerRequest): Promise<SshServer> {
  return await apiCall<SshServer>(
    `/api/ssh-servers/${id}`,
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(request),
    },
    "Update SSH server",
  );
}

export async function deleteSshServerApi(id: string): Promise<boolean> {
  await apiCall(`/api/ssh-servers/${id}`, { method: "DELETE" }, "Delete SSH server");
  return true;
}

export async function createStandaloneSshSessionApi(options: {
  serverId: string;
  name?: string;
  password?: string;
}): Promise<SshServerSession> {
  const credentialToken = await resolveCredentialToken(options.serverId, options.password);
  return await apiCall<SshServerSession>(
    `/api/ssh-servers/${options.serverId}/sessions`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        credentialToken,
        ...(options.name?.trim() ? { name: options.name.trim() } : {}),
      }),
    },
    "Create standalone SSH session",
  );
}

export async function deleteStandaloneSshSessionApi(options: {
  sessionId: string;
  serverId: string;
  password?: string;
}): Promise<boolean> {
  const credentialToken = await resolveCredentialToken(options.serverId, options.password);
  await apiCall(
    `/api/ssh-server-sessions/${options.sessionId}`,
    {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ credentialToken }),
    },
    "Delete standalone SSH session",
  );
  return true;
}

export async function saveStandaloneSshServerPassword(serverId: string, password: string): Promise<boolean> {
  await storeSshServerPassword(serverId, password.trim());
  log.debug("Saved encrypted standalone SSH password to browser storage", { serverId });
  return true;
}
