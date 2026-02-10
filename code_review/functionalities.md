# Cross-Cutting Functionality Analysis — Ralpher Codebase

**Date:** 2026-02-07
**Scope:** 10 end-to-end functionalities traced through all architectural layers
**Total Codebase:** ~27,328 LOC across 90 files

---

## Executive Summary

This document analyzes the Ralpher codebase by **functionality** — tracing each feature end-to-end through Presentation, API, Core, Persistence, and External Integration layers. This perspective reveals integration issues, data flow problems, and cross-layer inconsistencies that are invisible when reviewing files or modules in isolation.

### Finding Totals

| Severity | Count |
|----------|-------|
| Critical | 2 |
| Major | 30 |
| Minor | 21 |
| Suggestion | 8 |
| **Total** | **61** |

*Note: 2 Critical and 1 Major findings reclassified to "By Design" (fire-and-forget async patterns). 1 Critical marked N/A (authentication handled by reverse proxy).*

### Key Cross-Cutting Themes

1. **Fire-and-forget async** — The most dangerous pattern appears in Loop Lifecycle (core) and Backend Abstraction (opencode), violating AGENTS.md
2. **State management without a state machine** — Loop status transitions are scattered across API, Core, and Persistence layers with no single source of truth
3. **Layer bypassing** — API handlers directly call Persistence functions, skipping Core business logic validation and event emission
4. **Systematic code duplication** — Every functionality shows duplication: preflight checks, error responses, action functions, model selectors
5. **Missing error propagation** — Errors are frequently swallowed at layer boundaries, leaving users with no feedback

---

## 1. Loop Lifecycle

### Description
The core functionality of Ralpher — creating, starting, monitoring, stopping, accepting, discarding, pushing, and deleting loops. A loop progresses through status transitions: `draft` → `idle` → `starting` → `running` → `completed`/`stopped`/`failed`/`max_iterations` → `merged`/`discarded`.

### Files Involved

| Layer | File | Role |
|-------|------|------|
| Frontend | `src/components/Dashboard.tsx` | Loop listing, creation form, status display |
| Frontend | `src/components/LoopDetails.tsx` | Single loop view with tabs |
| Frontend | `src/components/CreateLoopForm.tsx` | Loop creation form |
| Frontend | `src/components/LoopActionBar.tsx` | Action buttons (accept, push, discard) |
| Frontend | `src/hooks/useLoop.ts` | Single loop data fetching + WebSocket updates |
| Frontend | `src/hooks/useLoops.ts` | Loop list fetching + WebSocket updates |
| Frontend | `src/hooks/loopActions.ts` | 14 API action functions |
| API | `src/api/loops.ts` | Loop CRUD + lifecycle endpoints |
| Core | `src/core/loop-manager.ts` | Loop lifecycle orchestration |
| Core | `src/core/loop-engine.ts` | Iteration execution |
| Persistence | `src/persistence/loops.ts` | Loop CRUD in SQLite |

### Data Flow

```
User Action (click "Create Loop")
  → CreateLoopForm.tsx (form submission)
    → fetch POST /api/loops (loopActions.ts or inline)
      → api/loops.ts POST handler
        → preflight checks (git, active loop, model)
        → loopManager.createLoop() or loopManager.createDraftLoop()
          → generateLoopName() (utils/name-generator.ts)
          → saveLoop() (persistence/loops.ts)
          → engine.start() ← FIRE AND FORGET
            → backend.sendPrompt() (backends/opencode)
            → events emitted via loopEventEmitter
              → WebSocket broadcast
                → useLoop.ts / useLoops.ts event handlers
                  → React state updates → UI re-render
```

### Findings

| # | Severity | Dimension | Location | Finding |
|---|----------|-----------|----------|---------|
| 1.1 | ~~**Critical**~~ **By Design** | ~~Best practices~~ | `loop-manager.ts:381-383` | ~~`engine.start().catch()` is fire-and-forget. If the engine fails after the API response is sent, the loop silently enters an inconsistent state. AGENTS.md explicitly prohibits this pattern. The same pattern appears at `loop-manager.ts:800-805` for `startDraftLoop`.~~ **By Design — Intentional Architecture:** The fire-and-forget pattern is intentional for long-running processes. The loop engine runs a `while`-loop with multiple AI iterations (potentially hours). Awaiting would block the HTTP response indefinitely. The engine has comprehensive self-contained error handling (`handleError()` updates state to "failed", emits error events, `trackConsecutiveError()` for failsafe exit). Errors are reported via event emitter and persistence callbacks, not exceptions. See `AGENTS.md` § Async Patterns for the documented exception. |
| 1.2 | **Major** | State management | Multiple files | No centralized state machine. Status transitions are validated ad-hoc: `startLoop` checks for `idle`/`draft`, `stopLoop` checks for running states, `acceptLoop` checks for completed states — but there is no transition table or centralized validator. Invalid transitions are prevented only by scattered if-checks. |
| 1.3 | **Major** | Data integrity | `loop-manager.ts` scattered | Direct mutation of `loop.state` properties (e.g., `loop.state.status = "starting"`) before calling `updateLoopState()`. If persistence fails, in-memory state diverges from database. |
| 1.4 | **Major** | Separation of concerns | `api/loops.ts:695-702` | Draft-to-planning transition directly calls `updateLoopState()` from persistence layer, bypassing `LoopManager`. This skips event emission and any business rules in the manager. The API handler directly mutates `loop.state.status` and `loop.state.planMode` before persisting. |
| 1.5 | **Major** | Code duplication | `api/loops.ts:169-216` vs `631-688` | Preflight validation (uncommitted changes check + active loop check) is duplicated between the create handler and the draft/start handler. ~50 lines of identical logic. |
| 1.6 | **Major** | Code duplication | `hooks/loopActions.ts` scattered | 14 action functions with identical boilerplate (log, fetch, check ok, parse error, throw, return). A generic `apiCall<T>()` wrapper would save ~260 LOC. |
| 1.7 | **Major** | Concurrency | `api/loops.ts:198-216` | TOCTOU race condition: checking for active loops and then creating one are separate operations. Two concurrent create requests for the same directory could both pass validation. |
| 1.8 | **Major** | Error handling | `Dashboard.tsx` scattered | Multiple catch blocks in Dashboard silently swallow errors (console.error only). Users have no indication that loop creation, deletion, or other operations failed. |
| 1.9 | **Major** | Performance | `hooks/useLoop.ts` scattered | Unbounded growth of `messages`, `toolCalls`, `logs` arrays. For long-running loops, memory pressure increases continuously with no pagination or maximum size. |
| 1.10 | **Minor** | Concurrency | `hooks/useLoop.ts:607-617` | Race condition when switching loops — no AbortController cancels stale fetch requests. Loop A's response may arrive and overwrite loop B's state. |
| 1.11 | **Minor** | UX | `hooks/useLoop.ts`, `useLoops.ts` | Loading flicker on WebSocket-triggered refreshes. `setLoading(true)` is called even for event-driven updates that should be seamless. |
| 1.12 | **Minor** | Code duplication | `loop-manager.ts:350,520` | Branch name generation logic duplicated between `startLoop` and `startDraftLoop`. |

### Integration Concerns

- **API ↔ Core boundary is porous**: The API layer directly imports and calls persistence functions (`updateLoopState`, `getActiveLoopByDirectory`) instead of routing through `LoopManager`. This means state mutations can bypass business rules and event emission.
- **Core ↔ Persistence synchronization**: The API response returns before the engine has finished starting. The frontend relies on WebSocket events to discover the actual state. Note: The fire-and-forget pattern is intentional — the engine has self-contained error handling that updates state and emits error events. See `AGENTS.md` § Async Patterns.
- **Frontend ↔ API contract**: The frontend mixes two data-fetching patterns: `useLoop.ts` hook for WebSocket-based updates and inline `fetch()` calls in Dashboard.tsx. This creates inconsistent state management.

### Recommendations

1. ~~**Await `engine.start()`** or implement a proper error propagation channel~~ **By Design** — The engine is a long-running process with self-contained error handling. See `AGENTS.md` § Async Patterns.
2. **Introduce a state machine** — a `LoopStateMachine` class with a transition table that validates and applies all status changes
3. **Route all persistence mutations through LoopManager** — remove direct `updateLoopState` imports from API handlers
4. **Add AbortController** to `useLoop.ts` for handling loop switches
5. **Extract shared preflight validation** into a `preflightChecks()` helper

---

## 2. Plan Mode

### Description
Allows users to request a plan before execution. The loop enters "planning" status, the AI generates a plan (written to `.planning/plan.md`), and the user can approve, reject, or provide feedback before execution begins.

### Files Involved

| Layer | File | Role |
|-------|------|------|
| Frontend | `src/components/PlanReviewPanel.tsx` | Plan display, approval, feedback UI |
| Frontend | `src/hooks/useLoop.ts` | Plan state tracking, `isPlanReady` |
| Frontend | `src/hooks/loopActions.ts` | `sendPlanFeedbackApi`, `acceptPlanApi`, `discardPlanApi` |
| API | `src/api/loops.ts` | Plan feedback, accept, discard endpoints |
| Core | `src/core/loop-manager.ts` | `startPlanMode`, `sendPlanFeedback`, `acceptPlan`, `discardPlan` |
| Core | `src/core/loop-engine.ts` | Plan iteration execution, plan-ready detection |
| Persistence | `src/persistence/loops.ts` | Plan mode state persistence |

### Data Flow

```
User clicks "Create with Plan Mode"
  → POST /api/loops (draft=false, planMode=true)
    → loopManager.createLoop() with planMode config
    → loopManager.startPlanMode()
      → engine.start() (fire-and-forget)
        → AI generates plan → writes .planning/plan.md
        → engine detects plan ready → emits loop.plan.ready event
          → WebSocket → useLoop.ts updates isPlanReady=true
            → PlanReviewPanel.tsx shows plan content

User reviews and approves plan
  → POST /api/loops/:id/plan/accept
    → loopManager.acceptPlan()
      → engine transitions from planning → running
        → Normal iteration execution begins
```

### Findings

| # | Severity | Dimension | Location | Finding |
|---|----------|-----------|----------|---------|
| 2.1 | **Major** | Separation of concerns | `api/loops.ts:692-702` | Draft-to-plan transition directly sets `loop.state.status = "planning"` and `loop.state.planMode` object, then calls `updateLoopState()` directly. This bypasses `LoopManager.startPlanMode()` which should be the authority for plan mode transitions. |
| 2.2 | ~~**Major**~~ **By Design** | ~~Error handling~~ | `loop-manager.ts:381-383` | ~~Plan mode `engine.start()` is fire-and-forget. If plan generation fails, the loop is stuck in "planning" status with no error surfaced.~~ **By Design — Intentional Architecture:** Same as 1.1. The engine is a long-running process with comprehensive self-contained error handling. If plan generation fails, the engine's `handleError()` updates loop state to "failed" and emits error events. See `AGENTS.md` § Async Patterns. |
| 2.3 | **Major** | Complexity | `loop-manager.ts:389-440` | `sendPlanFeedback()` recreates the entire engine if it doesn't exist (server restart recovery). This ~50-line recovery block duplicates engine creation logic from `startPlanMode()`. |
| 2.4 | **Minor** | Consistency | `PlanReviewPanel.tsx:224-251` | Implements its own modal overlay instead of using the shared `Modal` component. Missing escape key handling and focus management. |
| 2.5 | **Minor** | Test coverage | — | Plan mode workflow has limited test coverage for edge cases (server restart during planning, feedback after timeout). |

### Integration Concerns

- **Engine recreation on server restart**: If the server restarts while a loop is in "planning" status, `sendPlanFeedback()` recreates the engine from scratch. This recovery path duplicates engine creation and may not properly restore all state (session ID, event subscriptions).
- **Plan file detection**: The engine polls the filesystem for `.planning/plan.md` to detect plan readiness. This is an indirect communication channel between the AI (which writes the file) and the engine (which polls for it), creating a potential race condition.

### Recommendations

1. **Route plan mode transitions through LoopManager** — the API handler should call `loopManager.startPlanMode()` instead of directly mutating state
2. **Extract engine creation into a shared factory** to avoid duplication between `startPlanMode`, `startLoop`, and `sendPlanFeedback`
3. **Use the shared Modal component** in PlanReviewPanel

---

## 3. Review Cycles

### Description
After a loop completes and is pushed, reviewers can leave comments. The user can address these comments by creating a new iteration that incorporates the feedback.

### Files Involved

| Layer | File | Role |
|-------|------|------|
| Frontend | `src/components/AddressCommentsModal.tsx` | Comment submission UI |
| Frontend | `src/components/LoopDetails.tsx` | Review history display |
| Frontend | `src/hooks/loopActions.ts` | `addressReviewCommentsApi` |
| API | `src/api/loops.ts` | Address comments endpoint, review history |
| Core | `src/core/loop-manager.ts` | `addressReviewComments()` |
| Core | `src/core/loop-engine.ts` | Review iteration with comment context |
| Persistence | `src/persistence/database.ts` | `insertReviewComment`, `getReviewComments`, `markCommentsAsAddressed` |
| Persistence | `src/persistence/loops.ts` | Loop state with review round tracking |

### Data Flow

```
User submits review comments
  → POST /api/loops/:id/review/address
    → loopManager.addressReviewComments()
      → insertReviewComment() (persistence/database.ts)
      → engine starts review iteration with comments as context
        → AI addresses comments → commits changes
          → Loop returns to completed state
```

### Findings

| # | Severity | Dimension | Location | Finding |
|---|----------|-----------|----------|---------|
| 3.1 | **Major** | Data integrity | `persistence/loops.ts:289-292` | `INSERT OR REPLACE` in `saveLoop()` triggers `ON DELETE CASCADE`, potentially destroying review comments that reference the loop ID via foreign keys. |
| 3.2 | **Major** | Separation of concerns | `persistence/database.ts:312-385` | Review comment functions (`insertReviewComment`, `getReviewComments`, `markCommentsAsAddressed`) are placed in the database infrastructure file instead of a dedicated review module. |
| 3.3 | **Major** | API design | `persistence/database.ts:getReviewComments` | Returns raw snake_case column names (e.g., `review_round`, `created_at`), leaking database schema to API consumers. Other persistence modules (loops, workspaces) convert to camelCase. |
| 3.4 | **Minor** | Code duplication | `api/loops.ts` scattered | Review endpoints follow the same boilerplate as all other endpoints — lookup loop, check status, call manager, handle error — but this pattern is never extracted. |
| 3.5 | **Minor** | Test coverage | — | Review cycle workflow has integration tests but edge cases (concurrent review submissions, server restart during review iteration) lack coverage. |

### Integration Concerns

- **Cascade delete risk**: The `INSERT OR REPLACE` semantics in `saveLoop()` can cascade-delete review comments. This means a seemingly benign loop update (saving config changes) could silently destroy all review history.
- **Review comments split across modules**: The review comment CRUD lives in `database.ts` (infrastructure), but review round tracking lives in loop state (`persistence/loops.ts`). This split makes it easy to update one without the other.

### Recommendations

1. **Replace `INSERT OR REPLACE` with `INSERT ... ON CONFLICT DO UPDATE`** (upsert) to prevent cascade deletes
2. **Move review comment functions** to a dedicated `persistence/review-comments.ts` module
3. **Convert snake_case to camelCase** in review comment query results

---

## 4. Git Operations

### Description
Git operations underpin the loop lifecycle — creating branches, committing changes, computing diffs, merging, and pushing. All git commands are executed remotely via `CommandExecutor`.

### Files Involved

| Layer | File | Role |
|-------|------|------|
| Frontend | `src/components/LoopDetails.tsx` | Diff display, branch info |
| API | `src/api/git.ts` | Branch listing, repo info endpoints |
| Core | `src/core/git-service.ts` | Git operations via CommandExecutor |
| Core | `src/core/loop-manager.ts` | `acceptLoop()` merge, `discardLoop()` cleanup |
| Core | `src/core/loop-engine.ts` | Branch creation, commits during iterations |
| Core | `src/core/command-executor.ts` | CommandExecutor interface |
| Core | `src/core/remote-command-executor.ts` | Remote command execution via PTY/WebSocket |

### Data Flow

```
Loop starts → engine creates git branch
  → git-service.createBranch() via CommandExecutor
    → remote-command-executor sends command to opencode server
      → git checkout -b ralph/loop-name

Each iteration → engine commits changes
  → git-service.commitAll() via CommandExecutor

Loop completes → user accepts
  → loopManager.acceptLoop()
    → git-service.mergeBranch() (into original branch)
    → git-service.deleteBranch() (cleanup working branch)
```

### Findings

| # | Severity | Dimension | Location | Finding |
|---|----------|-----------|----------|---------|
| 4.1 | **Major** | Complexity | `loop-manager.ts:~600-800` | `acceptLoop()` is ~200 lines handling merge preparation, merge execution, conflict detection, error recovery, branch cleanup, and state persistence — all in a single method. |
| 4.2 | **Major** | Error handling | `git-service.ts` scattered | Many methods wrap simple operations in try/catch that converts errors to generic messages, losing stack trace information. Original error context is discarded. |
| 4.3 | **Major** | Error handling | `git-service.ts:isGitRepo()` | Catches all errors and returns `false`. Disk permission errors, network issues, and filesystem corruption are all reported as "not a git repo." |
| 4.4 | **Major** | Code duplication | `api/git.ts:83-129` vs `147-192` | Two git endpoints share ~40 lines of identical boilerplate (workspace lookup, executor creation, GitService instantiation, isGitRepo check, error handling). |
| 4.5 | **Major** | Edge case | `utils/index.ts:sanitizeBranchName` | Returns empty string for all-special-character input. An empty string is an invalid git branch name and will cause `git checkout -b ""` to fail downstream. |
| 4.6 | **Minor** | Security | `remote-command-executor.ts:exec` | Builds command strings that could be vulnerable to shell injection if arguments contain special characters. Currently safe since inputs are controlled internally, but fragile. |
| 4.7 | **Minor** | Code duplication | `loop-engine.ts:43-55` vs `loop-manager.ts` | `generateBranchName()` logic exists in loop-engine.ts (function) and loop-manager.ts (inline). |
| 4.8 | **Suggestion** | Separation of concerns | `git-service.ts:pushBranch()` | `pushBranch()` (~80 lines) handles push, error detection, retry with different remote, and output parsing — multiple concerns in one method. |

### Integration Concerns

- **Remote execution latency**: All git operations go through the `CommandExecutor` → PTY/WebSocket chain. Network latency and command execution time are not bounded. The `acceptLoop()` method performs multiple sequential git operations (checkout, merge, commit, delete branch) where any failure leaves the repository in a partially-modified state.
- **Error recovery during merge**: If a merge conflict occurs during `acceptLoop()`, the current implementation reports the error but doesn't clean up the partial merge state in the remote repository.

### Recommendations

1. **Decompose `acceptLoop()`** into merge-prepare, merge-execute, and merge-finalize methods
2. **Add empty-string guard** to `sanitizeBranchName()` with a fallback like `"unnamed"`
3. **Extract git API boilerplate** into a shared middleware function
4. **Add merge conflict recovery** — clean up partial merge state on failure

---

## 5. Workspace Management

### Description
Workspaces map to directories on remote opencode servers. Each workspace has connection settings (hostname, port, password) and tracks its last-used timestamp.

### Files Involved

| Layer | File | Role |
|-------|------|------|
| Frontend | `src/components/WorkspaceSelector.tsx` | Workspace dropdown |
| Frontend | `src/components/WorkspaceSettingsModal.tsx` | Per-workspace settings |
| Frontend | `src/components/CreateWorkspaceModal.tsx` | Workspace creation form |
| Frontend | `src/components/ServerSettingsForm.tsx` | Server connection config |
| Frontend | `src/hooks/useWorkspaces.ts` | Workspace CRUD hook |
| Frontend | `src/hooks/useWorkspaceServerSettings.ts` | Server settings hook |
| API | `src/api/workspaces.ts` | Workspace CRUD endpoints |
| Core | `src/core/backend-manager.ts` | Backend connections per workspace |
| Persistence | `src/persistence/workspaces.ts` | Workspace CRUD in SQLite |

### Data Flow

```
User creates workspace
  → POST /api/workspaces
    → workspaces.ts handler
      → insertWorkspace() (persistence)
      → backendManager.initializeWorkspaceBackend()
        → Creates OpenCodeBackend connection

User tests connection
  → POST /api/workspaces/:id/test-connection
    → Creates temporary backend, connects, disconnects
```

### Findings

| # | Severity | Dimension | Location | Finding |
|---|----------|-----------|----------|---------|
| 5.1 | **Major** | Consistency | `api/workspaces.ts` scattered | Uses `if (req.method === "GET")` / `if (req.method === "POST")` branching pattern instead of Bun's named method handlers used by all other API files. |
| 5.2 | **Major** | Code duplication | `api/workspaces.ts:157-163,286-292,355-361,388-394,443-449` | Workspace lookup + 404 pattern repeated 5 times. Should be a `requireWorkspace(id)` helper. |
| 5.3 | **Major** | Consistency | `api/workspaces.ts` scattered | Error response format differs from the rest of the API. Uses `{ message, error }` vs convention `{ error, message }` via `ErrorResponse` type. |
| 5.4 | **Major** | Barrel export | `persistence/index.ts` | `workspaces.ts` is not re-exported from the persistence barrel. Consumers must import directly. |
| 5.5 | **Minor** | Consistency | `hooks/useWorkspaces.ts` scattered | No WebSocket integration for real-time updates, unlike `useLoops` which gets WebSocket-driven refreshes. Workspace changes require manual refresh. |
| 5.6 | **Minor** | Concurrency | `api/workspaces.ts:115-121` | TOCTOU race condition on duplicate workspace directory check. |
| 5.7 | **Suggestion** | Simplicity | `hooks/useWorkspaceServerSettings.ts` scattered | `updateSettings`, `updateName`, `updateWorkspace` have near-identical structures — could share a generic updater helper. |

### Integration Concerns

- **Workspace-backend lifecycle**: When a workspace is deleted, the corresponding backend connection should be cleaned up. The current flow deletes the workspace from persistence but doesn't explicitly disconnect the backend.
- **Missing real-time updates**: Unlike loops, workspace changes are not broadcast via WebSocket. If multiple browser tabs are open, workspace changes in one tab are invisible to others.

### Recommendations

1. **Migrate workspaces.ts to named method handlers** — align with other API files
2. **Extract `requireWorkspace(id)` helper** for lookup + 404
3. **Add workspace.ts to persistence barrel exports**
4. **Add WebSocket events for workspace changes** for multi-tab consistency

---

## 6. Real-Time Events

### Description
Events flow from the backend loop engine to the frontend UI via Server-Sent Events (SSE) and WebSocket connections. This enables live updates of loop status, messages, logs, and tool calls.

### Files Involved

| Layer | File | Role |
|-------|------|------|
| Frontend | `src/hooks/useWebSocket.ts` | WebSocket connection management |
| Frontend | `src/hooks/useLoop.ts` | Event-driven single loop updates |
| Frontend | `src/hooks/useLoops.ts` | Event-driven loop list updates |
| API | `src/api/websocket.ts` | WebSocket upgrade, message routing |
| Core | `src/core/event-emitter.ts` | Typed pub/sub event system |
| Core | `src/core/loop-engine.ts` | Event emission during iterations |
| Core | `src/core/loop-manager.ts` | Lifecycle event emission |
| Utils | `src/utils/event-stream.ts` | Async iterable event buffer |
| Types | `src/types/events.ts` | Event type definitions |

### Data Flow

```
Backend event emission:
  loop-engine.ts → emitter.emit(event)
    → event-emitter.ts broadcasts to all listeners
      → websocket.ts listener serializes and sends to all WebSocket clients
        → Browser WebSocket receives
          → useWebSocket.ts onMessage handler
            → useLoop.ts / useLoops.ts handleEvent
              → React state update → UI re-render
```

### Findings

| # | Severity | Dimension | Location | Finding |
|---|----------|-----------|----------|---------|
| 6.1 | **Major** | Performance | `utils/event-stream.ts` scattered | `items` buffer grows unboundedly with no maximum size limit or backpressure mechanism. A fast producer (rapid loop events) and slow consumer (network lag) could cause memory exhaustion. |
| 6.2 | **Major** | Module coupling | `hooks/useLoop.ts`, `useLoops.ts` scattered | Both hooks use a fragile ref-based pattern to register event handlers with `useWebSocket`. The handlers rely on closure variables that may be stale if the WebSocket event arrives between render cycles. |
| 6.3 | **Major** | Double fetch | `hooks/useLoop.ts` dependency array | The `refresh` callback's dependency array includes `logs.length`, `messages.length`, `toolCalls.length`, `todos.length`, causing it to re-trigger on data changes and producing a double-fetch on mount. |
| 6.4 | **Minor** | Error handling | `api/websocket.ts` scattered | Silent JSON parsing error swallowing. Malformed WebSocket messages are silently dropped. |
| 6.5 | **Minor** | Security | `api/websocket.ts` scattered | No origin validation on WebSocket upgrade requests. No connection limit. |
| 6.6 | **Minor** | Error handling | `hooks/useWebSocket.ts:ws.onerror` | WebSocket error handler is empty — no logging or recovery action. |
| 6.7 | **Minor** | Dead code | `hooks/useWebSocket.ts` scattered | `events` array accumulates all events but appears unused by any consumer. |
| 6.8 | **Suggestion** | Architecture | `event-emitter.ts` | No max listener warning like Node.js EventEmitter. Memory leak possible if listeners are registered without cleanup. |

### Integration Concerns

- **Event ordering**: The event system does not guarantee ordered delivery across WebSocket reconnections. If the WebSocket disconnects and reconnects, events emitted during the gap are lost. The frontend relies on polling (full refresh) to recover, but the refresh timing may miss rapid state transitions.
- **Event type consistency**: Events emitted by `loop-engine.ts` and `loop-manager.ts` use different event type conventions. The engine emits fine-grained events (`message.delta`, `tool.start`, `tool.complete`), while the manager emits lifecycle events (`loop.started`, `loop.completed`). The frontend must handle both streams with different logic.

### Recommendations

1. **Add buffer size limit** to `event-stream.ts` with overflow strategy (drop oldest or error)
2. **Use AbortController** for stale fetch cancellation in useLoop
3. **Fix double-fetch** by removing array lengths from the refresh dependency array
4. **Add WebSocket origin validation** and connection limits

---

## 7. Settings & Preferences

### Description
User preferences (log level, markdown rendering, last-used model) and server settings (connection mode, hostname, port) are persisted across sessions.

### Files Involved

| Layer | File | Role |
|-------|------|------|
| Frontend | `src/components/AppSettingsModal.tsx` | Application settings UI |
| Frontend | `src/hooks/useLogLevelPreference.ts` | Log level persistence |
| Frontend | `src/hooks/useMarkdownPreference.ts` | Markdown preference |
| Frontend | `src/components/LogLevelInitializer.tsx` | Log level sync on mount |
| API | `src/api/settings.ts` | Settings endpoints, server kill, DB reset |
| API | `src/api/models.ts` | Model preference, log level endpoints |
| Persistence | `src/persistence/preferences.ts` | Key-value preference storage |
| Core | `src/core/config.ts` | Application config from environment |
| Core | `src/core/logger.ts` | Backend log level control |
| Lib | `src/lib/logger.ts` | Frontend log level control |

### Data Flow

```
User changes log level in UI:
  → useLogLevelPreference hook
    → PUT /api/models/log-level
      → api/models.ts handler
        → setLogLevel() (core/logger.ts) — updates backend
        → setLogLevelPreference() (persistence/preferences.ts) — persists
    → setLogLevel() (lib/logger.ts) — updates frontend locally
```

### Findings

| # | Severity | Dimension | Location | Finding |
|---|----------|-----------|----------|---------|
| 7.1 | ~~**Critical**~~ N/A | ~~Security~~ | `api/settings.ts:115` | ~~`POST /api/server/kill` calls `process.exit(0)` with no authentication. Any client with network access can terminate the server.~~ **Not Applicable** — authentication and authorization are enforced by a reverse proxy at the infrastructure level. |
| 7.2 | ~~**Major**~~ N/A | ~~Security~~ | `api/settings.ts:79` | ~~`POST /api/settings/reset-all` is destructive (deletes entire database) with no authentication or confirmation.~~ **Not Applicable** — authentication and authorization are enforced by a reverse proxy at the infrastructure level. |
| 7.3 | **Major** | Bug | `core/logger.ts:103-108` | `setLogLevel()` only updates the parent logger. Sub-loggers created via `createLogger()` retain their original level. Runtime log level changes silently fail for all sub-loggers on the backend. The frontend `lib/logger.ts` correctly caches and updates sub-loggers. |
| 7.4 | **Major** | Code duplication | `core/logger.ts` vs `lib/logger.ts` | Logger constants (`LogLevelName`, `LOG_LEVELS`, `LOG_LEVEL_NAMES`, `DEFAULT_LOG_LEVEL`) are fully duplicated between the two files. Identical definitions maintained independently. |
| 7.5 | **Major** | Code duplication | `api/settings.ts:31-34` | `errorResponse()` helper is the 3rd copy across API files (also in loops.ts, models.ts). |
| 7.6 | **Minor** | Code duplication | `persistence/preferences.ts` scattered | `LogLevelName` type and `VALID_LOG_LEVELS` array duplicate definitions from `core/logger.ts`. |
| 7.7 | **Suggestion** | Type safety | `types/schemas/preferences.ts:SetLogLevelRequestSchema` | Uses `z.string()` but should use `z.enum()` for valid log levels to get compile-time validation. |

### Integration Concerns

- **Behavioral inconsistency between frontend and backend loggers**: The frontend logger correctly propagates level changes to sub-loggers; the backend does not. This means changing the log level via the UI works for frontend logging but silently fails for most backend modules (which use `createLogger()` to create sub-loggers).

### Recommendations

1. ~~**Add authentication** to `POST /api/server/kill` — at minimum a token-based check~~ **Not Applicable** — authentication is enforced by reverse proxy
2. **Port sub-logger caching** from `lib/logger.ts` to `core/logger.ts`
3. **Extract shared logger constants** to a shared module imported by both
4. **Extract shared `errorResponse()`** to a single location

---

## 8. Backend Abstraction

### Description
The `Backend` interface abstracts the opencode SDK, providing a pluggable adapter for AI agent communication. Currently only one implementation exists (`OpenCodeBackend`).

### Files Involved

| Layer | File | Role |
|-------|------|------|
| External | `src/backends/types.ts` | Backend interface definition |
| External | `src/backends/opencode/index.ts` | OpenCode SDK adapter |
| External | `src/backends/index.ts` | Barrel exports |
| Core | `src/core/backend-manager.ts` | Backend lifecycle management |
| Core | `src/core/loop-engine.ts` | Backend consumer (sends prompts) |

### Data Flow

```
LoopEngine needs to send prompt:
  → engine.runIteration()
    → backend.sendPromptAsync(input) (backends/opencode)
      → SDK client.chat.sendMessageStreaming()
        → SDK event stream
          → translateEvent() maps SDK events to Ralpher events
            → EventStream.push() → engine processes events
```

### Findings

| # | Severity | Dimension | Location | Finding |
|---|----------|-----------|----------|---------|
| 8.1 | ~~**Critical**~~ **By Design** | ~~Best practices~~ | `opencode/index.ts:834-851` | ~~Fire-and-forget async IIFE in `translateEvent()`. An async API call (`client.session.get()`) is executed inside an immediately-invoked async function that is never awaited. Errors are silently swallowed, and the call may execute after the enclosing function returns.~~ **By Design — Intentional Architecture:** This async IIFE is purely diagnostic logging code inside a `session.idle` handler. It fetches session details for debugging when no assistant messages were seen (an edge case). It has its own `try/catch`, its result doesn't affect the return value of `translateEvent()`, and blocking for it would delay event processing unnecessarily. See `AGENTS.md` § Async Patterns. |
| 8.2 | **Major** | Type safety | `backends/types.ts:getSdkClient()` | Returns `unknown`, forcing all consumers to use unsafe `as unknown as OpencodeClient` double casts. |
| 8.3 | **Major** | Type safety | `backends/types.ts:getModels()` | Returns `Promise<unknown[]>`, providing zero type information. Consumers must cast to `ModelInfo[]`. |
| 8.4 | **Major** | Code duplication | `opencode/index.ts:335-341` vs `375-381` | Prompt construction logic duplicated between `sendPrompt` and `sendPromptAsync`. |
| 8.5 | **Major** | Error handling | `opencode/index.ts:298-301` | `getSession()` catches all errors and returns `null`, treating server errors, network timeouts, and SDK-level session authentication failures identically to "session not found." *(Note: this refers to SDK-level session authentication between Ralpher and the opencode backend, not user-facing auth which is handled by reverse proxy.)* |
| 8.6 | **Major** | Complexity | `opencode/index.ts:translateEvent()` | Function accepts 8 parameters — a strong indicator of too many responsibilities. Should use an options object or be a class method. |
| 8.7 | **Minor** | Dead code | `opencode/index.ts:1011-1015` | `getServerUrl()` method is unused and breaks encapsulation. |
| 8.8 | **Minor** | Concurrency | `opencode/index.ts` scattered | `connected` flag may be out of sync with actual `client` state across async boundaries. |
| 8.9 | **Suggestion** | Architecture | `backends/types.ts` | With only one implementation, the abstraction overhead may be premature. However, the interface is well-designed for future extensibility. |

### Integration Concerns

- **Type safety gap at the boundary**: The `Backend` interface returns `unknown` for `getSdkClient()` and `unknown[]` for `getModels()`. This means every consumer must use unsafe casts, and there is no compile-time verification that the returned data matches the expected shape.
- **Event translation complexity**: The `translateEvent()` function maps SDK events to Ralpher events with 8 parameters and complex branching. This is the most fragile integration point — SDK changes can silently break event translation.

### Recommendations

1. ~~**Await the async IIFE** in `translateEvent()` or use proper error handling~~ **By Design** — This is diagnostic logging code with its own try/catch. See `AGENTS.md` § Async Patterns.
2. **Type `getSdkClient()` with generics** — `Backend<TClient>` or concrete SDK types
3. **Extract shared prompt builder** between `sendPrompt` and `sendPromptAsync`
4. **Bundle `translateEvent` parameters** into an options/context object

---

## 9. Remote Command Execution

### Description
All operations on workspace repositories (git, filesystem) execute on remote opencode servers, never locally. The `CommandExecutor` interface provides `exec`, `fileExists`, `directoryExists`, `readFile`, and `listDirectory` methods.

### Files Involved

| Layer | File | Role |
|-------|------|------|
| Core | `src/core/command-executor.ts` | CommandExecutor interface + local Bun impl |
| Core | `src/core/remote-command-executor.ts` | Remote execution via PTY/WebSocket |
| Core | `src/core/backend-manager.ts` | Executor factory (local vs remote) |
| Core | `src/core/git-service.ts` | Primary consumer of CommandExecutor |
| Core | `src/core/loop-manager.ts` | Uses executor for file operations |

### Data Flow

```
LoopManager needs to check file existence:
  → backendManager.getCommandExecutorAsync(workspaceId, directory)
    → BackendManager resolves workspace → gets backend
      → backend.getCommandExecutor() or RemoteCommandExecutor
        → executor.fileExists(path)
          → Remote: PTY/WebSocket command "test -f <path>"
          → Local: Bun.file(path).exists()
```

### Findings

| # | Severity | Dimension | Location | Finding |
|---|----------|-----------|----------|---------|
| 9.1 | **Major** | Code duplication | `backend-manager.ts` scattered | `getCommandExecutor` (sync) and `getCommandExecutorAsync` (async) contain nearly identical logic — one returns synchronously from cache, the other awaits connection. |
| 9.2 | **Major** | Type safety | `backend-manager.ts:getSdkClient()` | Uses double unsafe cast `as unknown as OpencodeClient` to get the SDK client for remote executor creation. |
| 9.3 | **Minor** | Security | `remote-command-executor.ts:exec` | Command arguments are concatenated into strings for remote execution. While inputs are currently controlled internally, this is a fragile pattern that could become a shell injection vector. |
| 9.4 | **Minor** | Error handling | `remote-command-executor.ts:readFile` | Falls back to empty string on error without logging. Silent failure masks issues. |
| 9.5 | **Minor** | Testability | `backend-manager.ts` module-level | Module-level singleton pattern makes it difficult to replace with test doubles. |
| 9.6 | **Suggestion** | Performance | `remote-command-executor.ts` | No timeout support for remote commands. A hung command on the remote server could block indefinitely. |

### Integration Concerns

- **Local vs remote divergence**: The `LocalCommandExecutor` uses `Bun.spawn` directly, while `RemoteCommandExecutor` uses PTY/WebSocket. Error formats and exit code handling may differ between the two, causing inconsistent behavior between spawn and connect modes.
- **No connection pooling**: Each `getCommandExecutorAsync` call may create a new executor instance. For operations that make many sequential commands (like `acceptLoop`), this could be inefficient.

### Recommendations

1. **Unify `getCommandExecutor`/`getCommandExecutorAsync`** into a single async method
2. **Add timeout support** for remote command execution
3. **Add logging** to `readFile` error path

---

## 10. Database & Migrations

### Description
SQLite database manages loop state, workspace configuration, and user preferences. A migration system evolves the schema over time.

### Files Involved

| Layer | File | Role |
|-------|------|------|
| Persistence | `src/persistence/database.ts` | DB init, schema, connection management |
| Persistence | `src/persistence/migrations/index.ts` | Migration system (13 migrations) |
| Persistence | `src/persistence/loops.ts` | Loop CRUD |
| Persistence | `src/persistence/workspaces.ts` | Workspace CRUD |
| Persistence | `src/persistence/preferences.ts` | Preference key-value storage |
| Persistence | `src/persistence/paths.ts` | Data directory helpers |

### Data Flow

```
Application starts:
  → ensureDataDirectories() (paths.ts)
    → initializeDatabase() (database.ts)
      → createTables() — base schema
      → runMigrations() — apply pending migrations
        → For each unapplied migration:
          → migration.up(db) — applies schema change
          → INSERT INTO schema_migrations — records version

Runtime operations:
  → saveLoop() / loadLoop() / updateLoopState()
    → getDatabase() — returns singleton connection
      → db.prepare(sql) → stmt.run/get/all()
```

### Findings

| # | Severity | Dimension | Location | Finding |
|---|----------|-----------|----------|---------|
| 10.1 | **Critical** | Security | `migrations/index.ts:57` | SQL injection in `getTableColumns()` — `tableName` is interpolated directly into PRAGMA query. Currently called only with hardcoded strings, but the function signature accepts any string. |
| 10.2 | **Major** | Schema management | `database.ts:createTables` vs migrations | Dual schema sources of truth. Base schema includes columns from migrations 1-8. A fresh database gets both, while an upgraded database only gets migrations. If base schema diverges from migration history, databases created at different times will have different schemas. |
| 10.3 | **Major** | Error handling | `persistence/loops.ts:196-267` | Multiple `JSON.parse()` calls in `rowToLoop()` with no error handling. A single corrupt JSON value in any row prevents listing ALL loops. |
| 10.4 | **Major** | Code duplication | `persistence/loops.ts:422-506` | `updateLoopState()` and `updateLoopConfig()` are near-identical ~40-line functions differing only in which field they serialize. **Partially Resolved:** Both now use `UPDATE` instead of `INSERT OR REPLACE`, eliminating cascade delete risk for these paths. `saveLoop()` still uses `INSERT OR REPLACE`. |
| 10.5 | **Minor** | Async overhead | `persistence/loops.ts`, `workspaces.ts`, `preferences.ts` | All persistence functions are marked `async` but contain zero `await` expressions — Bun SQLite is synchronous. Every caller pays unnecessary Promise wrapping overhead. |
| 10.6 | **Minor** | Performance | `persistence/loops.ts` scattered | No prepared statement caching. Frequently-called queries (like `loadLoop` on every polling cycle) create new statement objects each time. |
| 10.7 | **Minor** | Architecture | `persistence/paths.ts` | Vestigial module (24 LOC) that just delegates to `database.ts`. `ensureDataDirectories` calls `initializeDatabase`, `isDataDirectoryReady` calls `isDatabaseReady`. |
| 10.8 | **Suggestion** | Error handling | — | No centralized error types. `NotFoundError`, `ValidationError`, etc. would enable consistent handling across layers. |

### Integration Concerns

- **Schema drift risk**: The base schema in `database.ts` and the migration history in `migrations/index.ts` can independently evolve. If a developer adds a column to the base schema but forgets the migration (or vice versa), databases created before and after the change will have different schemas.
- **Async wrapper overhead**: The entire persistence API is async (returning Promises) despite all operations being synchronous. This propagates up through the Core and API layers, forcing unnecessary `await` at every call site.

### Recommendations

1. **Validate table names** in `getTableColumns()` against an allowlist of known tables
2. **Add try/catch to JSON.parse** calls in `rowToLoop()` with sensible defaults per field
3. **Unify `updateLoopState`/`updateLoopConfig`** into a generic `updateLoopFields()`
4. **Reconcile base schema with migration history** — either remove duplicated columns from base schema or document the intentional overlap

---

## Cross-Functionality Concerns

These issues span multiple functionalities and represent systemic patterns in the codebase.

### ~~CF-1: Fire-and-Forget Async (Critical)~~ CF-1: Fire-and-Forget Async — By Design

**Affects:** Loop Lifecycle (1.1), Plan Mode (2.2), Backend Abstraction (8.1)

~~The fire-and-forget pattern appears in three critical locations:~~
~~- `loop-manager.ts:381-383` — `engine.start().catch()`~~
~~- `loop-manager.ts:800-805` — draft loop start~~
~~- `opencode/index.ts:834-851` — async IIFE in `translateEvent()`~~

~~This violates AGENTS.md which explicitly states: "CRITICAL: Always await async operations in API handlers." The pattern means errors are silently lost and the API returns success before the operation completes.~~

**By Design — Intentional Architecture:** All three fire-and-forget patterns are intentional and documented:

1. **`loop-manager.ts:381-383` and `800-805`** — The loop engine runs a `while`-loop with multiple AI iterations that may take hours. Awaiting would block the HTTP response indefinitely. The engine has comprehensive self-contained error handling: `handleError()` updates loop state to "failed", emits error events, and `trackConsecutiveError()` provides a failsafe exit. Errors are reported via the event emitter and persistence callbacks rather than thrown exceptions.

2. **`opencode/index.ts:834-851`** — This async IIFE is purely diagnostic logging code inside a `session.idle` handler. It fetches session details for debugging when no assistant messages were seen (an edge case). It has its own `try/catch`, its result doesn't affect the return value, and blocking for it would delay event processing unnecessarily.

See `AGENTS.md` § Async Patterns for the documented exception policy for long-running processes.

### CF-2: Layer Bypassing (Major)

**Affects:** Loop Lifecycle (1.4), Review Cycles (3.2), Settings (7.5)

The API layer directly calls persistence functions in multiple places:
- `api/loops.ts:22-23` imports `updateLoopState`, `getActiveLoopByDirectory` from persistence
- `api/loops.ts:695-702` directly mutates loop state and persists it
- `api/loops.ts:23` imports `getReviewComments` from `database.ts`

This bypasses the Core layer's business rules, event emission, and state validation. The architectural intent is API → Core → Persistence, but the actual pattern is API → {Core, Persistence}.

### CF-3: Systematic Code Duplication (Major)

**Affects:** All functionalities

| Duplication | LOC Savings | Locations |
|-------------|-------------|-----------|
| `errorResponse()` helper | ~30 | 3 API files |
| Loop action functions | ~260 | `hooks/loopActions.ts` |
| Preflight validation | ~50 | `api/loops.ts` (create + draft/start) |
| Model selector UI | ~100 | CreateLoopForm + LoopActionBar |
| Branch name generation | ~20 | loop-manager + loop-engine |
| Workspace lookup + 404 | ~40 | 5 places in `api/workspaces.ts` |
| Logger constants | ~40 | core/logger + lib/logger |
| **Total estimated** | **~540** | — |

### CF-4: Missing User-Facing Error Feedback (Major)

**Affects:** Loop Lifecycle (1.8), Review Cycles, Settings

Errors are consistently swallowed at the frontend boundary:
- **Frontend catch blocks** — `Dashboard.tsx` and other components catch errors and only `console.error()` them. No toast, no error state, no visual feedback.

*(Note: Backend fire-and-forget async patterns are intentional — see CF-1. The engine has self-contained error handling that updates state and emits error events.)*

Users have no way to know that an operation failed unless they notice the loop is stuck.

### CF-5: No Centralized State Machine (Major)

**Affects:** Loop Lifecycle (1.2), Plan Mode (2.1), Review Cycles

Loop status transitions are scattered across:
- `loop-manager.ts` — lifecycle transitions (starting, running, completed, etc.)
- `loop-engine.ts` — iteration-level transitions
- `api/loops.ts` — draft transitions (directly setting status)
- `persistence/loops.ts` — state persistence (no validation)

No single module owns the transition rules. Invalid transitions are prevented only by scattered if-checks that are easy to miss.

### CF-6: Test Coverage Gaps (~~Major~~ **Largely Resolved**)

**Affects:** All functionalities

| Area | LOC | Tests |
|------|-----|-------|
| React hooks | 2,477 | **145 tests** (useLoop: 37, useLoops: 24, useWorkspaces: 15, loopActions: 45, + others) |
| React components | 7,527 | **334 tests** (18 files) |
| Utility functions | 457 | Partial (name-generator only) |
| API endpoints | 3,397 | Some integration tests |
| Core business logic | 7,794 | Good unit + scenario coverage |
| Persistence | 2,061 | Good migration tests |
| E2E scenarios (frontend) | — | **50 tests** (8 scenario files) |
| Infrastructure tests | — | **19 tests** (1 file) |

~~The frontend (9,426 LOC combined) has zero automated tests.~~ **Updated:** 548 frontend tests now cover hooks, components, and E2E user workflows. The highest-risk code (hooks with complex async state management, WebSocket integration, race conditions) is now tested.

**Remaining gaps:** `useWebSocket` (no direct tests), `useAgentsMdOptimizer` (no tests), utility functions (`loop-status.ts`, `event-stream.ts`, `sanitizeBranchName`), `git.ts` API endpoints, `websocket.ts` API handler, `CollapsibleSection.tsx`. Utility functions and `useWebSocket` remain the primary untested areas.

### CF-7: Dual Logger Systems (Minor)

**Affects:** Settings (7.3, 7.4), all functionalities with logging

Two independent logger implementations exist:
- `core/logger.ts` — backend, broken sub-logger sync
- `lib/logger.ts` — frontend, correct sub-logger sync

They share identical constant definitions but diverge in behavior. Some modules import from the wrong logger (`utils/loop-status.ts` imports from `lib/logger` but may run on backend).

---

## Overall Recommendations (Prioritized)

| Priority | Recommendation | Impact | Complexity |
|----------|---------------|--------|------------|
| 1 | ~~Fix fire-and-forget async patterns~~ **By Design** — Intentional for long-running processes | ~~Critical — prevents silent failures~~ N/A — engine has self-contained error handling | ~~Low~~ N/A |
| 2 | Introduce loop state machine | Major — centralizes transition logic | Medium |
| 3 | Route all state mutations through LoopManager | Major — enforces architectural layers | Medium |
| 4 | Extract shared helpers (errorResponse, apiCall, preflight) | Major — eliminates ~540 LOC duplication | Low |
| 5 | Add React Error Boundary + toast notifications | Major — gives users error visibility | Low |
| 6 | Fix backend logger sub-logger sync | Major — runtime log level changes work | Low |
| 7 | Add AbortController to hooks | Major — prevents race conditions | Low |
| 8 | ~~Add authentication to destructive endpoints~~ **Not Applicable** — authentication and authorization are enforced by a reverse proxy at the infrastructure level | ~~Critical~~ N/A — ~~security~~ | ~~Low~~ N/A |
| 9 | Replace INSERT OR REPLACE with upsert | Major — prevents cascade deletes | Low |
| 10 | ~~Add hook tests with renderHook~~ **Resolved** | ~~Major~~ — ~~covers highest-risk untested code~~ **Done:** 145 hook tests added | ~~Medium~~ N/A |
