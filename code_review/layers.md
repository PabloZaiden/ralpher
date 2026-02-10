# Architectural Layer Analysis — Ralpher Codebase

**Date:** 2026-02-07
**Scope:** Full codebase analyzed through 6 architectural layers
**Total Codebase:** ~27,328 LOC across 90 source files

---

## Executive Summary

This document analyzes the Ralpher codebase by **architectural layer** — evaluating each layer's internal health, interface quality, and cross-layer interactions. This is the fourth and final review document, complementing the file-level (`files.md`), module-level (`modules.md`), and functionality-level (`functionalities.md`) analyses.

### Layer Overview

| # | Layer | Files | LOC | Health | Critical | Major | Minor | Suggestion |
|---|-------|------:|----:|:------:|---------:|------:|------:|-----------:|
| 1 | Presentation | 41 | 10,495 | C | 1 | 11 | 10 | 2 |
| 2 | API | 11 | 3,545 | C+ | 0 | 8 | 6 | 1 |
| 3 | Core Business Logic | 6 | 6,285 | C+ | 0 | 8 | 5 | 2 |
| 4 | Data Access | 7 | 2,061 | B- | 1 | 6 | 5 | 1 |
| 5 | External Integration | 6 | 2,597 | C | 0 | 7 | 3 | 1 |
| 6 | Shared Infrastructure | 14 | 2,345 | B | 0 | 5 | 5 | 2 |
| | **Totals** | **85** | **~27,328** | **C+** | **2** | **45** | **34** | **9** |

**Note:** 6 config/entry files (`src/index.ts`, `src/build.ts`, `src/frontend.tsx`, `src/index.html`, `src/index.css`, `src/App.tsx`) span multiple layers. They are discussed in the layer most relevant to their primary role and also referenced in the Cross-Layer Analysis.

### Health Score Scale

| Grade | Meaning |
|-------|---------|
| A | Excellent — clean, well-tested, well-documented |
| B | Good — minor issues, generally solid |
| C | Acceptable — functional but has significant technical debt |
| D | Poor — serious issues requiring immediate attention |
| F | Critical — active bugs, security vulnerabilities, or architectural failures |

---

## Layer 1: Presentation (~10,495 LOC)

### Purpose

Client-side React application: components, hooks, frontend library, and entry points that compose the Ralpher web UI.

### Files

| Sublayer | File | LOC | Role |
|----------|------|----:|------|
| Components | `components/Dashboard.tsx` | 1,118 | Main dashboard — loop listing, creation, workspace management |
| Components | `components/LoopDetails.tsx` | 1,225 | Single loop detail view with 8 tabs |
| Components | `components/CreateLoopForm.tsx` | 949 | Loop creation form with model selection |
| Components | `components/ServerSettingsForm.tsx` | 400 | Server connection configuration |
| Components | `components/WorkspaceSettingsModal.tsx` | 388 | Per-workspace settings |
| Components | `components/AppSettingsModal.tsx` | 428 | Application-wide settings |
| Components | `components/LoopActionBar.tsx` | 337 | Action toolbar for active loops |
| Components | `components/LogViewer.tsx` | 309 | Real-time log display with filtering |
| Components | `components/LoopCard.tsx` | 306 | Loop summary card |
| Components | `components/PlanReviewPanel.tsx` | 275 | Plan review with accept/feedback |
| Components | `components/LoopModals.tsx` | 223 | Modal containers for loop actions |
| Components | `components/CreateWorkspaceModal.tsx` | 197 | Workspace creation form |
| Components | `components/common/Modal.tsx` | 195 | Generic modal component |
| Components | `components/TodoViewer.tsx` | 174 | Todo list from agent sessions |
| Components | `components/RenameLoopModal.tsx` | 152 | Loop rename modal |
| Components | `components/AcceptLoopModal.tsx` | 144 | Accept/merge confirmation modal |
| Components | `components/AddressCommentsModal.tsx` | 130 | Review comment submission modal |
| Components | `components/common/Badge.tsx` | 108 | Status badge component |
| Components | `components/WorkspaceSelector.tsx` | 97 | Workspace dropdown selector |
| Components | `components/MarkdownRenderer.tsx` | 86 | Markdown rendering |
| Components | `components/common/Card.tsx` | 67 | Card container component |
| Components | `components/common/Button.tsx` | 67 | Button component with variants |
| Components | `components/common/CollapsibleSection.tsx` | 54 | Collapsible content section *(new)* |
| Components | `components/LogLevelInitializer.tsx` | 43 | Log level sync on mount |
| Components | `components/common/Icons.tsx` | 31 | SVG icon components |
| Components | `components/common/index.ts` | 10 | Barrel for common components |
| Components | `components/index.ts` | 14 | Barrel for main components |
| Hooks | `hooks/useLoop.ts` | 671 | Single loop data + WebSocket updates |
| Hooks | `hooks/loopActions.ts` | 349 | 14 API action functions |
| Hooks | `hooks/useLoops.ts` | 307 | Loop list + WebSocket updates |
| Hooks | `hooks/useWorkspaceServerSettings.ts` | 305 | Workspace server settings CRUD |
| Hooks | `hooks/useWebSocket.ts` | 230 | WebSocket connection management |
| Hooks | `hooks/useWorkspaces.ts` | 230 | Workspace list fetching |
| Hooks | `hooks/useAgentsMdOptimizer.ts` | 158 | AGENTS.md optimization hook *(new)* |
| Hooks | `hooks/useLogLevelPreference.ts` | 103 | Log level persistence |
| Hooks | `hooks/useMarkdownPreference.ts` | 99 | Markdown preference |
| Hooks | `hooks/index.ts` | 25 | Barrel for hooks |
| Lib | `lib/prompt-templates.ts` | 205 | Prompt template utilities *(new)* |
| Lib | `lib/logger.ts` | 163 | Frontend tslog instance with sub-logger caching |
| Lib | `lib/index.ts` | 15 | Barrel for lib (dead) |
| Entry | `frontend.tsx` | 21 | React DOM mount point |
| Entry | `App.tsx` | 87 | Root React component with hash routing |

**Total:** ~10,495 LOC across 42 files (including 3 barrels and entry points)

### Health Score: C

The Presentation layer is functional but carries the most technical debt of any layer. The debt is concentrated in two areas: (1) `Dashboard.tsx` as a 1,118-line god component, and (2) the hooks sublayer containing complex async state management with significant but incomplete test coverage (126 tests across 4 files).

### Pattern Analysis

**Strengths:**
- Clean separation of `common/` primitives (Button, Card, Modal, Badge, Icons) from feature components
- Hooks encapsulate most data-fetching logic, keeping components declarative
- `lib/logger.ts` correctly implements sub-logger caching (the backend logger does not)
- Feature-specific modals (AcceptLoop, AddressComments, Rename) are well-scoped and focused
- `useMarkdownPreference` and `useLogLevelPreference` are clean, well-structured hooks

**Anti-Patterns:**
- **God Component**: `Dashboard.tsx` manages 26 state variables, contains raw `fetch()` calls, business logic for loop grouping/sorting, modal state for 5+ dialogs, and a 196-line loop creation IIFE
- **Mixed data-fetching**: Some components use hooks (`useLoop`, `useLoops`), others use inline `fetch()` calls (`Dashboard.tsx`). No consistent HTTP client abstraction
- **No error boundaries**: The entire React tree renders without error boundaries — any uncaught error causes a white screen
- **No error feedback**: `catch` blocks in components and hooks only `console.error()` — no toast, no error state, no visual feedback to users
- **Massive duplication in hooks**: 14 action functions in `loopActions.ts` with identical boilerplate (~260 LOC recoverable)

### Findings

| # | Severity | Dimension | Location | Finding |
|---|----------|-----------|----------|---------|
| P1 | **Critical** | Complexity | `Dashboard.tsx` (entire file) | God component with 26 `useState` calls, inline `fetch()`, loop grouping logic, modal state, and 196-line creation IIFE. Should be decomposed into `LoopList`, `DashboardHeader`, `DashboardModals`, `LoopGroupSection` sub-components. |
| P2 | **Major** | Error handling | `frontend.tsx` | No React Error Boundary at the root level. Unrecoverable white screen on any component error. |
| P3 | **Major** | Code duplication | `hooks/loopActions.ts` scattered | 14 functions with identical boilerplate (log, fetch, check ok, parse error, throw, return). A generic `apiCall<T>()` wrapper would eliminate ~260 LOC. |
| P4 | **Major** | Code duplication | `CreateLoopForm.tsx` + `LoopActionBar.tsx` | Model grouping, sorting, and rendering logic duplicated between both components. Should be a shared `ModelSelector` component. |
| P5 | **Major** | Concurrency | `hooks/useLoop.ts:607-617` | Race condition when switching loops. No `AbortController` cancels stale fetch requests. Loop A's response may arrive and overwrite loop B's state. |
| P6 | **Major** | Performance | `hooks/useLoop.ts` scattered | Unbounded growth of `messages`, `toolCalls`, `logs` arrays for long-running loops. No pagination or maximum size limit. |
| P7 | **Major** | Bug — Double fetch | `hooks/useLoop.ts` dependency array | `refresh` callback's dependency array includes array lengths (`logs.length`, `messages.length`), causing re-trigger and double-fetch on mount. |
| P8 | **Major** | UX | `hooks/useLoop.ts`, `useLoops.ts` | Loading flicker on WebSocket-triggered refreshes. `setLoading(true)` called even for event-driven updates that should be seamless. |
| P9 | **Major** | Accessibility | `common/Modal.tsx` | No focus trapping — keyboard focus can escape the modal to background content. WCAG 2.1 Level A violation. |
| P10 | **Major** | Error handling | `Dashboard.tsx` scattered | Multiple catch blocks silently swallow errors. Users have no indication that operations failed. |
| P11 | **Major** | Code duplication | `core/logger.ts` vs `lib/logger.ts` | Logger constants (`LogLevelName`, `LOG_LEVELS`, `LOG_LEVEL_NAMES`, `DEFAULT_LOG_LEVEL`) fully duplicated between backend and frontend loggers. |
| P12 | **Minor** | Performance | `Dashboard.tsx` scattered | `groupLoopsByStatus` and `workspaceGroups` computed on every render without `useMemo`. |
| P13 | **Minor** | Consistency | `PlanReviewPanel.tsx:224-251` | Implements its own modal overlay instead of using the shared `Modal` component. Missing escape handling and focus management. |
| P14 | **Minor** | Code duplication | `Dashboard.tsx` | `GearIcon` and `WorkspaceGearIcon` are near-identical inline SVG components. |
| P15 | **Minor** | State management | `LoopModals.tsx` | Multiple modal states use repetitive `{open: boolean, loopId: string | null}` pattern — could use a generic `useModalState<T>()` hook. |
| P16 | **Minor** | Consistency | Components scattered | Logger usage varies: some create named loggers, others use global `log`, some don't log. |
| P17 | **Minor** | Dead code | `hooks/useWebSocket.ts` | `events` array accumulates all events but appears unused by consumers. |
| P18 | **Minor** | Dead code | `lib/index.ts` | Barrel re-exports logger but no consumer imports from `../lib`. All use `../lib/logger` directly. |
| P19 | **Minor** | Consistency | `hooks/useWorkspaces.ts` | No WebSocket integration for real-time updates, unlike `useLoops`. Workspace changes require manual refresh. |
| P20 | **Minor** | Best practices | `CreateLoopForm.tsx:280,403,490` | Multiple `eslint-disable-next-line react-hooks/exhaustive-deps` — suppressed dependency warnings. |
| P21 | **Suggestion** | Simplicity | `hooks/useLoop.ts` | Hook returns 20+ values — consider splitting into sub-hooks (`useLoopMessages`, `useLoopLogs`, etc.). |
| P22 | **Suggestion** | Best practices | `frontend.tsx` | No `React.StrictMode` wrapper. |

### Interface Quality

**Inbound (consumed by):** Nothing — this is the outermost layer.

**Outbound (depends on):**
- **API layer**: via `fetch()` calls in hooks and inline in components. No typed HTTP client — URLs are hardcoded strings, response parsing is manual, error handling is inconsistent.
- **Shared Infrastructure**: types from `types/`, status utilities from `utils/loop-status.ts`, logger from `lib/logger.ts`.

**Interface issues:**
1. No typed API client — all `fetch()` calls construct URLs manually and cast `response.json()` to expected types without validation
2. Status utility `loop-status.ts` imports `lib/logger` (frontend), which is correct for component usage but means the same utility cannot safely run on the backend
3. The `loopActions.ts` file is a thin wrapper over `fetch()` but provides no type safety on responses

### Test Coverage

| Area | LOC | Tests | Coverage |
|------|----:|:-----:|----------|
| Components | 7,527 | **520 tests** (18 files) | ~70% (common: 101, feature: 406, container: 13) |
| Hooks | 2,477 | **126 tests** (4 files) | ~65% (useLoop: 37, useLoops: 24, useWorkspaces: 20, loopActions: 45) |
| Lib | 383 | None | 0% |
| E2E scenarios | — | **50 tests** (8 files) | Good workflow coverage |

**Assessment:** ~~Zero automated test coverage.~~ **Updated:** 715 frontend tests now exist. Components and hooks — the highest-risk code — have good coverage. `useWebSocket` remains untested directly (exercised indirectly). `lib/logger.ts` has no tests. Remaining untested components (`MarkdownRenderer`, `ServerSettingsForm`, `AppSettingsModal`, `WorkspaceSettingsModal`, `CreateWorkspaceModal`, `Icons`, `LogLevelInitializer`) are lower-risk configuration/utility components. New files `useAgentsMdOptimizer.ts` and `CollapsibleSection.tsx` have no dedicated tests.

### Recommendations (Prioritized)

1. **Decompose `Dashboard.tsx`** into 5-6 smaller components (LoopList, DashboardHeader, DashboardModals, etc.)
2. **Add React Error Boundary** wrapping `<App />` in `frontend.tsx`
3. **Extract generic `apiCall<T>()`** wrapper to deduplicate 14 action functions
4. **Add `AbortController`** to `useLoop` for handling loop switches and unmounts
5. **Extract shared `ModelSelector`** component from CreateLoopForm and LoopActionBar
6. **Add focus trapping** to Modal component
7. **Add user-facing error notifications** — toast component or error state display
8. **Fix double-fetch** by removing array lengths from refresh dependency array
9. ~~**Add hook tests**~~ **Resolved** — 126 hook tests added using `renderHook` covering `useLoop`, `useLoops`, `useWorkspaces`, and all `loopActions` API functions
10. **Memoize expensive computations** with `useMemo` (loop grouping, workspace filtering)

---

## Layer 2: API (~3,545 LOC)

### Purpose

HTTP route handlers that expose REST endpoints for loops, workspaces, models, settings, git, and health. Also handles WebSocket upgrade for real-time event streaming.

### Files

| File | LOC | Role |
|------|----:|------|
| `api/loops.ts` | 1,351 | Loop CRUD, lifecycle control, plan/review operations |
| `api/workspaces.ts` | 695 | Workspace CRUD with server settings |
| `api/models.ts` | 426 | Model listing, preferences, log level |
| `api/agents-md.ts` | 234 | AGENTS.md optimization endpoints *(new)* |
| `api/git.ts` | 193 | Branch listing, repo info |
| `api/websocket.ts` | 134 | WebSocket upgrade and message routing |
| `api/settings.ts` | 132 | App config, DB reset, server kill |
| `api/validation.ts` | 121 | Zod schema parsing utilities |
| `api/index.ts` | 62 | Barrel export combining all routes |
| `api/health.ts` | 49 | Health check endpoint |
| `utils/event-stream.ts` | 148 | Async iterable event buffer for SSE |

**Total:** ~3,545 LOC across 11 files

### Health Score: C+

The API layer has good organizational structure (one file per resource) and a clean barrel export pattern. However, it suffers from systematic code duplication, inconsistent error response formats, and architectural violations where handlers directly access the persistence layer.

### Pattern Analysis

**Strengths:**
- One-file-per-resource organization is clean and discoverable
- Zod validation via `parseAndValidate()` is a good pattern
- The barrel aggregation of routes into a single `apiRoutes` object works well with Bun's server
- `health.ts` is a model of simplicity — clean, focused, no issues

**Anti-Patterns:**
- **Layer bypassing**: `loops.ts` directly imports from `persistence/loops.ts` and `persistence/database.ts`, bypassing Core business logic
- **Error response inconsistency**: Three independently defined `errorResponse()` helpers. `workspaces.ts` uses different error shapes than other files
- **Handler pattern inconsistency**: `workspaces.ts` uses `if (req.method === "GET")` branching while all other files use Bun's named method handlers
- **Boilerplate duplication**: Workspace lookup + 404, git endpoint boilerplate, preflight validation checks

### Findings

| # | Severity | Dimension | Location | Finding |
|---|----------|-----------|----------|---------|
| A1 | ~~**Critical**~~ N/A | ~~Security~~ | `api/settings.ts:115` | ~~`POST /api/server/kill` calls `process.exit(0)` with no authentication. Any client with network access can terminate the server.~~ **Not Applicable** — authentication and authorization are enforced by a reverse proxy at the infrastructure level. See `AGENTS.md` § Authentication & Authorization. |
| A2 | ~~**Major**~~ N/A | ~~Security~~ | `api/settings.ts:79` | ~~`POST /api/settings/reset-all` is destructive (deletes entire database) with no authentication or confirmation.~~ **Not Applicable** — authentication and authorization are enforced by a reverse proxy at the infrastructure level. |
| A3 | **Major** | Layering violation | `api/loops.ts:22-23` | Direct imports from persistence layer: `updateLoopState`, `getActiveLoopByDirectory`, `getReviewComments`. Bypasses `LoopManager` business rules and event emission. |
| A4 | **Major** | Layering violation | `api/loops.ts:695-702` | Draft-to-planning transition directly mutates `loop.state.status` and `loop.state.planMode`, then calls `updateLoopState()` from persistence. Bypasses `LoopManager.startPlanMode()`. |
| A5 | **Major** | Code duplication | `api/loops.ts`, `models.ts`, `settings.ts` | `errorResponse()` helper independently defined in 3 files with identical implementation. |
| A6 | **Major** | Consistency | `api/workspaces.ts` scattered | Uses `if (req.method === "GET")` branching instead of Bun's named method handlers used by all other API files. |
| A7 | **Major** | Code duplication | `api/loops.ts:169-216` vs `631-688` | Preflight validation (uncommitted changes + active loop check) duplicated between create and draft/start handlers (~50 LOC). |
| A8 | **Major** | Code duplication | `api/workspaces.ts` 5 locations | Workspace lookup + 404 pattern repeated 5 times. Should be `requireWorkspace(id)`. |
| A9 | **Major** | Code duplication | `api/git.ts:83-129` vs `147-192` | Two endpoints share ~40 lines of identical boilerplate (workspace lookup, executor creation, GitService instantiation). |
| A10 | **Major** | Performance | `utils/event-stream.ts` scattered | `items` buffer grows unboundedly. No backpressure, no max buffer size. Fast producer + slow consumer = memory exhaustion. |
| A11 | **Minor** | Consistency | `api/workspaces.ts` scattered | Error response format differs from rest of API — `{ message, error }` vs convention `{ error, message }`. |
| A12 | **Minor** | Consistency | API files scattered | Logger initialization inconsistent: `loops.ts` uses singleton `log`, `settings.ts` uses `createLogger("api:settings")`. |
| A13 | **Minor** | Concurrency | `api/loops.ts:198-216` | TOCTOU race condition between checking for active loops and creating one. |
| A14 | **Minor** | Security | `api/websocket.ts` scattered | No origin validation on WebSocket upgrade. No connection limit. |
| A15 | **Minor** | Error handling | `api/websocket.ts` scattered | Silent JSON parsing error swallowing. Malformed WebSocket messages dropped. |
| A16 | **Minor** | Dead code | `api/validation.ts` | `validateRequest` exported but may be unused — `parseAndValidate` is the pattern API handlers use. |
| A17 | **Suggestion** | Security | `api/loops.ts` | `stopPattern` field (regex from user input) should be validated for ReDoS. |

### Interface Quality

**Inbound (consumed by):** Presentation layer via `fetch()` calls.
- No API client library or typed SDK
- URLs are hardcoded strings in hooks/components
- Response types are manually cast without runtime validation

**Outbound (depends on):**
- **Core**: `LoopManager`, `BackendManager`, `GitService` (correct)
- **Persistence**: `updateLoopState`, `getActiveLoopByDirectory`, `getReviewComments` (incorrect — violates layering)
- **Shared Infrastructure**: types, schemas, logger

**Interface issues:**
1. **No API contract enforcement** — no OpenAPI spec, no generated types, no shared contract between frontend and backend
2. **Mixed response shapes** — `ErrorResponse` type exists but is not uniformly applied
3. **Inconsistent status codes** — some error paths return 400, others 500, without clear rules

### Test Coverage

| Area | LOC | Tests | Coverage |
|------|----:|:-----:|----------|
| API route handlers | 3,397 | Partial | ~40% (integration tests cover main flows) |
| Event stream | 148 | None | 0% |

**Assessment:** Core loop CRUD flows have integration test coverage. Git endpoints, WebSocket handler, and event stream have no tests. The `event-stream.ts` concurrency primitive is critical infrastructure with zero tests.

### Recommendations (Prioritized)

1. ~~**Add authentication** to `POST /api/server/kill` — at minimum a token check~~ **Not Applicable** — authentication is enforced by reverse proxy
2. **Route all persistence calls through Core** — remove direct `updateLoopState` imports from API handlers
3. **Extract shared `errorResponse()`** to `api/helpers.ts` or `api/validation.ts`
4. **Migrate `workspaces.ts` to named method handlers** — align with other API files
5. **Extract `requireWorkspace(id)` helper** for lookup + 404
6. **Add buffer size limit** to `event-stream.ts`
7. **Standardize error response shape** — enforce `ErrorResponse` type everywhere

---

## Layer 3: Core Business Logic (~6,285 LOC)

### Purpose

Central orchestration of loop lifecycle, iteration execution, git operations, and backend connection management. This layer contains the domain logic that gives Ralpher its behavior.

### Files

| File | LOC | Role |
|------|----:|------|
| `core/loop-manager.ts` | 2,409 | Loop CRUD, start/stop/accept/discard/push lifecycle |
| `core/loop-engine.ts` | 2,079 | Iteration execution, event processing, agent interaction |
| `core/git-service.ts` | 1,492 | Git branch, commit, merge, diff, push operations |
| `core/agents-md-optimizer.ts` | 234 | AGENTS.md optimization logic *(new)* |
| `core/event-emitter.ts` | 72 | Simple typed pub/sub event system |

**Note:** `config.ts`, `logger.ts`, `command-executor.ts`, and `remote-command-executor.ts` are placed in Layer 5 (External Integration) or Layer 6 (Shared Infrastructure) based on their primary role.

**Total:** ~6,285 LOC across 5 files (excluding infrastructure files)

### Health Score: C+

The Core layer contains the most critical business logic but also the most concentrated complexity. Two files exceed 2,000 LOC each. The absence of a formal state machine for loop transitions is the largest architectural gap. *(Note: The fire-and-forget async pattern is intentional for long-running processes — see B1.)*

### Pattern Analysis

**Strengths:**
- `LoopManager` is the intended single authority for loop lifecycle — the pattern is correct even if the boundary is violated by the API layer
- `GitService.withExecutor(executor)` is a clean dependency injection pattern that enables testing
- `EventEmitter` is a simple, focused, well-typed implementation
- The `BackendManager` handles workspace-to-backend mapping effectively

**Anti-Patterns:**
- **God methods**: `acceptLoop()` (~200 lines) and `runIteration()` (~250 lines) handle multiple concerns in single methods
- **Direct state mutation before persistence**: `loop.state.status = "starting"` before `updateLoopState()` — if persistence fails, in-memory and database diverge
- **Scattered state validation**: No centralized transition table — each method independently checks allowed states

*(Note: The fire-and-forget pattern in `engine.start().catch()` is intentional — the engine is a long-running process with self-contained error handling. See B1.)*

### Findings

| # | Severity | Dimension | Location | Finding |
|---|----------|-----------|----------|---------|
| B1 | ~~**Critical**~~ **By Design** | ~~Best practices~~ | `loop-manager.ts:381-383` | ~~Fire-and-forget: `engine.start().catch()` is not awaited. Also at `loop-manager.ts:800-805` for draft loop start. Violates AGENTS.md explicitly.~~ **By Design — Intentional Architecture:** The fire-and-forget pattern is intentional for long-running processes. The loop engine runs a `while`-loop with multiple AI iterations (potentially hours). Awaiting would block the HTTP response indefinitely. The engine has comprehensive self-contained error handling (`handleError()` updates state to "failed", emits error events, `trackConsecutiveError()` for failsafe exit). Errors are reported via event emitter and persistence callbacks, not exceptions. See `AGENTS.md` § Async Patterns for the documented exception. |
| B2 | **Major** | State management | Multiple locations | No centralized state machine. Status transitions validated ad-hoc in `startLoop()`, `stopLoop()`, `acceptLoop()`, etc. No transition table, no invalid-transition prevention at the type level. |
| B3 | **Major** | Data integrity | `loop-manager.ts` scattered | Direct mutation of `loop.state` properties before calling `updateLoopState()`. If persistence fails, in-memory object has already been mutated. |
| B4 | **Major** | Complexity | `loop-manager.ts:~600-800` | `acceptLoop()` is ~200 lines handling merge preparation, execution, conflict detection, error recovery, branch cleanup, and state persistence. |
| B5 | **Major** | Complexity | `loop-engine.ts` scattered | `runIteration()` is ~250 lines mixing event loop management, prompt construction, response parsing, error classification, and state updates. |
| B6 | **Major** | Code duplication | `loop-manager.ts:350,520` | Branch name generation logic duplicated between `startLoop` and `startDraftLoop`. |
| B7 | **Major** | Code duplication | `loop-engine.ts` scattered | Duplicate prompt-building logic between `start()` and `runIteration()`. |
| B8 | **Major** | Error handling | `git-service.ts` scattered | Many methods wrap operations in try/catch that converts errors to generic messages, losing stack trace information. |
| B9 | **Major** | Error handling | `git-service.ts:isGitRepo()` | Catches all errors and returns `false`. Disk permission errors, network issues, and filesystem corruption all reported as "not a git repo." |
| B10 | **Minor** | Testability | `backend-manager.ts` module-level | Module-level singleton pattern hinders testability. Cannot replace with test doubles without module mocking. |
| B11 | **Minor** | Naming | `loop-engine.ts` | `isLoopRunning` property name shadows the utility function `isLoopRunning` from `utils/loop-status.ts`. Different semantics, same name. |
| B12 | **Minor** | Configuration | `loop-engine.ts` scattered | Magic numbers: `maxConsecutiveErrors=3`, iteration delay `1000ms`, activity timeout `180s`, branch name length `40`. Should be named constants. |
| B13 | **Minor** | Performance | `loop-engine.ts` scattered | `logs` array grows unboundedly during long-running loops. |
| B14 | **Minor** | Security | `loop-engine.ts` scattered | `stopPattern` matching uses `new RegExp()` on user patterns without try/catch — invalid regex risks `SyntaxError` and ReDoS. |
| B15 | **Suggestion** | Architecture | — | Consider adopting a state machine pattern (transition table or XState) for loop status transitions. |
| B16 | **Suggestion** | Separation of concerns | `loop-engine.ts` | Extract prompt building into a separate `PromptBuilder` class. |

### Interface Quality

**Inbound (consumed by):** API layer (correct), some direct persistence access from API (incorrect).
- `LoopManager` exposes a clear public API: `createLoop`, `startLoop`, `stopLoop`, `acceptLoop`, `discardLoop`, etc.
- `BackendManager` provides `getCommandExecutorAsync()` and `getSdkClient()` for workspace-scoped resource access
- `GitService.withExecutor()` provides a clean factory pattern

**Outbound (depends on):**
- **Data Access**: imports from `persistence/loops.ts`, `persistence/workspaces.ts`, `persistence/preferences.ts`, `persistence/database.ts`
- **External Integration**: imports from `backends/types.ts`, `backends/opencode/index.ts`
- **Shared Infrastructure**: types, utils, logger

**Interface issues:**
1. **Missing query methods**: The API layer bypasses Core because Core doesn't expose some needed queries (e.g., `getActiveLoopByDirectory`, `getReviewComments`). Adding these to `LoopManager` would eliminate the layering violation.
2. **Incomplete barrel export**: `core/index.ts` only exports `event-emitter`, `git-service`, `loop-engine`, `loop-manager`. Missing `config`, `logger`, `backend-manager`, `command-executor`, `remote-command-executor`.

### Test Coverage

| Area | LOC | Tests | Coverage |
|------|----:|:-----:|----------|
| `loop-manager.ts` | 2,409 | Good | ~70% (unit + scenario tests) |
| `loop-engine.ts` | 2,079 | Good | ~75% (largest test file, 1,375 LOC) |
| `git-service.ts` | 1,492 | Good | ~60% |
| `backend-manager.ts` | 765 | Minimal | ~20% |
| `event-emitter.ts` | 72 | None | 0% |

**Assessment:** The two most critical files have good test coverage. `backend-manager.ts` and `event-emitter.ts` are under-tested.

### Recommendations (Prioritized)

1. ~~**Fix fire-and-forget async** in `startLoop()`~~ **By Design** — The engine is a long-running process with self-contained error handling. See `AGENTS.md` § Async Patterns.
2. **Introduce a state machine** — centralize loop status transitions with a transition table
3. **Decompose `acceptLoop()`** — split into merge-prepare, merge-execute, merge-finalize
4. **Decompose `runIteration()`** — extract prompt building, event processing, error handling
5. **Fix state mutation ordering** — persist first, then update in-memory state on success
6. **Add query methods to LoopManager** — `getActiveLoopByDirectory()`, `getReviewComments()` so API layer doesn't need direct persistence access

---

## Layer 4: Data Access (~2,061 LOC)

### Purpose

SQLite database management, schema creation, migrations, and CRUD operations for loops, workspaces, and preferences. Uses Bun's synchronous SQLite API.

### Files

| File | LOC | Role |
|------|----:|------|
| `persistence/loops.ts` | 566 | Loop CRUD, state updates, row mapping |
| `persistence/migrations/index.ts` | 571 | Schema migration system (14 migrations) |
| `persistence/database.ts` | 386 | DB init, schema, review comments |
| `persistence/workspaces.ts` | 327 | Workspace CRUD |
| `persistence/preferences.ts` | 178 | Key-value preference storage |
| `persistence/paths.ts` | 24 | Data directory helpers (vestigial) |
| `persistence/index.ts` | 9 | Barrel exports |

**Total:** 2,061 LOC across 7 files

### Health Score: B-

The Data Access layer is the most internally consistent layer. CRUD operations follow predictable patterns, the migration system is well-designed with idempotency checks, and the code is straightforward. The main issues are data integrity risks (INSERT OR REPLACE cascade, unguarded JSON.parse) and organizational debt (review comments in database.ts).

### Pattern Analysis

**Strengths:**
- Migration system with sequential versioning and idempotency checks is well-designed
- Consistent row-to-object conversion pattern (`rowToLoop`, `rowToWorkspace`)
- Clean separation by domain entity (loops, workspaces, preferences)
- `ALLOWED_LOOP_COLUMNS` whitelist for dynamic column updates is a good safety measure

**Anti-Patterns:**
- **INSERT OR REPLACE**: `saveLoop()` uses `INSERT OR REPLACE` which triggers `ON DELETE CASCADE`, silently destroying review comments
- **Unguarded JSON.parse**: 6 `JSON.parse()` calls in `rowToLoop()` without try/catch — one corrupt row breaks all loop listing
- **Misplaced domain logic**: Review comment functions (`insertReviewComment`, `getReviewComments`, `markCommentsAsAddressed`) in `database.ts` instead of a dedicated module
- **Dual schema source of truth**: Base schema in `createTables()` includes columns from early migrations, diverging from migration-only path

### Findings

| # | Severity | Dimension | Location | Finding |
|---|----------|-----------|----------|---------|
| D1 | **Critical** | Security | `migrations/index.ts:57` | SQL injection in `getTableColumns()` — `tableName` interpolated directly into PRAGMA query. Currently safe (hardcoded inputs) but dangerous pattern. |
| D2 | **Major** | Data integrity | `persistence/loops.ts:289` | `INSERT OR REPLACE` triggers `ON DELETE CASCADE`, silently destroying review comments. Should use `INSERT ... ON CONFLICT DO UPDATE` (upsert). |
| D3 | **Major** | Error handling | `persistence/loops.ts:196-267` | 6 `JSON.parse()` calls in `rowToLoop()` without error handling. One corrupt row prevents listing ALL loops. |
| D4 | **Major** | Schema management | `database.ts:createTables` vs migrations | Dual sources of truth. Base schema includes columns from migrations 1-8. Fresh and upgraded databases may diverge if either source is modified independently. |
| D5 | **Major** | Code duplication | `persistence/loops.ts:422-506` | `updateLoopState()` and `updateLoopConfig()` are near-identical ~40-line functions. Only differ in which field they serialize. Should be unified into `updateLoopFields()`. **Partially Resolved:** Both functions now use `UPDATE` instead of `INSERT OR REPLACE`, eliminating the cascade delete risk for these paths. `saveLoop()` at line 295 still uses `INSERT OR REPLACE`. |
| D6 | **Major** | Separation of concerns | `database.ts:312-385` | Review comment functions belong in a dedicated `persistence/review-comments.ts`, not in database infrastructure. |
| D7 | **Minor** | Barrel export | `persistence/index.ts` | Missing re-export of `workspaces.ts`. Consumers must import directly. |
| D8 | **Minor** | Async overhead | All persistence files | All functions marked `async` despite containing zero `await` — Bun SQLite is synchronous. Every caller pays unnecessary Promise wrapping. |
| D9 | **Minor** | Performance | `persistence/loops.ts` scattered | No prepared statement caching. `loadLoop` (called on every polling cycle) creates new statement objects each time. |
| D10 | **Minor** | Architecture | `persistence/paths.ts` | Vestigial module (24 LOC) — `ensureDataDirectories` just calls `initializeDatabase`. Unnecessary indirection. |
| D11 | **Minor** | Consistency | `database.ts:getReviewComments` | Returns raw snake_case column names, leaking DB schema to consumers. Other modules (loops, workspaces) convert to camelCase. |
| D12 | **Suggestion** | Error handling | — | No centralized error types. `NotFoundError`, `ValidationError` would enable consistent handling across layers. |

### Interface Quality

**Inbound (consumed by):** Core layer (correct), API layer (incorrect — direct access bypasses Core).

**Outbound (depends on):**
- `core/logger.ts` — logging only
- No other internal dependencies

**Interface issues:**
1. **Leaky abstraction**: Review comment queries return raw snake_case row data while other queries return camelCase mapped objects
2. **Missing barrel entry**: `workspaces.ts` not in barrel, forcing direct imports
3. **Async facade over sync**: The async function signatures suggest I/O but are pure synchronous operations, misleading callers about performance characteristics

### Test Coverage

| Area | LOC | Tests | Coverage |
|------|----:|:-----:|----------|
| `migrations/index.ts` | 552 | Good | ~80% (dedicated migration tests) |
| `loops.ts` | 560 | Indirect | ~50% (tested via loop-manager scenario tests) |
| `workspaces.ts` | 239 | Indirect | ~40% (tested via API integration tests) |
| `database.ts` | 386 | Minimal | ~20% |
| `preferences.ts` | 178 | Minimal | ~15% |

**Assessment:** The migration system has the best test coverage in this layer. The CRUD functions are tested indirectly through integration tests but lack direct unit tests that would catch edge cases (corrupt JSON, concurrent access, empty inputs).

### Recommendations (Prioritized)

1. **Replace `INSERT OR REPLACE` with upsert** (`INSERT ... ON CONFLICT DO UPDATE`) to prevent cascade deletes
2. **Add try/catch to JSON.parse** calls in `rowToLoop()` with sensible defaults per field
3. **Validate table names** in `getTableColumns()` against an allowlist
4. **Move review comment functions** to `persistence/review-comments.ts`
5. **Unify `updateLoopState`/`updateLoopConfig`** into generic `updateLoopFields()`
6. **Add `workspaces.ts` to barrel exports**

---

## Layer 5: External Integration (~2,597 LOC)

### Purpose

Interfaces with external systems: the opencode SDK for AI agent communication, and remote command execution for workspace operations on remote servers.

### Files

| File | LOC | Role |
|------|----:|------|
| `backends/opencode/index.ts` | 1,015 | OpenCode SDK adapter: connection, prompts, events |
| `core/remote-command-executor.ts` | 493 | Remote command execution via PTY/WebSocket |
| `core/backend-manager.ts` | 765 | Backend lifecycle management (also in Layer 3) |
| `backends/types.ts` | 239 | Backend interface, event types, data structures |
| `core/command-executor.ts` | 79 | CommandExecutor interface + local Bun impl |
| `backends/index.ts` | 6 | Barrel exports |

**Note:** `backend-manager.ts` spans Layer 3 (business logic for workspace-backend mapping) and Layer 5 (external system integration). It is analyzed in both layers for the relevant concerns.

**Total:** ~2,597 LOC across 6 files

### Health Score: C

The External Integration layer has a well-designed abstraction (`Backend` interface, `CommandExecutor` interface) but suffers from type safety gaps (`unknown` return types), a critical async bug, and high function complexity.

### Pattern Analysis

**Strengths:**
- `Backend` interface provides clean abstraction over the opencode SDK
- `CommandExecutor` interface enables swapping local/remote execution transparently
- `GitService.withExecutor()` consumer pattern is clean dependency injection
- `RemoteCommandExecutor` correctly uses PTY/WebSocket for remote operations

**Anti-Patterns:**
- **Fire-and-forget IIFE**: `translateEvent()` contains an async IIFE that is never awaited
- **Type safety holes**: `getSdkClient()` returns `unknown`, `getModels()` returns `unknown[]`, forcing unsafe casts everywhere
- **8-parameter function**: `translateEvent()` accepts 8 parameters — indicator of too many responsibilities
- **Blanket error catching**: `getSession()` catches all errors as "not found", losing distinction between 404, 500, network errors

### Findings

| # | Severity | Dimension | Location | Finding |
|---|----------|-----------|----------|---------|
| E1 | ~~**Critical**~~ **By Design** | ~~Best practices~~ | `opencode/index.ts:834-851` | ~~Fire-and-forget async IIFE in `translateEvent()`. Async `client.session.get()` call is never awaited. Errors silently swallowed, call may execute after enclosing function returns.~~ **By Design — Intentional Architecture:** This async IIFE is purely diagnostic logging code inside a `session.idle` handler. It fetches session details for debugging when no assistant messages were seen (an edge case). It has its own `try/catch`, its result doesn't affect the return value of `translateEvent()`, and blocking for it would delay event processing unnecessarily. See `AGENTS.md` § Async Patterns. |
| E2 | **Major** | Type safety | `backends/types.ts:getSdkClient()` | Returns `unknown`, forcing all consumers to use unsafe `as unknown as OpencodeClient` double casts. Should be generic: `Backend<TClient>`. |
| E3 | **Major** | Type safety | `backends/types.ts:getModels()` | Returns `Promise<unknown[]>`. Zero type information for consumers. Must cast to `ModelInfo[]`. |
| E4 | **Major** | Code duplication | `opencode/index.ts:335-341` vs `375-381` | Prompt construction logic duplicated between `sendPrompt` and `sendPromptAsync`. |
| E5 | **Major** | Error handling | `opencode/index.ts:298-301` | `getSession()` catches all errors and returns `null`. Server errors, network timeouts, and SDK-level session authentication failures indistinguishable from 404. *(Note: this refers to SDK-level session authentication between Ralpher and the opencode backend, not user-facing auth which is handled by reverse proxy.)* |
| E6 | **Major** | Complexity | `opencode/index.ts:translateEvent()` | Function accepts 8 parameters. Should use an options object or be a method on a class with injected dependencies. |
| E7 | **Major** | Code duplication | `backend-manager.ts` scattered | `getCommandExecutor` (sync) and `getCommandExecutorAsync` (async) contain nearly identical logic. Should be unified. |
| E8 | **Major** | Type safety | `backend-manager.ts:getSdkClient()` | Uses double unsafe cast `as unknown as OpencodeClient` to get SDK client for remote executor creation. |
| E9 | **Minor** | Security | `remote-command-executor.ts:exec` | Command arguments concatenated into strings for remote execution. Currently safe but fragile for shell injection. |
| E10 | **Minor** | Error handling | `remote-command-executor.ts:readFile` | Falls back to empty string on error without logging. Silent failure. |
| E11 | **Minor** | Dead code | `opencode/index.ts:1011-1015` | `getServerUrl()` is unused and breaks encapsulation. |
| E12 | **Suggestion** | Performance | `remote-command-executor.ts` | No timeout support for remote commands. Hung commands block indefinitely. |

### Interface Quality

**Inbound (consumed by):** Core layer.
- `LoopEngine` uses `Backend` interface for prompt sending and event receiving
- `LoopManager` and `GitService` use `CommandExecutor` for remote operations
- `BackendManager` creates and manages `Backend` and `CommandExecutor` instances

**Outbound (depends on):**
- OpenCode SDK (`@anthropic-ai/sdk` or equivalent) — external dependency
- `utils/event-stream.ts` — for streaming events

**Interface issues:**
1. **Type safety gap at boundary**: `unknown` returns force unsafe casts. Every consumer re-introduces type unsafety.
2. **Over-exported internals**: `backends/index.ts` re-exports everything including `translateEvent`, `customFetch` — internal implementation details leak through barrel.
3. **No typed error contract**: `getSession()` returning `null` for all errors provides no error discrimination.

### Test Coverage

| Area | LOC | Tests | Coverage |
|------|----:|:-----:|----------|
| `opencode/index.ts` | 1,015 | Minimal | ~15% (mostly "not connected" error tests) |
| `remote-command-executor.ts` | 493 | None | 0% |
| `backend-manager.ts` | 765 | Minimal | ~20% |
| `command-executor.ts` | 79 | Indirect | ~50% (via git-service tests) |
| `backends/types.ts` | 239 | N/A | Type definitions |

**Assessment:** Weakest test coverage of any layer. The OpenCode backend adapter (1,015 LOC) and remote command executor (493 LOC) are essentially untested. The mock backend system (`tests/mocks/mock-backend.ts`) provides good test infrastructure but only mocks the happy path.

### Recommendations (Prioritized)

1. **Await the async IIFE** in `translateEvent()` or restructure with proper error handling
2. **Type `getSdkClient()` with generics** — `Backend<TClient>` or use concrete SDK types
3. **Type `getModels()`** return to `Promise<ModelInfo[]>`
4. **Extract shared prompt builder** between `sendPrompt` and `sendPromptAsync`
5. **Bundle `translateEvent` parameters** into an options/context object
6. **Add timeout support** for remote command execution
7. **Restrict barrel exports** to only public API surface

---

## Layer 6: Shared Infrastructure (~2,345 LOC)

### Purpose

Types, schemas, utilities, configuration, and logging that are consumed by multiple layers. This layer has no business logic — it provides the foundational definitions and shared tools.

### Files

| Sublayer | File | LOC | Role |
|----------|------|----:|------|
| Types | `types/events.ts` | 536 | Loop event types, event data unions |
| Types | `types/loop.ts` | 400 | Loop, LoopConfig, LoopState types, defaults |
| Types | `types/api.ts` | 278 | API request/response DTOs |
| Types | `types/schemas/loop.ts` | 120 | Zod schemas for loop validation |
| Types | `types/schemas/workspace.ts` | 108 | Zod schemas for workspace validation |
| Types | `types/schemas/index.ts` | 65 | Barrel for schemas |
| Types | `types/workspace.ts` | 95 | Workspace type definitions |
| Types | `types/schemas/preferences.ts` | 44 | Zod schemas for preferences |
| Types | `types/settings.ts` | 43 | ServerMode, ConnectionStatus types |
| Types | `types/schemas/model.ts` | 33 | Zod schemas for models |
| Types | `types/index.ts` | 8 | Barrel for types |
| Utils | `utils/loop-status.ts` | 135 | Status label, running/terminal checks, colors |
| Utils | `utils/name-generator.ts` | 142 | AI-powered loop name generation |
| Utils | `utils/index.ts` | 32 | Barrel + inline `sanitizeBranchName` |
| Infra | `core/logger.ts` | 129 | Backend tslog wrapper |
| Infra | `core/config.ts` | 34 | Application config from environment |
| Config | `src/index.html` | 14 | HTML shell |
| Config | `src/index.css` | ~15 | Tailwind CSS imports |
| Config | `tsconfig.json` | 36 | TypeScript configuration |
| Config | `package.json` | 32 | Package manifest |

**Total:** ~2,345 LOC across ~20 files

### Health Score: B

The Shared Infrastructure layer has the least severe issues of any layer. Types are well-structured, Zod schemas provide validation, and configuration is straightforward. The main issues are dead code (16 unused `*Input` type aliases), name collisions, and the logger duplication between `core/logger.ts` and `lib/logger.ts`.

### Pattern Analysis

**Strengths:**
- Zod schemas are well-structured with appropriate validation rules
- Domain types (`Loop`, `LoopConfig`, `LoopState`) are comprehensive and well-defined
- `LoopStatus` union type provides compile-time safety for status values
- Clean separation between types (TypeScript) and schemas (Zod runtime validation)

**Anti-Patterns:**
- **Dead type exports**: 16 `*Input` type aliases across schema files are never imported by any consumer
- **Runtime logic in type files**: `createInitialState()`, `getDefaultServerSettings()`, `createTimestamp()`, `DEFAULT_LOOP_CONFIG` are runtime values in files named as type definitions
- **Name collision**: `ConnectionStatus` defined in `settings.ts` (interface) and `useWebSocket.ts` (string union) with entirely different meanings
- **Reverse dependency**: `types/loop.ts` imports `TodoItem` from `backends/types.ts` — types layer depends on implementation layer

### Findings

| # | Severity | Dimension | Location | Finding |
|---|----------|-----------|----------|---------|
| S1 | **Major** | Dead code | Schema files (4 files) | 16 `*Input` type aliases exported but never imported anywhere. Dead exports. |
| S2 | **Major** | Dead code | `types/api.ts:249-258` | `LogEntry` interface is never imported. A separate `LogEntry` in `LogViewer.tsx` is used instead. |
| S3 | **Major** | Bug | `core/logger.ts:103-108` | `setLogLevel()` only updates parent logger. Sub-loggers created via `createLogger()` retain original level. Runtime log level changes fail silently for all sub-loggers on backend. |
| S4 | **Major** | Code duplication | `core/logger.ts` vs `lib/logger.ts` | Logger constants fully duplicated. Behavioral inconsistency: frontend caches sub-loggers and propagates level changes, backend does not. |
| S5 | **Major** | Name collision | `types/settings.ts` vs `hooks/useWebSocket.ts` | `ConnectionStatus` means two different things in different modules. |
| S6 | **Minor** | Boundary violation | `types/loop.ts` imports | `TodoItem` imported from `../backends/types` — domain types depend on backend implementation. Should define `TodoItem` in types and import from there in backends. |
| S7 | **Minor** | Barrel completeness | `types/index.ts` | Missing re-export of `settings.ts`. |
| S8 | **Minor** | Code organization | `utils/index.ts:23-30` | `sanitizeBranchName` defined inline in barrel file instead of its own module. |
| S9 | **Minor** | Edge case | `utils/index.ts:sanitizeBranchName` | Returns empty string for all-special-character input — invalid git branch name. |
| S10 | ~~**Minor**~~ **Resolved** | ~~Missing case~~ | `utils/loop-status.ts:getStatusLabel` | ~~Missing `"draft"` case in switch. Falls through to default returning raw string.~~ **Resolved:** Draft case now present at line 26-27. |
| S11 | **Suggestion** | Type safety | `types/schemas/preferences.ts` | `SetLogLevelRequestSchema` uses `z.string()` but should use `z.enum()` for valid log levels. |
| S12 | **Suggestion** | Architecture | `types/events.ts` | `MessageData`/`PersistedMessage` and `ToolCallData`/`PersistedToolCall` are near-identical mirror types. Unifying or deriving one from the other would reduce surface area. |

### Interface Quality

**Inbound (consumed by):** All other layers.
- Types are imported by every module in the codebase
- Zod schemas are used by the API layer for request validation
- Logger is used by Core, API, and Data Access layers
- Status utilities are used by Presentation and API layers

**Outbound (depends on):**
- `tslog` — external logging library
- `zod` — external validation library
- `backends/types.ts` — **reverse dependency** from `types/loop.ts` importing `TodoItem`

**Interface issues:**
1. **Reverse dependency**: Types should be a leaf dependency with no internal imports, but `loop.ts` imports from `backends/types.ts`
2. **Dead exports inflate API surface**: 16 dead `*Input` types in the schema barrel create a misleading public API
3. **Logger split**: Two separate logger modules (`core/logger.ts` and `lib/logger.ts`) with duplicated constants and divergent behavior. Consumers must know which to import.

### Test Coverage

| Area | LOC | Tests | Coverage |
|------|----:|:-----:|----------|
| Types | 1,730 | N/A | Type definitions (no runtime code to test) |
| Zod schemas | ~277 | None | 0% (validated indirectly through API tests) |
| `loop-status.ts` | 135 | None | 0% |
| `name-generator.ts` | 142 | Good | ~70% |
| `sanitizeBranchName` | ~10 | None | 0% |
| `core/logger.ts` | 129 | None | 0% |
| `core/config.ts` | 34 | None | 0% |

**Assessment:** `name-generator.ts` has good test coverage. All other utilities and the logger have zero tests. `loop-status.ts` is particularly notable — it contains critical UI logic (status labels, color mapping) used by the Presentation layer with no test coverage.

### Recommendations (Prioritized)

1. **Fix backend logger sub-logger sync** — port the caching/update pattern from `lib/logger.ts` to `core/logger.ts`
2. **Extract shared logger constants** to a shared `logger-constants.ts` imported by both
3. **Remove dead `*Input` type aliases** from schema files
4. **Rename one `ConnectionStatus`** to avoid ambiguity (e.g., `ServerConnectionStatus` vs `WebSocketConnectionStatus`)
5. **Move `TodoItem`** definition to `types/loop.ts`, import from there in `backends/types.ts`
6. ~~**Add `"draft"` case** to `getStatusLabel()` switch~~ **Resolved** — draft case now present
7. **Add unit tests** for `loop-status.ts` and `sanitizeBranchName`

---

## Cross-Layer Analysis

### Dependency Flow

```
                    ┌─────────────────┐
                    │   Presentation   │
                    │  (10,495 LOC)    │
                    └────────┬────────┘
                             │ fetch() — no typed client
                             ▼
                    ┌─────────────────┐
                    │      API         │
                    │   (3,545 LOC)    │
                    └───┬─────────┬───┘
                        │         │
             correct    │         │ VIOLATION
                        ▼         ▼
              ┌──────────────┐  ┌──────────────┐
              │ Core Business│  │  Data Access  │
              │  (6,285 LOC) │  │  (2,061 LOC)  │
              └──────┬───────┘  └──────────────┘
                     │                 ▲
                     │    correct      │
                     └─────────────────┘
                     │
                     ▼
              ┌──────────────┐
              │   External   │
              │ Integration  │
              │  (2,597 LOC) │
              └──────────────┘
                     │
                     ▼
              ┌──────────────┐
              │    Shared    │
              │Infrastructure│
              │  (2,345 LOC) │
              └──────────────┘
```

**Key violations:**
1. **API → Data Access** (bypasses Core): `api/loops.ts` imports `updateLoopState`, `getActiveLoopByDirectory`, `getReviewComments` directly from persistence. This skips `LoopManager`'s validation, event emission, and business rules.
2. **Shared Infrastructure → External Integration** (reverse dependency): `types/loop.ts` imports `TodoItem` from `backends/types.ts`. The types layer should be a leaf dependency.

### Data Flow Patterns

**Loop creation flow (happy path):**
```
Presentation → API → Core (LoopManager) → Data Access (saveLoop)
                                        → External Integration (engine.start — FIRE AND FORGET)
                                          → External (opencode SDK)
                                            → Core (event emitter)
                                              → API (WebSocket broadcast)
                                                → Presentation (useLoop state update)
```

**Issue:** The data flow forks at `engine.start()`. The API response returns before the engine finishes starting. The Presentation layer discovers state changes only through WebSocket events or polling. If the engine fails silently, no event is emitted, and the loop appears stuck.

**Settings change flow:**
```
Presentation → API → Core (logger.setLogLevel) → BROKEN for sub-loggers
             → Data Access (preferences.setLogLevelPreference) → persisted correctly
Presentation → Lib (logger.setLogLevel) → CORRECT for sub-loggers
```

**Issue:** The log level change has split behavior — it persists correctly but only propagates to sub-loggers on the frontend, not the backend.

### Error Propagation

Error handling at layer boundaries is the weakest cross-cutting concern:

| Boundary | Pattern | Quality |
|----------|---------|---------|
| Presentation → API | `fetch()` + `response.ok` check | Poor — errors caught and `console.error`'d with no user feedback |
| API → Core | Direct function calls with try/catch | Acceptable — errors converted to HTTP responses |
| Core → Data Access | Direct function calls, some try/catch | Poor — `JSON.parse` failures crash entire operations |
| Core → External | try/catch with self-contained error handling | Good — fire-and-forget is intentional for long-running processes with event-based error reporting |
| External → SDK | try/catch converting to `null` | Poor — all error types conflated into "not found" |

**Systemic issue:** There is no centralized error type hierarchy. Each layer defines its own error handling patterns. The result is inconsistent error propagation where:
- Some errors crash the application (unguarded JSON.parse)
- Some errors are conflated (all session errors → null)
- Some errors reach the user as console output only (dashboard fetch failures)

*(Note: Fire-and-forget patterns in Core → External are intentional — the engine has self-contained error handling. See `AGENTS.md` § Async Patterns.)*

### Type Safety Across Boundaries

| Boundary | Type Safety | Assessment |
|----------|------------|------------|
| Presentation → API | None | No typed API client. URLs are strings, responses are `any` from `response.json()` |
| API → Core | Good | Core functions have proper TypeScript signatures |
| Core → Data Access | Good | Persistence functions accept/return typed objects |
| Data Access → DB | Moderate | `rowToLoop` converts, but review comments leak snake_case |
| Core → External | Poor | `Backend.getSdkClient()` returns `unknown`, `getModels()` returns `unknown[]` |
| Shared → All | Good | Types, schemas, and status utilities are well-typed |

### Consistency Assessment

| Aspect | Consistent? | Details |
|--------|:-----------:|---------|
| Error response shape | No | `{ error, message }` in most files, `{ message, error }` in workspaces.ts |
| HTTP handler pattern | No | Named methods in most files, method branching in workspaces.ts |
| Logger initialization | No | Singleton `log` in some files, `createLogger()` in others |
| Logger import path | No | `core/logger` in backend files, `lib/logger` in frontend, mixed in utils |
| Async functions | No | Persistence is sync-wrapped-as-async, Core is genuinely async |
| Barrel export strategy | No | Some complete, some partial, some dead |
| Row-to-object conversion | No | camelCase in loops/workspaces, snake_case in review comments |
| State mutation pattern | No | Some through LoopManager, some direct to persistence |
| Modal implementation | No | Most use shared `Modal`, PlanReviewPanel implements its own |
| Test patterns | Mostly | Tests use consistent setup/teardown except review-mode.test.ts |

---

## Top 10 Architectural Recommendations

These recommendations address systemic issues that span multiple layers and represent the highest-impact improvements.

| # | Recommendation | Layers Affected | Impact | Complexity |
|---|---------------|----------------|--------|------------|
| 1 | ~~**Fix fire-and-forget async** — Await `engine.start()` in LoopManager and the async IIFE in `translateEvent()`.~~ **By Design** — Intentional for long-running processes. The engine has comprehensive self-contained error handling (`handleError()`, error events, `trackConsecutiveError()`). See `AGENTS.md` § Async Patterns. | Core, External | ~~Critical~~ N/A — engine handles errors via events and persistence | ~~Low~~ N/A |
| 2 | **Introduce a loop state machine** — Centralize all status transitions into a `LoopStateMachine` with a transition table. Eliminate scattered ad-hoc status checks. | Core, API | Major — single source of truth for loop lifecycle | Medium |
| 3 | **Enforce layered architecture** — Remove all direct persistence imports from API handlers. Add query methods to `LoopManager` (`getActiveLoopByDirectory`, `getReviewComments`) so the API layer never bypasses Core. | API, Core, Data Access | Major — prevents business rule bypass | Medium |
| 4 | **Extract shared helpers to eliminate duplication** — `errorResponse()` (3 copies), `apiCall<T>()` wrapper (14 action functions), `ModelSelector` component (2 copies), `requireWorkspace()` (5 copies). Estimated ~540 LOC savings. | API, Presentation | Major — reduces maintenance burden | Low |
| 5 | **Add error boundaries and user-facing error feedback** — Root `<ErrorBoundary>` in `frontend.tsx`, toast/notification system for transient errors, error states in Dashboard and LoopDetails. | Presentation | Major — users can see and recover from errors | Low |
| 6 | **Fix backend logger sub-logger sync** — Port the sub-logger caching pattern from `lib/logger.ts` to `core/logger.ts`. Extract shared constants to a shared module. | Shared Infra | Major — runtime log level changes work for all modules | Low |
| 7 | ~~**Add authentication to destructive endpoints** — `POST /api/server/kill` and `POST /api/settings/reset-all` need at minimum a token-based check.~~ **Not Applicable** — authentication and authorization are enforced by a reverse proxy at the infrastructure level. See `AGENTS.md` § Authentication & Authorization. | API | ~~Critical~~ N/A — ~~prevents unauthorized server termination~~ | ~~Low~~ N/A |
| 8 | **Decompose Dashboard.tsx** — Extract `LoopList`, `DashboardHeader`, `DashboardModals`, `LoopGroupSection` sub-components. Move inline fetch calls to hooks. | Presentation | Major — improves testability and maintainability | Medium |
| 9 | **Fix data integrity risks in Data Access** — Replace `INSERT OR REPLACE` with upsert to prevent cascade deletes. Add try/catch to `JSON.parse` calls in `rowToLoop()`. Validate table names in `getTableColumns()`. | Data Access | Major — prevents data loss and crash-on-corruption | Low |
| 10 | ~~**Add test coverage for hooks and utilities**~~ **Largely Resolved** — 715 frontend tests added (126 hook tests, 520 component tests, 50 E2E scenario tests, 19 infra tests). Remaining gaps: `useWebSocket`, `useAgentsMdOptimizer`, `loop-status.ts`, `sanitizeBranchName`, `event-stream.ts`. | Presentation, Shared Infra | ~~Major~~ Minor — highest-risk code now covered | ~~Medium~~ N/A |

---

## Finding Totals by Dimension

| Dimension | Critical | Major | Minor | Suggestion | Total |
|-----------|:--------:|:-----:|:-----:|:----------:|:-----:|
| Code duplication | 0 | 12 | 2 | 0 | 14 |
| Error handling | 0 | 7 | 4 | 1 | 12 |
| Type safety | 0 | 4 | 1 | 1 | 6 |
| Security | 0 | 0 | 3 | 1 | 4 |
| Best practices | 0 | 2 | 1 | 1 | 4 |
| Consistency | 0 | 2 | 4 | 0 | 6 |
| Complexity | 1 | 3 | 0 | 1 | 5 |
| State management | 0 | 1 | 1 | 0 | 2 |
| Performance | 0 | 2 | 2 | 0 | 4 |
| Dead code | 0 | 2 | 2 | 1 | 5 |
| Data integrity | 0 | 2 | 0 | 0 | 2 |
| Concurrency | 0 | 1 | 1 | 0 | 2 |
| Layering violation | 0 | 2 | 0 | 0 | 2 |
| Architecture | 0 | 1 | 2 | 2 | 5 |
| Schema management | 0 | 1 | 0 | 0 | 1 |
| Accessibility | 0 | 1 | 0 | 0 | 1 |
| Separation of concerns | 0 | 1 | 0 | 0 | 1 |
| Barrel export | 0 | 0 | 2 | 0 | 2 |
| Name collision | 0 | 1 | 0 | 0 | 1 |
| Async overhead | 0 | 0 | 1 | 0 | 1 |
| Bug | 0 | 2 | 0 | 1 | 3 |
| UX | 0 | 1 | 0 | 0 | 1 |
| Testability | 0 | 0 | 1 | 0 | 1 |
| **Totals** | **2** | **45** | **34** | **9** | **90** |

---

## Appendix: File-to-Layer Mapping

Every source file in the codebase mapped to its primary layer:

| Layer | File |
|-------|------|
| Presentation | `src/components/Dashboard.tsx`, `src/components/LoopDetails.tsx`, `src/components/CreateLoopForm.tsx`, `src/components/ServerSettingsForm.tsx`, `src/components/LoopActionBar.tsx`, `src/components/LogViewer.tsx`, `src/components/LoopCard.tsx`, `src/components/AppSettingsModal.tsx`, `src/components/PlanReviewPanel.tsx`, `src/components/WorkspaceSettingsModal.tsx`, `src/components/LoopModals.tsx`, `src/components/CreateWorkspaceModal.tsx`, `src/components/common/Modal.tsx`, `src/components/TodoViewer.tsx`, `src/components/RenameLoopModal.tsx`, `src/components/AcceptLoopModal.tsx`, `src/components/AddressCommentsModal.tsx`, `src/components/common/Badge.tsx`, `src/components/WorkspaceSelector.tsx`, `src/components/MarkdownRenderer.tsx`, `src/components/common/Card.tsx`, `src/components/common/Button.tsx`, `src/components/common/CollapsibleSection.tsx`, `src/components/LogLevelInitializer.tsx`, `src/components/common/Icons.tsx`, `src/components/common/index.ts`, `src/components/index.ts`, `src/hooks/useLoop.ts`, `src/hooks/loopActions.ts`, `src/hooks/useLoops.ts`, `src/hooks/useWorkspaceServerSettings.ts`, `src/hooks/useWebSocket.ts`, `src/hooks/useWorkspaces.ts`, `src/hooks/useAgentsMdOptimizer.ts`, `src/hooks/useLogLevelPreference.ts`, `src/hooks/useMarkdownPreference.ts`, `src/hooks/index.ts`, `src/lib/prompt-templates.ts`, `src/lib/logger.ts`, `src/lib/index.ts`, `src/frontend.tsx`, `src/App.tsx` |
| API | `src/api/loops.ts`, `src/api/workspaces.ts`, `src/api/models.ts`, `src/api/agents-md.ts`, `src/api/git.ts`, `src/api/websocket.ts`, `src/api/settings.ts`, `src/api/validation.ts`, `src/api/index.ts`, `src/api/health.ts`, `src/utils/event-stream.ts` |
| Core Business Logic | `src/core/loop-manager.ts`, `src/core/loop-engine.ts`, `src/core/git-service.ts`, `src/core/agents-md-optimizer.ts`, `src/core/event-emitter.ts`, `src/core/index.ts` |
| Data Access | `src/persistence/database.ts`, `src/persistence/loops.ts`, `src/persistence/migrations/index.ts`, `src/persistence/workspaces.ts`, `src/persistence/preferences.ts`, `src/persistence/paths.ts`, `src/persistence/index.ts` |
| External Integration | `src/backends/opencode/index.ts`, `src/backends/types.ts`, `src/backends/index.ts`, `src/core/backend-manager.ts`, `src/core/command-executor.ts`, `src/core/remote-command-executor.ts` |
| Shared Infrastructure | `src/types/events.ts`, `src/types/loop.ts`, `src/types/api.ts`, `src/types/schemas/loop.ts`, `src/types/schemas/workspace.ts`, `src/types/schemas/index.ts`, `src/types/workspace.ts`, `src/types/schemas/preferences.ts`, `src/types/settings.ts`, `src/types/schemas/model.ts`, `src/types/index.ts`, `src/utils/loop-status.ts`, `src/utils/name-generator.ts`, `src/utils/index.ts`, `src/core/logger.ts`, `src/core/config.ts` |
| Entry/Config | `src/index.ts`, `src/build.ts`, `src/index.html`, `src/index.css` |
