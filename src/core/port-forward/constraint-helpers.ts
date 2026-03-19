import { findPortForwardByWorkspaceAndRemotePort } from "../../persistence/forwarded-ports";
import { ACTIVE_PORT_FORWARD_STATUSES } from "./constants";

export function isActiveLocalPortConstraintError(error: unknown): boolean {
  const message = String(error);
  return message.includes("UNIQUE constraint failed: forwarded_ports.local_port")
    || message.includes("idx_forwarded_ports_local_port_active");
}

export function isActiveWorkspaceRemotePortConstraintError(error: unknown): boolean {
  const message = String(error);
  return message.includes("UNIQUE constraint failed: forwarded_ports.workspace_id, forwarded_ports.remote_port")
    || message.includes("idx_forwarded_ports_workspace_remote_port_active");
}

export function buildDuplicateRemotePortError(remotePort: number): Error {
  return new Error(`Port ${remotePort} is already being forwarded for this workspace`);
}

export async function assertWorkspaceRemotePortAvailable(workspaceId: string, remotePort: number): Promise<void> {
  const existing = await findPortForwardByWorkspaceAndRemotePort(
    workspaceId,
    remotePort,
    ACTIVE_PORT_FORWARD_STATUSES,
  );
  if (existing) {
    throw buildDuplicateRemotePortError(remotePort);
  }
}
