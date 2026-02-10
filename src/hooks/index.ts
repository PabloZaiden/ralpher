/**
 * Central export for all hooks.
 */

export { useWebSocket, useGlobalEvents, useLoopEvents, type ConnectionStatus, type UseWebSocketOptions, type UseWebSocketResult } from "./useWebSocket";
export { useLoops, type UseLoopsResult, type CreateLoopResult } from "./useLoops";
export { useLoop, type UseLoopResult } from "./useLoop";
export { useWorkspaceServerSettings, type UseWorkspaceServerSettingsResult } from "./useWorkspaceServerSettings";
export { useMarkdownPreference, type UseMarkdownPreferenceResult } from "./useMarkdownPreference";
export { useLogLevelPreference, type UseLogLevelPreferenceResult } from "./useLogLevelPreference";
export { useWorkspaces, type UseWorkspacesResult } from "./useWorkspaces";
export { useAgentsMdOptimizer, type UseAgentsMdOptimizerResult, type AgentsMdStatus, type OptimizeResult } from "./useAgentsMdOptimizer";
export { useCountdownReload, computeProgressPercent, KILL_SERVER_COUNTDOWN_SECONDS, type UseCountdownReloadResult } from "./useCountdownReload";

// Shared loop action API functions
export {
  acceptLoopApi,
  pushLoopApi,
  discardLoopApi,
  deleteLoopApi,
  purgeLoopApi,
  setPendingPromptApi,
  clearPendingPromptApi,
  type AcceptLoopResult,
  type PushLoopResult,
} from "./loopActions";
