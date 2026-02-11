# Ralpher Code Review — Phased Improvement Plan

**Created:** 2026-02-10
**Source:** Code review findings from `README.md`, `files.md`, `modules.md`, `functionalities.md`, `layers.md`
**Overall Health:** C+ → Target: B+
**Last Audited:** 2026-02-11

---

## Audit Summary

| Phase | Total | Done | Partial | Pending | N/A |
|-------|:-----:|:----:|:-------:|:-------:|:---:|
| 1. Data Integrity & Safety | 9 | 9 | 0 | 0 | 0 |
| 2. Code Duplication | 9 | 9 | 0 | 0 | 0 |
| 3. Error Handling | 6 | 5 | 1 | 0 | 0 |
| 4. Architecture | 4 | 3 | 1 | 0 | 0 |
| 5. Component Decomposition | 5 | 4 | 1 | 0 | 0 |
| 6. Test Coverage | 6 | 5 | 1 | 0 | 0 |
| 7. Type Safety & Dead Code | 12 | 9 | 1 | 1 | 1 |
| 8. Performance | 7 | 7 | 0 | 0 | 0 |
| 9. Minor Consistency & Polish | 14 | 10 | 2 | 2 | 0 |
| **Total** | **72** | **61** | **6** | **3** | **1** |

**Overall: 61/72 DONE (85%), 6 PARTIAL, 3 PENDING, 1 N/A**

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
**Status: 9/9 DONE**

### 1.1 SQL Injection Fix ✅ DONE
- **File:** `src/persistence/migrations/index.ts:57`
- **Finding:** `getTableColumns()` interpolates `tableName` directly into a PRAGMA query.
- **Fix:** Validate `tableName` against a whitelist of known table names, or use parameterized approach.
- **Refs:** `layers.md` § D1, `functionalities.md` § 10.1, `modules.md` § C3.1, `files.md` § persistence/migrations #1
- **Resolution:** `KNOWN_TABLE_NAMES` whitelist added (lines 59-65). Throws error for unknown table names. Also `ALLOWED_LOOP_COLUMNS` set added in `loops.ts` with `validateColumnNames()`.

### 1.2 Timer Leak in Name Generator ✅ DONE
- **File:** `src/utils/name-generator.ts:112-115`
- **Finding:** `setTimeout` in `Promise.race` is never cleared when the main promise resolves first.
- **Fix:** Store the timer ID and clear it in a `.finally()` block.
- **Refs:** `modules.md` § C6.1, `files.md` § utils/name-generator #1
- **Resolution:** Timer ID stored in variable; `clearTimeout(timeoutId)` called in `finally` block (lines 126-128).

### 1.3 INSERT OR REPLACE → Upsert ✅ DONE
- **File:** `src/persistence/loops.ts:289` (`saveLoop`)
- **Finding:** `INSERT OR REPLACE` triggers `ON DELETE CASCADE`, silently destroying review comments.
- **Fix:** Use `INSERT ... ON CONFLICT DO UPDATE` (upsert) to preserve related data.
- **Refs:** `layers.md` § D2, `functionalities.md` § 10.2, `files.md` § persistence/loops #4
- **Resolution:** Changed to `INSERT INTO loops (...) VALUES (...) ON CONFLICT(id) DO UPDATE SET ...` (lines 319-322). Comments explain the rationale.

### 1.4 JSON.parse Error Handling in rowToLoop ✅ DONE
- **File:** `src/persistence/loops.ts:196-267`
- **Finding:** Multiple `JSON.parse` calls with no error handling — one corrupt row prevents listing ALL loops.
- **Fix:** Wrap each `JSON.parse` in try/catch with fallback defaults; log warnings for corrupt fields.
- **Refs:** `layers.md` § D3, `functionalities.md` § 10.3, `files.md` § persistence/loops #5
- **Resolution:** `safeJsonParse<T>()` helper (lines 155-162) wraps all 9 JSON.parse calls with fallback defaults and warning logging.

### 1.5 Dockerfile Security ✅ DONE
- **File:** `Dockerfile`
- **Finding:** Container runs as root.
- **Fix:** Add `USER` instruction with non-root user.
- **Refs:** `files.md` § Dockerfile #1
- **Resolution:** Non-root `ralpher` user created (lines 37-38), `USER ralpher` set (line 52), port changed to 8080 (non-privileged), tini init process added.

### 1.6 Viewport Zoom Fix ✅ DONE
- **File:** `src/index.html`
- **Finding:** `user-scalable=no` and `maximum-scale=1.0` prevent zooming — WCAG 2.1 Level AA violation.
- **Fix:** Remove these restrictions from the viewport meta tag.
- **Refs:** `files.md` § index.html #1
- **Resolution:** Viewport now uses `width=device-width, initial-scale=1.0, viewport-fit=cover` — zoom restrictions removed.

### 1.7 React Error Boundary ✅ DONE
- **File:** `src/frontend.tsx`
- **Finding:** No Error Boundary at root — unrecoverable white screen on component errors.
- **Fix:** Add root-level ErrorBoundary component with fallback UI.
- **Refs:** `layers.md` § P2, `files.md` § frontend.tsx #1
- **Resolution:** `ErrorBoundary` component wraps the app at root (`frontend.tsx:16`). Provides fallback UI with "Try Again" and "Reload Page" buttons.

### 1.8 Entry Point Error Handling ✅ DONE
- **File:** `src/index.ts:16, 28`
- **Finding:** Top-level `await` without error handling — DB init failure crashes with unhandled rejection.
- **Fix:** Wrap initialization in try/catch with proper error logging and graceful exit.
- **Refs:** `files.md` § index.ts #1
- **Resolution:** Full try/catch (lines 15-82) around initialization with `console.error` and `process.exit(1)`.

### 1.9 StopPattern ReDoS Prevention ✅ DONE
- **File:** `src/core/loop-engine.ts`
- **Finding:** `stopPattern` matching uses `new RegExp()` on user-provided patterns without try/catch.
- **Fix:** Wrap in try/catch; consider validating/sanitizing regex patterns.
- **Refs:** `files.md` § loop-engine #3
- **Resolution:** `StopPatternDetector` class (lines 160-184) wraps `new RegExp()` in try/catch. Invalid patterns set `this.pattern = null` and log warning. Note: prevents crash from invalid syntax but doesn't mitigate ReDoS from valid-but-catastrophic patterns.

---

## Phase 2: Code Duplication Reduction (~540 LOC)

**Goal:** Extract shared helpers and components to eliminate systematic code duplication.
**Complexity:** Low-Medium
**Estimated findings addressed:** 15+
**Status: 9/9 DONE**

### 2.1 Extract `errorResponse()` Helper ✅ DONE
- **Files:** `src/api/loops.ts`, `src/api/models.ts`, `src/api/settings.ts`
- **Finding:** Identical `errorResponse()` function duplicated in 3 API files.
- **Fix:** Move to a shared `src/api/helpers.ts` or add to `src/api/validation.ts`.
- **Savings:** ~30 LOC
- **Resolution:** `errorResponse()` defined once in `src/api/helpers.ts` (line 22) along with `successResponse()`. All 6 API files import from `./helpers`.

### 2.2 Extract `apiCall<T>()` Helper for Loop Actions ✅ DONE
- **File:** `src/hooks/loopActions.ts`
- **Finding:** 14 functions with near-identical boilerplate (fetch + check status + parse JSON + error handling).
- **Fix:** Extract a generic `apiCall<T>(url, options)` helper; reduce 14 functions to call sites.
- **Savings:** ~260 LOC
- **Resolution:** Generic `apiCall<T>()` helper (line 21-43) plus `apiAction()` and `apiActionWithBody()` wrappers. All action functions use these helpers.

### 2.3 Extract Shared `ModelSelector` Component ✅ DONE
- **Files:** `src/components/CreateLoopForm.tsx:494-521`, `src/components/LoopActionBar.tsx:87-119`
- **Finding:** Model grouping/sorting logic and `renderModelOptions()` duplicated.
- **Fix:** Create a `ModelSelector` component with shared grouping/sorting logic.
- **Savings:** ~100 LOC
- **Resolution:** `src/components/ModelSelector.tsx` created with full component plus exported utilities (`makeModelKey`, `parseModelKey`, `groupModelsByProvider`, etc.). Both consumers import from it.

### 2.4 Extract `requireWorkspace()` Helper ✅ DONE
- **File:** `src/api/workspaces.ts:157-163, 286-292, 355-361, 388-394, 443-449`
- **Finding:** Workspace-lookup-and-404 pattern repeated 5 times.
- **Fix:** Extract a `requireWorkspace(workspaceId)` helper that returns workspace or throws 404.
- **Savings:** ~40 LOC
- **Resolution:** `requireWorkspace()` defined in `src/api/helpers.ts` (line 47-55). Used across workspace endpoints.

### 2.5 Consolidate Logger Constants ✅ DONE
- **Files:** `src/core/logger.ts`, `src/lib/logger.ts`
- **Finding:** `LogLevelName`, `LOG_LEVELS`, `LOG_LEVEL_NAMES`, `DEFAULT_LOG_LEVEL` duplicated identically.
- **Fix:** Move shared constants to a common module (e.g., `src/types/logger.ts` or `src/utils/log-levels.ts`).
- **Savings:** ~40 LOC
- **Resolution:** `src/utils/log-levels.ts` is the single source of truth. Both loggers import and re-export from it.

### 2.6 Consolidate Branch Name Generation ✅ DONE
- **Files:** `src/core/loop-manager.ts:~350, ~520`
- **Finding:** Duplicate branch name construction logic between `startLoop` and `startDraftLoop`.
- **Fix:** Extract to a shared `generateBranchName()` function.
- **Savings:** ~20 LOC
- **Resolution:** Single `generateBranchName()` function in `src/core/loop-engine.ts:63`. Both `startLoop` and `startPlanMode` delegate to `LoopEngine` which calls `setupGitBranch()` → `resolveBranchName()` → `generateBranchName()`.

### 2.7 Consolidate Preflight Validation ✅ DONE
- **File:** `src/api/loops.ts:169-216 vs 641-688`
- **Finding:** Uncommitted changes preflight check logic duplicated between POST (create) and POST draft/start.
- **Fix:** Extract `checkPreflightConditions(directory)` helper.
- **Savings:** ~50 LOC
- **Resolution:** Preflight checks removed entirely — worktrees isolate each loop in its own directory, eliminating the need for uncommitted changes checks. Comments explain the rationale.

### 2.8 Consolidate PATCH/PUT Handlers ✅ DONE
- **File:** `src/api/loops.ts:375-426 vs 464-516`
- **Finding:** PATCH and PUT handler bodies are near-identical copy-paste.
- **Fix:** Extract shared field mapping and update logic.
- **Resolution:** Shared `applyLoopUpdates()` function (lines 54-107) called by both PATCH (line 358) and PUT (line 394) handlers.

### 2.9 Consolidate Git Endpoint Boilerplate ✅ DONE
- **File:** `src/api/git.ts:83-129 vs 147-192`
- **Finding:** Two endpoints share near-identical boilerplate.
- **Fix:** Extract shared request parsing, validation, and git service setup.
- **Resolution:** Shared `validateGitRequest()` function (lines 68-88) plus `getGitService()` (line 49). Both endpoints use them.

---

## Phase 3: Error Handling & User Feedback

**Goal:** Ensure errors are never silently swallowed and users get meaningful feedback.
**Complexity:** Medium
**Estimated findings addressed:** 12+
**Status: 5/6 DONE, 1 PARTIAL**

### 3.1 Backend Logger Sub-Logger Sync ✅ DONE
- **File:** `src/core/logger.ts`
- **Finding:** `setLogLevel()` only updates parent; sub-loggers retain their original level.
- **Fix:** Port the caching pattern from `src/lib/logger.ts` — cache sub-loggers and propagate level changes.
- **Refs:** `layers.md` § S3, `functionalities.md` § 7.3
- **Resolution:** `subLoggers` Map with `setLogLevel()` propagation implemented in both `src/core/logger.ts` and `src/lib/logger.ts`.

### 3.2 Toast/Notification System for Frontend ✅ DONE
- **File:** New component or integration
- **Finding:** Errors silently swallowed in catch blocks across Dashboard.tsx and other components.
- **Fix:** Add a toast notification system; replace silent catch blocks with user-visible error messages.
- **Refs:** `layers.md` § P10, `functionalities.md` § CF-4
- **Resolution:** `ToastProvider` in `src/components/common/Toast.tsx`, wraps app at root in `frontend.tsx`. Components use `useToast()` hook.

### 3.3 Fix Silent Error Swallowing in API Handlers ✅ DONE
- **Files:** `src/api/loops.ts:301-303, 318-320`, `src/api/models.ts`, `src/api/workspaces.ts`
- **Finding:** Empty catch blocks, inconsistent error logging.
- **Fix:** Add proper error logging; return error responses to clients.
- **Resolution:** No truly silent catch blocks remain in API handlers.

### 3.4 Fix Error Response Consistency ✅ DONE
- **Files:** `src/api/workspaces.ts`, `src/api/git.ts`, `src/api/loops.ts`
- **Finding:** Inconsistent error response shapes (`{message, error}` vs `{error, message}`).
- **Fix:** Standardize on a single error response shape using the shared `errorResponse()` from Phase 2.
- **Resolution:** All API files use centralized `errorResponse()` from `src/api/helpers.ts`.

### 3.5 Backend Error Handling Improvements ✅ DONE
- **Files:** `src/backends/opencode/index.ts:298-301`, `src/core/remote-command-executor.ts`
- **Finding:** `getSession` swallows all errors as "not found"; `readFile` falls back to empty string silently.
- **Fix:** Distinguish error types; add proper logging.
- **Resolution:** `getSession` distinguishes 404 errors; `readFile` returns null with logging.

### 3.6 Git Service Error Stack Preservation 🔶 PARTIAL
- **File:** `src/core/git-service.ts`
- **Finding:** Many methods wrap errors in generic messages, losing stack trace information.
- **Fix:** Use `cause` option in Error constructor to chain error context.
- **Resolution:** `GitCommandError` class provides structured context (command, stderr, exit code), but `{ cause }` chaining is not used for wrapping caught errors. The structured error class partially addresses the issue.

---

## Phase 4: Architecture — State Machine & Layering

**Goal:** Introduce a centralized loop state machine and fix layering violations.
**Complexity:** Medium-High
**Estimated findings addressed:** 8+
**Status: 3/4 DONE, 1 PARTIAL**

### 4.1 Introduce Loop State Machine ✅ DONE
- **Files:** New `src/core/loop-state-machine.ts`, modify `src/core/loop-manager.ts`, `src/core/loop-engine.ts`
- **Finding:** Status transitions validated ad-hoc across scattered methods. No centralized transition table.
- **Fix:** Create a state machine with a transition table defining all valid transitions. All state changes go through it.
- **Refs:** `layers.md` § B2, `functionalities.md` § CF-5
- **Resolution:** `src/core/loop-state-machine.ts` (174 lines) with centralized `TRANSITION_TABLE`. Exports `isValidTransition()`, `assertValidTransition()`, etc. Both `loop-manager.ts` and `loop-engine.ts` use `assertValidTransition()` before state changes.

### 4.2 Fix API → Persistence Layer Bypass 🔶 PARTIAL
- **File:** `src/api/loops.ts:22-23`
- **Finding:** API imports `updateLoopState`, `getActiveLoopByDirectory`, `getReviewComments` directly from persistence.
- **Fix:** Add query/mutation methods to LoopManager; route API calls through Core layer.
- **Refs:** `layers.md` § A3, A4, `functionalities.md` § CF-2
- **Resolution:** All loop-specific persistence is routed through `loopManager`. However, `src/api/loops.ts` still imports `getWorkspaceByDirectory`, `getWorkspace`, `touchWorkspace` from `persistence/workspaces` (line 21). This is arguably acceptable since workspaces are a separate domain (not a loop persistence bypass), but technically the API layer still directly touches persistence.

### 4.3 Fix Shared → External Reverse Dependency ✅ DONE
- **Files:** `src/types/loop.ts`, `src/types/events.ts`
- **Finding:** Domain type files import `TodoItem` from `../backends/types` — reverse dependency.
- **Fix:** Move `TodoItem` to `src/types/` or define a local interface; backends should import from types, not vice versa.
- **Resolution:** `TodoItem` is defined in `src/types/loop.ts` (lines 18-28). `events.ts` imports from `./loop` (same layer). `backends/types.ts` imports from `../types/loop` (correct direction).

### 4.4 Fix Direct State Mutation in API Handler ✅ DONE
- **File:** `src/api/loops.ts:690-728`
- **Finding:** Draft/start handler directly mutates `loop.state.status` and `loop.state.planMode`, bypassing LoopManager.
- **Fix:** Add a `startDraft()` method to LoopManager that handles state transitions properly.
- **Resolution:** Draft/start handler (lines 489-524) delegates entirely to `loopManager.startDraft()`, which uses `assertValidTransition()` internally.

---

## Phase 5: Component Decomposition & Complexity Reduction

**Goal:** Break apart god components and god methods into focused, testable units.
**Complexity:** Medium-High
**Estimated findings addressed:** 8+
**Status: 4/5 DONE, 1 PARTIAL**

### 5.1 Decompose Dashboard.tsx ✅ DONE
- **File:** `src/components/Dashboard.tsx` (1,118 LOC, 26 state variables)
- **Fix:** Extract into:
  - `DashboardHeader` — workspace selector, settings buttons, create loop trigger
  - `LoopGrid` — loop grouping by status, rendering LoopCards
  - `DashboardModals` — aggregate modal state management
  - `useDashboardData` hook — data fetching (config, health, models, branches, preferences)
  - `useLoopGrouping` hook — grouping/sorting logic with memoization
- **Refs:** `layers.md` § P1, `modules.md` § C7.1
- **Resolution:** Dashboard.tsx is now 223 lines. All sub-components extracted: `DashboardHeader`, `LoopGrid`, `DashboardModals`, `useDashboardData`, `useDashboardModals`, `useLoopGrouping`.

### 5.2 Decompose `acceptLoop()` Method 🔶 PARTIAL
- **File:** `src/core/loop-manager.ts:~600-800`
- **Finding:** ~200 LOC handling merge, cleanup, branch deletion, and state transitions in one massive method.
- **Fix:** Extract sub-methods: `mergeLoopBranch()`, `cleanupLoopBranch()`, `finalizeLoopState()`.
- **Refs:** `layers.md` § B4, `modules.md` § C1.8
- **Resolution:** `acceptLoop()` is now ~100 lines (lines 824-923) — reduced but still a single method. The related `pushLoop()` workflow IS well-decomposed (`syncWorkingBranch`, `syncBaseBranchAndPush`, `pushAndFinalize`, `startConflictResolutionEngine`), but `acceptLoop()` itself hasn't been broken into named sub-methods.

### 5.3 Decompose `runIteration()` Method ✅ DONE
- **File:** `src/core/loop-engine.ts`
- **Finding:** ~250 LOC handling prompt building, sending, response processing, logging, and state updates.
- **Fix:** Extract: `buildIterationPrompt()`, `sendAndProcessResponse()`, `updateIterationState()`.
- **Refs:** `layers.md` § B5, `modules.md` § C1.9
- **Resolution:** `runIteration()` is now ~60 lines (lines 1261-1322), delegating to `executeIterationPrompt()`, `evaluateOutcome()`, `commitIteration()`, `buildIterationResult()`. Outcome handling further decomposed into `handleCompletedOutcome()`, `handlePlanReadyOutcome()`, `handleErrorOutcome()`.

### 5.4 Reduce `translateEvent()` Parameters ✅ DONE
- **File:** `src/backends/opencode/index.ts`
- **Finding:** Function has 8 parameters.
- **Fix:** Bundle into a context object: `TranslateEventContext`.
- **Resolution:** `TranslateEventContext` interface (lines 41-56) bundles all parameters. `translateEvent()` now takes just 2 params: `event` and `ctx`.

### 5.5 Extract Prompt Building ✅ DONE
- **File:** `src/core/loop-engine.ts`
- **Finding:** Duplicate prompt-building logic between `start()` and `runIteration()`.
- **Fix:** Extract `PromptBuilder` class or module.
- **Resolution:** Single `buildPrompt()` entry point delegating to `buildPlanModePrompt()` and `buildExecutionPrompt()`, with shared `buildErrorContext()` helper. No duplication between start/iteration paths.

---

## Phase 6: Test Coverage Gaps

**Goal:** Add tests for untested critical modules.
**Complexity:** Medium
**Estimated findings addressed:** 8+
**Status: 5/6 DONE, 1 PARTIAL**

### 6.1 Tests for `loop-status.ts` ✅ DONE
- **File:** `src/utils/loop-status.ts`
- **Finding:** 0% test coverage despite containing critical UI logic.
- **Tests:** `getStatusLabel()`, `isLoopRunning()`, `isLoopTerminal()`, `getStatusColor()` for all status values.
- **Resolution:** `tests/unit/loop-status-helpers.test.ts` (382 lines) covers all 9 exported functions exhaustively.

### 6.2 Tests for `event-stream.ts` ✅ DONE
- **File:** `src/utils/event-stream.ts`
- **Finding:** 0% test coverage for a concurrency primitive.
- **Tests:** Producer/consumer flow, buffer behavior, `end()`/`fail()` semantics, backpressure behavior.
- **Resolution:** `tests/unit/event-stream.test.ts` (392 lines) covers producer/consumer flow, end/fail/close semantics, and buffer limit behaviors.

### 6.3 Tests for `sanitizeBranchName` ✅ DONE
- **File:** `src/utils/index.ts`
- **Finding:** No tests; function can return empty string for all-special-character input.
- **Tests:** Normal input, special characters, empty string edge case, unicode, length limits.
- **Resolution:** `tests/unit/sanitize-branch-name.test.ts` (165 lines, 32 test cases) covers all cases including the "unnamed" fallback.

### 6.4 Tests for Git API Endpoints ✅ DONE
- **File:** `src/api/git.ts`
- **Finding:** No API tests for git status and branch listing endpoints.
- **Tests:** Success cases, non-git directory, missing directory, invalid parameters.
- **Resolution:** `tests/api/git.test.ts` (144 lines) covers branches and default-branch endpoints with real git repos.

### 6.5 Tests for WebSocket API ✅ DONE
- **File:** `src/api/websocket.ts`
- **Finding:** No tests for WebSocket upgrade, message routing, or connection lifecycle.
- **Tests:** Connection upgrade, event subscription, message parsing, connection cleanup.
- **Resolution:** `tests/api/events-sse.test.ts` provides WebSocket API integration tests. Frontend hook tests (`useLoop.test.ts`, `useLoops.test.ts`) cover WebSocket event handling with mock WebSocket helper.

### 6.6 Improve Backend Tests 🔶 PARTIAL
- **File:** `src/backends/opencode/`
- **Finding:** Tests mostly cover "not connected" error throwing — minimal positive-path coverage.
- **Tests:** Connection flow, event translation, prompt sending, session management.
- **Resolution:** `tests/unit/opencode-backend.test.ts` (324 lines) exists but remains predominantly "not connected" error tests. `opencode-backend-translate.test.ts` covers translation logic separately. No positive-path connected behavior tests (creating sessions, sending prompts, receiving events).

---

## Phase 7: Type Safety & Dead Code Cleanup

**Goal:** Improve type safety at boundaries and remove dead code.
**Complexity:** Low
**Estimated findings addressed:** 20+
**Status: 9/12 DONE, 1 PARTIAL, 1 PENDING, 1 N/A**

### 7.1 Remove Dead Type Aliases ✅ DONE
- **Files:** `src/types/schemas/loop.ts`, `src/types/schemas/workspace.ts`, `src/types/schemas/model.ts`, `src/types/schemas/preferences.ts`, `src/types/schemas/index.ts`
- **Finding:** 16 dead `*Input` type aliases never imported.
- **Fix:** Remove them and their barrel re-exports.
- **Resolution:** No dead `*Input` type aliases remain. Request types use `z.infer<>` in `api.ts`.

### 7.2 Remove Dead `LogEntry` Type ✅ DONE
- **File:** `src/types/api.ts:249-258`
- **Finding:** `LogEntry` interface never imported — dead code.
- **Fix:** Remove it.
- **Resolution:** `LogEntry` removed from `api.ts`. The only `LogEntry` is a UI component type in `LogViewer.tsx` (properly used).

### 7.3 Remove Dead `getServerUrl` ✅ DONE
- **File:** `src/backends/opencode/index.ts:1011-1015`
- **Finding:** Dead code with `unknown` cast breaking encapsulation.
- **Fix:** Remove the function.
- **Resolution:** `getServerUrl` does not exist anywhere in the codebase.

### 7.4 Remove Vestigial `paths.ts` ✅ DONE
- **File:** `src/persistence/paths.ts`
- **Finding:** Vestigial module — functions just delegate to `database.ts` with no added value.
- **Fix:** Remove and update imports to use `database.ts` directly.
- **Resolution:** `src/persistence/paths.ts` does not exist.

### 7.5 Type Backend Interface Returns 🔶 PARTIAL
- **File:** `src/backends/types.ts`
- **Finding:** `getSdkClient()` returns `unknown`, `getModels()` returns `unknown[]`.
- **Fix:** Add proper return types or use generics.
- **Resolution:** `getModels()` now returns `Promise<ModelInfo[]>` (properly typed). `getSdkClient()` still returns `unknown` but this is **intentionally documented** with JSDoc explaining the interface is shared between real and mock backends.

### 7.6 Fix `ModelInfo` Type Duplication ✅ DONE
- **Files:** `src/backends/types.ts`, `src/types/api.ts`
- **Finding:** `ModelInfo` defined in both files with identical shape.
- **Fix:** Single source of truth in `src/types/api.ts`; backend imports from there.
- **Resolution:** `ModelInfo` defined once in `src/types/api.ts` (line 36). `backends/types.ts` imports from `../types/api`.

### 7.7 Fix Barrel Export Consistency ⏳ PENDING
- **Files:** `src/persistence/index.ts`, `src/types/index.ts`
- **Finding:** Missing re-exports (`workspaces.ts` not in persistence barrel, `settings.ts` not in types barrel).
- **Fix:** Add missing re-exports.
- **Resolution:** `src/persistence/index.ts` now re-exports workspaces and review-comments. `src/types/index.ts` re-exports settings. However, `src/types/schemas/index.ts` is not re-exported through the main types barrel — consumers must import directly from `types/schemas`.

### 7.8 Rename `ConnectionStatus` to Avoid Collision ✅ DONE
- **Files:** `src/types/settings.ts`, `src/hooks/useWebSocket.ts`
- **Finding:** Both define `ConnectionStatus` with different meanings.
- **Fix:** Rename one (e.g., `ServerConnectionStatus` in settings.ts).
- **Resolution:** No collision — `settings.ts` exports `ConnectionStatus`, `useWebSocket.ts` exports `WebSocketConnectionStatus`. Different names, no conflict.

### 7.9 Remove Dead CSS Animations — N/A
- **File:** `src/index.css`
- **Finding:** `slide` and `spin` animations may be unused.
- **Fix:** Verify and remove if dead.
- **Resolution:** `slide-in` animation is used by `Toast.tsx`. `animate-spin` is a Tailwind CSS built-in used in 9+ places. Both are actively used — **false positive** in original review.

### 7.10 Remove Unused Path Alias ⏳ PENDING
- **File:** `tsconfig.json`
- **Finding:** `@/*` path alias defined but never used.
- **Fix:** Remove it.
- **Resolution:** `@/*` alias still defined in `tsconfig.json` (lines 25-27). Grep confirms no source files use `@/` imports. Should be removed.

### 7.11 Clean Up `sanitizeBranchName` Location ✅ DONE
- **File:** `src/utils/index.ts`
- **Finding:** Defined inline in barrel file — breaks organizational pattern.
- **Fix:** Move to its own module file.
- **Resolution:** Moved to `src/utils/sanitize-branch-name.ts`. Barrel re-exports it.

### 7.12 Fix Empty Branch Name Edge Case ✅ DONE
- **File:** `src/utils/index.ts` (or new module)
- **Finding:** `sanitizeBranchName` can return empty string for all-special-character input.
- **Fix:** Add fallback to a default branch name.
- **Resolution:** Returns `sanitized || "unnamed"` (line 24). Verified by tests.

---

## Phase 8: Performance & Resource Management

**Goal:** Fix unbounded buffers, add memoization, and address resource leaks.
**Complexity:** Low-Medium
**Estimated findings addressed:** 8+
**Status: 7/7 DONE**

### 8.1 Event Stream Buffer Limits ✅ DONE
- **File:** `src/utils/event-stream.ts`
- **Finding:** `items` buffer can grow unboundedly.
- **Fix:** Add configurable max buffer size with backpressure or drop policy.
- **Resolution:** `DEFAULT_MAX_BUFFER_SIZE = 10_000` with configurable `maxBufferSize` option and 10% eviction when full.

### 8.2 Dashboard Memoization ✅ DONE
- **File:** `src/components/Dashboard.tsx` (or extracted hooks after Phase 5)
- **Finding:** `groupLoopsByStatus` and `workspaceGroups` computed on every render.
- **Fix:** Wrap in `useMemo` with proper dependency arrays.
- **Resolution:** Extracted to `useLoopGrouping` hook (`src/hooks/useLoopGrouping.ts`) which uses `useMemo` throughout.

### 8.3 LogViewer Memoization ✅ DONE
- **File:** `src/components/LogViewer.tsx:144-168`
- **Finding:** Entries array rebuilt and sorted on every render.
- **Fix:** Wrap in `useMemo`.
- **Resolution:** `useMemo` wraps entries at line 144. Component wrapped in `memo()`.

### 8.4 Loop Engine Log Buffer Limits ✅ DONE
- **File:** `src/core/loop-engine.ts`
- **Finding:** `logs` array grows unboundedly during long-running loops.
- **Fix:** Add ring buffer or max size with oldest-entry eviction.
- **Resolution:** `MAX_PERSISTED_LOGS = 5000`, `MAX_PERSISTED_MESSAGES = 2000`, `MAX_PERSISTED_TOOL_CALLS = 5000` with eviction logic.

### 8.5 useLoop Data Growth ✅ DONE
- **File:** `src/hooks/useLoop.ts`
- **Finding:** `messages`, `toolCalls`, `logs`, `todos` arrays grow unboundedly.
- **Fix:** Add pagination or windowing for very long-running loops.
- **Resolution:** Frontend caps: `MAX_FRONTEND_LOGS = 2000`, `MAX_FRONTEND_MESSAGES = 1000`, `MAX_FRONTEND_TOOL_CALLS = 2000` with `slice(-MAX)` eviction. Initial hydration also limits to latest 1000 entries.

### 8.6 AbortController for Hooks ✅ DONE
- **Files:** `src/hooks/useLoop.ts`, `src/hooks/useLoops.ts`
- **Finding:** No cancellation of in-flight fetch requests on unmount.
- **Fix:** Add AbortController; abort on cleanup.
- **Resolution:** Both hooks use `abortControllerRef` with abort on cleanup/unmount.

### 8.7 WebSocket Connection Limits ✅ DONE
- **File:** `src/api/websocket.ts`
- **Finding:** No connection limit.
- **Fix:** Track active connections; reject/close oldest when limit exceeded.
- **Resolution:** `MAX_CONNECTIONS = 100` with `activeConnections` Set tracking. Oldest connection closed when limit reached.

---

## Phase 9: Minor Consistency & Polish

**Goal:** Address remaining minor issues for consistency and code health.
**Complexity:** Low
**Estimated findings addressed:** 20+
**Status: 10/14 DONE, 2 PARTIAL, 2 PENDING**

### 9.1 Workspaces Handler Pattern Consistency ✅ DONE
- **File:** `src/api/workspaces.ts`
- **Finding:** Mix of named-method-handler and single-function-with-switch patterns.
- **Fix:** Standardize on the named-method pattern used by other API files.
- **Resolution:** Uses consistent route-object pattern with named HTTP method handlers. No switch statements.

### 9.2 Logger Initialization Consistency ✅ DONE
- **Files:** Various API files
- **Finding:** Some use `createLogger("api:xyz")`, some use `import { log }`.
- **Fix:** Standardize on `createLogger` pattern for sub-module loggers.
- **Resolution:** All API files consistently use `createLogger("api:xyz")` pattern (verified: api:workspaces, api:websocket, api:settings, api:models, api:loops, api:git, api:agents-md, api:health).

### 9.3 Build Script Bun API Usage ✅ DONE
- **File:** `src/build.ts`
- **Finding:** Uses `fs` (Node API) instead of `Bun.file`/`Bun.$`.
- **Fix:** Replace with Bun APIs per project conventions.
- **Resolution:** Uses `Bun.$` for shell commands, `Bun.build()` for compilation, `Bun.file()` and `Bun.write()` for file operations. No Node `fs` usage.

### 9.4 Package.json Fixes 🔶 PARTIAL
- **File:** `package.json`
- **Finding:** Zod uses caret range; build script uses `;` instead of `&&`.
- **Fix:** Pin zod version; use `&&` in build script.
- **Resolution:** Zod uses exact version `"4.3.6"` (no caret — fixed). Build script uses `&&` (fixed). The original review wanted to ADD caret for zod but current pinning may be intentional for Zod v4 stability.

### 9.5 Dynamic Import Cleanup ✅ DONE
- **File:** `src/api/loops.ts:147`, `src/persistence/database.ts:67, 284`
- **Finding:** Dynamic `import()` should be static; `fs/promises` should use Bun APIs.
- **Fix:** Convert to static imports; use Bun APIs where applicable.
- **Resolution:** No dynamic `import()` calls found in `loops.ts` or `database.ts`. All imports are static.

### 9.6 Focus Trapping in Modal ✅ DONE
- **File:** `src/components/common/Modal.tsx`
- **Finding:** No focus trapping — keyboard users can tab outside modal.
- **Fix:** Add focus trap using a library or manual implementation.
- **Resolution:** Full focus trapping implemented: `FOCUSABLE_SELECTOR` constant, Tab/Shift+Tab cycling, Escape to close, focus restore on unmount via `previousFocusRef`.

### 9.7 PlanReviewPanel Modal ✅ DONE
- **File:** `src/components/PlanReviewPanel.tsx:224-251`
- **Finding:** Custom modal bypasses shared Modal component.
- **Fix:** Use shared Modal component for consistency.
- **Resolution:** Uses shared `ConfirmModal` component imported from `./common`.

### 9.8 Review Comments in Database Module ✅ DONE
- **File:** `src/persistence/database.ts:312-385`
- **Finding:** Review comment functions belong in a dedicated module.
- **Fix:** Extract to `src/persistence/review-comments.ts`.
- **Resolution:** Extracted to `src/persistence/review-comments.ts` with `insertReviewComment`, `getReviewComments`, `markCommentsAsAddressed`.

### 9.9 Schema Duplication in database.ts 🔶 PARTIAL
- **File:** `src/persistence/database.ts`
- **Finding:** Base schema in `createTables` includes columns originally added by migrations — dual source of truth.
- **Fix:** Document the relationship or separate base schema from migration additions.
- **Resolution:** The duplication still structurally exists (createTables includes columns from migrations v1-v9), but a detailed comment block (lines 102-118) now explains this is intentional: fresh DBs get full schema, existing DBs get columns via idempotent migrations. v10+ columns are NOT duplicated. The documentation approach was chosen over separation.

### 9.10 Unnecessary Async in Persistence ⏳ PENDING
- **Files:** `src/persistence/loops.ts`, `src/persistence/workspaces.ts`, `src/persistence/preferences.ts`
- **Finding:** All exported functions are `async` but contain zero `await` expressions.
- **Fix:** Remove `async` keyword (or keep for interface consistency and document why).
- **Resolution:** Functions remain `async` with zero `await` expressions. Each file has a header comment explaining this is "intentional for interface consistency" — deliberately documented but not changed.

### 9.11 Dockerfile HEALTHCHECK ✅ DONE
- **File:** `Dockerfile`
- **Finding:** No HEALTHCHECK instruction.
- **Fix:** Add HEALTHCHECK using the `/api/health` endpoint.
- **Resolution:** `HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 CMD curl -f http://localhost:${RALPHER_PORT}/api/health || exit 1`

### 9.12 WebSocket Logging ✅ DONE
- **File:** `src/api/websocket.ts`
- **Finding:** No connection open/close logging; stale heartbeat comment.
- **Fix:** Add connection lifecycle logging; update/remove stale comment.
- **Resolution:** Connection open and close logging added. No stale heartbeat comment found.

### 9.13 useLoop Hook Improvements ✅ DONE
- **File:** `src/hooks/useLoop.ts`
- **Finding:** Double-fetch on mount (dependency array issue), loading flicker on event refresh.
- **Fix:** Fix dependency arrays; skip `setLoading(true)` on event-driven refreshes.
- **Resolution:** `initialLoadDoneRef` prevents double-fetch on mount. `isInitialLoad` check only shows loading spinner on first load, not event-driven refreshes.

### 9.14 Incomplete Barrel Re-exports ✅ DONE
- **Files:** `src/hooks/index.ts`, `src/backends/index.ts`
- **Finding:** Incomplete re-exports from `loopActions.ts`; backends barrel re-exports dead code.
- **Fix:** Clean up barrel exports.
- **Resolution:** `src/hooks/index.ts` comprehensively exports all hooks including loopActions. `src/backends/index.ts` exports types and opencode.

---

## Summary

| Phase | Focus | Complexity | Est. Findings | Status |
|-------|-------|:----------:|:-------------:|:------:|
| 1 | Data Integrity & Safety | Low | 9 | **9/9 DONE** |
| 2 | Code Duplication (~540 LOC) | Low-Medium | 15+ | **9/9 DONE** |
| 3 | Error Handling & User Feedback | Medium | 12+ | **5/6 DONE** |
| 4 | Architecture — State Machine & Layering | Medium-High | 8+ | **3/4 DONE** |
| 5 | Component Decomposition | Medium-High | 8+ | **4/5 DONE** |
| 6 | Test Coverage Gaps | Medium | 8+ | **5/6 DONE** |
| 7 | Type Safety & Dead Code | Low | 20+ | **9/12 DONE** |
| 8 | Performance & Resource Management | Low-Medium | 8+ | **7/7 DONE** |
| 9 | Minor Consistency & Polish | Low | 20+ | **10/14 DONE** |
| **Total** | | | **108+** | **61/72 DONE** |

### Remaining Items (9 total)

**PARTIAL (6 items — partially addressed, small remaining work):**
| Item | Issue | Remaining Work |
|------|-------|----------------|
| 3.6 | Git Service Error Stack Preservation | Add `{ cause }` chaining to error wrapping |
| 4.2 | API → Persistence Layer Bypass | Workspace imports still direct from persistence |
| 5.2 | Decompose acceptLoop() | Method is ~100 LOC, could be split further |
| 6.6 | Backend Tests | Add positive-path connected tests |
| 7.5 | Backend Interface Returns | `getSdkClient()` returns `unknown` (documented as intentional) |
| 9.9 | Schema Duplication | Documented but structurally still exists |

**PENDING (3 items — not yet addressed):**
| Item | Issue |
|------|-------|
| 7.7 | Barrel Export Consistency — schemas not re-exported through types barrel |
| 7.10 | Unused `@/*` Path Alias — still in tsconfig.json |
| 9.10 | Unnecessary Async in Persistence — documented as intentional but unchanged |
