/**
 * Utility for sanitizing strings to be used as git branch names.
 */

/**
 * Sanitize a string to be used in a git branch name.
 * - Converts to lowercase
 * - Replaces any non-alphanumeric characters with hyphens
 * - Collapses multiple consecutive hyphens
 * - Removes leading and trailing hyphens
 * - Limits length to 40 characters
 * - Returns "unnamed" if the result would be empty (e.g., input is all special characters)
 */
export function sanitizeBranchName(name: string): string {
  const sanitized = name
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "-")  // Replace non-alphanumeric with -
    .replace(/-+/g, "-")          // Collapse multiple hyphens
    .replace(/^-|-$/g, "")        // Trim leading/trailing hyphens
    .slice(0, 40);                // Limit length

  return sanitized || "unnamed";
}
