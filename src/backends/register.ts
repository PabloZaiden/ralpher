/**
 * Registers the OpenCode backend in the global registry.
 * Import this module to make the opencode backend available.
 */

import { registerBackend } from "./registry";
import { OpenCodeBackend } from "./opencode";

/**
 * Register the OpenCode backend.
 * Call this once at application startup.
 */
export function registerOpenCodeBackend(): void {
  registerBackend("opencode", () => new OpenCodeBackend());
}

// Auto-register on import
registerOpenCodeBackend();
