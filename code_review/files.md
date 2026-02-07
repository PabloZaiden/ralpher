# File-by-File Code Review

## Summary

### Findings by Severity

| Severity | Count | Description |
|----------|-------|-------------|
| Critical | 8 | Issues that can cause data loss, security vulnerabilities, or silent failures in production |
| Major | 68 | Significant code quality, maintainability, or correctness issues |
| Minor | 96 | Style, convention, or low-risk issues |
| Suggestion | 22 | Recommendations for improvement, not defects |

### Findings by Directory

| Directory | Critical | Major | Minor | Suggestion |
|-----------|----------|-------|-------|------------|
| src/core/ | 1 | 14 | 14 | 5 |
| src/api/ | 1 | 11 | 16 | 1 |
| src/persistence/ | 1 | 7 | 11 | 2 |
| src/backends/ | 1 | 7 | 7 | 2 |
| src/types/ | 0 | 7 | 5 | 4 |
| src/utils/ | 1 | 5 | 3 | 2 |
| src/components/ | 1 | 7 | 10 | 0 |
| src/hooks/ | 0 | 5 | 14 | 1 |
| src/lib/ | 0 | 2 | 2 | 0 |
| Entry Points & Config | 1 | 3 | 7 | 2 |
| Tests | 1 | 3 | 2 | 0 |
| **Total** | **8** | **71** | **84** | **19** |

---

## src/core/

### src/core/loop-manager.ts

**Purpose:** Central orchestrator for loop lifecycle — creation, starting, stopping, accepting, and state management of Ralph Loops.
**LOC:** ~2025

| # | Severity | Dimension | Lines | Finding |
|---|----------|-----------|-------|---------|
| 1 | Critical | Best practices | ~340-400 | `startLoop()` uses fire-and-forget `engine.start().catch()` — promise is not awaited. AGENTS.md explicitly forbids this pattern. |
| 2 | Major | Code duplication | ~350, ~520 | Duplicate branch name generation logic between `startLoop` and `startDraftLoop`. Both construct branch names with the same prefix/sanitize logic. |
| 3 | Major | Simplicity | ~600-800 | `acceptLoop()` method is ~200 lines handling merge, cleanup, branch deletion, and state transitions in one massive method. Should be decomposed. |
| 4 | Major | State management | scattered | State transition validation is scattered. Multiple methods check `loop.state.status` independently instead of using a centralized state machine. |
| 5 | Major | Error handling | scattered | Direct mutation of `loop.state` properties before calling `updateLoopState()` — if persistence fails, in-memory object is already mutated. |
| 6 | Minor | Simplicity | scattered | `getLoop()`, `listLoops()` etc. are async wrappers around synchronous persistence calls. |
| 7 | Minor | Testability | module-level | `loopEventEmitter` is a module-level singleton that makes testing difficult. |
| 8 | Minor | Code duplication | scattered | Multiple `try/catch` blocks with identical error handling patterns (log + emit error event + update state to failed). |
| 9 | Suggestion | State management | — | Consider a state machine library or pattern for loop status transitions. |

---

### src/core/loop-engine.ts

**Purpose:** Executes loop iterations — builds prompts, sends to backend, processes responses, manages iteration lifecycle.
**LOC:** ~2009

| # | Severity | Dimension | Lines | Finding |
|---|----------|-----------|-------|---------|
| 1 | Major | Simplicity | scattered | `runIteration()` is ~250 lines — handles prompt building, sending, response processing, logging, and state updates all in one method. |
| 2 | Major | Code duplication | scattered | Duplicate prompt-building logic between `start()` and `runIteration()` — both construct system prompts and context. |
| 3 | Major | Security | scattered | `stopPattern` matching uses `new RegExp()` on user-provided patterns without try/catch for invalid regex, risking `SyntaxError` and ReDoS. |
| 4 | Minor | Naming & readability | scattered | `isLoopRunning` property name shadows the utility function `isLoopRunning` from `utils/loop-status`. |
| 5 | Minor | Configuration & environment | scattered | Magic numbers: `maxConsecutiveErrors` defaults to 3 (hardcoded), iteration delay is 1000ms (hardcoded). |
| 6 | Minor | Performance & resource management | scattered | `logs` array grows unboundedly during long-running loops. |
| 7 | Suggestion | Separation of concerns | — | Extract prompt building into a separate `PromptBuilder` class. |

---

### src/core/backend-manager.ts

**Purpose:** Manages backend connections and provides access to SDK clients and command executors for workspaces.
**LOC:** ~667

| # | Severity | Dimension | Lines | Finding |
|---|----------|-----------|-------|---------|
| 1 | Major | Type safety | scattered | `getSdkClient()` casts `backend.getSdkClient()` via `as unknown as OpencodeClient` — double unsafe cast. |
| 2 | Major | Code duplication | scattered | `getCommandExecutor` and `getCommandExecutorAsync` contain nearly identical logic (one sync, one async). |
| 3 | Minor | Testability | module-level | Module-level singleton pattern hinders testability. |
| 4 | Minor | Error handling | `initialize()` | Settings loaded from persistence with no error recovery — if the DB is corrupt, the app crashes. |
| 5 | Suggestion | Testability | — | Consider dependency injection for the backend instance. |

---

### src/core/git-service.ts

**Purpose:** Provides git operations (branch management, commits, merges, push/pull) via CommandExecutor for remote execution.
**LOC:** ~979

| # | Severity | Dimension | Lines | Finding |
|---|----------|-----------|-------|---------|
| 1 | Major | Error handling | scattered | Many methods wrap simple operations in try/catch that converts errors to generic messages, losing stack trace information. |
| 2 | Major | Separation of concerns | scattered | `pushBranch()` (~80 lines) handles push, error detection, retry with different remote, and output parsing — multiple concerns. |
| 3 | Minor | Error handling | `isGitRepo()` | Catches all errors and returns false — could mask real issues (permissions, disk errors). |
| 4 | Minor | Type safety | scattered | Several methods use `as string` assertions on exec results without null checking. |
| 5 | Suggestion | Separation of concerns | — | Extract remote URL detection into a separate method. |

---

### src/core/command-executor.ts

**Purpose:** Defines the `CommandExecutor` interface for executing commands on remote servers.
**LOC:** ~50

No findings. Clean interface definition.

---

### src/core/remote-command-executor.ts

**Purpose:** Implements `CommandExecutor` for remote opencode servers, translating commands to API calls.
**LOC:** ~464

| # | Severity | Dimension | Lines | Finding |
|---|----------|-----------|-------|---------|
| 1 | Minor | Security | `exec` | Builds command strings with potential shell injection if arguments contain special characters — inputs are controlled internally but fragile. |
| 2 | Minor | Error handling | `readFile` | Falls back to empty string on error without logging. |
| 3 | Suggestion | Performance & resource management | — | Add timeout support for remote commands. |

---

### src/core/event-emitter.ts

**Purpose:** Type-safe event emitter implementation for internal pub/sub.
**LOC:** ~150

| # | Severity | Dimension | Lines | Finding |
|---|----------|-----------|-------|---------|
| 1 | Suggestion | Best practices | — | Consider adding max listener warnings like Node.js EventEmitter. |

---

### src/core/config.ts

**Purpose:** Application configuration management.
**LOC:** ~100

| # | Severity | Dimension | Lines | Finding |
|---|----------|-----------|-------|---------|
| 1 | Minor | Performance & resource management | `getConfig()` | Returns a frozen copy on each call, allocating a new object. Could cache. |

---

### src/core/logger.ts

**Purpose:** Backend logging infrastructure with log levels and sub-logger creation.
**LOC:** ~100

| # | Severity | Dimension | Lines | Finding |
|---|----------|-----------|-------|---------|
| 1 | Major | Best practices | `createLogger()` | Does NOT cache sub-loggers, so `setLogLevel()` only updates the parent logger. Sub-loggers created via `createLogger("api:loops")` retain their original level after runtime level changes. |
| 2 | Major | Code duplication | scattered | `LogLevelName` type, `LOG_LEVELS`, `LOG_LEVEL_NAMES`, `DEFAULT_LOG_LEVEL` are duplicated identically in `src/lib/logger.ts`. |
| 3 | Minor | Performance & resource management | — | No max log buffer or rotation mechanism. |

---

### src/core/index.ts

**Purpose:** Barrel export for core modules.
**LOC:** ~9

No findings. Clean barrel export.

---

## src/api/

### src/api/loops.ts

**Purpose:** API route handlers for loop CRUD operations, loop control (start/stop/accept), plan management, and review comments.
**LOC:** ~1432

| # | Severity | Dimension | Lines | Finding |
|---|----------|-----------|-------|---------|
| 1 | Major | Code duplication | 375-426 vs 464-516 | PATCH and PUT handler bodies are near-identical copy-paste. Field mapping logic and error handling are duplicated. |
| 2 | Major | Code duplication | 169-216 vs 641-688 | Uncommitted changes preflight check logic duplicated between POST (create) and POST draft/start handlers. |
| 3 | Major | Code duplication | scattered | Active loop existence check duplicated between create and draft/start. |
| 4 | Major | Separation of concerns | 690-728 | Draft/start handler directly mutates `loop.state.status` and `loop.state.planMode`, bypassing loop manager's state management. |
| 5 | Major | Code duplication | scattered | `errorResponse()` helper is duplicated in 3 API files (loops.ts, models.ts, settings.ts). |
| 6 | Major | Consistency of patterns | scattered | Some handlers use `errorResponse()` while others construct `Response.json()` directly — inconsistent error response patterns. |
| 7 | Minor | Best practices | 147 | Dynamic `import()` inside POST handler should be a static import. |
| 8 | Minor | Type safety | 748, 757, 1376-78 | Non-null assertions on success result fields. |
| 9 | Minor | Error handling | 301-303, 318-320 | Empty catch blocks silently swallow errors. |
| 10 | Minor | Concurrency & race conditions | scattered | TOCTOU race condition between checking for uncommitted changes/active loops and creating the loop. |
| 11 | Minor | Module coupling & cohesion | 22-23 | Direct persistence layer imports from API handler — bypasses service layer. |
| 12 | Minor | Security | 456-462 | Debug log may contain sensitive prompt content. |
| 13 | Suggestion | Security | — | `stopPattern` field (regex from user input) should be validated for ReDoS. |

---

### src/api/workspaces.ts

**Purpose:** API route handlers for workspace CRUD operations and connection testing.
**LOC:** ~490

| # | Severity | Dimension | Lines | Finding |
|---|----------|-----------|-------|---------|
| 1 | Major | Consistency of patterns | scattered | Error response format differs from the rest of the API — uses `{ message, error }` vs convention `{ error, message }` via `ErrorResponse` type. |
| 2 | Major | Consistency of patterns | scattered | Mix of named-method-handler pattern and single-function-with-switch pattern — inconsistent with other API files. |
| 3 | Major | Code duplication | 157-163, 286-292, 355-361, 388-394, 443-449 | Workspace-lookup-and-404 pattern repeated 5 times. |
| 4 | Minor | Concurrency & race conditions | 115-121 | TOCTOU for duplicate workspace check. |
| 5 | Minor | Naming & readability | 221-224 | String matching for status code decisions. |
| 6 | Minor | Documentation & comments | scattered | Some handlers have JSDoc, some don't. |

---

### src/api/models.ts

**Purpose:** API route handlers for model discovery, enablement checking, and log level management.
**LOC:** ~427

| # | Severity | Dimension | Lines | Finding |
|---|----------|-----------|-------|---------|
| 1 | Major | Code duplication | scattered | `errorResponse` function duplicated (identical to loops.ts and settings.ts). |
| 2 | Minor | Type safety | 74, 80, 96 | `as ModelInfo[]` assertions repeated 3 times. |
| 3 | Minor | Performance & resource management | `isModelEnabled` | May connect test backend as side effect, mutating state. |
| 4 | Minor | Performance & resource management | scattered | Creating temporary `OpenCodeBackend` for every GET /api/models request is expensive. |
| 5 | Minor | Code duplication | scattered | Redundant log level validation when Zod already validated. |
| 6 | Minor | Logging & observability | `isModelEnabled` | Missing logging in `isModelEnabled` function. |
| 7 | Minor | Error handling | scattered | Disconnect errors silently swallowed. |

---

### src/api/settings.ts

**Purpose:** API route handlers for server settings retrieval, database reset, and server kill.
**LOC:** ~133

| # | Severity | Dimension | Lines | Finding |
|---|----------|-----------|-------|---------|
| 1 | Critical | Security | 115 | `POST /api/server/kill` has no authentication — any client can terminate the server. |
| 2 | Major | Security | 79 | `POST /api/settings/reset-all` is destructive with no authentication or confirmation. |
| 3 | Major | Code duplication | scattered | `errorResponse` duplicated (3rd copy across API files). |
| 4 | Minor | Consistency of patterns | scattered | Inconsistent logger initialization (uses `createLogger("api:settings")` while loops.ts uses `import { log }`). |

---

### src/api/git.ts

**Purpose:** API route handlers for git status and branch listing.
**LOC:** ~194

| # | Severity | Dimension | Lines | Finding |
|---|----------|-----------|-------|---------|
| 1 | Major | Code duplication | 83-129 vs 147-192 | Two endpoints share near-identical boilerplate — parse URL, get directory, validate, get git service, check isGitRepo, do work, handle errors. |
| 2 | Minor | Consistency of patterns | scattered | Error responses use inline `Response.json()` instead of shared helper. |
| 3 | Minor | Consistency of patterns | scattered | Inconsistent logger initialization pattern. |

---

### src/api/health.ts

**Purpose:** Health check endpoint.
**LOC:** ~50

No findings. Clean implementation.

---

### src/api/validation.ts

**Purpose:** Request validation utilities using Zod schemas.
**LOC:** ~122

| # | Severity | Dimension | Lines | Finding |
|---|----------|-----------|-------|---------|
| 1 | Minor | Dead/legacy code | scattered | `validateRequest` is exported but may be unused externally — `parseAndValidate` is what API handlers use. |

---

### src/api/websocket.ts

**Purpose:** WebSocket upgrade handler and message routing for real-time loop events.
**LOC:** ~135

| # | Severity | Dimension | Lines | Finding |
|---|----------|-----------|-------|---------|
| 1 | Minor | Documentation & comments | 77 | Stale comment about heartbeat. |
| 2 | Minor | Error handling | scattered | Silent error/JSON swallowing without trace logging. |
| 3 | Minor | Performance & resource management | scattered | No WebSocket connection limit. |
| 4 | Minor | Logging & observability | scattered | No connection open/close logging. |
| 5 | Minor | Security | scattered | No origin validation on WebSocket upgrade requests. |

---

### src/api/index.ts

**Purpose:** Barrel export aggregating all API route handlers.
**LOC:** ~59

No findings. Clean barrel export.

---

## src/persistence/

### src/persistence/database.ts

**Purpose:** SQLite database initialization, schema creation, and low-level database access (including review comment operations).
**LOC:** ~387

| # | Severity | Dimension | Lines | Finding |
|---|----------|-----------|-------|---------|
| 1 | Major | Separation of concerns | 312-385 | Review comment functions (`insertReviewComment`, `getReviewComments`, `markCommentsAsAddressed`) belong in a dedicated module, not in database infrastructure. |
| 2 | Major | Database & persistence | scattered | Schema duplication — base schema in `createTables` includes columns originally added by migrations 1-8, creating two sources of truth. |
| 3 | Major | Consistency of patterns | scattered | `workspaces` table NOT created in `createTables` (only in migration 10), inconsistent with other tables. |
| 4 | Minor | Testability | module-level | Module-level mutable singleton `let db: Database | null`. |
| 5 | Minor | Best practices | 67, 284 | Dynamic import of `fs/promises` — should be static or use Bun APIs. |
| 6 | Minor | Error handling | 285-303 | Error swallowing in `deleteAndReinitializeDatabase`. |
| 7 | Minor | Database & persistence | `resetDatabase` | Drops tables without disabling foreign key checks. |
| 8 | Minor | API design & consistency | `getReviewComments` | Returns snake_case column names, leaking DB schema to consumers. |

---

### src/persistence/loops.ts

**Purpose:** Loop persistence layer — CRUD operations, state/config updates, and row-to-object mapping for loops.
**LOC:** ~561

| # | Severity | Dimension | Lines | Finding |
|---|----------|-----------|-------|---------|
| 1 | Critical | Security | 57 (migrations) | SQL injection risk in `getTableColumns` via string interpolation in PRAGMA query. (Note: shared with migrations/index.ts) |
| 2 | Major | Best practices | scattered | `ALLOWED_LOOP_COLUMNS` manually maintained, must be kept in sync with schema AND migrations. |
| 3 | Major | Code duplication | 422-506 | `updateLoopState` and `updateLoopConfig` are near-identical ~40-line functions that differ only in which field they update. |
| 4 | Major | Database & persistence | 289 | `INSERT OR REPLACE` in `saveLoop` triggers `ON DELETE CASCADE`, silently destroying review comments. |
| 5 | Major | Error handling | 196-267 | Multiple `JSON.parse` calls in `rowToLoop` have no error handling — one corrupt row prevents listing ALL loops. |
| 6 | Minor | Best practices | scattered | All exported functions are `async` but contain zero `await` expressions (synchronous SQLite operations). |
| 7 | Minor | Database & persistence | 99 | `loopToRow` stores `Infinity` directly in SQLite. |
| 8 | Minor | Concurrency & race conditions | `getActiveLoopByDirectory` | Returns only first match with no DB-level unique constraint. |

---

### src/persistence/workspaces.ts

**Purpose:** Workspace persistence layer — CRUD operations for workspace records.
**LOC:** ~240

| # | Severity | Dimension | Lines | Finding |
|---|----------|-----------|-------|---------|
| 1 | Minor | Best practices | scattered | All functions unnecessarily async (same pattern as loops.ts). |
| 2 | Minor | Concurrency & race conditions | `deleteWorkspace` | Check-then-act not wrapped in transaction. |
| 3 | Minor | Concurrency & race conditions | `updateWorkspace` | Non-atomic read-after-write. |
| 4 | Minor | Consistency of patterns | scattered | No column name validation (unlike loops.ts which has `ALLOWED_LOOP_COLUMNS`). |

---

### src/persistence/preferences.ts

**Purpose:** User preferences persistence — log level, last directory, and markdown rendering preferences.
**LOC:** ~179

| # | Severity | Dimension | Lines | Finding |
|---|----------|-----------|-------|---------|
| 1 | Minor | Code duplication | scattered | `LogLevelName` type duplicated from `core/logger.ts`. |
| 2 | Minor | Best practices | scattered | All functions unnecessarily async. |
| 3 | Minor | Code duplication | scattered | `VALID_LOG_LEVELS` array duplicates the `LogLevelName` union. |
| 4 | Suggestion | Error handling | — | No input validation for `setLastDirectory`. |

---

### src/persistence/paths.ts

**Purpose:** Data directory and database readiness helpers.
**LOC:** ~25

| # | Severity | Dimension | Lines | Finding |
|---|----------|-----------|-------|---------|
| 1 | Minor | Dead/legacy code | scattered | Vestigial module — `ensureDataDirectories` just calls `initializeDatabase`, `isDataDirectoryReady` just calls `isDatabaseReady`. Unnecessary indirection. |

---

### src/persistence/migrations/index.ts

**Purpose:** Database migration system — sequential schema upgrades with idempotency checks.
**LOC:** ~553

| # | Severity | Dimension | Lines | Finding |
|---|----------|-----------|-------|---------|
| 1 | Critical | Security | 57 | SQL injection in `getTableColumns` — `tableName` interpolated directly into SQL string. |
| 2 | Minor | Best practices | migration 11 | Uses `Date.now()` for ID generation — non-deterministic, potential collisions. |
| 3 | Minor | Error handling | migration 13 | Missing `tableExists` check before ALTER TABLE. |
| 4 | Minor | Consistency of patterns | scattered | Logger import inconsistency (uses `log` from `../../core/logger` instead of `createLogger`). |
| 5 | Suggestion | Dead/legacy code | migration 4 | Documented no-op migration. |

---

### src/persistence/index.ts

**Purpose:** Barrel export for persistence modules.
**LOC:** ~10

| # | Severity | Dimension | Lines | Finding |
|---|----------|-----------|-------|---------|
| 1 | Major | Module coupling & cohesion | scattered | Missing re-export of `workspaces.ts` — consumers must import directly, breaking barrel pattern. |

---

## src/backends/

### src/backends/types.ts

**Purpose:** Backend abstraction types — defines the `Backend` interface, model info, prompt parts, and agent response structures.
**LOC:** ~240

| # | Severity | Dimension | Lines | Finding |
|---|----------|-----------|-------|---------|
| 1 | Major | Type safety | `getSdkClient()` | Returns `unknown`, forcing unsafe `as OpencodeClient` casts everywhere it's used. |
| 2 | Major | Type safety | `getModels()` | Returns `unknown[]`, providing no type information to consumers. |
| 3 | Major | Code duplication | scattered | `ModelInfo` defined here AND in `src/types/api.ts` with identical shape — duplicate type. |
| 4 | Minor | Type safety | `AgentPart` | Uses optional fields instead of discriminated union. |
| 5 | Suggestion | Dead/legacy code | `PromptPart.type` | Hardcoded to `"text"` with no other variants — may be over-engineered. |

---

### src/backends/opencode/index.ts

**Purpose:** OpenCode backend implementation — manages SDK client connection, prompt sending, session management, and event translation.
**LOC:** ~1016

| # | Severity | Dimension | Lines | Finding |
|---|----------|-----------|-------|---------|
| 1 | Critical | Best practices | 834-851 | Fire-and-forget async IIFE in `translateEvent` — async API call not awaited. |
| 2 | Major | Simplicity | `translateEvent` | Function has 8 parameters — too many, hard to test and maintain. |
| 3 | Major | Type safety | 684 | `client` parameter typed as `any`. |
| 4 | Major | Code duplication | 335-341 vs 375-381 | Prompt mapping logic duplicated between `sendPrompt` and `sendPromptAsync`. |
| 5 | Major | Dead/legacy code | 1011-1015 | `getServerUrl` breaks encapsulation with `unknown` cast AND is dead code. |
| 6 | Major | Error handling | 298-301 | `getSession` swallows all errors as "not found" — doesn't distinguish 404 from 500/network errors. |
| 7 | Minor | Performance & resource management | scattered | Excessive logging in hot paths (6+ log statements per `sendPromptAsync` call). |
| 8 | Minor | Dead/legacy code | scattered | `ConnectionInfo` re-export "for backward compatibility" — may be dead code. |
| 9 | Minor | Code duplication | scattered | Error messages use `JSON.stringify(result.error)` repeatedly — could be a helper. |
| 10 | Minor | Configuration & environment | 153-154 | `customFetch` disables request timeout. |
| 11 | Minor | Concurrency & race conditions | scattered | `connected` flag potentially out of sync with `client` across async boundaries. |

---

### src/backends/index.ts

**Purpose:** Barrel export for backends.
**LOC:** ~7

| # | Severity | Dimension | Lines | Finding |
|---|----------|-----------|-------|---------|
| 1 | Suggestion | Dead/legacy code | — | Barrel re-exports entire internal surface including dead code. |

---

## src/types/

### src/types/loop.ts

**Purpose:** Loop domain types — status enums, state/config interfaces, default values, and factory functions.
**LOC:** ~386

| # | Severity | Dimension | Lines | Finding |
|---|----------|-----------|-------|---------|
| 1 | Minor | Module coupling & cohesion | imports | Imports `TodoItem` from `../backends/types` — domain type file depends on backend layer. |
| 2 | Minor | Separation of concerns | scattered | `DEFAULT_LOOP_CONFIG` and `createInitialState()` are runtime values/functions in a type definition file. |
| 3 | Suggestion | Naming & readability | — | `planMode` and `reviewMode` inline object types could be extracted to named interfaces. |

---

### src/types/workspace.ts

**Purpose:** Workspace domain types.
**LOC:** ~69

No findings. Clean type definitions.

---

### src/types/settings.ts

**Purpose:** Server settings types — connection status, server mode, and default settings factory.
**LOC:** ~44

| # | Severity | Dimension | Lines | Finding |
|---|----------|-----------|-------|---------|
| 1 | Major | Naming & readability | scattered | `ConnectionStatus` name collides with the completely different `ConnectionStatus` type in `useWebSocket.ts`. |
| 2 | Minor | Code duplication | scattered | `ServerMode` manually defined but also exists as Zod schema in `schemas/workspace.ts`. |
| 3 | Minor | Consistency of patterns | scattered | Not re-exported via `src/types/index.ts`, breaking barrel pattern. |
| 4 | Suggestion | Separation of concerns | — | `getDefaultServerSettings()` is a factory function in a type file. |

---

### src/types/events.ts

**Purpose:** Event types for the loop event system — defines all event payloads, message data, and event creation helpers.
**LOC:** ~489

| # | Severity | Dimension | Lines | Finding |
|---|----------|-----------|-------|---------|
| 1 | Minor | Separation of concerns | scattered | `createTimestamp()` utility function in a type file. |
| 2 | Minor | Module coupling & cohesion | imports | `TodoItem` imported from `../backends/types` (same coupling issue as loop.ts). |
| 3 | Suggestion | Code duplication | — | `MessageData`/`ToolCallData` structurally near-identical to `PersistedMessage`/`PersistedToolCall` in loop.ts. |

---

### src/types/api.ts

**Purpose:** API request/response types — loop, workspace, model, and settings DTOs.
**LOC:** ~269

| # | Severity | Dimension | Lines | Finding |
|---|----------|-----------|-------|---------|
| 1 | Major | Dead/legacy code | 249-258 | `LogEntry` interface is never imported — dead code. A separate `LogEntry` in `LogViewer.tsx` IS used. The two types differ. |
| 2 | Suggestion | API design & consistency | — | Discriminated union response types could use a generic `ApiResponse<T>`. |

---

### src/types/schemas/workspace.ts

**Purpose:** Zod validation schemas for workspace API requests.
**LOC:** ~81

| # | Severity | Dimension | Lines | Finding |
|---|----------|-----------|-------|---------|
| 1 | Major | Dead/legacy code | scattered | 4 dead type aliases (`ServerSettingsInput`, `CreateWorkspaceRequestInput`, `UpdateWorkspaceRequestInput`, `TestConnectionRequestInput`) — never imported. |

---

### src/types/schemas/loop.ts

**Purpose:** Zod validation schemas for loop API requests.
**LOC:** ~121

| # | Severity | Dimension | Lines | Finding |
|---|----------|-----------|-------|---------|
| 1 | Major | Dead/legacy code | scattered | 7 dead `*Input` type aliases (`CreateLoopRequestInput`, `UpdateLoopRequestInput`, `AddressCommentsRequestInput`, `PlanFeedbackRequestInput`, `PendingPromptRequestInput`, `SetPendingRequestInput`, `StartDraftRequestInput`) — never imported. |

---

### src/types/schemas/model.ts

**Purpose:** Zod validation schemas for model API requests.
**LOC:** ~34

| # | Severity | Dimension | Lines | Finding |
|---|----------|-----------|-------|---------|
| 1 | Major | Dead/legacy code | scattered | `ModelConfigInput` — dead type alias, never imported. |

---

### src/types/schemas/preferences.ts

**Purpose:** Zod validation schemas for preferences API requests.
**LOC:** ~45

| # | Severity | Dimension | Lines | Finding |
|---|----------|-----------|-------|---------|
| 1 | Major | Dead/legacy code | scattered | 4 dead `*Input` type aliases — never imported. |
| 2 | Suggestion | Type safety | `SetLogLevelRequestSchema` | Uses `z.string()` but should use `z.enum()` for valid log levels to get compile-time validation. |

---

### src/types/schemas/index.ts

**Purpose:** Barrel export for Zod schemas.
**LOC:** ~60

| # | Severity | Dimension | Lines | Finding |
|---|----------|-----------|-------|---------|
| 1 | Minor | Dead/legacy code | scattered | Re-exports 16 dead `*Input` type aliases. |

---

### src/types/index.ts

**Purpose:** Barrel export for type modules.
**LOC:** ~9

| # | Severity | Dimension | Lines | Finding |
|---|----------|-----------|-------|---------|
| 1 | Minor | Consistency of patterns | scattered | Does not re-export `./settings`, breaking barrel pattern. |

---

## src/utils/

### src/utils/loop-status.ts

**Purpose:** Loop status utilities — status label formatting, running/terminal state checks, and color mapping.
**LOC:** ~106

| # | Severity | Dimension | Lines | Finding |
|---|----------|-----------|-------|---------|
| 1 | Major | Best practices | `getStatusLabel` | Missing `"draft"` case in switch — falls through to default returning raw string. |
| 2 | Major | Test coverage gaps | — | No unit tests for this file despite containing critical UI logic. |
| 3 | Major | Consistency of patterns | imports | Logger import inconsistency — imports from `../lib/logger` (frontend) while `event-stream.ts` imports from `../core/logger` (backend). |
| 4 | Minor | Dead/legacy code | `isLoopRunning` | Exported but never imported outside `src/utils/` — dead code at public API level. |
| 5 | Minor | Performance & resource management | scattered | Trace logging on every pure function call is excessive (6 log statements for trivial boolean returns). |
| 6 | Suggestion | Type safety | — | Switch statement could use `Record<LoopStatus, string>` for compile-time exhaustiveness checking. |

---

### src/utils/event-stream.ts

**Purpose:** Async iterable event stream — buffered producer/consumer pattern for streaming events.
**LOC:** ~149

| # | Severity | Dimension | Lines | Finding |
|---|----------|-----------|-------|---------|
| 1 | Major | Performance & resource management | scattered | `items` buffer can grow unboundedly with no maximum size limit. |
| 2 | Major | Test coverage gaps | — | No unit tests for this concurrency primitive. |
| 3 | Minor | Error handling | `fail()` | Should check `closed` as well as `ended`. |

---

### src/utils/name-generator.ts

**Purpose:** Generates human-readable names for loops using alliterative adjective-animal pairs.
**LOC:** ~143

| # | Severity | Dimension | Lines | Finding |
|---|----------|-----------|-------|---------|
| 1 | Critical | Performance & resource management | 112-115 | `setTimeout` in `Promise.race` is never cleared — timer leak on successful name generation. |
| 2 | Minor | Error handling | catch block | Errors silently swallowed with no logging. |
| 3 | Minor | Consistency of patterns | — | No logger imported (inconsistent with sibling files). |

---

### src/utils/index.ts

**Purpose:** Barrel export for utils, including inline `sanitizeBranchName` definition.
**LOC:** ~31

| # | Severity | Dimension | Lines | Finding |
|---|----------|-----------|-------|---------|
| 1 | Major | Consistency of patterns | scattered | `sanitizeBranchName` defined inline in barrel file — breaks organizational pattern (should be in its own module). |
| 2 | Major | Error handling | scattered | `sanitizeBranchName` can return empty string for all-special-character input — not a valid git branch name. |
| 3 | Major | Test coverage gaps | — | `sanitizeBranchName` has no unit tests. |
| 4 | Suggestion | Module coupling & cohesion | — | `event-stream` and `name-generator` not re-exported through barrel. |

---

## src/components/

### src/components/Dashboard.tsx

**Purpose:** Main application dashboard — displays loops grouped by status and workspace, handles loop creation, and manages top-level application state.
**LOC:** ~1248

| # | Severity | Dimension | Lines | Finding |
|---|----------|-----------|-------|---------|
| 1 | Critical | Simplicity | scattered | God Component — manages ~20+ state variables, contains raw `fetch()` calls for config/health/models/branches/preferences, and business logic for loop creation (IIFE at lines 890-1086). |
| 2 | Major | Code duplication | 570-842 | Massive JSX duplication between workspace-grouped and unassigned loop sections — near-identical repeated grid blocks for each status group. |
| 3 | Major | Performance & resource management | scattered | `groupLoopsByStatus` and `workspaceGroups` computed on every render without memoization. |
| 4 | Major | Code duplication | scattered | Inline icon components (GearIcon, WorkspaceGearIcon) are near-identical SVGs. |
| 5 | Major | Error handling | 60, 126, 139, 203, 225, 248, etc. | Silent error swallowing in many catch blocks — no user-facing error notifications. |
| 6 | Minor | State management | scattered | No loading/error states shown for many fetches. |
| 7 | Minor | Simplicity | scattered | Prop drilling of models, branches, workspaces through multiple layers. |

---

### src/components/LoopDetails.tsx

**Purpose:** Loop detail view with tabbed interface — shows messages, logs, tool calls, todos, config, and plan/review panels.
**LOC:** ~1220

| # | Severity | Dimension | Lines | Finding |
|---|----------|-----------|-------|---------|
| 1 | Major | Simplicity | scattered | Large component with 8 tab views. Could be split into sub-components per tab. |
| 2 | Minor | Performance & resource management | scattered | Many inline arrow functions in JSX causing new references each render. |

---

### src/components/CreateLoopForm.tsx

**Purpose:** Form component for creating new loops — model selection, prompt input, configuration options.
**LOC:** ~895

| # | Severity | Dimension | Lines | Finding |
|---|----------|-----------|-------|---------|
| 1 | Major | Code duplication | 494-521 | Model grouping/sorting logic duplicated between CreateLoopForm and LoopActionBar. `renderModelOptions()` and `isSelectedModelEnabled()` both duplicated. |
| 2 | Minor | Best practices | 280, 403, 490 | Multiple `eslint-disable-next-line react-hooks/exhaustive-deps` — suppressed dependency warnings. |

---

### src/components/LoopActionBar.tsx

**Purpose:** Action toolbar for active loops — stop, accept, rename, and model switching controls.
**LOC:** ~338

| # | Severity | Dimension | Lines | Finding |
|---|----------|-----------|-------|---------|
| 1 | Major | Code duplication | 87-119 | Model grouping/sorting logic duplicated from CreateLoopForm. |
| 2 | Minor | Performance & resource management | scattered | Inline arrow functions with `e.stopPropagation()` create new references each render. |

---

### src/components/LogViewer.tsx

**Purpose:** Displays loop log entries with filtering and auto-scroll.
**LOC:** ~310

| # | Severity | Dimension | Lines | Finding |
|---|----------|-----------|-------|---------|
| 1 | Minor | Performance & resource management | 144-168 | Entries array rebuilt and sorted on every render without memoization. |

---

### src/components/TodoViewer.tsx

**Purpose:** Displays loop todo items with completion status.
**LOC:** ~175

No findings. Generally clean, properly memoized.

---

### src/components/MarkdownRenderer.tsx

**Purpose:** Renders markdown content safely using react-markdown.
**LOC:** ~87

No findings. Clean implementation, safe against XSS.

---

### src/components/PlanReviewPanel.tsx

**Purpose:** UI panel for reviewing and providing feedback on loop plans.
**LOC:** ~255

| # | Severity | Dimension | Lines | Finding |
|---|----------|-----------|-------|---------|
| 1 | Minor | Best practices | 224-251 | Custom modal bypasses the shared Modal component, missing escape handling and focus management. |

---

### src/components/ServerSettingsForm.tsx

**Purpose:** Form for editing server connection settings.
**LOC:** ~401

No findings. Generally clean form component.

---

### src/components/AppSettingsModal.tsx

**Purpose:** Application-level settings modal.
**LOC:** ~280

No findings. Generally clean.

---

### src/components/WorkspaceSettingsModal.tsx

**Purpose:** Workspace-specific settings modal.
**LOC:** ~236

No findings. Generally clean.

---

### src/components/CreateWorkspaceModal.tsx

**Purpose:** Modal form for creating new workspaces.
**LOC:** ~198

No findings. Generally clean.

---

### src/components/WorkspaceSelector.tsx

**Purpose:** Dropdown selector for switching between workspaces.
**LOC:** ~98

No findings. Clean, simple component.

---

### src/components/AcceptLoopModal.tsx

**Purpose:** Confirmation modal for accepting a completed loop.
**LOC:** ~145

No findings. Clean.

---

### src/components/AddressCommentsModal.tsx

**Purpose:** Modal for addressing review comments on a loop.
**LOC:** ~131

| # | Severity | Dimension | Lines | Finding |
|---|----------|-----------|-------|---------|
| 1 | Minor | Consistency of patterns | scattered | Inconsistent logger usage (`createLogger("Name")` vs `import { log }`). |

---

### src/components/RenameLoopModal.tsx

**Purpose:** Modal form for renaming a loop.
**LOC:** ~153

No findings. Clean.

---

### src/components/LoopModals.tsx

**Purpose:** Aggregates all loop-related modals and manages their open/close state.
**LOC:** ~224

| # | Severity | Dimension | Lines | Finding |
|---|----------|-----------|-------|---------|
| 1 | Minor | Code duplication | scattered | Multiple modal states use repetitive `{open: boolean, loopId: string | null}` pattern — could be abstracted. |

---

### src/components/LogLevelInitializer.tsx

**Purpose:** Initializes frontend log level from persisted preferences on mount.
**LOC:** ~44

No findings. Clean.

---

### src/components/common/Modal.tsx

**Purpose:** Reusable modal dialog component with overlay, close button, and animation.
**LOC:** ~196

| # | Severity | Dimension | Lines | Finding |
|---|----------|-----------|-------|---------|
| 1 | Major | Best practices | scattered | Lacks focus trapping — keyboard users can tab outside the modal to background content (accessibility issue). |
| 2 | Minor | Best practices | scattered | No ARIA `role="dialog"` or `aria-modal` attribute. |

---

### src/components/common/Card.tsx

**Purpose:** Reusable card container component.
**LOC:** ~68

No findings. Clean.

---

### src/components/common/Icons.tsx

**Purpose:** Shared SVG icon components.
**LOC:** ~32

No findings. Clean.

---

### src/components/common/Badge.tsx

**Purpose:** Status badge component with color variants.
**LOC:** ~105

| # | Severity | Dimension | Lines | Finding |
|---|----------|-----------|-------|---------|
| 1 | Minor | Dead/legacy code | scattered | Some variants may map to the same styles (potential dead variants). |

---

### src/components/common/Button.tsx

**Purpose:** Reusable button component with variant styling.
**LOC:** ~68

No findings. Clean.

---

### src/components/common/index.ts

**Purpose:** Barrel export for common components.
**LOC:** ~10

No findings. Clean.

---

### src/components/index.ts

**Purpose:** Barrel export for main components.
**LOC:** ~15

No findings. Not all components are re-exported (only main components), which is intentional.

---

## src/hooks/

### src/hooks/useLoop.ts

**Purpose:** React hook for managing a single loop's data — fetches and synchronizes messages, tool calls, logs, todos, and state via polling and WebSocket events.
**LOC:** ~672

| # | Severity | Dimension | Lines | Finding |
|---|----------|-----------|-------|---------|
| 1 | Major | Best practices | dependency array | `refresh` has `logs.length`, `messages.length`, `toolCalls.length`, `todos.length` in dependency array — causes double-fetch on mount. |
| 2 | Major | State management | scattered | `setLoading(true)` called on every event-triggered refresh — causes UI flicker. |
| 3 | Major | Concurrency & race conditions | 607-617 vs 603-605 | Race condition between `loopId` change reset and initial fetch. |
| 4 | Major | Performance & resource management | scattered | Unbounded growth of `messages`, `toolCalls`, `logs` arrays for long-running loops. |
| 5 | Major | Module coupling & cohesion | scattered | `handleEvent` as plain function relies on `useWebSocket`'s internal ref pattern — fragile coupling. |
| 6 | Minor | Naming & readability | 133 | Variable shadowing: `log` in `setLogs` callback. |
| 7 | Minor | Code duplication | 609-617, 625-637 | Duplicate cleanup logic. |
| 8 | Minor | Logging & observability | scattered | `log.debug("useLoop initialized")` runs on every render, not just initialization. |
| 9 | Suggestion | Simplicity | — | Hook returns 20+ values — consider splitting into sub-hooks. |

---

### src/hooks/useLoops.ts

**Purpose:** React hook for managing the loops list — fetches all loops and handles real-time updates via WebSocket events.
**LOC:** ~308

| # | Severity | Dimension | Lines | Finding |
|---|----------|-----------|-------|---------|
| 1 | Major | Module coupling & cohesion | scattered | Same fragile `handleEvent` pattern as useLoop. |
| 2 | Major | State management | scattered | No error handling differentiation — single error state persists across operations. |
| 3 | Minor | Performance & resource management | `getLoop` | Wrapped in `useCallback` with `[loops]` dependency — unnecessary memoization since loops changes frequently. |
| 4 | Minor | State management | scattered | Loading flicker on event-driven refreshes. |

---

### src/hooks/useWebSocket.ts

**Purpose:** React hook managing WebSocket connection lifecycle, reconnection, and event dispatching.
**LOC:** ~231

| # | Severity | Dimension | Lines | Finding |
|---|----------|-----------|-------|---------|
| 1 | Minor | Best practices | auto-connect effect | `connect` not in dependency array of auto-connect effect (works but violates hook rules). |
| 2 | Minor | Dead/legacy code | scattered | Event accumulation may not be needed — `events` return value appears unused by consumers. |
| 3 | Minor | Code duplication | scattered | Three separate useEffect calls to sync refs — could be one. |
| 4 | Minor | Error handling | `ws.onerror` | Handler is empty (no logging or recovery). |

---

### src/hooks/useWorkspaces.ts

**Purpose:** React hook for workspace CRUD operations and state management.
**LOC:** ~178

| # | Severity | Dimension | Lines | Finding |
|---|----------|-----------|-------|---------|
| 1 | Minor | Consistency of patterns | scattered | No WebSocket integration for real-time updates (inconsistent with useLoops). |
| 2 | Minor | API design & consistency | `getWorkspaceByDirectory` | Doesn't update state — just returns from cached array. |

---

### src/hooks/useWorkspaceServerSettings.ts

**Purpose:** React hook for managing workspace-specific server settings with optimistic updates.
**LOC:** ~306

| # | Severity | Dimension | Lines | Finding |
|---|----------|-----------|-------|---------|
| 1 | Minor | Code duplication | scattered | `updateSettings`, `updateName`, `updateWorkspace` have near-identical structures — could share a helper. |
| 2 | Minor | Naming & readability | scattered | `ConnectionStatus` name collision with WebSocket type from `useWebSocket.ts`. |

---

### src/hooks/useMarkdownPreference.ts

**Purpose:** React hook for persisting markdown rendering preference.
**LOC:** ~100

No findings. Clean. `enabledRef` pattern is correct.

---

### src/hooks/useLogLevelPreference.ts

**Purpose:** React hook for persisting log level preference.
**LOC:** ~104

No findings. Clean.

---

### src/hooks/loopActions.ts

**Purpose:** Collection of standalone async functions for loop API operations (stop, accept, rename, delete, etc.).
**LOC:** ~348

| # | Severity | Dimension | Lines | Finding |
|---|----------|-----------|-------|---------|
| 1 | Minor | Code duplication | scattered | 13 functions with near-identical boilerplate — massive duplication that could be reduced to ~80 lines with a shared helper. |
| 2 | Minor | Type safety | scattered | No type safety on error response parsing (`response.json()` returns `any`). |
| 3 | Minor | Consistency of patterns | scattered | Inconsistent return types (boolean vs result objects). |

---

### src/hooks/index.ts

**Purpose:** Barrel export for hooks.
**LOC:** ~25

| # | Severity | Dimension | Lines | Finding |
|---|----------|-----------|-------|---------|
| 1 | Minor | Consistency of patterns | scattered | Incomplete re-exports from loopActions.ts. |
| 2 | Minor | Naming & readability | scattered | `ConnectionStatus` naming conflict (only WebSocket version exported). |

---

## src/lib/

### src/lib/logger.ts

**Purpose:** Frontend logging library — mirrors backend logger API with browser-appropriate output and sub-logger caching.
**LOC:** ~165

| # | Severity | Dimension | Lines | Finding |
|---|----------|-----------|-------|---------|
| 1 | Major | Code duplication | scattered | `LogLevelName`, `LOG_LEVELS`, `LOG_LEVEL_NAMES`, `DEFAULT_LOG_LEVEL` duplicated identically from `src/core/logger.ts`. |
| 2 | Major | Consistency of patterns | scattered | Sub-logger level sync inconsistency — frontend caches sub-loggers and propagates level changes, backend does NOT. Same abstraction with different behavior. |
| 3 | Minor | Separation of concerns | scattered | `LOG_LEVEL_OPTIONS` is frontend-specific UI metadata in a generic-looking module. |
| 4 | Minor | Dead/legacy code | — | `src/lib/index.ts` re-exports this module but no file imports from `../lib` — all import from `../lib/logger` directly. |

---

### src/lib/index.ts

**Purpose:** Barrel export for lib modules.
**LOC:** ~16

| # | Severity | Dimension | Lines | Finding |
|---|----------|-----------|-------|---------|
| 1 | Minor | Dead/legacy code | — | Covered above — no consumers use this barrel. |

---

## Entry Points & Configuration

### src/index.ts

**Purpose:** Application entry point — initializes database, starts HTTP/WebSocket server.
**LOC:** ~77

| # | Severity | Dimension | Lines | Finding |
|---|----------|-----------|-------|---------|
| 1 | Major | Error handling | 16, 28 | Top-level `await` without error handling — if DB init fails, process crashes with unhandled rejection. |
| 2 | Minor | Type safety | 31 | `parseInt` without NaN validation. |

---

### src/build.ts

**Purpose:** Build script — bundles frontend assets using Bun's bundler and copies to output directory.
**LOC:** ~65

| # | Severity | Dimension | Lines | Finding |
|---|----------|-----------|-------|---------|
| 1 | Minor | Best practices | scattered | Uses `fs` (Node API) instead of `Bun.file`/`Bun.$` — violates AGENTS.md conventions. |
| 2 | Minor | Logging & observability | scattered | Build output path logged incorrectly (logs temp dir path after deletion). |
| 3 | Minor | Consistency of patterns | scattered | Single quotes for imports vs project convention of double quotes. |

---

### src/frontend.tsx

**Purpose:** Frontend entry point — mounts React root component.
**LOC:** ~20

| # | Severity | Dimension | Lines | Finding |
|---|----------|-----------|-------|---------|
| 1 | Major | Error handling | scattered | No React Error Boundary at root level — unrecoverable white screen on component errors. |
| 2 | Suggestion | Best practices | — | No `StrictMode` wrapper. |

---

### src/App.tsx

**Purpose:** Root React component — hash-based routing between Dashboard and LoopDetails.
**LOC:** ~86

| # | Severity | Dimension | Lines | Finding |
|---|----------|-----------|-------|---------|
| 1 | Minor | Dead/legacy code | scattered | Dual export (named + default) — default is unused. |
| 2 | Minor | Naming & readability | `parseHash` | Magic numbers in slice offsets. |

---

### src/index.html

**Purpose:** HTML shell for the single-page application.

| # | Severity | Dimension | Lines | Finding |
|---|----------|-----------|-------|---------|
| 1 | Major | Best practices | viewport meta | `user-scalable=no` and `maximum-scale=1.0` prevent zooming — WCAG 2.1 Level AA violation. |

---

### src/index.css

**Purpose:** Global CSS with Tailwind v4 imports and custom animations.

| # | Severity | Dimension | Lines | Finding |
|---|----------|-----------|-------|---------|
| 1 | Minor | Dead/legacy code | scattered | `slide` and `spin` animations may be unused (dead CSS). |
| 2 | Suggestion | Consistency of patterns | `html` | Duplicate `height` properties (h-full overridden by svh). |

---

### tsconfig.json

**Purpose:** TypeScript compiler configuration.

| # | Severity | Dimension | Lines | Finding |
|---|----------|-----------|-------|---------|
| 1 | Minor | Dead/legacy code | paths | `@/*` path alias defined but never used in the codebase. |

---

### package.json

**Purpose:** Package manifest and scripts.

| # | Severity | Dimension | Lines | Finding |
|---|----------|-----------|-------|---------|
| 1 | Minor | Dependency management | `zod` | Uses caret range (`^`) while all other dependencies are pinned — inconsistent. |
| 2 | Minor | Build & deployment | build script | Uses `;` instead of `&&` — continues after tsc failure. |

---

### Dockerfile

**Purpose:** Container image definition for production deployment.

| # | Severity | Dimension | Lines | Finding |
|---|----------|-----------|-------|---------|
| 1 | Major | Security | scattered | Container runs as root — security best practice violation. |
| 2 | Minor | Best practices | scattered | No HEALTHCHECK instruction. |

---

### bunfig.toml

**Purpose:** Bun runtime configuration.

No findings. Clean.

---

### bun-env.d.ts

**Purpose:** Bun environment type declarations.

| # | Severity | Dimension | Lines | Finding |
|---|----------|-----------|-------|---------|
| 1 | Suggestion | Documentation & comments | — | "Generated by bun init" comment is misleading since file was customized. |

---

## Test Files

### tests/setup.ts

**Purpose:** Test infrastructure — provides `setupTestContext`/`teardownTestContext`, polling helpers, and shared test utilities.

No findings. Well-designed test infrastructure with proper polling helpers (`waitForLoopStatus`, `waitForPlanReady`, `waitForFileDeleted`, `waitForFileExists`, `waitForEvent`).

---

### tests/mocks/mock-backend.ts

**Purpose:** Mock backend implementations for testing — normal, never-completing, and plan-mode variants.

No findings. Three mock variants provide good test coverage flexibility.

---

### tests/mocks/mock-executor.ts

**Purpose:** Test command executor using real `Bun.spawn` for integration-style tests.

No findings. Clean implementation.

---

### Test Coverage Gaps

| # | Severity | Dimension | Area | Finding |
|---|----------|-----------|------|---------|
| 1 | Critical | Test coverage gaps | src/utils/ | No tests for `loop-status.ts`, `event-stream.ts`, or `sanitizeBranchName` — all contain critical logic. |
| 2 | Major | Test coverage gaps | src/hooks/ | No tests for any React hooks (`useLoop`, `useLoops`, `useWebSocket`, etc.). |
| 3 | Major | Test coverage gaps | src/api/ | No API tests for `git.ts` endpoints or `websocket.ts`. |
| 4 | Major | Test coverage gaps | src/backends/ | `opencode-backend.test.ts` mostly tests "not connected" error throwing — minimal positive-path coverage. |
| 5 | Minor | Best practices | scattered | Some tests use `await new Promise(resolve => setTimeout(resolve, 100))` — flaky test risk. |
| 6 | Minor | Consistency of patterns | review-mode.test.ts | Uses try/finally instead of beforeEach/afterEach — inconsistent with other test files. |

---

### Test Quality Notes

- Unit tests are generally thorough for covered modules (migrations, git-service, plan-mode, review-mode).
- `loop-engine.test.ts` is the largest test file (~1375 lines) with good coverage of iteration logic.
- E2E tests provide good scenario coverage: full loop lifecycle, plan mode, multi-workspace, git workflows, draft workflows.
- Test infrastructure (`setup.ts`) follows best practices with proper cleanup and deterministic polling helpers.
