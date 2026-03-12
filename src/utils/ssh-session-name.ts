/**
 * Helpers for generating human-readable SSH session names.
 */

export function buildDefaultSshSessionName(workspaceName: string, existingSessionCount: number): string {
  const normalizedWorkspaceName = workspaceName.trim() || "SSH Session";
  const normalizedCount = Math.max(0, Math.floor(existingSessionCount));
  return `${normalizedWorkspaceName} ${String(normalizedCount + 1)}`;
}

export function buildLoopSshSessionName(loopName: string): string {
  const normalizedLoopName = loopName.trim() || "Loop";
  return `${normalizedLoopName} SSH`;
}
