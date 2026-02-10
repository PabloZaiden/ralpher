# Ralpher Code Review — Phased Improvement Plan

**Created:** 2026-02-10
**Source:** Code review findings from `README.md`, `files.md`, `modules.md`, `functionalities.md`, `layers.md`
**Overall Health:** C+ → Target: B+

---

## Phasing Strategy

Phases are ordered by priority: safety/correctness first, then architecture, then code quality, then polish. Each phase is self-contained — implement one phase, validate no regressions (`bun run build && bun run test`), then proceed to the next.

**Excluded findings (By Design / N/A / Resolved):**
- Fire-and-forget async patterns — By Design (intentional for long-running processes)
- Authentication on destructive endpoints — N/A (reverse proxy handles auth)
- `getStatusLabel()` missing draft case — Resolved
- Hook tests — Resolved (715 frontend tests added)
- Modal ARIA attributes — Resolved

---

## Phase 1: Data Integrity & Safety Fixes

**Goal:** Fix all critical and high-severity issues that can cause data loss, security vulnerabilities, or silent failures.
**Complexity:** Low
**Estimated findings addressed:** 5 Critical + 4 Major = 9

### 1.1 SQL Injection Fix
- **File:** `src/persistence/migrations/index.ts:57`
- **Finding:** `getTableColumns()` interpolates `tableName` directly into a PRAGMA query.
- **Fix:** Validate `tableName` against a whitelist of known table names, or use parameterized approach.
- **Refs:** `layers.md` § D1, `functionalities.md` § 10.1, `modules.md` § C3.1, `files.md` § persistence/migrations #1

### 1.2 Timer Leak in Name Generator
- **File:** `src/utils/name-generator.ts:112-115`
- **Finding:** `setTimeout` in `Promise.race` is never cleared when the main promise resolves first.
- **Fix:** Store the timer ID and clear it in a `.finally()` block.
- **Refs:** `modules.md` § C6.1, `files.md` § utils/name-generator #1

### 1.3 INSERT OR REPLACE → Upsert
- **File:** `src/persistence/loops.ts:289` (`saveLoop`)
- **Finding:** `INSERT OR REPLACE` triggers `ON DELETE CASCADE`, silently destroying review comments.
- **Fix:** Use `INSERT ... ON CONFLICT DO UPDATE` (upsert) to preserve related data.
- **Refs:** `layers.md` § D2, `functionalities.md` § 10.2, `files.md` § persistence/loops #4

### 1.4 JSON.parse Error Handling in rowToLoop
- **File:** `src/persistence/loops.ts:196-267`
- **Finding:** Multiple `JSON.parse` calls with no error handling — one corrupt row prevents listing ALL loops.
- **Fix:** Wrap each `JSON.parse` in try/catch with fallback defaults; log warnings for corrupt fields.
- **Refs:** `layers.md` § D3, `functionalities.md` § 10.3, `files.md` § persistence/loops #5

### 1.5 Dockerfile Security
- **File:** `Dockerfile`
- **Finding:** Container runs as root.
- **Fix:** Add `USER` instruction with non-root user.
- **Refs:** `files.md` § Dockerfile #1

### 1.6 Viewport Zoom Fix
- **File:** `src/index.html`
- **Finding:** `user-scalable=no` and `maximum-scale=1.0` prevent zooming — WCAG 2.1 Level AA violation.
- **Fix:** Remove these restrictions from the viewport meta tag.
- **Refs:** `files.md` § index.html #1

### 1.7 React Error Boundary
- **File:** `src/frontend.tsx`
- **Finding:** No Error Boundary at root — unrecoverable white screen on component errors.
- **Fix:** Add root-level ErrorBoundary component with fallback UI.
- **Refs:** `layers.md` § P2, `files.md` § frontend.tsx #1

### 1.8 Entry Point Error Handling
- **File:** `src/index.ts:16, 28`
- **Finding:** Top-level `await` without error handling — DB init failure crashes with unhandled rejection.
- **Fix:** Wrap initialization in try/catch with proper error logging and graceful exit.
- **Refs:** `files.md` § index.ts #1

### 1.9 StopPattern ReDoS Prevention
- **File:** `src/core/loop-engine.ts`
- **Finding:** `stopPattern` matching uses `new RegExp()` on user-provided patterns without try/catch.
- **Fix:** Wrap in try/catch; consider validating/sanitizing regex patterns.
- **Refs:** `files.md` § loop-engine #3

---

## Phase 2: Code Duplication Reduction (~540 LOC)

**Goal:** Extract shared helpers and components to eliminate systematic code duplication.
**Complexity:** Low-Medium
**Estimated findings addressed:** 15+

### 2.1 Extract `errorResponse()` Helper
- **Files:** `src/api/loops.ts`, `src/api/models.ts`, `src/api/settings.ts`
- **Finding:** Identical `errorResponse()` function duplicated in 3 API files.
- **Fix:** Move to a shared `src/api/helpers.ts` or add to `src/api/validation.ts`.
- **Savings:** ~30 LOC

### 2.2 Extract `apiCall<T>()` Helper for Loop Actions
- **File:** `src/hooks/loopActions.ts`
- **Finding:** 14 functions with near-identical boilerplate (fetch + check status + parse JSON + error handling).
- **Fix:** Extract a generic `apiCall<T>(url, options)` helper; reduce 14 functions to call sites.
- **Savings:** ~260 LOC

### 2.3 Extract Shared `ModelSelector` Component
- **Files:** `src/components/CreateLoopForm.tsx:494-521`, `src/components/LoopActionBar.tsx:87-119`
- **Finding:** Model grouping/sorting logic and `renderModelOptions()` duplicated.
- **Fix:** Create a `ModelSelector` component with shared grouping/sorting logic.
- **Savings:** ~100 LOC

### 2.4 Extract `requireWorkspace()` Helper
- **File:** `src/api/workspaces.ts:157-163, 286-292, 355-361, 388-394, 443-449`
- **Finding:** Workspace-lookup-and-404 pattern repeated 5 times.
- **Fix:** Extract a `requireWorkspace(workspaceId)` helper that returns workspace or throws 404.
- **Savings:** ~40 LOC

### 2.5 Consolidate Logger Constants
- **Files:** `src/core/logger.ts`, `src/lib/logger.ts`
- **Finding:** `LogLevelName`, `LOG_LEVELS`, `LOG_LEVEL_NAMES`, `DEFAULT_LOG_LEVEL` duplicated identically.
- **Fix:** Move shared constants to a common module (e.g., `src/types/logger.ts` or `src/utils/log-levels.ts`).
- **Savings:** ~40 LOC

### 2.6 Consolidate Branch Name Generation
- **Files:** `src/core/loop-manager.ts:~350, ~520`
- **Finding:** Duplicate branch name construction logic between `startLoop` and `startDraftLoop`.
- **Fix:** Extract to a shared `generateBranchName()` function.
- **Savings:** ~20 LOC

### 2.7 Consolidate Preflight Validation
- **File:** `src/api/loops.ts:169-216 vs 641-688`
- **Finding:** Uncommitted changes preflight check logic duplicated between POST (create) and POST draft/start.
- **Fix:** Extract `checkPreflightConditions(directory)` helper.
- **Savings:** ~50 LOC

### 2.8 Consolidate PATCH/PUT Handlers
- **File:** `src/api/loops.ts:375-426 vs 464-516`
- **Finding:** PATCH and PUT handler bodies are near-identical copy-paste.
- **Fix:** Extract shared field mapping and update logic.

### 2.9 Consolidate Git Endpoint Boilerplate
- **File:** `src/api/git.ts:83-129 vs 147-192`
- **Finding:** Two endpoints share near-identical boilerplate.
- **Fix:** Extract shared request parsing, validation, and git service setup.

---

## Phase 3: Error Handling & User Feedback

**Goal:** Ensure errors are never silently swallowed and users get meaningful feedback.
**Complexity:** Medium
**Estimated findings addressed:** 12+

### 3.1 Backend Logger Sub-Logger Sync
- **File:** `src/core/logger.ts`
- **Finding:** `setLogLevel()` only updates parent; sub-loggers retain their original level.
- **Fix:** Port the caching pattern from `src/lib/logger.ts` — cache sub-loggers and propagate level changes.
- **Refs:** `layers.md` § S3, `functionalities.md` § 7.3

### 3.2 Toast/Notification System for Frontend
- **File:** New component or integration
- **Finding:** Errors silently swallowed in catch blocks across Dashboard.tsx and other components.
- **Fix:** Add a toast notification system; replace silent catch blocks with user-visible error messages.
- **Refs:** `layers.md` § P10, `functionalities.md` § CF-4

### 3.3 Fix Silent Error Swallowing in API Handlers
- **Files:** `src/api/loops.ts:301-303, 318-320`, `src/api/models.ts`, `src/api/workspaces.ts`
- **Finding:** Empty catch blocks, inconsistent error logging.
- **Fix:** Add proper error logging; return error responses to clients.

### 3.4 Fix Error Response Consistency
- **Files:** `src/api/workspaces.ts`, `src/api/git.ts`, `src/api/loops.ts`
- **Finding:** Inconsistent error response shapes (`{message, error}` vs `{error, message}`).
- **Fix:** Standardize on a single error response shape using the shared `errorResponse()` from Phase 2.

### 3.5 Backend Error Handling Improvements
- **Files:** `src/backends/opencode/index.ts:298-301`, `src/core/remote-command-executor.ts`
- **Finding:** `getSession` swallows all errors as "not found"; `readFile` falls back to empty string silently.
- **Fix:** Distinguish error types; add proper logging.

### 3.6 Git Service Error Stack Preservation
- **File:** `src/core/git-service.ts`
- **Finding:** Many methods wrap errors in generic messages, losing stack trace information.
- **Fix:** Use `cause` option in Error constructor to chain error context.

---

## Phase 4: Architecture — State Machine & Layering

**Goal:** Introduce a centralized loop state machine and fix layering violations.
**Complexity:** Medium-High
**Estimated findings addressed:** 8+

### 4.1 Introduce Loop State Machine
- **Files:** New `src/core/loop-state-machine.ts`, modify `src/core/loop-manager.ts`, `src/core/loop-engine.ts`
- **Finding:** Status transitions validated ad-hoc across scattered methods. No centralized transition table.
- **Fix:** Create a state machine with a transition table defining all valid transitions. All state changes go through it.
- **Refs:** `layers.md` § B2, `functionalities.md` § CF-5

### 4.2 Fix API → Persistence Layer Bypass
- **File:** `src/api/loops.ts:22-23`
- **Finding:** API imports `updateLoopState`, `getActiveLoopByDirectory`, `getReviewComments` directly from persistence.
- **Fix:** Add query/mutation methods to LoopManager; route API calls through Core layer.
- **Refs:** `layers.md` § A3, A4, `functionalities.md` § CF-2

### 4.3 Fix Shared → External Reverse Dependency
- **Files:** `src/types/loop.ts`, `src/types/events.ts`
- **Finding:** Domain type files import `TodoItem` from `../backends/types` — reverse dependency.
- **Fix:** Move `TodoItem` to `src/types/` or define a local interface; backends should import from types, not vice versa.

### 4.4 Fix Direct State Mutation in API Handler
- **File:** `src/api/loops.ts:690-728`
- **Finding:** Draft/start handler directly mutates `loop.state.status` and `loop.state.planMode`, bypassing LoopManager.
- **Fix:** Add a `startDraft()` method to LoopManager that handles state transitions properly.

---

## Phase 5: Component Decomposition & Complexity Reduction

**Goal:** Break apart god components and god methods into focused, testable units.
**Complexity:** Medium-High
**Estimated findings addressed:** 8+

### 5.1 Decompose Dashboard.tsx
- **File:** `src/components/Dashboard.tsx` (1,118 LOC, 26 state variables)
- **Fix:** Extract into:
  - `DashboardHeader` — workspace selector, settings buttons, create loop trigger
  - `LoopGrid` — loop grouping by status, rendering LoopCards
  - `DashboardModals` — aggregate modal state management
  - `useDashboardData` hook — data fetching (config, health, models, branches, preferences)
  - `useLoopGrouping` hook — grouping/sorting logic with memoization
- **Refs:** `layers.md` § P1, `modules.md` § C7.1

### 5.2 Decompose `acceptLoop()` Method
- **File:** `src/core/loop-manager.ts:~600-800`
- **Finding:** ~200 LOC handling merge, cleanup, branch deletion, and state transitions in one massive method.
- **Fix:** Extract sub-methods: `mergeLoopBranch()`, `cleanupLoopBranch()`, `finalizeLoopState()`.
- **Refs:** `layers.md` § B4, `modules.md` § C1.8

### 5.3 Decompose `runIteration()` Method
- **File:** `src/core/loop-engine.ts`
- **Finding:** ~250 LOC handling prompt building, sending, response processing, logging, and state updates.
- **Fix:** Extract: `buildIterationPrompt()`, `sendAndProcessResponse()`, `updateIterationState()`.
- **Refs:** `layers.md` § B5, `modules.md` § C1.9

### 5.4 Reduce `translateEvent()` Parameters
- **File:** `src/backends/opencode/index.ts`
- **Finding:** Function has 8 parameters.
- **Fix:** Bundle into a context object: `TranslateEventContext`.

### 5.5 Extract Prompt Building
- **File:** `src/core/loop-engine.ts`
- **Finding:** Duplicate prompt-building logic between `start()` and `runIteration()`.
- **Fix:** Extract `PromptBuilder` class or module.

---

## Phase 6: Test Coverage Gaps

**Goal:** Add tests for untested critical modules.
**Complexity:** Medium
**Estimated findings addressed:** 8+

### 6.1 Tests for `loop-status.ts`
- **File:** `src/utils/loop-status.ts`
- **Finding:** 0% test coverage despite containing critical UI logic.
- **Tests:** `getStatusLabel()`, `isLoopRunning()`, `isLoopTerminal()`, `getStatusColor()` for all status values.

### 6.2 Tests for `event-stream.ts`
- **File:** `src/utils/event-stream.ts`
- **Finding:** 0% test coverage for a concurrency primitive.
- **Tests:** Producer/consumer flow, buffer behavior, `end()`/`fail()` semantics, backpressure behavior.

### 6.3 Tests for `sanitizeBranchName`
- **File:** `src/utils/index.ts`
- **Finding:** No tests; function can return empty string for all-special-character input.
- **Tests:** Normal input, special characters, empty string edge case, unicode, length limits.

### 6.4 Tests for Git API Endpoints
- **File:** `src/api/git.ts`
- **Finding:** No API tests for git status and branch listing endpoints.
- **Tests:** Success cases, non-git directory, missing directory, invalid parameters.

### 6.5 Tests for WebSocket API
- **File:** `src/api/websocket.ts`
- **Finding:** No tests for WebSocket upgrade, message routing, or connection lifecycle.
- **Tests:** Connection upgrade, event subscription, message parsing, connection cleanup.

### 6.6 Improve Backend Tests
- **File:** `src/backends/opencode/`
- **Finding:** Tests mostly cover "not connected" error throwing — minimal positive-path coverage.
- **Tests:** Connection flow, event translation, prompt sending, session management.

---

## Phase 7: Type Safety & Dead Code Cleanup

**Goal:** Improve type safety at boundaries and remove dead code.
**Complexity:** Low
**Estimated findings addressed:** 20+

### 7.1 Remove Dead Type Aliases
- **Files:** `src/types/schemas/loop.ts`, `src/types/schemas/workspace.ts`, `src/types/schemas/model.ts`, `src/types/schemas/preferences.ts`, `src/types/schemas/index.ts`
- **Finding:** 16 dead `*Input` type aliases never imported.
- **Fix:** Remove them and their barrel re-exports.

### 7.2 Remove Dead `LogEntry` Type
- **File:** `src/types/api.ts:249-258`
- **Finding:** `LogEntry` interface never imported — dead code.
- **Fix:** Remove it.

### 7.3 Remove Dead `getServerUrl`
- **File:** `src/backends/opencode/index.ts:1011-1015`
- **Finding:** Dead code with `unknown` cast breaking encapsulation.
- **Fix:** Remove the function.

### 7.4 Remove Vestigial `paths.ts`
- **File:** `src/persistence/paths.ts`
- **Finding:** Vestigial module — functions just delegate to `database.ts` with no added value.
- **Fix:** Remove and update imports to use `database.ts` directly.

### 7.5 Type Backend Interface Returns
- **File:** `src/backends/types.ts`
- **Finding:** `getSdkClient()` returns `unknown`, `getModels()` returns `unknown[]`.
- **Fix:** Add proper return types or use generics.

### 7.6 Fix `ModelInfo` Type Duplication
- **Files:** `src/backends/types.ts`, `src/types/api.ts`
- **Finding:** `ModelInfo` defined in both files with identical shape.
- **Fix:** Single source of truth in `src/types/api.ts`; backend imports from there.

### 7.7 Fix Barrel Export Consistency
- **Files:** `src/persistence/index.ts`, `src/types/index.ts`
- **Finding:** Missing re-exports (`workspaces.ts` not in persistence barrel, `settings.ts` not in types barrel).
- **Fix:** Add missing re-exports.

### 7.8 Rename `ConnectionStatus` to Avoid Collision
- **Files:** `src/types/settings.ts`, `src/hooks/useWebSocket.ts`
- **Finding:** Both define `ConnectionStatus` with different meanings.
- **Fix:** Rename one (e.g., `ServerConnectionStatus` in settings.ts).

### 7.9 Remove Dead CSS Animations
- **File:** `src/index.css`
- **Finding:** `slide` and `spin` animations may be unused.
- **Fix:** Verify and remove if dead.

### 7.10 Remove Unused Path Alias
- **File:** `tsconfig.json`
- **Finding:** `@/*` path alias defined but never used.
- **Fix:** Remove it.

### 7.11 Clean Up `sanitizeBranchName` Location
- **File:** `src/utils/index.ts`
- **Finding:** Defined inline in barrel file — breaks organizational pattern.
- **Fix:** Move to its own module file.

### 7.12 Fix Empty Branch Name Edge Case
- **File:** `src/utils/index.ts` (or new module)
- **Finding:** `sanitizeBranchName` can return empty string for all-special-character input.
- **Fix:** Add fallback to a default branch name.

---

## Phase 8: Performance & Resource Management

**Goal:** Fix unbounded buffers, add memoization, and address resource leaks.
**Complexity:** Low-Medium
**Estimated findings addressed:** 8+

### 8.1 Event Stream Buffer Limits
- **File:** `src/utils/event-stream.ts`
- **Finding:** `items` buffer can grow unboundedly.
- **Fix:** Add configurable max buffer size with backpressure or drop policy.

### 8.2 Dashboard Memoization
- **File:** `src/components/Dashboard.tsx` (or extracted hooks after Phase 5)
- **Finding:** `groupLoopsByStatus` and `workspaceGroups` computed on every render.
- **Fix:** Wrap in `useMemo` with proper dependency arrays.

### 8.3 LogViewer Memoization
- **File:** `src/components/LogViewer.tsx:144-168`
- **Finding:** Entries array rebuilt and sorted on every render.
- **Fix:** Wrap in `useMemo`.

### 8.4 Loop Engine Log Buffer Limits
- **File:** `src/core/loop-engine.ts`
- **Finding:** `logs` array grows unboundedly during long-running loops.
- **Fix:** Add ring buffer or max size with oldest-entry eviction.

### 8.5 useLoop Data Growth
- **File:** `src/hooks/useLoop.ts`
- **Finding:** `messages`, `toolCalls`, `logs`, `todos` arrays grow unboundedly.
- **Fix:** Add pagination or windowing for very long-running loops.

### 8.6 AbortController for Hooks
- **Files:** `src/hooks/useLoop.ts`, `src/hooks/useLoops.ts`
- **Finding:** No cancellation of in-flight fetch requests on unmount.
- **Fix:** Add AbortController; abort on cleanup.

### 8.7 WebSocket Connection Limits
- **File:** `src/api/websocket.ts`
- **Finding:** No connection limit.
- **Fix:** Track active connections; reject/close oldest when limit exceeded.

---

## Phase 9: Minor Consistency & Polish

**Goal:** Address remaining minor issues for consistency and code health.
**Complexity:** Low
**Estimated findings addressed:** 20+

### 9.1 Workspaces Handler Pattern Consistency
- **File:** `src/api/workspaces.ts`
- **Finding:** Mix of named-method-handler and single-function-with-switch patterns.
- **Fix:** Standardize on the named-method pattern used by other API files.

### 9.2 Logger Initialization Consistency
- **Files:** Various API files
- **Finding:** Some use `createLogger("api:xyz")`, some use `import { log }`.
- **Fix:** Standardize on `createLogger` pattern for sub-module loggers.

### 9.3 Build Script Bun API Usage
- **File:** `src/build.ts`
- **Finding:** Uses `fs` (Node API) instead of `Bun.file`/`Bun.$`.
- **Fix:** Replace with Bun APIs per project conventions.

### 9.4 Package.json Fixes
- **File:** `package.json`
- **Finding:** Zod uses caret range; build script uses `;` instead of `&&`.
- **Fix:** Pin zod version; use `&&` in build script.

### 9.5 Dynamic Import Cleanup
- **File:** `src/api/loops.ts:147`, `src/persistence/database.ts:67, 284`
- **Finding:** Dynamic `import()` should be static; `fs/promises` should use Bun APIs.
- **Fix:** Convert to static imports; use Bun APIs where applicable.

### 9.6 Focus Trapping in Modal
- **File:** `src/components/common/Modal.tsx`
- **Finding:** No focus trapping — keyboard users can tab outside modal.
- **Fix:** Add focus trap using a library or manual implementation.

### 9.7 PlanReviewPanel Modal
- **File:** `src/components/PlanReviewPanel.tsx:224-251`
- **Finding:** Custom modal bypasses shared Modal component.
- **Fix:** Use shared Modal component for consistency.

### 9.8 Review Comments in Database Module
- **File:** `src/persistence/database.ts:312-385`
- **Finding:** Review comment functions belong in a dedicated module.
- **Fix:** Extract to `src/persistence/review-comments.ts`.

### 9.9 Schema Duplication in database.ts
- **File:** `src/persistence/database.ts`
- **Finding:** Base schema in `createTables` includes columns originally added by migrations — dual source of truth.
- **Fix:** Document the relationship or separate base schema from migration additions.

### 9.10 Unnecessary Async in Persistence
- **Files:** `src/persistence/loops.ts`, `src/persistence/workspaces.ts`, `src/persistence/preferences.ts`
- **Finding:** All exported functions are `async` but contain zero `await` expressions.
- **Fix:** Remove `async` keyword (or keep for interface consistency and document why).

### 9.11 Dockerfile HEALTHCHECK
- **File:** `Dockerfile`
- **Finding:** No HEALTHCHECK instruction.
- **Fix:** Add HEALTHCHECK using the `/api/health` endpoint.

### 9.12 WebSocket Logging
- **File:** `src/api/websocket.ts`
- **Finding:** No connection open/close logging; stale heartbeat comment.
- **Fix:** Add connection lifecycle logging; update/remove stale comment.

### 9.13 useLoop Hook Improvements
- **File:** `src/hooks/useLoop.ts`
- **Finding:** Double-fetch on mount (dependency array issue), loading flicker on event refresh.
- **Fix:** Fix dependency arrays; skip `setLoading(true)` on event-driven refreshes.

### 9.14 Incomplete Barrel Re-exports
- **Files:** `src/hooks/index.ts`, `src/backends/index.ts`
- **Finding:** Incomplete re-exports from `loopActions.ts`; backends barrel re-exports dead code.
- **Fix:** Clean up barrel exports.

---

## Summary

| Phase | Focus | Complexity | Est. Findings |
|-------|-------|:----------:|:-------------:|
| 1 | Data Integrity & Safety | Low | 9 |
| 2 | Code Duplication (~540 LOC) | Low-Medium | 15+ |
| 3 | Error Handling & User Feedback | Medium | 12+ |
| 4 | Architecture — State Machine & Layering | Medium-High | 8+ |
| 5 | Component Decomposition | Medium-High | 8+ |
| 6 | Test Coverage Gaps | Medium | 8+ |
| 7 | Type Safety & Dead Code | Low | 20+ |
| 8 | Performance & Resource Management | Low-Medium | 8+ |
| 9 | Minor Consistency & Polish | Low | 20+ |
| **Total** | | | **108+** |
