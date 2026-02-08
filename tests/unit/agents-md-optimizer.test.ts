/**
 * Unit tests for the AGENTS.md optimizer module.
 */

import { test, expect, describe } from "bun:test";
import {
  analyzeAgentsMd,
  optimizeContent,
  previewOptimization,
  getRalpherSectionContent,
  RALPHER_OPTIMIZATION_VERSION,
} from "../../src/core/agents-md-optimizer";

describe("analyzeAgentsMd", () => {
  test("returns not optimized for null content", () => {
    const result = analyzeAgentsMd(null);
    expect(result.isOptimized).toBe(false);
    expect(result.currentVersion).toBeNull();
    expect(result.updateAvailable).toBe(true);
  });

  test("returns not optimized for empty string", () => {
    const result = analyzeAgentsMd("");
    expect(result.isOptimized).toBe(false);
    expect(result.currentVersion).toBeNull();
    expect(result.updateAvailable).toBe(true);
  });

  test("returns not optimized for whitespace-only content", () => {
    const result = analyzeAgentsMd("   \n  \n  ");
    expect(result.isOptimized).toBe(false);
    expect(result.currentVersion).toBeNull();
    expect(result.updateAvailable).toBe(true);
  });

  test("returns not optimized for AGENTS.md without marker", () => {
    const content = "# My Project\n\nSome guidelines here.\n";
    const result = analyzeAgentsMd(content);
    expect(result.isOptimized).toBe(false);
    expect(result.currentVersion).toBeNull();
    expect(result.updateAvailable).toBe(true);
  });

  test("returns optimized with current version when marker matches", () => {
    const content = `# My Project\n\n<!-- ralpher-optimized-v${RALPHER_OPTIMIZATION_VERSION} -->\n## Agentic Workflow\n`;
    const result = analyzeAgentsMd(content);
    expect(result.isOptimized).toBe(true);
    expect(result.currentVersion).toBe(RALPHER_OPTIMIZATION_VERSION);
    expect(result.updateAvailable).toBe(false);
  });

  test("returns updateAvailable when marker has older version", () => {
    const content = "# My Project\n\n<!-- ralpher-optimized-v0 -->\n## Old section\n";
    const result = analyzeAgentsMd(content);
    expect(result.isOptimized).toBe(true);
    expect(result.currentVersion).toBe(0);
    expect(result.updateAvailable).toBe(true);
  });

  test("returns not updateAvailable when marker has same version", () => {
    const content = `<!-- ralpher-optimized-v${RALPHER_OPTIMIZATION_VERSION} -->\n## Section\n`;
    const result = analyzeAgentsMd(content);
    expect(result.isOptimized).toBe(true);
    expect(result.currentVersion).toBe(RALPHER_OPTIMIZATION_VERSION);
    expect(result.updateAvailable).toBe(false);
  });
});

describe("optimizeContent", () => {
  test("creates content from null (no existing file)", () => {
    const result = optimizeContent(null);
    expect(result).toContain(`<!-- ralpher-optimized-v${RALPHER_OPTIMIZATION_VERSION} -->`);
    expect(result).toContain("## Agentic Workflow");
    expect(result).toContain(".planning/plan.md");
    expect(result).toContain(".planning/status.md");
    expect(result.endsWith("\n")).toBe(true);
  });

  test("creates content from empty string", () => {
    const result = optimizeContent("");
    expect(result).toContain(`<!-- ralpher-optimized-v${RALPHER_OPTIMIZATION_VERSION} -->`);
    expect(result).toContain("## Agentic Workflow");
  });

  test("appends to existing content without Ralpher section", () => {
    const existing = "# My Project\n\nSome existing guidelines.\n";
    const result = optimizeContent(existing);

    // Should preserve existing content
    expect(result).toContain("# My Project");
    expect(result).toContain("Some existing guidelines.");

    // Should have the Ralpher section appended
    expect(result).toContain(`<!-- ralpher-optimized-v${RALPHER_OPTIMIZATION_VERSION} -->`);
    expect(result).toContain("## Agentic Workflow");

    // Existing content should come before Ralpher section
    const existingIndex = result.indexOf("# My Project");
    const ralpherIndex = result.indexOf("<!-- ralpher-optimized-v");
    expect(existingIndex).toBeLessThan(ralpherIndex);
  });

  test("returns content unchanged when already at current version", () => {
    const ralpherSection = getRalpherSectionContent();
    const existing = `# My Project\n\n${ralpherSection}\n`;
    const result = optimizeContent(existing);

    expect(result).toBe(existing);
  });

  test("replaces old version section with new one", () => {
    const existing = [
      "# My Project",
      "",
      "<!-- ralpher-optimized-v0 -->",
      "## Agentic Workflow — Planning & Progress Tracking",
      "",
      "Old content that should be replaced.",
      "",
      "### Old subsection",
      "",
      "More old content.",
    ].join("\n");

    const result = optimizeContent(existing);

    // Should contain new version marker
    expect(result).toContain(`<!-- ralpher-optimized-v${RALPHER_OPTIMIZATION_VERSION} -->`);

    // Should NOT contain old version marker
    expect(result).not.toContain("<!-- ralpher-optimized-v0 -->");

    // Should NOT contain old content
    expect(result).not.toContain("Old content that should be replaced.");

    // Should preserve content before the section
    expect(result).toContain("# My Project");
  });

  test("replaces old version while preserving content after", () => {
    const existing = [
      "# My Project",
      "",
      "<!-- ralpher-optimized-v0 -->",
      "## Agentic Workflow — Planning & Progress Tracking",
      "",
      "Old ralpher content.",
      "",
      "## Other Section",
      "",
      "This should be preserved.",
    ].join("\n");

    const result = optimizeContent(existing);

    // Should have new version
    expect(result).toContain(`<!-- ralpher-optimized-v${RALPHER_OPTIMIZATION_VERSION} -->`);

    // Should preserve content after the Ralpher section
    expect(result).toContain("## Other Section");
    expect(result).toContain("This should be preserved.");

    // The other section should come after the Ralpher section
    const ralpherIndex = result.indexOf("<!-- ralpher-optimized-v");
    const otherIndex = result.indexOf("## Other Section");
    expect(ralpherIndex).toBeLessThan(otherIndex);
  });

  test("handles content that doesn't end with newline", () => {
    const existing = "# My Project\n\nNo trailing newline";
    const result = optimizeContent(existing);

    expect(result).toContain("# My Project");
    expect(result).toContain("<!-- ralpher-optimized-v");
  });

  test("idempotent - optimizing already optimized content returns same result", () => {
    const original = "# My Project\n\nGuidelines here.\n";
    const firstOptimize = optimizeContent(original);
    const secondOptimize = optimizeContent(firstOptimize);

    expect(secondOptimize).toBe(firstOptimize);
  });
});

describe("previewOptimization", () => {
  test("returns preview for missing file", () => {
    const preview = previewOptimization(null, false);

    expect(preview.fileExists).toBe(false);
    expect(preview.currentContent).toBe("");
    expect(preview.analysis.isOptimized).toBe(false);
    expect(preview.analysis.updateAvailable).toBe(true);
    expect(preview.proposedContent).toContain("<!-- ralpher-optimized-v");
    expect(preview.ralpherSection).toContain("## Agentic Workflow");
  });

  test("returns preview for existing file without optimization", () => {
    const content = "# My Project\n\nExisting content.\n";
    const preview = previewOptimization(content, true);

    expect(preview.fileExists).toBe(true);
    expect(preview.currentContent).toBe(content);
    expect(preview.analysis.isOptimized).toBe(false);
    expect(preview.analysis.updateAvailable).toBe(true);
    expect(preview.proposedContent).toContain("# My Project");
    expect(preview.proposedContent).toContain("<!-- ralpher-optimized-v");
  });

  test("returns preview for already optimized file", () => {
    const ralpherSection = getRalpherSectionContent();
    const content = `# My Project\n\n${ralpherSection}\n`;
    const preview = previewOptimization(content, true);

    expect(preview.fileExists).toBe(true);
    expect(preview.analysis.isOptimized).toBe(true);
    expect(preview.analysis.updateAvailable).toBe(false);
    // Proposed content should be the same as current
    expect(preview.proposedContent).toBe(content);
  });

  test("returns preview for outdated optimization", () => {
    const content = "# My Project\n\n<!-- ralpher-optimized-v0 -->\n## Agentic Workflow — Planning & Progress Tracking\n\nOld.\n";
    const preview = previewOptimization(content, true);

    expect(preview.fileExists).toBe(true);
    expect(preview.analysis.isOptimized).toBe(true);
    expect(preview.analysis.updateAvailable).toBe(true);
    expect(preview.proposedContent).toContain(`<!-- ralpher-optimized-v${RALPHER_OPTIMIZATION_VERSION} -->`);
    expect(preview.proposedContent).not.toContain("<!-- ralpher-optimized-v0 -->");
  });
});

describe("getRalpherSectionContent", () => {
  test("returns the Ralpher section string", () => {
    const section = getRalpherSectionContent();

    expect(section).toContain("<!-- ralpher-optimized-v");
    expect(section).toContain("## Agentic Workflow");
    expect(section).toContain(".planning/plan.md");
    expect(section).toContain(".planning/status.md");
    expect(section).toContain("Incremental Progress Tracking");
    expect(section).toContain("Pre-Compaction Persistence");
    expect(section).toContain("Goal Verification");
  });

  test("does NOT contain completion signals", () => {
    const section = getRalpherSectionContent();

    expect(section).not.toContain("COMPLETE");
    expect(section).not.toContain("<promise>");
    expect(section).not.toContain("unattended");
    expect(section).not.toContain("never ask");
  });

  test("contains the current version marker", () => {
    const section = getRalpherSectionContent();
    expect(section).toContain(`<!-- ralpher-optimized-v${RALPHER_OPTIMIZATION_VERSION} -->`);
  });
});
