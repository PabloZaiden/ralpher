/**
 * SSH session and port-forward actions for loops.
 */

import type { SshSession, PortForward } from "../../types";
import { apiCall, apiAction } from "./helpers";

export interface CreatePortForwardRequest {
  remotePort: number;
}

/**
 * Fetch a loop's linked SSH session via the API.
 */
export async function getLoopSshSessionApi(loopId: string): Promise<SshSession> {
  return apiCall<SshSession>(
    `/api/loops/${loopId}/ssh-session`,
    { method: "GET" },
    "Fetch loop SSH session",
  );
}

/**
 * Get or create a loop's linked SSH session via the API.
 */
export async function getOrCreateLoopSshSessionApi(loopId: string): Promise<SshSession> {
  return apiCall<SshSession>(
    `/api/loops/${loopId}/ssh-session`,
    { method: "POST" },
    "Connect loop SSH session",
  );
}

/**
 * List a loop's forwarded ports via the API.
 */
export async function listLoopPortForwardsApi(loopId: string): Promise<PortForward[]> {
  return apiCall<PortForward[]>(
    `/api/loops/${loopId}/port-forwards`,
    { method: "GET" },
    "List loop port forwards",
  );
}

/**
 * Create a loop port forward via the API.
 */
export async function createLoopPortForwardApi(
  loopId: string,
  request: CreatePortForwardRequest,
): Promise<PortForward> {
  return apiCall<PortForward>(
    `/api/loops/${loopId}/port-forwards`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(request),
    },
    "Create loop port forward",
  );
}

/**
 * Delete a loop port forward via the API.
 */
export async function deleteLoopPortForwardApi(loopId: string, forwardId: string): Promise<boolean> {
  return apiAction(
    `/api/loops/${loopId}/port-forwards/${forwardId}`,
    "DELETE",
    "Delete loop port forward",
  );
}
