/**
 * Central export for all hooks.
 */

export { useSSE, useGlobalSSE, useLoopSSE, type SSEStatus, type UseSSEOptions, type UseSSEResult } from "./useSSE";
export { useLoops, type UseLoopsResult } from "./useLoops";
export { useLoop, type UseLoopResult } from "./useLoop";
export { useServerSettings, type UseServerSettingsResult } from "./useServerSettings";

// Shared loop action API functions
export {
  startLoopApi,
  stopLoopApi,
  acceptLoopApi,
  pushLoopApi,
  discardLoopApi,
  deleteLoopApi,
  purgeLoopApi,
  setPendingPromptApi,
  clearPendingPromptApi,
  type StartLoopResult,
  type AcceptLoopResult,
  type PushLoopResult,
} from "./loopActions";
