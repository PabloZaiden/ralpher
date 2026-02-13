/**
 * Conventional Commits utility module.
 *
 * Provides functions for formatting, parsing, and normalizing commit messages
 * that follow the Conventional Commits v1.0.0 specification.
 *
 * @see https://www.conventionalcommits.org/en/v1.0.0/
 */

/** Valid conventional commit types. */
export const CONVENTIONAL_COMMIT_TYPES = [
  "feat",
  "fix",
  "refactor",
  "docs",
  "style",
  "test",
  "build",
  "ci",
  "chore",
  "perf",
  "revert",
] as const;

export type ConventionalCommitType = (typeof CONVENTIONAL_COMMIT_TYPES)[number];

/** Parsed conventional commit message. */
export interface ParsedConventionalCommit {
  type: ConventionalCommitType;
  scope: string | undefined;
  description: string;
  body: string | undefined;
}

const COMMIT_TYPES_SET: ReadonlySet<string> = new Set(CONVENTIONAL_COMMIT_TYPES);

/**
 * Regex to parse a conventional commit first line.
 *
 * Captures:
 *   [1] type  — one of the allowed types
 *   [2] scope — optional, inside parentheses
 *   [3] description — the text after ": "
 */
const CONVENTIONAL_COMMIT_RE =
  /^([a-z]+)(?:\(([^)]*)\))?!?:\s+(.+)$/;

/**
 * Format a conventional commit message from its parts.
 *
 * @param type - Commit type (feat, fix, chore, etc.)
 * @param scope - Optional scope (e.g., "ralph")
 * @param description - Short description (will be trimmed)
 * @param body - Optional multi-line body
 * @returns A valid conventional commit message string
 */
export function formatConventionalCommit(
  type: ConventionalCommitType,
  scope: string | undefined,
  description: string,
  body?: string,
): string {
  const scopePart = scope ? `(${scope})` : "";
  const firstLine = `${type}${scopePart}: ${description.trim()}`;

  if (body && body.trim()) {
    return `${firstLine}\n\n${body.trim()}`;
  }
  return firstLine;
}

/**
 * Parse a conventional commit message string.
 *
 * @param message - The raw commit message
 * @returns Parsed commit or `null` if the message is not a valid conventional commit
 */
export function parseConventionalCommit(message: string): ParsedConventionalCommit | null {
  const lines = message.split("\n");
  const firstLine = lines[0]?.trim();
  if (!firstLine) return null;

  const match = CONVENTIONAL_COMMIT_RE.exec(firstLine);
  if (!match) return null;

  const [, rawType, scope, description] = match;
  if (!rawType || !description) return null;

  if (!COMMIT_TYPES_SET.has(rawType)) return null;

  // Body is everything after the first blank line
  let body: string | undefined;
  if (lines.length > 2 && lines[1]?.trim() === "") {
    body = lines.slice(2).join("\n").trim() || undefined;
  }

  return {
    type: rawType as ConventionalCommitType,
    scope: scope || undefined,
    description: description.trim(),
    body,
  };
}

/**
 * Normalize raw AI-generated commit output into a valid conventional commit.
 *
 * The AI is prompted to produce `type: description` (without scope). This
 * function validates the type, injects the configured scope, and returns a
 * well-formed conventional commit string.
 *
 * If the AI output cannot be parsed, falls back to `chore(scope): <raw>`.
 *
 * @param aiOutput - The raw string returned by the AI
 * @param scope - The scope to inject (e.g., "ralph")
 * @returns A valid conventional commit message string
 */
export function normalizeAiCommitMessage(aiOutput: string, scope: string | undefined): string {
  const trimmed = aiOutput.trim();
  if (!trimmed) {
    return formatConventionalCommit("chore", scope, "update code");
  }

  // Strip wrapping markdown code fences the AI sometimes adds
  const cleaned = trimmed
    .replace(/^```[^\n]*\n?/, "")
    .replace(/\n?```$/, "")
    .trim();

  const lines = cleaned.split("\n");
  const firstLine = lines[0]?.trim() ?? "";

  // Try to parse as conventional commit (AI may have included a scope or not)
  const parsed = parseConventionalCommit(cleaned);
  if (parsed) {
    // Valid conventional commit — replace scope with the configured one
    const body = parsed.body;
    return formatConventionalCommit(parsed.type, scope, parsed.description, body);
  }

  // Try a looser match: "type: description" where type is valid
  const looseMatch = /^([a-z]+):\s+(.+)$/i.exec(firstLine);
  if (looseMatch) {
    const [, rawType, description] = looseMatch;
    if (rawType && description && COMMIT_TYPES_SET.has(rawType.toLowerCase())) {
      const body = lines.length > 2 && lines[1]?.trim() === ""
        ? lines.slice(2).join("\n").trim() || undefined
        : undefined;
      return formatConventionalCommit(
        rawType.toLowerCase() as ConventionalCommitType,
        scope,
        description.trim(),
        body,
      );
    }
  }

  // Fallback: wrap raw message as chore
  // Truncate to keep first line under 72 chars
  const maxDescLen = 72 - "chore".length - (scope ? scope.length + 2 : 0) - 2; // 2 for ": "
  const truncated = firstLine.length > maxDescLen
    ? firstLine.slice(0, maxDescLen - 3) + "..."
    : firstLine;

  return formatConventionalCommit("chore", scope, truncated.toLowerCase());
}
