/**
 * Unit tests for the conventional commits utility module.
 */

import { test, expect, describe } from "bun:test";
import {
  CONVENTIONAL_COMMIT_TYPES,
  formatConventionalCommit,
  parseConventionalCommit,
  normalizeAiCommitMessage,
} from "../../src/core/conventional-commits";

describe("CONVENTIONAL_COMMIT_TYPES", () => {
  test("includes all standard types", () => {
    expect(CONVENTIONAL_COMMIT_TYPES).toContain("feat");
    expect(CONVENTIONAL_COMMIT_TYPES).toContain("fix");
    expect(CONVENTIONAL_COMMIT_TYPES).toContain("refactor");
    expect(CONVENTIONAL_COMMIT_TYPES).toContain("docs");
    expect(CONVENTIONAL_COMMIT_TYPES).toContain("style");
    expect(CONVENTIONAL_COMMIT_TYPES).toContain("test");
    expect(CONVENTIONAL_COMMIT_TYPES).toContain("build");
    expect(CONVENTIONAL_COMMIT_TYPES).toContain("ci");
    expect(CONVENTIONAL_COMMIT_TYPES).toContain("chore");
    expect(CONVENTIONAL_COMMIT_TYPES).toContain("perf");
    expect(CONVENTIONAL_COMMIT_TYPES).toContain("revert");
  });

  test("has exactly 11 types", () => {
    expect(CONVENTIONAL_COMMIT_TYPES.length).toBe(11);
  });
});

describe("formatConventionalCommit", () => {
  test("formats with scope", () => {
    const result = formatConventionalCommit("feat", "ralph", "add auth endpoint");
    expect(result).toBe("feat(ralph): add auth endpoint");
  });

  test("formats without scope", () => {
    const result = formatConventionalCommit("fix", undefined, "resolve null pointer");
    expect(result).toBe("fix: resolve null pointer");
  });

  test("formats with empty string scope (treated as no scope)", () => {
    const result = formatConventionalCommit("chore", "", "update deps");
    expect(result).toBe("chore: update deps");
  });

  test("formats with body", () => {
    const result = formatConventionalCommit("feat", "ralph", "add login", "Detailed explanation\nof the change");
    expect(result).toBe("feat(ralph): add login\n\nDetailed explanation\nof the change");
  });

  test("formats with empty body (ignored)", () => {
    const result = formatConventionalCommit("fix", "ralph", "fix bug", "");
    expect(result).toBe("fix(ralph): fix bug");
  });

  test("formats with whitespace-only body (ignored)", () => {
    const result = formatConventionalCommit("fix", "ralph", "fix bug", "   \n  ");
    expect(result).toBe("fix(ralph): fix bug");
  });

  test("trims description whitespace", () => {
    const result = formatConventionalCommit("chore", "ralph", "  update deps  ");
    expect(result).toBe("chore(ralph): update deps");
  });
});

describe("parseConventionalCommit", () => {
  test("parses basic conventional commit", () => {
    const result = parseConventionalCommit("feat: add auth endpoint");
    expect(result).toEqual({
      type: "feat",
      scope: undefined,
      description: "add auth endpoint",
      body: undefined,
    });
  });

  test("parses with scope", () => {
    const result = parseConventionalCommit("feat(ralph): add auth endpoint");
    expect(result).toEqual({
      type: "feat",
      scope: "ralph",
      description: "add auth endpoint",
      body: undefined,
    });
  });

  test("parses with body", () => {
    const result = parseConventionalCommit("feat(ralph): add auth\n\nDetailed body here");
    expect(result).toEqual({
      type: "feat",
      scope: "ralph",
      description: "add auth",
      body: "Detailed body here",
    });
  });

  test("parses with multi-line body", () => {
    const result = parseConventionalCommit("fix: resolve crash\n\nLine 1\nLine 2\nLine 3");
    expect(result).toEqual({
      type: "fix",
      scope: undefined,
      description: "resolve crash",
      body: "Line 1\nLine 2\nLine 3",
    });
  });

  test("parses breaking change indicator", () => {
    const result = parseConventionalCommit("feat!: drop support for Node 12");
    expect(result).toEqual({
      type: "feat",
      scope: undefined,
      description: "drop support for Node 12",
      body: undefined,
    });
  });

  test("parses all valid types", () => {
    for (const type of CONVENTIONAL_COMMIT_TYPES) {
      const result = parseConventionalCommit(`${type}: some description`);
      expect(result).not.toBeNull();
      expect(result!.type).toBe(type);
    }
  });

  test("returns null for empty string", () => {
    expect(parseConventionalCommit("")).toBeNull();
  });

  test("returns null for non-conventional message", () => {
    expect(parseConventionalCommit("Add auth endpoint")).toBeNull();
  });

  test("returns null for unknown type", () => {
    expect(parseConventionalCommit("unknown: some description")).toBeNull();
  });

  test("returns null for missing colon", () => {
    expect(parseConventionalCommit("feat add auth endpoint")).toBeNull();
  });

  test("returns null for missing space after colon", () => {
    expect(parseConventionalCommit("feat:missing space")).toBeNull();
  });

  test("returns null for empty description after colon", () => {
    // The regex requires at least one char after ": "
    expect(parseConventionalCommit("feat: ")).toBeNull();
  });
});

describe("normalizeAiCommitMessage", () => {
  test("normalizes valid conventional commit and injects scope", () => {
    const result = normalizeAiCommitMessage("feat: add auth endpoint", "ralph");
    expect(result).toBe("feat(ralph): add auth endpoint");
  });

  test("replaces existing scope with configured one", () => {
    const result = normalizeAiCommitMessage("feat(wrong-scope): add auth", "ralph");
    expect(result).toBe("feat(ralph): add auth");
  });

  test("handles undefined scope (no scope in output)", () => {
    const result = normalizeAiCommitMessage("feat: add auth endpoint", undefined);
    expect(result).toBe("feat: add auth endpoint");
  });

  test("handles empty scope", () => {
    const result = normalizeAiCommitMessage("feat: add auth endpoint", "");
    expect(result).toBe("feat: add auth endpoint");
  });

  test("preserves body from AI output", () => {
    const result = normalizeAiCommitMessage("feat: add auth\n\nDetailed body", "ralph");
    expect(result).toBe("feat(ralph): add auth\n\nDetailed body");
  });

  test("falls back to chore for non-conventional message", () => {
    const result = normalizeAiCommitMessage("Add auth endpoint", "ralph");
    expect(result).toBe("chore(ralph): add auth endpoint");
  });

  test("falls back for empty input", () => {
    const result = normalizeAiCommitMessage("", "ralph");
    expect(result).toBe("chore(ralph): update code");
  });

  test("falls back for whitespace-only input", () => {
    const result = normalizeAiCommitMessage("   ", "ralph");
    expect(result).toBe("chore(ralph): update code");
  });

  test("strips markdown code fences", () => {
    const result = normalizeAiCommitMessage("```\nfeat: add auth endpoint\n```", "ralph");
    expect(result).toBe("feat(ralph): add auth endpoint");
  });

  test("strips markdown code fences with language tag", () => {
    const result = normalizeAiCommitMessage("```text\nfix: resolve crash\n```", "ralph");
    expect(result).toBe("fix(ralph): resolve crash");
  });

  test("handles case-insensitive type in loose match", () => {
    const result = normalizeAiCommitMessage("Fix: resolve crash", "ralph");
    expect(result).toBe("fix(ralph): resolve crash");
  });

  test("truncates very long fallback messages", () => {
    const longMessage = "A".repeat(200);
    const result = normalizeAiCommitMessage(longMessage, "ralph");
    // Should be a valid conventional commit and not exceed reasonable length
    expect(result).toMatch(/^chore\(ralph\): /);
    expect(result.split("\n")[0]!.length).toBeLessThanOrEqual(72);
  });

  test("handles all valid types from AI", () => {
    for (const type of CONVENTIONAL_COMMIT_TYPES) {
      const result = normalizeAiCommitMessage(`${type}: some change`, "ralph");
      expect(result).toBe(`${type}(ralph): some change`);
    }
  });
});
