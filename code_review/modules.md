# Module-Level Code Review — Ralpher Codebase

**Date:** 2026-02-07
**Scope:** All `src/` modules reviewed as architectural units
**Total Codebase:** ~27,328 LOC across 10 modules, 90 files

---

## Executive Summary

| Module | Files | LOC | Critical | Major | Minor | Suggestion |
|--------|------:|----:|---------:|------:|------:|-----------:|
| `src/core/` | 11 | 7,794 | 0 | 8 | 5 | 1 |
| `src/api/` | 10 | 3,397 | 0 | 8 | 3 | 0 |
| `src/persistence/` | 7 | 2,061 | 1 | 6 | 4 | 1 |
| `src/backends/` | 3 | 1,260 | 0 | 6 | 2 | 0 |
| `src/types/` | 11 | 1,730 | 0 | 3 | 4 | 1 |
| `src/utils/` | 4 | 457 | 1 | 5 | 1 | 0 |
| `src/components/` | 25 | 7,527 | 1 | 5 | 4 | 0 |
| `src/hooks/` | 10 | 2,477 | 0 | 6 | 3 | 0 |
| `src/lib/` | 3 | 383 | 0 | 2 | 1 | 0 |
| Entry Points & Config | 8+ | ~350 | 0 | 3 | 4 | 0 |
| **Totals** | **90** | **~27,328** | **3** | **52** | **31** | **3** |

**Overall Assessment:** The codebase is functional and well-organized at the directory level, but suffers from concentrated complexity in a handful of oversized files, systematic code duplication (especially in API layers and hooks), and several genuine runtime bugs (fire-and-forget async, timer leaks, SQL injection). The separation between frontend and backend modules is clean. The primary architectural debt lies in the `core/` module, where two 2000+ LOC files carry the entire business logic without a formal state machine, and in `components/` where Dashboard.tsx has grown into a god component.

---

## Module 1: `src/core/` — Core Business Logic

**Purpose:** Loop lifecycle orchestration, backend management, git operations, logging, configuration, event emission, and remote command execution.

**Files (11):**

| File | LOC | Role |
|------|----:|------|
| `loop-manager.ts` | 2,409 | Loop CRUD, start/stop/accept/discard/push lifecycle |
| `loop-engine.ts` | 2,079 | Iteration execution, event processing, agent interaction |
| `git-service.ts` | 1,492 | Git branch, commit, merge, diff, push operations |
| `backend-manager.ts` | 765 | Backend connection pooling per workspace |
| `remote-command-executor.ts` | 493 | PTY-over-WebSocket remote command execution |
| `agents-md-optimizer.ts` | 234 | AGENTS.md optimization logic for workspaces |
| `logger.ts` | 129 | tslog wrapper, runtime log level control |
| `command-executor.ts` | 79 | CommandExecutor interface + local Bun implementation |
| `event-emitter.ts` | 72 | Simple typed pub/sub event system |
| `config.ts` | 34 | App configuration from environment |
| `index.ts` | 8 | Barrel exports |

**Total:** 7,794 LOC

### Module-Level Findings

| # | Severity | Dimension | Finding |
|---|----------|-----------|---------|
| C1.1 | ~~**Critical**~~ **By Design** | ~~Async Safety~~ | ~~`loop-manager.ts` `startLoop()` calls engine methods in a fire-and-forget pattern. If the engine's async start fails after the response is sent, the loop silently enters an inconsistent state. This directly violates the AGENTS.md guideline: "CRITICAL: Always await async operations in API handlers." The loop status may show "starting" permanently with no error surfaced.~~ **By Design — Intentional Architecture:** The fire-and-forget pattern is intentional for long-running processes. The loop engine runs a `while`-loop with multiple AI iterations (potentially hours). Awaiting would block the HTTP response indefinitely. The engine has comprehensive self-contained error handling (`handleError()` updates state to "failed", emits error events, `trackConsecutiveError()` for failsafe exit). Errors are reported via event emitter and persistence callbacks, not exceptions. See `AGENTS.md` § Async Patterns for the documented exception. |
| C1.2 | **Major** | File Size / Complexity | Two files exceed 2,000 LOC each (`loop-manager.ts`: 2,409, `loop-engine.ts`: 2,079). These are the most complex files in the entire codebase and contain deeply nested control flow. `acceptLoop()` in loop-manager is ~200 lines with multiple nested try/catch blocks and git operations. `runIteration()` in loop-engine is ~250 lines mixing event processing, state management, and error handling. |
| C1.3 | **Major** | Code Duplication | Branch name generation logic (`sanitizeBranchName` usage + prefix assembly) is duplicated between `loop-manager.ts` (during `createLoop`) and `loop-engine.ts` (during `startLoop`). Changes to branch naming conventions must be synchronized in two places. |
| C1.4 | **Major** | Bug — Logger | `createLogger()` in `core/logger.ts:93` creates sub-loggers via `log.getSubLogger()`, but `setLogLevel()` at line 103-108 only updates `log.settings.minLevel`. tslog sub-loggers copy the parent's level at creation time and do not inherit runtime changes. Any module using `createLogger()` (which is most backend modules — persistence, API, backends, etc.) will not respond to runtime log level changes. The frontend `lib/logger.ts` correctly addresses this by caching sub-loggers and updating them in `setLogLevel()`. |
| C1.5 | **Major** | Code Duplication | Logger constants (`LogLevelName`, `LOG_LEVELS`, `LOG_LEVEL_NAMES`, `DEFAULT_LOG_LEVEL`) are fully duplicated between `core/logger.ts:26-63` and `lib/logger.ts:35-66`. These are identical definitions maintained independently. |
| C1.6 | **Major** | State Management | State transitions are validated ad-hoc across scattered methods. `startLoop()` checks for "idle" or "draft" status, `stopLoop()` checks for running states, `acceptLoop()` checks for completed/max_iterations — but there is no centralized state machine or transition table. This makes it easy to introduce invalid transitions and hard to reason about the full lifecycle. |
| C1.7 | **Major** | Data Integrity | `loop-manager.ts` directly mutates `loop.state` properties (e.g., `loop.state.status = "starting"`) before calling persistence functions. If the persistence call fails, the in-memory loop object has already been modified, creating inconsistency between memory and database. |
| C1.8 | **Major** | Complexity | `acceptLoop()` (~200 lines) handles merge operations, branch switching, conflict resolution, error recovery, and state updates all in one method. It should be decomposed into: merge preparation, merge execution, post-merge cleanup, and state persistence steps. |
| C1.9 | **Major** | Complexity | `runIteration()` in `loop-engine.ts` (~250 lines) mixes event loop management, prompt construction, response parsing, error classification, and state updates. Each concern should be a separate private method. |
| C1.10 | **Minor** | Testability | Module-level singletons (`backendManager` in `backend-manager.ts`, `loopManager` pattern) are instantiated at import time. While `LoopManager` accepts an optional event emitter for testing, `backendManager` is a hard singleton that cannot be replaced in tests without module mocking. |
| C1.11 | **Minor** | Performance | Several methods wrap synchronous operations in `async` (e.g., many persistence layer calls that are sync SQLite under the hood). While not incorrect, it adds unnecessary microtask overhead to hot paths like `loadLoop`. |
| C1.12 | **Minor** | Magic Numbers | Hardcoded constants scattered: `maxConsecutiveErrors=3` (default), iteration delay `1000ms`, activity timeout `180s`, branch name length `40` chars. These should be named constants or configuration values. |
| C1.13 | **Minor** | Naming | `isLoopRunning` exists as both a utility function in `utils/loop-status.ts:81` and as a computed property concept in the engine. The utility checks status strings; the engine checks engine-internal state. Different semantics, same name. |
| C1.14 | **Minor** | API Design | The `BackendManager` class returns `CommandExecutor` instances via `getCommandExecutorAsync()` which requires callers to know the workspace ID and directory. This creates coupling between callers and workspace configuration details. |
| C1.15 | **Suggestion** | Architecture | Consider adopting a state machine library (e.g., XState or a lightweight custom implementation) for loop status transitions. This would centralize transition rules, make invalid transitions impossible at the type level, and enable transition side-effects (logging, events) to be declared rather than scattered. |

### API Surface Analysis

**Barrel exports (`index.ts`):**
- Exports: `event-emitter`, `git-service`, `loop-engine`, `loop-manager`
- **Missing from barrel:** `config.ts`, `logger.ts`, `backend-manager.ts`, `command-executor.ts`, `remote-command-executor.ts`

**Actual usage pattern:** Most consumers bypass the barrel and import directly:
- `api/loops.ts` imports `loopManager` from `"../core/loop-manager"` (direct)
- `api/settings.ts` imports from `"../core/backend-manager"` and `"../core/config"` (direct)
- `persistence/database.ts` imports `createLogger` from `"../core/logger"` (direct)
- `persistence/migrations/index.ts` imports `log` from `"../../core/logger"` (direct)

**Assessment:** The barrel export is incomplete and largely unused. Either expand it to cover all public APIs or remove it in favor of explicit direct imports (which is the actual pattern).

### Cohesion & Coupling

**Cohesion:** Low. The module conflates two distinct concerns:
1. **Loop orchestration** (loop-manager, loop-engine, event-emitter) — domain logic
2. **Infrastructure** (git-service, backend-manager, command-executor, remote-command-executor, logger, config) — technical services

**Coupling:**
- High coupling to `persistence/` — direct imports of `loops.ts`, `workspaces.ts`, `preferences.ts` from both manager and engine
- High coupling to `backends/` — `backend-manager.ts` imports backend types and creates instances
- `loop-engine.ts` depends on `backends/types.ts` for `Backend` interface, `AgentEvent`, `TodoItem`, etc.

**Recommendation:** Split into `core/loop/` (manager, engine, event-emitter) and `core/services/` (git, backend-manager, command execution, logger, config).

### Top Recommendations (Prioritized)

1. **Fix fire-and-forget async** in `startLoop()` — await engine start or implement proper error propagation
2. **Fix logger sub-logger sync** — port the caching/update pattern from `lib/logger.ts` to `core/logger.ts`
3. **Extract state machine** — centralize loop status transitions with a transition table
4. **Decompose `acceptLoop()`** — break into merge-prepare, merge-execute, merge-finalize steps
5. **Decompose `runIteration()`** — extract prompt building, event processing, error handling
6. **Deduplicate logger constants** — create a shared `logger-constants.ts` imported by both core and lib

---

## Module 2: `src/api/` — REST API Layer

**Purpose:** HTTP endpoint handlers for loops, workspaces, models, settings, git, health, and WebSocket upgrade.

**Files (10):**

| File | LOC | Role |
|------|----:|------|
| `loops.ts` | 1,351 | Loop CRUD, lifecycle control, plan/review operations |
| `workspaces.ts` | 695 | Workspace CRUD with server settings |
| `models.ts` | 426 | Model listing, preferences, enabled status |
| `agents-md.ts` | 234 | AGENTS.md optimization endpoints |
| `git.ts` | 193 | Branch listing and repository info |
| `websocket.ts` | 134 | WebSocket handlers for real-time events |
| `settings.ts` | 132 | App config, DB reset, server kill |
| `validation.ts` | 121 | Zod schema parsing utility |
| `index.ts` | 62 | Barrel export combining all routes |
| `health.ts` | 49 | Health check endpoint |

**Total:** 3,397 LOC

### Module-Level Findings

| # | Severity | Dimension | Finding |
|---|----------|-----------|---------|
| C2.1 | ~~**Critical**~~ N/A | ~~Security~~ | ~~`POST /api/server/kill` in `settings.ts:115` calls `process.exit(0)` with no authentication. Any client with network access to the server can terminate it. In the Docker deployment (port 80), this is directly exploitable. While the endpoint is intentional for container restart workflows, it needs at minimum an auth token or rate limiting.~~ **Not Applicable** — authentication and authorization are enforced by a reverse proxy at the infrastructure level. See `AGENTS.md` § Authentication & Authorization. |
| C2.2 | **Major** | Code Duplication | `errorResponse()` helper function is independently defined in 3 files: `loops.ts:48-53`, `models.ts` (similar pattern), and `settings.ts:31-34`. All three are identical in signature and behavior. This should be a single shared function in `validation.ts` or a new `api/helpers.ts`. |
| C2.3 | **Major** | Consistency | Error response shapes differ across modules. `loops.ts`, `models.ts`, and `settings.ts` use `{ error: string, message: string }` (the `ErrorResponse` type). `workspaces.ts` sometimes uses `{ error: string }` without `message`. This makes client-side error handling fragile. |
| C2.4 | **Major** | Consistency | `workspaces.ts` uses an `if (req.method === "GET")` / `if (req.method === "POST")` branching pattern, while all other API files use Bun's named method handlers (`{ GET(req) {}, POST(req) {} }`). This inconsistency makes the module harder to maintain and doesn't benefit from Bun's method-based routing optimizations. |
| C2.5 | **Major** | Code Duplication | Workspace lookup + 404 pattern (`getWorkspaceById(id) → if (!workspace) return 404`) is repeated 5 times in `workspaces.ts`. Should be extracted to a `requireWorkspace(id)` helper that throws or returns a guaranteed workspace. |
| C2.6 | **Major** | Code Duplication | `loops.ts` duplicates preflight validation logic (model enabled check, workspace existence check, uncommitted changes check) between the create handler and the draft/start handler. These are ~30 lines of identical checks. |
| C2.7 | **Major** | Code Duplication | `loops.ts` PATCH and PUT handler bodies are near-identical copy-paste blocks for updating loop configuration fields. The field mapping and persistence call patterns should be shared. |
| C2.8 | **Major** | Layering Violation | The draft/start handler in `loops.ts` directly calls `updateLoopState()` from the persistence layer, bypassing `LoopManager`. This violates the architectural intent where `LoopManager` is the single authority for loop state mutations. Direct persistence mutations skip event emission, validation, and any future middleware. |
| C2.9 | **Major** | Code Duplication | `git.ts` has two endpoint handlers (`/api/git/:workspaceId/branches` and `/api/git/:workspaceId/repo-info`) that share ~20 lines of identical boilerplate: workspace lookup, command executor creation, GitService instantiation, and error handling. |
| C2.10 | **Minor** | Consistency | Logger initialization is inconsistent across the module. `loops.ts` imports the singleton `log` from `core/logger`, while `settings.ts` and `models.ts` use `createLogger("api:settings")` to create named sub-loggers. Both patterns work but produce different log output. |
| C2.11 | **Minor** | Race Condition | Loop creation and workspace creation have TOCTOU (time-of-check-time-of-use) race conditions. The "check if active loop exists for directory" query and the subsequent "create loop" call are not atomic. Two concurrent creation requests for the same directory could both pass validation. |
| C2.12 | ~~**Minor**~~ N/A | ~~Security~~ | ~~No authentication on any destructive endpoint (DELETE loops, POST discard, POST reset-all). While acceptable for a local development tool, the Docker deployment with `EXPOSE 80` makes this a concern for shared environments.~~ **Not Applicable** — authentication and authorization are enforced by a reverse proxy at the infrastructure level. |
| C2.13 | **Minor** | Security | WebSocket endpoint (`/api/ws`) has no connection limits or origin validation. A malicious client could open thousands of WebSocket connections to exhaust server resources. |

### API Surface Analysis

**Barrel exports (`index.ts`):**
- Exports: combined `apiRoutes` object + re-exports from all route modules + `websocket`
- All route modules are properly aggregated and re-exported

**Actual usage:**
- `src/index.ts` imports `apiRoutes` from `"./api"` (barrel) and `websocketHandlers` from `"./api/websocket"` (direct)
- Internal cross-references: `loops.ts` imports `isModelEnabled` from `"./models"` (peer import, acceptable)

**Assessment:** Clean barrel export. The combined `apiRoutes` pattern works well with Bun's spread-based route registration.

### Cohesion & Coupling

**Cohesion:** Good. Each file handles a distinct REST resource. Responsibilities are well-separated.

**Coupling:**
- Direct imports from `persistence/` layer (e.g., `loops.ts:22-24` imports `updateLoopState`, `getActiveLoopByDirectory`, `getReviewComments`) — should go through `core/` managers
- Direct import of `backendManager` singleton from `core/backend-manager` — acceptable given the singleton pattern
- Cross-file dependency: `loops.ts` imports `isModelEnabled` from `models.ts`

### Top Recommendations (Prioritized)

1. ~~**Add authentication** to `POST /api/server/kill` — even a simple token-based check~~ **Not Applicable** — authentication is enforced by reverse proxy
2. **Extract shared `errorResponse()`** to `validation.ts` or `helpers.ts`
3. **Route all state mutations through LoopManager** — remove direct `updateLoopState()` calls
4. **Standardize error response shape** — enforce `ErrorResponse` type everywhere
5. **Extract workspace lookup helper** — `requireWorkspace(id): Promise<Workspace>`
6. **Migrate workspaces.ts to named method handlers** — align with other API files

---

## Module 3: `src/persistence/` — Data Access Layer

**Purpose:** SQLite database management, schema creation, migrations, and CRUD operations for loops, workspaces, and preferences.

**Files (7):**

| File | LOC | Role |
|------|----:|------|
| `migrations/index.ts` | 571 | Schema migration system (14 migrations) |
| `loops.ts` | 566 | Loop CRUD, state updates, query helpers |
| `database.ts` | 386 | DB init, schema, review comments, connection management |
| `workspaces.ts` | 327 | Workspace CRUD with server settings |
| `preferences.ts` | 178 | Key-value preference storage |
| `paths.ts` | 24 | Data directory management (delegates to `database.ts`) |
| `index.ts` | 9 | Barrel exports |

**Total:** 2,061 LOC

### Module-Level Findings

| # | Severity | Dimension | Finding |
|---|----------|-----------|---------|
| C3.1 | **Critical** | Security — SQL Injection | `getTableColumns()` in `migrations/index.ts:57` interpolates `tableName` directly into a PRAGMA query: `` db.query(`PRAGMA table_info(${tableName})`) ``. While `tableName` currently comes from hardcoded strings in migration code (not user input), this is a dangerous pattern that could become exploitable if the function is called with dynamic input in the future. The PRAGMA syntax does not support parameterized queries, so the fix is to validate `tableName` against an allowlist of known tables. |
| C3.2 | **Major** | Schema Management | The base schema in `database.ts` and the migrations in `migrations/index.ts` are two independent sources of truth. A fresh database gets the full schema from `database.ts` plus all migrations. An upgraded database only gets migrations. If the base schema is modified without a corresponding migration, upgraded databases will diverge from fresh ones. |
| C3.3 | **Major** | Barrel Export | `workspaces.ts` is not re-exported from the barrel `index.ts`. Consumers must import directly from `"../persistence/workspaces"`. The barrel exports `database`, `paths`, `loops`, `preferences`, and `migrations` — but not `workspaces`. |
| C3.4 | ~~**Major**~~ **Partially Resolved** | Code Duplication | `updateLoopState()` and `updateLoopConfig()` in `loops.ts` ~~are structurally near-identical (~40 lines each).~~ **Updated:** Both functions now use proper `UPDATE` statements (lines 457-459, 502-504) rather than the previous pattern. However, `saveLoop()` (line 295-296) still uses `INSERT OR REPLACE` semantics — see C3.5. The structural duplication between the two update functions remains and they should still be unified into a generic `updateLoopFields()` function. |
| C3.5 | **Major** | Data Integrity | `saveLoop()` likely uses `INSERT OR REPLACE` semantics. In SQLite, `INSERT OR REPLACE` triggers the `ON DELETE CASCADE` behavior — if the loops table has foreign key relationships (e.g., review comments reference loop IDs), replacing a loop row will cascade-delete all associated review comments. The fix is to use `INSERT ... ON CONFLICT DO UPDATE` (upsert) instead. |
| C3.6 | **Major** | Error Handling | `rowToLoop()` in `loops.ts` uses `JSON.parse()` to deserialize `git_commits`, `recent_iterations`, `logs`, `messages`, `tool_calls`, and `todos` columns. None of these parse calls have try/catch. A single corrupt JSON value in any row will throw, preventing the listing of ALL loops (since `listLoops` maps all rows through `rowToLoop`). Each parse should have a fallback default. |
| C3.7 | **Minor** | Async Overhead | All persistence functions (`saveLoop`, `loadLoop`, `listLoops`, `updateLoopState`, etc.) are marked `async` despite performing only synchronous Bun SQLite operations. This adds microtask overhead on every database call. Since Bun's SQLite API is synchronous, these functions could be plain synchronous functions. (This is a pervasive pattern — changing it would require updating all callers.) |
| C3.8 | **Minor** | Performance | No prepared statement caching. Frequently-called queries like `loadLoop` (called on every polling cycle from the UI) create new statement objects on each invocation. Bun SQLite supports `db.query()` which returns a reusable prepared statement — these should be cached at module level. |
| C3.9 | **Minor** | Architecture | `paths.ts` (24 LOC) contains only `ensureDataDirectories()` which calls `getDataDir()` from `database.ts` and creates the directory. This is vestigial — the function could live in `database.ts` and `paths.ts` could be removed. |
| C3.10 | **Minor** | Consistency | Row-to-object conversion is inconsistent. `loops.ts` has a thorough `rowToLoop()` converter that maps snake_case columns to camelCase objects. `workspaces.ts` has a similar `rowToWorkspace()`. But review comment queries in `database.ts` return raw snake_case rows without conversion, leaking database schema details to consumers. |
| C3.11 | **Major** | Separation of Concerns | Review comment functions (`insertReviewComment`, `getReviewComments`, `getReviewHistory`) are placed in `database.ts` instead of a dedicated `review-comments.ts` module. `database.ts` should only contain database infrastructure (init, connection, schema). Domain-specific CRUD belongs in domain-specific files. |
| C3.12 | **Suggestion** | Error Handling | No centralized error types. When a loop is not found, different callers handle it differently — some return `null`, some throw generic `Error`. A `NotFoundError` class would enable consistent handling and proper HTTP status codes in the API layer. |

### API Surface Analysis

**Barrel exports (`index.ts`):**
- Exports: `database`, `paths`, `loops`, `preferences`, `migrations`
- **Missing:** `workspaces` — consumers must use direct imports

**Actual usage:**
- `core/loop-manager.ts` imports 6 functions from `"../persistence/loops"` (direct, bypassing barrel)
- `core/loop-manager.ts` imports `insertReviewComment` from `"../persistence/database"` (direct)
- `api/loops.ts` imports from both `"../persistence/loops"` and `"../persistence/database"` (direct)
- `api/workspaces.ts` imports from `"../persistence/workspaces"` (direct, not available via barrel)

**Assessment:** The barrel is incomplete and universally bypassed. Either commit to making it the sole import path (and add `workspaces`) or remove it.

### Cohesion & Coupling

**Cohesion:** Good separation by domain entity, except for review comments in `database.ts`.

**Coupling:** Appropriately low — this is a leaf dependency that other modules depend on but itself has minimal dependencies (only `core/logger` for logging).

### Top Recommendations (Prioritized)

1. **Add try/catch to JSON.parse** calls in `rowToLoop()` with sensible defaults
2. **Replace INSERT OR REPLACE** with upsert to prevent cascade deletes
3. **Validate table names** in `getTableColumns()` against an allowlist
4. **Extract review comments** to a dedicated `review-comments.ts` file
5. **Unify updateLoopState/updateLoopConfig** into a generic updater
6. **Add workspaces.ts to barrel** exports or document the direct-import convention

---

## Module 4: `src/backends/` — External Service Adapters

**Purpose:** Abstraction layer for AI agent backends. Currently contains only the OpenCode backend implementation.

**Files (3):**

| File | LOC | Role |
|------|----:|------|
| `opencode/index.ts` | 1,015 | OpenCode SDK integration, session/prompt/event management |
| `types.ts` | 239 | Backend interface, event types, data structures |
| `index.ts` | 6 | Barrel exports |

**Total:** 1,260 LOC

### Module-Level Findings

| # | Severity | Dimension | Finding |
|---|----------|-----------|---------|
| C4.1 | ~~**Critical**~~ **By Design** | ~~Async Safety~~ | ~~`translateEvent()` in `opencode/index.ts` contains an async IIFE (Immediately Invoked Function Expression) that is not awaited. This means errors during event translation are silently swallowed, and the push-to-stream call happens after the enclosing function returns. If the stream is closed between the IIFE start and the push, events are lost.~~ **By Design — Intentional Architecture:** This async IIFE is purely diagnostic logging code inside a `session.idle` handler. It fetches session details for debugging when no assistant messages were seen (an edge case). It has its own `try/catch`, its result doesn't affect the return value of `translateEvent()`, and blocking for it would delay event processing unnecessarily. See `AGENTS.md` § Async Patterns for the documented exception. |
| C4.2 | **Major** | Type Safety | `Backend` interface method `getSdkClient()` returns `unknown` (`types.ts:223`). Callers must cast the result, losing all type safety. The actual return type is the OpenCode SDK client type, which should be made generic: `Backend<TClient>` or at least typed to the SDK's client interface. |
| C4.3 | **Major** | Type Safety | `getModels()` returns `Promise<unknown[]>` (`types.ts:238`). The actual return type is an array of model objects from the SDK. This forces every caller to cast or use `as ModelInfo[]`, defeating TypeScript's type system. |
| C4.4 | **Major** | Type Duplication | `ModelInfo` type is defined in both `types/api.ts:36-54` and implicitly in the `getModels()` return type. The backend returns raw SDK model objects, and `api/models.ts` transforms them into `ModelInfo`. But the lack of typing in the backend means the transformation is unchecked. |
| C4.5 | **Major** | Function Signature | `translateEvent()` accepts 8 parameters: `(sdkEvent, push, end, fail, sessionId, eventStream, connectionInfo, log)`. This is a code smell indicating the function has too many responsibilities. Parameters should be bundled into an options object or the function should be a method on a class with injected dependencies. |
| C4.6 | **Major** | Type Safety | The `client` parameter in several internal functions is typed as `any`. The OpenCode SDK provides proper TypeScript types that should be used. |
| C4.7 | **Major** | Code Duplication | Prompt construction logic is duplicated between `sendPrompt()` and `sendPromptAsync()`. Both methods build the same SDK prompt object from the `PromptInput` type, including model mapping. A shared `buildSdkPrompt()` helper would eliminate this duplication. |
| C4.8 | **Major** | Error Handling | `getSession()` catches all errors and returns `null`, treating every failure as "session not found." This means a 500 server error, a network timeout, or an SDK-level session authentication failure are all indistinguishable from a genuine 404. Callers cannot differentiate recoverable from non-recoverable errors. *(Note: this refers to SDK-level session authentication between Ralpher and the opencode backend, not user-facing auth which is handled by reverse proxy.)* |
| C4.9 | **Minor** | Dead Code | `getServerUrl()` method exists but is not used externally. It also breaks encapsulation by exposing internal connection details that should be accessed through `getConnectionInfo()`. |
| C4.10 | **Minor** | Timeout Handling | `customFetch()` disables request timeouts for all SDK calls by setting a very high or infinite timeout. While some operations (like long prompt completions) genuinely need extended timeouts, this applies globally, meaning even health checks or metadata requests have no timeout protection. |

### API Surface Analysis

**Barrel exports (`index.ts`):**
- Re-exports everything from `types.ts` and `opencode/index.ts`
- This includes internal implementation details (e.g., `customFetch`, `translateEvent`) alongside public interfaces

**Actual usage:**
- `core/backend-manager.ts` imports `OpenCodeBackend` and types from `"../backends"`
- `core/loop-engine.ts` imports `Backend`, `AgentEvent`, `TodoItem`, etc. from `"../backends/types"` (direct)
- `utils/name-generator.ts` imports `PromptInput`, `AgentResponse` from `"../backends/types"` (direct)

**Assessment:** The barrel over-exports internal implementation details. Only `Backend`, `OpenCodeBackend`, and the type definitions should be publicly exported. Internal helpers like `translateEvent` and `customFetch` should not be part of the public API surface.

### Cohesion & Coupling

**Cohesion:** Good — single backend implementation behind a clean interface. The interface is well-designed with clear separation between "core methods" (for LoopEngine) and "manager methods" (for BackendManager).

**Coupling:** The backend depends on `utils/event-stream.ts` for the `EventStream` type. This is a reasonable dependency. The reverse dependency (types importing `TodoItem` from backends into the types module) is problematic — see types module analysis.

### Top Recommendations (Prioritized)

1. **Fix fire-and-forget IIFE** in `translateEvent()` — await the async operation or use proper error handling
2. **Type `getSdkClient()` and `getModels()`** — use generics or concrete SDK types
3. **Extract shared prompt builder** between `sendPrompt` and `sendPromptAsync`
4. **Differentiate error types** in `getSession()` — 404 vs server error
5. **Bundle `translateEvent` parameters** into an options object
6. **Restrict barrel exports** to only public API surface

---

## Module 5: `src/types/` — Type Definitions

**Purpose:** TypeScript type definitions, Zod validation schemas, and type-adjacent runtime constants for the domain model.

**Files (11):**

| File | LOC | Role |
|------|----:|------|
| `events.ts` | 536 | Loop event types, event data unions, timestamp helpers |
| `loop.ts` | 400 | Loop, LoopConfig, LoopState types, initial state factory |
| `api.ts` | 278 | API request/response types, file diff types |
| `schemas/loop.ts` | 120 | Zod schemas for loop request validation |
| `schemas/workspace.ts` | 108 | Zod schemas for workspace/server settings validation |
| `workspace.ts` | 95 | Workspace type definition |
| `schemas/index.ts` | 65 | Barrel for schemas |
| `schemas/preferences.ts` | 44 | Zod schemas for preference validation |
| `settings.ts` | 43 | ServerMode, ConnectionStatus, default settings factory |
| `schemas/model.ts` | 33 | Zod schemas for model preference validation |
| `index.ts` | 8 | Barrel exports |

**Total:** 1,730 LOC

### Module-Level Findings

| # | Severity | Dimension | Finding |
|---|----------|-----------|---------|
| C5.1 | **Major** | Dead Code | Across schema files, 16 `*Input` type aliases are exported (e.g., `CreateLoopInput`, `UpdateLoopInput`, `ServerSettingsInput`, `ModelPreferenceInput`, etc.) that are never imported by any consumer in the codebase. The API layer uses `z.infer<typeof Schema>` directly in `api.ts`. These dead exports add noise and maintenance burden. |
| C5.2 | **Major** | Dead Code | `LogEntry` interface in `api.ts:249-258` defines a log entry shape, but the component that actually renders logs (`LogViewer.tsx`) defines its own `LogEntry` type inline. The `api.ts` version is never imported. |
| C5.3 | **Major** | Name Collision | `ConnectionStatus` is defined in `settings.ts:34-43` as an interface with `connected`, `mode`, `serverUrl`, `error` fields. A different `ConnectionStatus` type is defined in `hooks/useWebSocket.ts` as a string union `"connecting" | "connected" | "disconnected"`. These represent entirely different concepts but share the same name, creating confusion. |
| C5.4 | **Minor** | Boundary Violation | Type files contain runtime logic: `createInitialState()` in `loop.ts`, `getDefaultServerSettings()` in `settings.ts`, `createTimestamp()` in `events.ts`, `DEFAULT_LOOP_CONFIG` constant in `loop.ts`. While co-locating defaults with types is convenient, it means "type" modules have runtime side-effect potential and are not tree-shakeable in the traditional sense. |
| C5.5 | **Minor** | Barrel Completeness | `settings.ts` is not re-exported from the barrel `index.ts`. The barrel exports `loop`, `events`, `api`, and `workspace` — but not `settings`. Consumers must import `ServerMode`, `ConnectionStatus`, and `getDefaultServerSettings` directly. |
| C5.6 | **Minor** | Dependency Direction | `loop.ts` imports `TodoItem` from `"../backends/types"`. This creates a reverse dependency: the types module (which should be a foundational, dependency-free layer) depends on the backends module (which is an implementation detail). `TodoItem` should be defined in the types module and imported by backends. |
| C5.7 | **Minor** | Type Redundancy | `ServerMode` type is manually defined as `"spawn" | "connect"` in `settings.ts:15` when the same values are already encoded in the `ServerSettingsSchema` Zod schema in `schemas/workspace.ts`. Changes to valid modes must be synchronized in two places. |
| C5.8 | **Suggestion** | Architecture | `MessageData`/`PersistedMessage` and `ToolCallData`/`PersistedToolCall` in `events.ts` are acknowledged mirror types (one for events, one for persistence). Unifying them or making one derive from the other would reduce the surface area and prevent drift. |

### API Surface Analysis

**Barrel exports (`index.ts`):**
- Exports: `loop`, `events`, `api`, `workspace`
- **Missing:** `settings` (with `ServerMode`, `ConnectionStatus`, `getDefaultServerSettings`)

**Schemas barrel (`schemas/index.ts`):**
- Properly re-exports all schemas and validation types
- However, many of the exported `*Input` types are dead code

**Actual usage:**
- `api/loops.ts` imports schemas from `"../types/schemas"` (via schemas barrel)
- `api/loops.ts` imports response types from `"../types/api"` (direct)
- `core/loop-manager.ts` imports from `"../types/loop"` and `"../types/events"` (direct)
- `api/workspaces.ts` imports `ServerSettingsSchema` from `"../types/schemas/workspace"` (bypasses barrel)

**Assessment:** Reasonable structure but with dead exports and missing barrel entries. The schemas sub-module is well-organized.

### Cohesion & Coupling

**Cohesion:** Good conceptual separation between domain types and validation schemas. The boundary is slightly leaky due to runtime logic in type files.

**Coupling:** Mostly a leaf dependency (other modules depend on types, types depend on almost nothing). The exception is the `TodoItem` import from `backends/types`, which inverts the expected dependency direction.

### Top Recommendations (Prioritized)

1. **Remove dead `*Input` type aliases** or add `@deprecated` annotations
2. **Rename one of the `ConnectionStatus` types** to avoid ambiguity
3. **Move `TodoItem` definition** to `types/loop.ts` and import it from there in backends
4. **Add `settings.ts` to barrel** exports
5. **Remove dead `LogEntry`** from `api.ts` or ensure components import it

---

## Module 6: `src/utils/` — Shared Utilities

**Purpose:** Miscellaneous utility functions for loop status checking, async event streaming, loop name generation, and git branch name sanitization.

**Files (4):**

| File | LOC | Role |
|------|----:|------|
| `event-stream.ts` | 148 | Async push/pull event stream with buffering |
| `name-generator.ts` | 142 | AI-powered loop name generation with fallbacks |
| `loop-status.ts` | 135 | Loop status predicates (canAccept, isFinalState, etc.) |
| `index.ts` | 32 | Barrel exports + inline `sanitizeBranchName` |

**Total:** 457 LOC

### Module-Level Findings

| # | Severity | Dimension | Finding |
|---|----------|-----------|---------|
| C6.1 | **Critical** | Resource Leak | `name-generator.ts:113-114` creates a `setTimeout` for the timeout promise in `Promise.race`. If the `sendPrompt` call resolves first (the happy path), the timeout's `setTimeout` is never cleared. While the timeout will eventually fire and the rejected promise will be garbage collected, this is a timer leak — in rapid succession (creating many loops quickly), these orphan timers accumulate. Fix: capture the timer ID and clear it after the race resolves. |
| C6.2 | ~~**Major**~~ **Resolved** | Missing Case | ~~`getStatusLabel()` in `loop-status.ts:15-43` is missing a case for the `"draft"` status. Loops can be created with `draft: true`, giving them a "draft" status. The `default` branch returns the raw status string `"draft"` (which happens to be readable), but this is clearly unintentional — all other statuses have explicit labels.~~ **Updated:** The `"draft"` case has been added at lines 26-27 of `loop-status.ts`. |
| C6.3 | **Major** | Edge Case | `sanitizeBranchName()` in `index.ts:23-30` can return an empty string if the input consists entirely of non-alphanumeric characters (e.g., `"!!!"` → `"---"` → `""` after trimming hyphens). An empty string is an invalid git branch name and will cause `git checkout -b ""` to fail. The function should have a fallback (e.g., `"unnamed"` or a random suffix). |
| C6.4 | **Major** | Code Organization | `sanitizeBranchName()` is defined inline in the barrel file `index.ts:23-30` rather than in its own utility file. This breaks the pattern of the barrel being import-only. The function should be in a dedicated file (e.g., `git-utils.ts`) and re-exported from the barrel. |
| C6.5 | **Major** | Test Coverage | No unit tests exist for `loop-status.ts`, `event-stream.ts`, or `sanitizeBranchName`. These are pure functions with clear input/output contracts — ideal candidates for unit testing. The `name-generator.ts` has tests but the other utilities do not. |
| C6.6 | **Major** | Memory Safety | `event-stream.ts` buffer (`items: T[]` at line 50) can grow unboundedly. If a producer pushes events faster than the consumer calls `next()`, the buffer will grow without limit. There is no backpressure mechanism, high-water mark, or maximum buffer size. For long-running loops with many events, this could cause memory issues. |
| C6.7 | **Major** | Consistency | Logger imports are inconsistent across the module: `loop-status.ts` imports from `"../lib/logger"` (frontend logger), `event-stream.ts` imports from `"../core/logger"` (backend logger), `name-generator.ts` has no logger at all. Since `loop-status.ts` is used on both frontend and backend (via the API layer), the frontend logger import is correct for its UI usage but incorrect when called from backend code. |
| C6.8 | **Minor** | Dead Export | `isLoopRunning` is exported from the barrel but analysis of import usage shows it may not be consumed externally — the same check is done inline in components. |

### API Surface Analysis

**Barrel exports (`index.ts`):**
- Exports: `getStatusLabel`, `canAccept`, `isFinalState`, `isLoopActive`, `isLoopRunning`, `canJumpstart`, `isAwaitingFeedback` (from `loop-status.ts`), `sanitizeBranchName` (defined inline)
- **Not exported via barrel:** `EventStream`, `createEventStream` (from `event-stream.ts`), `generateLoopName`, `sanitizeLoopName` (from `name-generator.ts`)

**Actual usage:**
- `core/loop-manager.ts` imports `sanitizeBranchName` from `"../utils"` (barrel) and `generateLoopName` from `"../utils/name-generator"` (direct)
- `backends/opencode/index.ts` imports `createEventStream` from `"../utils/event-stream"` (direct, not available via barrel)
- Components import status helpers from `"../utils"` (barrel) — but these are frontend functions that depend on `lib/logger`

**Assessment:** The barrel is selective — only loop status functions and `sanitizeBranchName` are exported. The most complex utilities (`event-stream`, `name-generator`) require direct imports. This is an inconsistent API surface.

### Cohesion & Coupling

**Cohesion:** Low. The four utilities have no common theme:
- `loop-status.ts` — UI/domain logic (loop state predicates)
- `event-stream.ts` — infrastructure (async data stream)
- `name-generator.ts` — AI interaction (prompt-based name generation)
- `sanitizeBranchName` — git tooling (string sanitization)

These should arguably live closer to their consumers: loop-status near components, event-stream near backends, sanitizeBranchName in core/git-service.

**Coupling:**
- `loop-status.ts` depends on `types/` and `lib/logger` (frontend logger)
- `event-stream.ts` depends on `core/logger` (backend logger)
- `name-generator.ts` depends on `backends/types` for `PromptInput`/`AgentResponse`

### Top Recommendations (Prioritized)

1. **Fix timer leak** in `name-generator.ts` — clear timeout after Promise.race resolves
2. **Add `"draft"` case** to `getStatusLabel()` switch
3. **Add empty-string guard** to `sanitizeBranchName()` — return a fallback
4. **Move `sanitizeBranchName`** out of barrel file into its own module
5. **Add buffer size limit** to `event-stream.ts` with overflow strategy (drop oldest, error, etc.)
6. **Add unit tests** for all pure utility functions

---

## Module 7: `src/components/` — React UI

**Purpose:** React functional components for the Ralpher web interface, including the main dashboard, loop management views, modals, and shared UI primitives.

**Files (25):**

| File | LOC | Role |
|------|----:|------|
| `LoopDetails.tsx` | 1,225 | Single loop detail view with tabs |
| `Dashboard.tsx` | 1,118 | Main dashboard: loop listing, creation, workspace management |
| `CreateLoopForm.tsx` | 949 | Loop creation form with model selection |
| `AppSettingsModal.tsx` | 428 | Application-wide settings |
| `ServerSettingsForm.tsx` | 400 | Server connection configuration |
| `WorkspaceSettingsModal.tsx` | 388 | Per-workspace settings |
| `LoopActionBar.tsx` | 337 | Loop action buttons (accept, push, discard, etc.) |
| `LogViewer.tsx` | 309 | Real-time log display with filtering |
| `LoopCard.tsx` | 306 | Loop summary card for dashboard |
| `PlanReviewPanel.tsx` | 275 | Plan review with accept/feedback |
| `LoopModals.tsx` | 223 | Modal containers for loop actions |
| `CreateWorkspaceModal.tsx` | 197 | Workspace creation form |
| `common/Modal.tsx` | 195 | Generic modal component |
| `TodoViewer.tsx` | 174 | Todo list from agent sessions |
| `RenameLoopModal.tsx` | 152 | Loop rename modal |
| `AcceptLoopModal.tsx` | 144 | Accept/merge confirmation modal |
| `AddressCommentsModal.tsx` | 130 | Review comment submission modal |
| `common/Badge.tsx` | 108 | Status badge component |
| `WorkspaceSelector.tsx` | 97 | Workspace dropdown selector |
| `MarkdownRenderer.tsx` | 86 | Markdown rendering with react-markdown |
| `common/Card.tsx` | 67 | Card container component |
| `common/Button.tsx` | 67 | Button component with variants |
| `common/CollapsibleSection.tsx` | 54 | Reusable collapsible UI section |
| `LogLevelInitializer.tsx` | 43 | Log level sync on mount |
| `common/Icons.tsx` | 31 | SVG icon components |
| `common/index.ts` | 10 | Common components barrel |
| `index.ts` | 14 | Barrel exports |

**Total:** 7,527 LOC

### Module-Level Findings

| # | Severity | Dimension | Finding |
|---|----------|-----------|---------|
| C7.1 | **Critical** | Complexity — God Component | `Dashboard.tsx` (1,118 LOC) is a god component with 26 `useState` calls, raw `fetch()` calls for multiple API endpoints, business logic for loop grouping/sorting/filtering, workspace management, modal state for 5+ different modals, and massive JSX with significant duplication between active and completed loop sections. This single component handles what should be 5-6 smaller components: `LoopList`, `WorkspacePanel`, `DashboardHeader`, `LoopGroupSection`, `DashboardModals`. |
| C7.2 | **Major** | Code Duplication | Model grouping, sorting, and rendering logic is duplicated between `CreateLoopForm.tsx` (for initial model selection) and `LoopActionBar.tsx` (for mid-loop model changes). Both components independently fetch models, group them by provider, sort by connected status, and render nearly identical model selection dropdowns. This should be extracted to a shared `ModelSelector` component. |
| C7.3 | **Major** | Accessibility | `Modal.tsx` lacks focus trapping. When a modal opens, keyboard focus can tab outside the modal to elements behind the overlay. This is a WCAG 2.1 Level A violation (2.4.3 Focus Order). The modal should trap focus within its content area and return focus to the trigger element on close. |
| C7.4 | **Major** | Error Handling | Multiple components silently swallow errors in catch blocks with no user-facing notification. For example, failed API calls in Dashboard result in `console.error` but no toast, alert, or error state shown to the user. The user has no indication that an operation failed. |
| C7.5 | **Major** | Performance | `groupLoopsByStatus` computation in Dashboard.tsx runs on every render without `useMemo`. With many loops, this creates unnecessary object allocations and array operations on every state change (including unrelated state like modal open/close). Similarly, workspace groups are computed without memoization. |
| C7.6 | **Minor** | Consistency | `PlanReviewPanel.tsx` implements its own modal-like overlay behavior instead of using the shared `Modal` component from `common/Modal.tsx`. This creates an inconsistent modal experience (different animations, different escape handling, different overlay behavior). |
| C7.7 | **Minor** | Code Duplication | `GearIcon` and `WorkspaceGearIcon` are near-identical inline SVG components defined separately. They differ only in `className` defaults. A single parameterized `GearIcon` would suffice. |
| C7.8 | **Minor** | State Management | Multiple modal states across the dashboard use a repetitive `{ open: boolean, loopId: string | null }` pattern. A generic `useModalState<TData>()` hook would reduce boilerplate. |
| C7.9 | **Minor** | Consistency | Logger usage varies: some components create named loggers via `createLogger("ComponentName")`, others use the global `log`, and some don't log at all. |

### API Surface Analysis

**Barrel exports (`index.ts` + `common/index.ts`):**
- Common: `Button`, `Card`, `Badge`, `Modal`, `ConfirmModal`, `CollapsibleSection`, `EditIcon` + their prop types
- Main: `Dashboard`, `LoopCard`, `LoopDetails`, `LogViewer`, `CreateLoopForm`, `LoopActionBar`
- **Not exported:** 13 components including all modals (`AcceptLoopModal`, `AddressCommentsModal`, `AppSettingsModal`, etc.), `PlanReviewPanel`, `TodoViewer`, `MarkdownRenderer`, `ServerSettingsForm`, `WorkspaceSelector`, `LogLevelInitializer`

**Actual usage:**
- `App.tsx` imports `Dashboard` and `LoopDetails` directly (not via barrel)
- Components import from each other directly (e.g., `LoopDetails` imports `LoopActionBar`, `LogViewer`, etc.)

**Assessment:** The barrel exports only 11 of 25 components. The 14 unexported components are used as internal implementation details of the exported components. This is a reasonable pattern — only "page-level" and shared components are exported.

### Cohesion & Coupling

**Cohesion:** Reasonable. Common primitives (Button, Card, Modal, Badge, Icons) are well-separated in `common/`. Feature components (Dashboard, LoopDetails, CreateLoopForm) are at the right level. The main concern is Dashboard.tsx combining too many responsibilities.

**Coupling:**
- Components make direct `fetch()` calls to API endpoints instead of using a service layer or the hooks consistently
- Some components import from `hooks/` (good), others inline their own fetch logic (bad)
- Tight coupling between Dashboard and its many child modals

### Top Recommendations (Prioritized)

1. **Decompose Dashboard.tsx** into `LoopList`, `DashboardHeader`, `DashboardModals`, etc.
2. **Extract `ModelSelector`** shared between CreateLoopForm and LoopActionBar
3. **Add focus trapping** to Modal component (use a library like `focus-trap-react` or implement manually)
4. **Add user-facing error notifications** — toast component or error state in UI
5. **Memoize expensive computations** with `useMemo` (loop grouping, workspace filtering)
6. **Standardize fetch patterns** — all API calls should go through hooks, not inline fetch

---

## Module 8: `src/hooks/` — React Hooks

**Purpose:** React custom hooks for data fetching, WebSocket management, and server-side state synchronization.

**Files (10):**

| File | LOC | Role |
|------|----:|------|
| `useLoop.ts` | 671 | Single loop data fetching with real-time updates |
| `loopActions.ts` | 349 | 14 API action functions for loop operations |
| `useLoops.ts` | 307 | Loop list fetching with WebSocket updates |
| `useWorkspaceServerSettings.ts` | 305 | Workspace server settings CRUD |
| `useWebSocket.ts` | 230 | WebSocket connection management |
| `useWorkspaces.ts` | 230 | Workspace list fetching |
| `useAgentsMdOptimizer.ts` | 158 | AGENTS.md optimization hook |
| `useLogLevelPreference.ts` | 103 | Log level persistence and sync |
| `useMarkdownPreference.ts` | 99 | Markdown rendering preference |
| `index.ts` | 25 | Barrel exports |

**Total:** 2,477 LOC

### Module-Level Findings

| # | Severity | Dimension | Finding |
|---|----------|-----------|---------|
| C8.1 | **Major** | Bug — Double Fetch | `useLoop.ts` fetches loop data on mount and also triggers a fetch when WebSocket events arrive. Due to the dependency array including calculated values (like array lengths from messages/toolCalls), the effect re-triggers unnecessarily, causing a double-fetch on initial mount. This results in two identical API calls within milliseconds of each other. |
| C8.2 | **Major** | UX — Loading Flicker | Both `useLoop.ts` and `useLoops.ts` set `loading: true` at the start of every refresh, including WebSocket-triggered refreshes. This causes a brief loading state flicker in the UI on every event. For WebSocket updates (which should feel instant), the loading state should not be shown — data should be updated in-place without an intermediate loading state. |
| C8.3 | **Major** | Race Condition | `useLoop.ts` has a race condition when switching between loops. When the user navigates from loop A to loop B, the hook calls `resetState()` and then `fetchLoop(newId)`. If the fetch for loop A's data was still in-flight, its response may arrive after the reset and overwrite loop B's state with loop A's data. No AbortController is used to cancel stale requests. |
| C8.4 | **Major** | Memory | `useLoop.ts` appends to `messages` and `toolCalls` arrays on every iteration event. For long-running loops with thousands of iterations, these arrays grow without bound. There is no pagination, virtualization, or maximum size limit. On a loop running for hours, this will cause increasing memory pressure and slower renders. |
| C8.5 | **Major** | Code Duplication | `loopActions.ts` contains 14 functions (`acceptLoopApi`, `pushLoopApi`, `discardLoopApi`, `deleteLoopApi`, `purgeLoopApi`, `markMergedApi`, `setPendingPromptApi`, `clearPendingPromptApi`, `sendPlanFeedbackApi`, `acceptPlanApi`, `discardPlanApi`, `setPendingApi`, `clearPendingApi`, `addressReviewCommentsApi`) that all follow the same pattern: log, fetch, check `!response.ok`, parse error, throw, log success, return. The only differences are URL, method, body, and return shape. A generic `apiCall<T>(url, options)` wrapper would eliminate ~260 lines of boilerplate. |
| C8.6 | ~~Major~~ **Resolved** | Test Coverage | ~~No unit tests exist for any hook.~~ **Updated:** 126 hook tests now exist across 4 test files: `loopActions.test.ts` (45 tests covering all 14 API functions), `useLoops.test.ts` (24 tests), `useLoop.test.ts` (37 tests), `useWorkspaces.test.ts` (20 tests). `useWebSocket` remains untested directly but is exercised indirectly. `useLogLevelPreference` and `useMarkdownPreference` remain untested (low-risk utility hooks). |
| C8.7 | **Minor** | Fragile Coupling | WebSocket event handlers in `useLoop` and `useLoops` rely on `useWebSocket`'s internal ref-based callback pattern. The handlers are registered via refs and called synchronously in the WebSocket `onmessage` handler. If the internal implementation changes (e.g., to use `useEffect` cleanup for unregistration), the event delivery guarantees could break. |
| C8.8 | **Minor** | Missing AbortController | No async operation in any hook uses `AbortController` for cancellation. When components unmount during an in-flight fetch, the response handler still runs and attempts to set state on an unmounted component. While React 18+ suppresses the warning, this wastes resources and can cause subtle bugs. |
| C8.9 | **Minor** | Inconsistent Return Types | `loopActions.ts` returns `boolean` (true) for simple operations (discard, delete, purge) but returns typed result objects (`AcceptLoopResult`, `PushLoopResult`, `SetPendingResult`) for operations with data. This inconsistency makes the API surface harder to learn. All actions should return a consistent `{ success: true, data?: T }` shape. |

### API Surface Analysis

**Barrel exports (`index.ts`):**
- Exports: all hooks + selected action functions + result types
- **Not exported via barrel:** `addressReviewCommentsApi`, `sendPlanFeedbackApi`, `acceptPlanApi`, `discardPlanApi`, `markMergedApi`, `setPendingApi`, `clearPendingApi`, `SetPendingResult`, `AddressCommentsResult`

**Actual usage:**
- Components import from both the barrel and directly (e.g., `LoopDetails.tsx` imports `useLoop` from `"../hooks"` but `PlanReviewPanel.tsx` imports actions directly from `"../hooks/loopActions"`)

**Assessment:** The barrel is partial — only 6 of 14 action functions are exported. Components inconsistently use the barrel vs. direct imports. Either export everything or document which actions are "public."

### Cohesion & Coupling

**Cohesion:** Good. Hooks are well-organized by domain entity (loop, loops, workspaces, settings). The `loopActions.ts` file groups all API call functions together, which is a reasonable organizational choice despite the duplication within it.

**Coupling:**
- `useLoop.ts` and `useLoops.ts` depend on `useWebSocket` for real-time updates
- All hooks depend on `lib/logger` for logging
- `loopActions.ts` makes raw `fetch()` calls — no shared HTTP client abstraction

### Top Recommendations (Prioritized)

1. **Add AbortController** to `useLoop` for handling loop switches and unmounts
2. **Fix loading flicker** — don't set `loading: true` on WebSocket-triggered refreshes
3. **Extract generic `apiCall<T>()` wrapper** to deduplicate 13 action functions
4. **Add maximum array sizes** for messages/toolCalls in useLoop (with pagination)
5. **Add unit tests** for hooks using `renderHook` from React Testing Library
6. **Complete barrel exports** or document the public/private action API boundary

---

## Module 9: `src/lib/` — Frontend Library

**Purpose:** Browser-side logging infrastructure and predefined prompt templates.

**Files (3):**

| File | LOC | Role |
|------|----:|------|
| `prompt-templates.ts` | 205 | Predefined prompt templates for loop creation |
| `logger.ts` | 163 | Frontend tslog instance with sub-logger caching |
| `index.ts` | 15 | Barrel exports |

**Total:** 383 LOC

### Module-Level Findings

| # | Severity | Dimension | Finding |
|---|----------|-----------|---------|
| C9.1 | **Major** | Code Duplication | Logger constants (`LogLevelName`, `LOG_LEVELS`, `LOG_LEVEL_NAMES`, `DEFAULT_LOG_LEVEL`) are fully duplicated from `core/logger.ts`. Both files define identical type definitions and constant maps independently. A shared `logger-constants.ts` module should be created and imported by both. |
| C9.2 | **Major** | Behavioral Inconsistency | `lib/logger.ts` correctly caches sub-loggers (`subLoggers` Map at line 89) and updates their levels in `setLogLevel()` (lines 136-138). `core/logger.ts` does NOT do this — its `setLogLevel()` only updates the parent logger. This means runtime log level changes work correctly on the frontend but silently fail for sub-loggers on the backend. This is the same bug described in C1.4 but viewed from the perspective of the correct implementation being in this module. |
| C9.3 | **Minor** | Dead Barrel | The barrel file `index.ts` re-exports everything from `logger.ts`, but no consumer imports from `"../lib"` or `"../lib/index"`. All consumers import directly from `"../lib/logger"`. The barrel is dead code. |

### API Surface Analysis

**Barrel exports (`index.ts`):**
- Exports: `log`, `createLogger`, `setLogLevel`, `getLogLevel`, `LOG_LEVELS`, `LOG_LEVEL_NAMES`, `LOG_LEVEL_OPTIONS`, `DEFAULT_LOG_LEVEL`, `LogLevelName`

**Actual usage:**
- `hooks/loopActions.ts` imports `createLogger` from `"../lib/logger"` (direct)
- `hooks/useLogLevelPreference.ts` imports from `"../lib/logger"` (direct)
- `utils/loop-status.ts` imports from `"../lib/logger"` (direct)
- `components/LogLevelInitializer.tsx` imports from `"../lib/logger"` (direct)
- **No consumer uses the barrel** `"../lib"` or `"../lib/index"`

**Assessment:** The barrel is unused. Either enforce barrel-only imports or remove it.

### Cohesion & Coupling

**Cohesion:** High — single-purpose module for frontend logging.

**Coupling:** Depends only on `tslog` library. No project-internal dependencies.

### Top Recommendations (Prioritized)

1. **Extract shared logger constants** to a shared module (or at minimum, keep core/logger as the source of truth and import from there if bundling allows)
2. **Port sub-logger caching pattern** to `core/logger.ts` (or vice versa — unify the implementations)
3. **Remove dead barrel** `index.ts` or enforce its usage

---

## Module 10: Entry Points & Configuration

**Purpose:** Application entry points (server, frontend, build), HTML template, CSS entry, and project configuration files.

**Files:**

| File | LOC | Role |
|------|----:|------|
| `index.ts` | 77 | Server entry point (Bun.serve setup) |
| `App.tsx` | 87 | Root React component with hash routing |
| `frontend.tsx` | 21 | React DOM mount point |
| `build.ts` | 61 | Build script for standalone binary |
| `index.html` | 14 | HTML template |
| `index.css` | ~15 | Tailwind CSS imports |
| `tsconfig.json` | 36 | TypeScript configuration |
| `package.json` | 32 | Project metadata and scripts |
| `Dockerfile` | 50 | Multi-stage Docker build |
| `bunfig.toml` | ~5 | Bun configuration |
| `bun-env.d.ts` | ~5 | Bun environment type declarations |

### Module-Level Findings

| # | Severity | Dimension | Finding |
|---|----------|-----------|---------|
| C10.1 | **Major** | Error Handling | `frontend.tsx` renders `<App />` without a React Error Boundary. Any uncaught error in any component will crash the entire application with a white screen and no recovery path. A top-level `<ErrorBoundary>` should wrap `<App />` and display a fallback UI with a retry option. |
| C10.2 | **Major** | Error Handling | `index.ts` uses top-level `await` (lines 16, 20-21, 28) without try/catch. If `ensureDataDirectories()`, `getLogLevelPreference()`, or `backendManager.initialize()` throw, the server crashes with an unhandled rejection. These should be wrapped in try/catch with meaningful error messages and graceful fallbacks. |
| C10.3 | **Major** | Accessibility | `index.html:5` sets `user-scalable=no` in the viewport meta tag. This prevents users from zooming the page, which is a WCAG 2.1 Level AA violation (1.4.4 Resize Text). This particularly affects users with low vision who rely on pinch-to-zoom on mobile devices. |
| C10.4 | **Minor** | Security | `Dockerfile` runs the application as root (no `USER` directive after the final `COPY`). While the `debian:bookworm-slim` base image doesn't have a pre-configured non-root user, one should be created. Running as root in a container means a container escape vulnerability gives full host access. |
| C10.5 | **Minor** | Build Script | `package.json:9` build script uses `;` between `tsc` and the build step: `"bun run tsc; export workspace_dir=..."`. The semicolon means the build continues even if `tsc` reports type errors. This should use `&&` to fail fast on type errors. |
| C10.6 | **Minor** | API Consistency | `build.ts` uses Node.js `fs` API (`import fs from 'fs'`) for file operations instead of Bun's native APIs (`Bun.file`, `Bun.write`). While functional, this contradicts the AGENTS.md guideline: "Always use Bun features and APIs where possible." |
| C10.7 | **Minor** | Dependency Management | `package.json:23` pins `zod` with a caret range (`^4.3.6`) while all other dependencies use exact pinning (no `^` or `~`). This inconsistency means `zod` can float to newer minor/patch versions on `bun install`, potentially introducing breaking changes. |
| C10.8 | **Minor** | Dead Configuration | `tsconfig.json:25-27` defines a path alias `@/*` mapping to `./src/*`, but no file in the codebase uses `@/` imports. All imports use relative paths. This is dead configuration that could confuse contributors. |

### Top Recommendations (Prioritized)

1. **Add React Error Boundary** wrapping `<App />` in `frontend.tsx`
2. **Wrap top-level awaits** in try/catch in `index.ts`
3. **Remove `user-scalable=no`** from viewport meta tag
4. **Add non-root user** to Dockerfile
5. **Change `;` to `&&`** in build script
6. **Pin zod version** (remove `^`)

---

## Cross-Module Findings

These are systemic patterns that span multiple modules and indicate codebase-wide architectural concerns.

### XM-1: Logger Infrastructure Fragmentation (Critical)

**Affected modules:** `core/`, `lib/`, `api/`, `persistence/`, `utils/`, `components/`, `hooks/`

The codebase has two independent logger implementations (`core/logger.ts` for backend, `lib/logger.ts` for frontend) with:
- Duplicated constants (type, level maps, defaults)
- Inconsistent behavior (sub-logger level sync works in frontend, broken in backend)
- Inconsistent import paths across consumers
- Some modules import from the wrong logger (e.g., `utils/loop-status.ts` imports from `lib/logger` but runs on backend too)

**Recommendation:** Create a `shared/logger-constants.ts` with types and constants. Have both loggers import from it. Port the sub-logger caching pattern to both.

### XM-2: Pervasive Code Duplication Pattern (Major)

**Affected modules:** `api/` (errorResponse x3), `hooks/` (14 action functions), `components/` (model selector), `core/` (branch naming), `persistence/` (update functions)

Code duplication is the single most common finding across the codebase. The pattern is always the same: a function is written once, then copy-pasted with minor modifications. This creates maintenance burden (N places to update) and consistency risk (one copy gets updated, others don't).

**Recommendation:** Establish a refactoring pass focused solely on DRY violations. Priority targets:
1. `hooks/loopActions.ts` — generic API call wrapper (~260 LOC savings)
2. `api/` errorResponse — shared helper (~30 LOC savings)
3. `components/` ModelSelector — shared component (~100 LOC savings)

### XM-3: Inconsistent Barrel Export Strategy (Major)

**Affected modules:** All modules with `index.ts` barrels

Every module has a barrel `index.ts`, but the strategy is inconsistent:
- `core/index.ts` — missing 5 of 9 submodules
- `persistence/index.ts` — missing `workspaces.ts`
- `types/index.ts` — missing `settings.ts`
- `lib/index.ts` — exists but never imported (dead)
- `hooks/index.ts` — missing 8 of 14 action functions
- `components/index.ts` — intentionally partial (14 of 25)
- `utils/index.ts` — missing 2 of 3 utility modules

Most consumers bypass barrels and import directly. This suggests the barrel pattern is overhead without value in this codebase.

**Recommendation:** Either commit to barrel-only imports (add lint rule, complete all barrels) or remove barrels in favor of explicit direct imports (which is the actual pattern).

### XM-4: ~~No~~ Test Coverage for Hooks and Components (~~Major~~ **Largely Resolved**)

**Affected modules:** `hooks/`, `components/`

~~Combined 9,426 LOC across hooks and components with zero automated tests.~~ **Updated:** 715 frontend tests now exist across 31 test files:
- **Hooks:** 126 tests (loopActions: 45, useLoop: 37, useLoops: 24, useWorkspaces: 20)
- **Common components:** 101 tests (Badge: 33, Modal: 28, Button: 22, Card: 18)
- **Feature components:** 406 tests (LoopDetails: 55, CreateLoopForm: 53, LoopCard: 48, LogViewer: 33, PlanReviewPanel: 32, Dashboard: 31, LoopModals: 29, TodoViewer: 27, AcceptLoopModal: 25, LoopActionBar: 24, RenameLoopModal: 17, AddressCommentsModal: 16, WorkspaceSelector: 16)
- **Container components:** 13 tests (App: 13)
- **E2E scenarios:** 50 tests across 8 scenario files
- **Infrastructure:** 19 tests

**Remaining gaps:** `useWebSocket` (no direct tests), `useLogLevelPreference`, `useMarkdownPreference`, `useWorkspaceServerSettings`, `useAgentsMdOptimizer`, `Icons.tsx`, `MarkdownRenderer.tsx`, `LogLevelInitializer.tsx`, `ServerSettingsForm.tsx`, `CreateWorkspaceModal.tsx`, `AppSettingsModal.tsx`, `WorkspaceSettingsModal.tsx`, `CollapsibleSection.tsx`. These are lower-risk components/hooks.

**Recommendation:** The highest-risk code is now covered. Remaining untested components are mostly configuration forms and low-complexity utility hooks. Add tests for these as they are modified.

### XM-5: Direct Persistence Access from API Layer (Major)

**Affected modules:** `api/`, `persistence/`, `core/`

Multiple API handlers import directly from the persistence layer, bypassing the core managers:
- `api/loops.ts` imports `updateLoopState`, `getActiveLoopByDirectory` from `persistence/loops`
- `api/loops.ts` imports `getReviewComments` from `persistence/database`
- `api/workspaces.ts` imports `getWorkspaceByDirectory` from `persistence/workspaces`

This violates the layered architecture where API → Core → Persistence. Direct access means state mutations can skip validation, event emission, and business rules enforced by the managers.

**Recommendation:** Add the necessary query methods to `LoopManager` and `BackendManager` so API handlers never need to import from `persistence/` directly.

### XM-6: Async/Sync Mismatch (Minor)

**Affected modules:** `persistence/`, `core/`, `api/`

All persistence functions are `async` despite performing synchronous Bun SQLite operations. This propagates upward — callers in `core/` must `await` them, and API handlers must `await` those. The entire call chain pays the microtask overhead of Promise wrapping for what are fundamentally synchronous operations.

**Recommendation:** This is a low-priority refactor. If addressed, start at the persistence layer and work upward. The `async` signature provides forward-compatibility if the persistence layer ever moves to an async database driver.

### XM-7: Missing Error Boundary and Error UX (Major)

**Affected modules:** `components/`, `hooks/`, entry points

There is no error boundary at any level of the React tree, no toast/notification system for surfacing errors, and most catch blocks either swallow errors or only log to console. Users have no visibility into failures.

**Recommendation:** Add (1) a root-level `ErrorBoundary` in `frontend.tsx`, (2) a toast/notification system for transient errors, and (3) error states in key components (Dashboard, LoopDetails) for API failures.

---

## Summary of Critical Findings

| ID | Module | Finding | Impact |
|----|--------|---------|--------|
| C1.1 | core | Fire-and-forget async in `startLoop()` | Loops can silently enter inconsistent state |
| C2.1 | api | ~~Unauthenticated `POST /api/server/kill`~~ Not Applicable (reverse proxy) | ~~Any network client can kill the server~~ N/A |
| C3.1 | persistence | SQL injection in `getTableColumns()` | Currently safe but pattern is exploitable |
| C4.1 | backends | Fire-and-forget async IIFE in `translateEvent()` | Events silently lost, errors swallowed |
| C6.1 | utils | Timer leak in `name-generator.ts` | Memory pressure under rapid loop creation |
| C7.1 | components | Dashboard.tsx god component (~1,118 LOC, 26 state vars) | Unmaintainable, performance issues (now has 31 tests, but decomposition still recommended) |

**Total findings: 3 Critical (1 N/A, 2 By Design), 50 Major (3 resolved/partially resolved), 31 Minor (1 N/A), 3 Suggestions = 88 active findings across 10 modules.**
