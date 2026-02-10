/**
 * Prompt templates for loop creation.
 *
 * Each template provides a predefined prompt that can be selected from
 * a dropdown in the loop creation form. Templates may also specify
 * default form values (e.g., planMode) that are applied when selected.
 *
 * To add a new template, append an entry to the `PROMPT_TEMPLATES` array.
 */

/** Configuration defaults that a template can override on the form. */
export interface PromptTemplateDefaults {
  /** Whether plan mode should be enabled for this template. */
  planMode?: boolean;
}

/** A predefined prompt template for loop creation. */
export interface PromptTemplate {
  /** Unique identifier for the template. */
  id: string;
  /** Short display name shown in the dropdown. */
  name: string;
  /** Brief description shown as helper text when the template is selected. */
  description: string;
  /** The full prompt text that autofills the textarea. */
  prompt: string;
  /** Optional form defaults applied when the template is selected. */
  defaults?: PromptTemplateDefaults;
}

/**
 * Predefined prompt templates.
 *
 * Add new templates by appending to this array. Each template must have
 * a unique `id`. The order here determines the order in the dropdown.
 */
export const PROMPT_TEMPLATES: readonly PromptTemplate[] = [
  {
    id: "thorough-code-review",
    name: "Thorough Code Review",
    description:
      "Performs a comprehensive multi-layer code review and writes results to the code_review/ folder.",
    prompt: `Perform a thorough, multi-perspective code review of this codebase. Write your findings into the \`code_review/\` folder with the following structure:

1. **\`code_review/README.md\`** — Summary & guide
   - Overall codebase health score (A through F)
   - Finding summary tables by severity (Critical, Major, Minor, Suggestion) and by dimension
   - Top 10 architectural recommendations
   - How-to-read guide pointing readers to the other documents

2. **\`code_review/layers.md\`** — Architectural layer analysis
   - Identify the architectural layers (e.g., API, Core, Persistence, Frontend, etc.)
   - Analyze each layer: responsibilities, health, dependency violations, error propagation
   - Cross-layer analysis: coupling, bypasses, data flow issues

3. **\`code_review/functionalities.md\`** — End-to-end functionality analysis
   - Trace key features across all layers from UI to database
   - Identify cross-cutting concerns (code duplication, error handling patterns, etc.)
   - Analyze data flow, state management, and integration points

4. **\`code_review/modules.md\`** — Module-level analysis
   - Review each source directory as a cohesive module
   - Assess cohesion, coupling, API surface quality, test coverage
   - Identify dead code, missing abstractions, and refactoring opportunities

5. **\`code_review/files.md\`** — File-by-file analysis
   - Detailed findings for each file with exact line numbers
   - Categorize by dimensions: correctness, error handling, type safety, complexity, naming, duplication, performance, security
   - Each finding should include severity, description, and suggested fix

**Guidelines:**
- Be thorough and specific — reference exact file paths and line numbers
- Prioritize actionable findings over style nitpicks
- Use severity levels consistently: Critical (data loss, security), Major (correctness, maintainability), Minor (style, convention), Suggestion (improvements)
- Cross-reference findings across documents where they overlap
- Consider the project's own AGENTS.md conventions when evaluating code`,
    defaults: {
      planMode: true,
    },
  },
  {
    id: "fix-code-review-issues",
    name: "Fix Code Review Issues",
    description:
      "Reads the code_review/ folder and systematically fixes identified issues by priority.",
    prompt: `Read all files in the \`code_review/\` folder (README.md, layers.md, functionalities.md, modules.md, files.md) and fix the issues identified in the review.

**Approach:**
1. Start by reading \`code_review/README.md\` to understand the overall findings and top recommendations
2. Read \`code_review/files.md\` for specific file-level issues with line numbers
3. Prioritize fixes by severity: Critical first, then Major, then Minor
4. Skip Suggestion-level items unless they are quick wins

**Rules:**
- Fix the code, not the review — do not modify files in \`code_review/\`
- Ensure each fix doesn't break existing tests — run the test suite after each batch of related fixes
- Follow the coding conventions in AGENTS.md
- If a fix requires a larger refactor, note it in the plan but implement it incrementally
- Track which issues you've fixed in your status updates`,
    defaults: {
      planMode: true,
    },
  },
  {
    id: "fix-failing-tests",
    name: "Fix Failing Tests",
    description:
      "Runs the test suite and iteratively fixes code until all tests pass.",
    prompt: `Run the full test suite and fix any failing tests.

**Approach:**
1. Run \`bun run build\` first to check for build/type errors — fix any that appear
2. Run \`bun run test\` to identify all failing tests
3. For each failing test, analyze the failure to determine if the issue is in the application code or the test itself
4. Fix the application code to make tests pass — prefer fixing code over fixing tests
5. If a test is genuinely wrong (testing incorrect behavior), fix the test and document why
6. Re-run the full test suite after each batch of fixes to verify no regressions
7. Repeat until all tests pass

**Rules:**
- Always fix code to match test expectations, unless the test is clearly wrong
- Never delete or skip tests to make the suite pass
- Run the full suite (not individual tests) for final verification
- Follow the coding conventions in AGENTS.md`,
    defaults: {
      planMode: false,
    },
  },
  {
    id: "continue-planned-tasks",
    name: "Continue Planned Tasks",
    description:
      "Reads the .planning/ folder and continues executing the next pending task.",
    prompt: `Continue working on the planned tasks.

Read \`.planning/plan.md\` for the full plan and \`.planning/status.md\` for current progress. Pick up the next pending task and continue implementation.

Follow the standard workflow from AGENTS.md — update status after each completed task.`,
    defaults: {
      planMode: false,
    },
  },
] as const;

/**
 * Find a template by its ID.
 * Returns undefined if no template matches.
 */
export function getTemplateById(id: string): PromptTemplate | undefined {
  return PROMPT_TEMPLATES.find((t) => t.id === id);
}
