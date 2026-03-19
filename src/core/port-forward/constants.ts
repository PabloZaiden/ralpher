import type { PortForward } from "../../types";

export const LOCAL_FORWARD_HOST = "127.0.0.1";
export const REMOTE_FORWARD_HOST = "localhost";
export const STARTUP_GRACE_MS = 300;
export const STOP_TIMEOUT_MS = 2_000;
export const LOCAL_PORT_RESERVATION_RETRY_LIMIT = 5;
export const ACTIVE_PORT_FORWARD_STATUSES: Array<PortForward["state"]["status"]> = ["starting", "active", "stopping"];
export const RESERVED_STATUSES = new Set<PortForward["state"]["status"]>(ACTIVE_PORT_FORWARD_STATUSES);
