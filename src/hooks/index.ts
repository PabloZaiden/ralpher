/**
 * Central export for all hooks.
 */

export { useWebSocket, useGlobalEvents, useLoopEvents, type WebSocketConnectionStatus, type UseWebSocketOptions, type UseWebSocketResult } from "./useWebSocket";
export { useLoops, type UseLoopsResult, type CreateLoopResult } from "./useLoops";
export { useLoop, type UseLoopResult } from "./useLoop";
export { useSshSessions, type UseSshSessionsResult } from "./useSshSessions";
export { useSshSession, type UseSshSessionResult } from "./useSshSession";
export { useLoopPortForwards, type UseLoopPortForwardsResult } from "./useLoopPortForwards";
export { useWorkspaceServerSettings, type UseWorkspaceServerSettingsResult } from "./useWorkspaceServerSettings";
export { useMarkdownPreference, type UseMarkdownPreferenceResult } from "./useMarkdownPreference";
export { useLogLevelPreference, type UseLogLevelPreferenceResult } from "./useLogLevelPreference";
export { useWorkspaces, type UseWorkspacesResult } from "./useWorkspaces";
export { useAgentsMdOptimizer, type UseAgentsMdOptimizerResult, type AgentsMdStatus, type OptimizeResult } from "./useAgentsMdOptimizer";
export { useCountdownReload, computeProgressPercent, KILL_SERVER_COUNTDOWN_SECONDS, type UseCountdownReloadResult } from "./useCountdownReload";
export { useToast, type ToastContextValue, type Toast, type ToastType, type ToastOptions } from "./useToast";
export { useLoopGrouping, groupLoopsByStatus, sectionConfig, type StatusGroups, type StatusSectionKey, type SectionConfig, type WorkspaceGroup, type UseLoopGroupingResult } from "./useLoopGrouping";
export { useDashboardModals, type ModalState, type UncommittedModalState, type UseDashboardModalsResult } from "./useDashboardModals";
export { useDashboardData, type UseDashboardDataResult } from "./useDashboardData";
export { useViewModePreference, type UseViewModePreferenceResult, type DashboardViewMode } from "./useViewModePreference";

// Shared loop action API functions
export {
  acceptLoopApi,
  pushLoopApi,
  createLoopPortForwardApi,
  deleteLoopPortForwardApi,
  listLoopPortForwardsApi,
  updateBranchApi,
  discardLoopApi,
  deleteLoopApi,
  purgeLoopApi,
  getLoopSshSessionApi,
  getOrCreateLoopSshSessionApi,
  setPendingPromptApi,
  clearPendingPromptApi,
  markMergedApi,
  sendPlanFeedbackApi,
  answerPlanQuestionApi,
  acceptPlanApi,
  discardPlanApi,
  addressReviewCommentsApi,
  setPendingApi,
  clearPendingApi,
  type CreatePortForwardRequest,
  type AcceptLoopResult,
  type PushLoopResult,
  type AddressCommentsResult,
  type SetPendingResult,
} from "./loopActions";
