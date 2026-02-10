/**
 * Unit tests for prompt templates.
 */

import { describe, test, expect } from "bun:test";
import { PROMPT_TEMPLATES, getTemplateById } from "../../src/lib/prompt-templates";

describe("PROMPT_TEMPLATES", () => {
  test("contains at least 5 templates", () => {
    expect(PROMPT_TEMPLATES.length).toBeGreaterThanOrEqual(5);
  });

  test("all templates have unique IDs", () => {
    const ids = PROMPT_TEMPLATES.map((t) => t.id);
    const uniqueIds = new Set(ids);
    expect(uniqueIds.size).toBe(ids.length);
  });

  test("all templates have non-empty required fields", () => {
    for (const template of PROMPT_TEMPLATES) {
      expect(template.id.trim().length).toBeGreaterThan(0);
      expect(template.name.trim().length).toBeGreaterThan(0);
      expect(template.description.trim().length).toBeGreaterThan(0);
      expect(template.prompt.trim().length).toBeGreaterThan(0);
    }
  });

  test("template defaults have valid planMode values when set", () => {
    for (const template of PROMPT_TEMPLATES) {
      if (template.defaults?.planMode !== undefined) {
        expect(typeof template.defaults.planMode).toBe("boolean");
      }
    }
  });

  test("thorough-code-review template references code_review folder", () => {
    const template = PROMPT_TEMPLATES.find((t) => t.id === "thorough-code-review");
    expect(template).toBeDefined();
    expect(template!.prompt).toContain("code_review/");
    expect(template!.defaults?.planMode).toBe(true);
  });

  test("fix-code-review-issues template references code_review folder", () => {
    const template = PROMPT_TEMPLATES.find((t) => t.id === "fix-code-review-issues");
    expect(template).toBeDefined();
    expect(template!.prompt).toContain("code_review/");
    expect(template!.defaults?.planMode).toBe(true);
  });

  test("fix-failing-tests template references test commands", () => {
    const template = PROMPT_TEMPLATES.find((t) => t.id === "fix-failing-tests");
    expect(template).toBeDefined();
    expect(template!.prompt).toContain("test");
    expect(template!.defaults?.planMode).toBe(false);
  });

  test("continue-planned-tasks template references .planning folder", () => {
    const template = PROMPT_TEMPLATES.find((t) => t.id === "continue-planned-tasks");
    expect(template).toBeDefined();
    expect(template!.prompt).toContain(".planning/");
    expect(template!.defaults?.planMode).toBe(false);
  });

  test("review-fix-documentation template references README and documentation", () => {
    const template = PROMPT_TEMPLATES.find((t) => t.id === "review-fix-documentation");
    expect(template).toBeDefined();
    expect(template!.prompt).toContain("README");
    expect(template!.prompt).toContain("documentation");
    expect(template!.prompt).toContain("comments");
    expect(template!.defaults?.planMode).toBe(true);
  });
});

describe("getTemplateById", () => {
  test("returns template when ID matches", () => {
    const template = getTemplateById("thorough-code-review");
    expect(template).toBeDefined();
    expect(template!.id).toBe("thorough-code-review");
    expect(template!.name).toBe("Thorough Code Review");
  });

  test("returns undefined for non-existent ID", () => {
    const template = getTemplateById("non-existent-id");
    expect(template).toBeUndefined();
  });

  test("returns undefined for empty string", () => {
    const template = getTemplateById("");
    expect(template).toBeUndefined();
  });

  test("returns correct template for each known ID", () => {
    const expectedIds = [
      "thorough-code-review",
      "fix-code-review-issues",
      "fix-failing-tests",
      "continue-planned-tasks",
      "review-fix-documentation",
    ];

    for (const id of expectedIds) {
      const template = getTemplateById(id);
      expect(template).toBeDefined();
      expect(template!.id).toBe(id);
    }
  });
});
