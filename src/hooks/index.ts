/**
 * Central export for all hooks.
 */

export { useWebSocket, useGlobalEvents, useLoopEvents, type ConnectionStatus, type UseWebSocketOptions, type UseWebSocketResult } from "./useWebSocket";
export { useLoops, type UseLoopsResult } from "./useLoops";
export { useLoop, type UseLoopResult } from "./useLoop";
export { useServerSettings, type UseServerSettingsResult } from "./useServerSettings";

// Shared loop action API functions (start kept for internal use only)
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
