/**
 * Workspace server settings state management hook.
 * Provides access to workspace-specific server settings and connection status.
 *
 * IMPORTANT: This hook fetches fresh data from the API to avoid using stale in-memory data.
 * Always use the data from this hook rather than from the workspaces list.
 */

export type { UseWorkspaceServerSettingsResult } from "./workspace-server-settings";
export { useWorkspaceServerSettings } from "./workspace-server-settings";
