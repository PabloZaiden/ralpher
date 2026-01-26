/**
 * Central export for all utility functions.
 */

export {
  getStatusLabel,
  canAccept,
  isFinalState,
  isLoopActive,
  isLoopRunning,
} from "./loop-status";

/**
 * Sanitize a string to be used in a git branch name.
 * - Converts to lowercase
 * - Replaces any non-alphanumeric characters with hyphens
 * - Collapses multiple consecutive hyphens
 * - Removes leading and trailing hyphens
 * - Limits length to 40 characters
 */
export function sanitizeBranchName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "-")  // Replace non-alphanumeric with -
    .replace(/-+/g, "-")          // Collapse multiple hyphens
    .replace(/^-|-$/g, "")        // Trim leading/trailing hyphens
    .slice(0, 40);                // Limit length
}
