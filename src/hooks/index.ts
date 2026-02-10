/**
 * Central export for all hooks.
 */

export { useWebSocket, useGlobalEvents, useLoopEvents, type WebSocketConnectionStatus, type UseWebSocketOptions, type UseWebSocketResult } from "./useWebSocket";
export { useLoops, type UseLoopsResult, type CreateLoopResult } from "./useLoops";
export { useLoop, type UseLoopResult } from "./useLoop";
export { useWorkspaceServerSettings, type UseWorkspaceServerSettingsResult } from "./useWorkspaceServerSettings";
export { useMarkdownPreference, type UseMarkdownPreferenceResult } from "./useMarkdownPreference";
export { useLogLevelPreference, type UseLogLevelPreferenceResult } from "./useLogLevelPreference";
export { useWorkspaces, type UseWorkspacesResult } from "./useWorkspaces";
export { useAgentsMdOptimizer, type UseAgentsMdOptimizerResult, type AgentsMdStatus, type OptimizeResult } from "./useAgentsMdOptimizer";
export { useToast, type ToastContextValue, type Toast, type ToastType, type ToastOptions } from "./useToast";
export { useLoopGrouping, groupLoopsByStatus, sectionConfig, type StatusGroups, type StatusSectionKey, type SectionConfig, type WorkspaceGroup, type UseLoopGroupingResult } from "./useLoopGrouping";
export { useDashboardModals, type ModalState, type UncommittedModalState, type UseDashboardModalsResult } from "./useDashboardModals";
export { useDashboardData, type UseDashboardDataResult } from "./useDashboardData";

// Shared loop action API functions
export {
  acceptLoopApi,
  pushLoopApi,
  discardLoopApi,
  deleteLoopApi,
  purgeLoopApi,
  setPendingPromptApi,
  clearPendingPromptApi,
  markMergedApi,
  sendPlanFeedbackApi,
  acceptPlanApi,
  discardPlanApi,
  addressReviewCommentsApi,
  setPendingApi,
  clearPendingApi,
  type AcceptLoopResult,
  type PushLoopResult,
  type AddressCommentsResult,
  type SetPendingResult,
} from "./loopActions";
