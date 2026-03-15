/**
 * Central export for all utility functions.
 */

export {
  getStatusLabel,
  canAccept,
  isFinalState,
  isLoopActive,
  isLoopRunning,
  canJumpstart,
  isAwaitingFeedback,
  isArchivedLoop,
  getPlanningStatusLabel,
  isLoopPlanReady,
  getEntityLabel,
  isChat,
  type EntityLabels,
} from "./loop-status";

export { sanitizeBranchName } from "./sanitize-branch-name";

export { formatRelativeTime } from "./format";

export { buildDefaultSshSessionName, buildLoopSshSessionName } from "./ssh-session-name";

export { writeTextToClipboard } from "./clipboard";

export {
  getEffectiveSshConnectionMode,
  getSshConnectionModeLabel,
  isPersistentSshConnectionMode,
  isPersistentSshSession,
} from "./ssh-connection-mode";
