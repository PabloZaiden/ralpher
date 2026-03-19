/**
 * ACP backend barrel re-export.
 */

// Re-export ConnectionInfo for backward compatibility
export type { ConnectionInfo } from "../types";

export { sanitizeSpawnArgsForLogging } from "./process-utils";
export { AcpBackend } from "./acp-backend";
