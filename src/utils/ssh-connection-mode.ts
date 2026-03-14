/**
 * Shared presentation helpers for SSH connection modes.
 */

import type { SshConnectionMode } from "../types";

export function getSshConnectionModeLabel(mode: SshConnectionMode): string {
  return mode === "direct" ? "Direct SSH" : "Persistent SSH";
}
