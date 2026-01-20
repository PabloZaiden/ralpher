# Ralph Loops Management System - Implementation Status

**Last Updated:** 2026-01-20  
**Current Phase:** Phase 6 - Testing & Polish (IN PROGRESS)  
**Overall Progress:** Phase 6 Near Complete (6/6 tasks, pending documentation)

---

## Phase Summary

| Phase | Name | Status | Progress |
|-------|------|--------|----------|
| 1 | Foundation | **Complete** | 5/5 |
| 2 | OpenCode Backend | **Complete** | 5/5 |
| 3 | Loop Engine + Git | **Complete** | 8/8 |
| 4 | API Layer | **Complete** | 5/5 |
| 5 | Frontend | **Complete** | 9/9 |
| 6 | Testing & Polish | **In Progress** | 5/6 |

---

## Phase 1: Foundation

| Task | Description | Status |
|------|-------------|--------|
| 1.1 | Create data directory structure | **Complete** |
| 1.2 | Create type definitions (`src/types/*.ts`) | **Complete** |
| 1.3 | Implement persistence paths config | **Complete** |
| 1.4 | Implement SimpleEventEmitter | **Complete** |
| 1.5 | Create AgentBackend interface and registry | **Complete** |

### Files Created in Phase 1

```
src/types/
├── index.ts          # Central export
├── loop.ts           # LoopConfig, LoopState, Loop types
├── events.ts         # LoopEvent types (16 event types)
└── api.ts            # API request/response types

src/persistence/
├── index.ts          # Central export
├── paths.ts          # Path config with env var support
├── loops.ts          # Loop CRUD operations (Bun.file API)
└── sessions.ts       # Session mapping storage

src/core/
├── index.ts          # Central export
└── event-emitter.ts  # SimpleEventEmitter + SSE stream

src/backends/
├── index.ts          # Central export
├── types.ts          # AgentBackend interface
└── registry.ts       # Backend registry

tests/unit/
├── event-emitter.test.ts  # 7 tests
├── persistence.test.ts    # 8 tests
└── registry.test.ts       # 6 tests
```

---

## Phase 2: OpenCode Backend

| Task | Description | Status |
|------|-------------|--------|
| 2.1 | Install `@opencode-ai/sdk` | **Complete** |
| 2.2 | Implement OpenCodeBackend class | **Complete** |
| 2.3 | Implement spawn mode | **Complete** |
| 2.4 | Implement connect mode | **Complete** |
| 2.5 | Implement event subscription adapter | **Complete** |

### Files Created in Phase 2

```
src/backends/opencode/
└── index.ts          # OpenCodeBackend class implementing AgentBackend

src/backends/
└── register.ts       # Auto-registers opencode backend

tests/unit/
└── opencode-backend.test.ts  # 13 tests
```

### Implementation Details

**OpenCodeBackend Features:**
- Implements full `AgentBackend` interface
- **Spawn mode**: Uses `createOpencode()` to start a new opencode server
- **Connect mode**: Uses `createOpencodeClient()` to connect to existing server
- **Session management**: Create, get, delete sessions via SDK
- **Prompt handling**: Both sync (`sendPrompt`) and async (`sendPromptAsync`)
- **Event subscription**: Translates SDK events to AgentEvent types
- **Abort support**: Can abort running sessions

**Event Translation:**
- `message.updated` → `message.start`
- `message.part.updated` (text delta) → `message.delta`
- `message.part.updated` (tool) → `tool.start` / `tool.complete`
- `session.idle` → `message.complete`
- `session.error` → `error`

---

## Phase 3: Loop Engine + Git

| Task | Description | Status |
|------|-------------|--------|
| 3.1 | Implement GitService | **Complete** |
| 3.2 | Implement loop engine core | **Complete** |
| 3.3 | Implement iteration execution | **Complete** |
| 3.4 | Implement stop pattern detection | **Complete** |
| 3.5 | Implement loop manager | **Complete** |
| 3.6 | Integrate git branch on start | **Complete** |
| 3.7 | Integrate git commit on iteration end | **Complete** |
| 3.8 | Write tests | **Complete** |

### Files Created in Phase 3

```
src/core/
├── git-service.ts    # Git operations using Bun.$
├── loop-engine.ts    # Core loop execution logic
└── loop-manager.ts   # Loop lifecycle management

tests/unit/
├── git-service.test.ts    # 13 tests
├── loop-engine.test.ts    # 8 tests
└── loop-manager.test.ts   # 15 tests
```

### Implementation Details

**GitService Features:**
- `isGitRepo()` - Check if directory is a git repo
- `getCurrentBranch()` - Get current branch name
- `hasUncommittedChanges()` - Check for uncommitted changes
- `getChangedFiles()` - List changed files
- `createBranch()` / `checkoutBranch()` / `deleteBranch()` - Branch operations
- `branchExists()` - Check if branch exists
- `stageAll()` / `commit()` - Commit operations with SHA return
- `stash()` / `stashPop()` - Stash operations
- `mergeBranch()` - Merge source into target branch
- `getDiff()` / `getDiffSummary()` - Diff information
- All operations use `Bun.$` for shell commands

**LoopEngine Features:**
- `start()` - Initialize and run the loop
- `stop()` - Stop execution manually
- `pause()` / `resume()` - Pause/resume loop
- `StopPatternDetector` class for regex-based completion detection
- Default pattern: `<promise>COMPLETE</promise>$`
- Automatic git branch creation on start (if git.enabled)
- Automatic git commit after each iteration (if git.enabled)
- Records iteration summaries (messageCount, toolCallCount, outcome)
- Emits events for all state changes

**LoopManager Features:**
- `createLoop()` - Create new loop with config
- `getLoop()` / `getAllLoops()` - Retrieve loops
- `updateLoop()` / `deleteLoop()` - Modify/delete loops
- `startLoop()` - Start loop execution
- `stopLoop()` / `pauseLoop()` / `resumeLoop()` - Control loops
- `acceptLoop()` - Merge git branch on completion
- `discardLoop()` - Delete git branch without merging
- `isRunning()` / `getRunningLoopState()` - Query running state
- `shutdown()` - Stop all running loops
- Handles uncommitted changes with `handleUncommitted` option
- Periodic state persistence to disk (every 5 seconds)

---

## Phase 4: API Layer

| Task | Description | Status |
|------|-------------|--------|
| 4.1 | Refactor `src/index.ts` for modular routes | **Complete** |
| 4.2 | Implement loops CRUD endpoints | **Complete** |
| 4.3 | Implement loop control endpoints | **Complete** |
| 4.4 | Implement SSE endpoint | **Complete** |
| 4.5 | Add health check endpoint | **Complete** |

### Files Created in Phase 4

```
src/api/
├── index.ts          # Central export combining all routes
├── health.ts         # Health check endpoint (/api/health)
├── loops.ts          # CRUD + control + data endpoints
└── events.ts         # SSE streaming endpoints

tests/api/
├── health.test.ts        # 2 tests
├── loops-crud.test.ts    # 16 tests
├── loops-control.test.ts # 18 tests
└── events-sse.test.ts    # 4 tests
```

### API Endpoints Implemented

**CRUD:**
- `GET /api/loops` - List all loops
- `POST /api/loops` - Create new loop
- `GET /api/loops/:id` - Get loop details
- `PATCH /api/loops/:id` - Update loop
- `DELETE /api/loops/:id` - Delete loop

**Control:**
- `POST /api/loops/:id/start` - Start loop (handles 409 for uncommitted changes)
- `POST /api/loops/:id/stop` - Stop loop
- `POST /api/loops/:id/pause` - Pause loop
- `POST /api/loops/:id/resume` - Resume loop
- `POST /api/loops/:id/accept` - Merge git branch
- `POST /api/loops/:id/discard` - Delete git branch

**Data:**
- `GET /api/loops/:id/diff` - Get git diff
- `GET /api/loops/:id/plan` - Get plan.md content
- `GET /api/loops/:id/status-file` - Get status.md content

**SSE:**
- `GET /api/events` - Global event stream
- `GET /api/loops/:id/events` - Loop-specific event stream

**System:**
- `GET /api/health` - Health check

---

## Phase 5: Frontend

| Task | Description | Status |
|------|-------------|--------|
| 5.1 | Implement useSSE hook | **Complete** |
| 5.2 | Implement useLoops hook | **Complete** |
| 5.3 | Create common UI components | **Complete** |
| 5.4 | Create Dashboard and LoopCard | **Complete** |
| 5.5 | Create LoopDetails with tabs | **Complete** |
| 5.6 | Create LogViewer | **Complete** |
| 5.7 | Create CreateLoopForm | **Complete** |
| 5.8 | Implement client-side routing | **Complete** |
| 5.9 | Add git info to UI | **Complete** |

### Files Created in Phase 5

```
src/hooks/
├── index.ts          # Central export
├── useSSE.ts         # SSE connection hook (native EventSource)
├── useLoops.ts       # Loops state management hook
└── useLoop.ts        # Single loop hook with real-time updates

src/components/
├── index.ts          # Central export
├── common/
│   ├── index.ts      # Central export
│   ├── Button.tsx    # Button with variants/sizes/loading
│   ├── Card.tsx      # Card container component
│   ├── Badge.tsx     # Status badge with loop status variants
│   └── Modal.tsx     # Modal and ConfirmModal components
├── Dashboard.tsx     # Loop grid view with sections
├── LoopCard.tsx      # Loop summary card with actions
├── LoopDetails.tsx   # Full loop view with tabs
├── LogViewer.tsx     # Real-time log/message display
└── CreateLoopForm.tsx # Loop creation form

src/App.tsx           # Updated with hash-based routing
```

### Implementation Details

**Hooks:**
- `useSSE<T>` - Generic SSE hook with native EventSource
  - Auto-connect on mount
  - Reconnection handling
  - Event buffering with max limit
  - Status tracking (connecting/open/closed/error)
- `useGlobalSSE` - Convenience hook for `/api/events`
- `useLoopSSE` - Convenience hook for `/api/loops/:id/events`
- `useLoops` - Full loops state management
  - CRUD operations
  - Control operations (start/stop/pause/resume/accept/discard)
  - SSE integration for real-time updates
- `useLoop` - Single loop management
  - Real-time message/tool call tracking
  - File content fetching (plan/status/diff)

**Components:**
- **Button** - Primary/secondary/danger/ghost variants, sm/md/lg sizes, loading state
- **Card** - Container with optional title/description/actions
- **Badge** - Status indicators with loop-specific variants
- **Modal** - Dialog overlay with ConfirmModal convenience wrapper
- **Dashboard** - Loop grid grouped by status (Active/Completed/Other)
- **LoopCard** - Summary card with quick actions and live indicator
- **LoopDetails** - Tabbed view (Log/Plan/Status/Diff) with full controls
- **LogViewer** - Real-time message and tool call display
- **CreateLoopForm** - Form with basic and advanced options

**Routing:**
- Hash-based routing (`#/` and `#/loop/:id`)
- No external router dependency
- Clean navigation between Dashboard and LoopDetails

### Verification Results

- `bun run build` - **PASS**
- `bun test` - **PASS** (108 tests total)

---

## Phase 6: Testing & Polish

| Task | Description | Status |
|------|-------------|--------|
| 6.1 | Create test setup and mock backend | **Complete** |
| 6.2 | Write unit tests for core modules | **Complete** |
| 6.3 | Write API integration tests | **Complete** |
| 6.4 | Write E2E tests | **Complete** |
| 6.5 | Error handling and loading states | **Complete** |
| 6.6 | Documentation updates | Not Started |

### Files Created in Phase 6

```
tests/mocks/
└── mock-backend.ts       # Reusable MockBackend class for testing

tests/
└── setup.ts              # Test utilities (setupTestContext, waitForEvent, etc.)

tests/e2e/
├── full-loop.test.ts     # E2E tests for full loop workflow (13 tests)
└── git-workflow.test.ts  # E2E tests for git integration (14 tests)

src/components/common/
├── ErrorBoundary.tsx     # Error boundary for catching React errors
├── Toast.tsx             # Toast notification system with context
└── Skeleton.tsx          # Loading skeleton components
```

### E2E Tests Implemented

**Full Loop Workflow (13 tests):**
- Loop creation with defaults and custom options
- Loop persistence to disk
- Loop execution until completion
- Max iterations limit
- Manual stop during execution
- Error handling for backend failures
- CRUD operations (list, update, delete)
- State tracking and iteration summaries

**Git Workflow (14 tests):**
- Branch creation on loop start
- Custom branch prefix
- Branch name includes loop ID
- Commits per iteration
- Uncommitted changes detection and handling (commit/stash)
- Accept loop (merge branch)
- Discard loop (delete branch)
- Error handling for non-git loops

### UI Polish Components

**ErrorBoundary:**
- React error boundary using class component (required for error boundaries)
- Custom fallback UI with error message display
- Retry button to reset error state
- onError callback for logging

**Toast Notifications:**
- ToastProvider context for global access
- useToast hook for easy access
- Variants: success, error, warning, info
- Auto-dismiss with configurable duration
- Manual dismiss button
- Slide-in animation

**Skeleton Components:**
- Base Skeleton component with width/height/rounded options
- SkeletonText for multiple text lines
- SkeletonCard for card placeholders
- SkeletonLoopCard matching LoopCard structure
- SkeletonLoopDetails matching LoopDetails structure

### Bug Fix

- Fixed `acceptLoop` and `discardLoop` methods in LoopManager to use `getLoop` instead of `loadLoop` to correctly get in-memory state for running/recently completed loops

### Verification Results

- `bun run build` - **PASS**
- `bun test` - **PASS** (135 tests total - 27 new tests)

---

## Verification Checklist

### Build & Type Check
- [x] `bun run build` succeeds
- [x] `bun test` passes (135 tests)
- [x] `bun x tsc --noEmit` passes

### Functional Requirements
- [x] F1: Create loop via API
- [x] F2: Start/stop loops
- [x] F3: Loop iterates until complete (LoopEngine)
- [x] F4: Respects maxIterations (LoopEngine)
- [x] F5: Connect to existing opencode (OpenCodeBackend.connect with mode="connect")
- [x] F6: Spawn new opencode (OpenCodeBackend.connect with mode="spawn")
- [x] F7: Git branch per loop (LoopEngine.setupGitBranch)
- [x] F8: Git commit per iteration (LoopEngine.commitIteration)
- [x] F9: Git merge on accept (LoopManager.acceptLoop)
- [x] F10: Events stream via SSE
- [x] F11: Persists across restarts (LoopManager state persistence)
- [x] F12: Web UI shows loops
- [x] F13: Web UI real-time log

---

## Notes

### 2026-01-20 - SSE Connection Flickering Fix

- Fixed the "Connecting..." status flickering issue in `src/hooks/useSSE.ts`
- **Root cause:** The `connect` callback was being recreated on every render because it depended on `onEvent` which was a new function reference each time. The `useEffect` depended on `connect`, causing reconnection on every render.
- **Fix:** 
  - Store callbacks (`onEvent`, `onStatusChange`, `maxEvents`) in refs to avoid triggering effect re-runs
  - Remove `connect` and `disconnect` from the `useEffect` dependency array
  - Only reconnect when `url` or `autoConnect` actually changes
- Tests: 135 pass
- Build: Succeeds

### 2026-01-20 - Test Fixes for Async Streaming

- Fixed failing unit tests in `tests/unit/loop-engine.test.ts`
  - The `LoopEngine.runIteration()` was changed to use async streaming (`sendPromptAsync` + `subscribeToEvents`) instead of sync `sendPrompt`
  - Updated the inline `createMockBackend` function to properly implement async streaming:
    - `sendPromptAsync()` now stores response for `subscribeToEvents` to yield
    - `subscribeToEvents()` now yields proper events: `message.start`, `message.delta`, `message.complete`
  - Updated 3 test cases that override the mock backend:
    - "can be stopped manually" - uses async events with resolver
    - "pause and resume works" - uses async streaming
    - "handles errors gracefully" - throws from `sendPromptAsync`
- All 135 tests now pass (previously 20 were failing with timeouts)
- Build succeeds

### 2026-01-20 - UI and Logging Improvements (Previous Session)

- **SSE "Connecting..." status fix:**
  - Added heartbeat/keepalive to `src/core/event-emitter.ts` (every 15 seconds)
  - Fixed `src/hooks/useSSE.ts` error handling for reconnection state

- **Real-time logging improvements:**
  - Changed `LoopEngine.runIteration()` to use async streaming for real-time events
  - Now emits `loop.progress` events for streaming text deltas
  - Now emits `loop.tool_call` events as tools are invoked
  - Emits `loop.message` with full content when complete

- **AI-generated commit messages:**
  - `LoopEngine.commitIteration()` now accepts `responseContent` parameter
  - Added `generateCommitMessage()` method that:
    1. Gets list of changed files
    2. Asks opencode to generate a meaningful commit message
    3. Falls back to file list if AI generation fails

### 2026-01-20 - TypeScript Errors Fixed

- Fixed all TypeScript errors to make `bun x tsc --noEmit` pass:
  - `build.ts`: Fixed `toCamelCase` regex callback, `parseArgs` return type, nested property access
  - `src/components/common/ErrorBoundary.tsx`: Added `override` modifiers to class methods
  - `src/api/loops.ts`: Fixed `UpdateLoopRequest` git config merging
  - `src/backends/opencode/index.ts`: Fixed error message extraction type check
  - `src/components/LogViewer.tsx`: Fixed unknown type in JSX conditionals
  - `src/core/git-service.ts`: Added fallbacks for undefined match groups in parseInt
  - `tests/api/*.test.ts`: Added generic type parameter to `Server<unknown>`
  - `tests/unit/loop-engine.test.ts`: Fixed type narrowing issue with closure callback

### 2026-01-20 - Phase 6 Progress

- Created reusable MockBackend class for testing
  - Configurable responses, delays, and error throwing
  - Tracks all calls for assertions
- Created test setup utilities (setupTestContext, teardownTestContext)
  - Handles temp directories, git init, mock backend registration
  - Provides event helpers (waitForEvent, countEvents, getEvents)
- Wrote 13 E2E tests for full loop workflow
  - Loop creation, execution, stopping, error handling
  - CRUD operations and state tracking
- Wrote 14 E2E tests for git integration
  - Branch creation, commits, uncommitted changes handling
  - Accept (merge) and discard (delete) workflows
- Created ErrorBoundary component for catching React errors
- Created Toast notification system with context provider
- Created Skeleton loading components matching app structure
- Fixed bug in LoopManager: accept/discard now use getLoop for in-memory state
- Total tests: 135 (up from 108)
- Build succeeds

### 2026-01-20 - Phase 5 Complete

- Created React hooks for SSE and loops management
  - `useSSE` - Native EventSource with auto-reconnect
  - `useLoops` - Full CRUD + control with SSE integration
  - `useLoop` - Single loop with real-time message tracking
- Created common UI components from scratch (no external libraries)
  - Button, Card, Badge, Modal with Tailwind CSS v4
  - Loop-specific status variants for Badge
- Created Dashboard with loop grid grouped by status
  - Active, Completed, and Other sections
  - Create loop modal
  - Uncommitted changes handling modal
- Created LoopDetails with tabbed interface
  - Log, Plan, Status, Diff tabs
  - Full control actions (start/stop/pause/resume/accept/discard)
  - Git info display (branch, commits)
- Created LogViewer for real-time message/tool display
  - Auto-scroll to bottom
  - Collapsible tool input/output
  - Streaming progress indicator
- Created CreateLoopForm with advanced options
  - Basic fields: name, directory, prompt
  - Advanced: max iterations, backend mode, git toggle
- Updated App.tsx with hash-based client-side routing
  - Dashboard view at `#/`
  - LoopDetails view at `#/loop/:id`
- All 108 tests still pass
- Build succeeds

### 2026-01-20 - Phase 4 Complete

- Created modular API structure in `src/api/`
- Implemented all REST endpoints for loops CRUD, control, and data
- Implemented SSE streaming endpoints for real-time events
- Fixed SSE stream cancel handling for proper cleanup
- Added 38 new API integration tests (108 total tests now passing)
- API endpoints fully tested with actual HTTP requests
- All functional requirements F1, F2, F10 now complete

### 2026-01-20 - Phase 3 Complete

- Implemented `GitService` with all git operations using `Bun.$`
- Implemented `LoopEngine` with iteration execution and stop pattern detection
- Implemented `LoopManager` for full loop lifecycle management
- Added 36 new tests (70 total tests now passing)
- Git integration fully working:
  - Branch created on loop start (if git.enabled)
  - Commit after each iteration
  - Merge on accept, delete branch on discard
- Build and all tests pass

### 2026-01-20 - Phase 2 Complete

- Installed `@opencode-ai/sdk@1.1.27`
- Created `OpenCodeBackend` class implementing full `AgentBackend` interface
- Spawn mode uses `createOpencode()` to start a new server
- Connect mode uses `createOpencodeClient()` with baseUrl
- Event adapter translates SDK events to our `AgentEvent` types
- Added 13 new tests for OpenCodeBackend (34 total)
- Build and all tests pass

### 2026-01-20 - Phase 1 Complete

- Created comprehensive type system with full TypeScript definitions
- Persistence layer uses Bun.file API as per AGENTS.md guidelines
- SimpleEventEmitter is ~50 lines, includes SSE stream helper
- AgentBackend interface is fully abstracted for future backends
- All 21 unit tests pass
- Build succeeds

### Pre-existing Issue (RESOLVED)

- All TypeScript errors in `build.ts` and other files have been fixed
- `bun x tsc --noEmit` now passes with no errors

---

## Next Steps

1. **Complete Phase 6:**
   - Update documentation (README with usage examples)
   - Consider adding more comprehensive error messages

2. **Future enhancements to consider:**
   - Integrate Toast notifications into existing components
   - Add loading skeletons to Dashboard and LoopDetails
   - Wrap App with ErrorBoundary and ToastProvider
   - Dark mode toggle in UI
   - Keyboard shortcuts
   - Markdown rendering for plan.md and status.md
   - Loop templates/presets

3. **Testing with real environment:**
   - Test with actual opencode server
   - Verify SSE reconnection behavior
   - Test git operations in real project

---

### 2026-01-20 - UI Fixes and Enhancements (Current Session)

**Goals Completed:**

1. **Fixed real-time logs not showing during loop execution**
   - **Issue:** The `useLoop` hook tracked `loop.message` and `loop.tool_call` events but wasn't accumulating `loop.progress` streaming text deltas
   - **Fix in `src/hooks/useLoop.ts`:**
     - Added `progressContent` state to accumulate streaming text
     - Handle `loop.progress` events to append to progress content
     - Clear progress content when `loop.message` (complete message) arrives
     - Clear progress content on `loop.iteration.start`
     - Added `progressContent` to the return object
   - **Fix in `src/components/LoopDetails.tsx`:**
     - Pass `progressContent` to `LogViewer` component
   - Now users can see AI output streaming in real-time during loop execution

2. **Fixed placeholder text styling**
   - **Issue:** Placeholder text in form inputs was indistinguishable from regular text
   - **Fix in `src/components/CreateLoopForm.tsx`:**
     - Added `placeholder:text-gray-400 dark:placeholder:text-gray-500` to all input fields
     - Applied to: name input, directory input, prompt textarea, max iterations input
   - Placeholders now appear grayed out and clearly distinguished from user input

3. **Made diff panel files expandable/collapsible with actual diff content**
   - **Enhancement in `src/core/git-service.ts`:**
     - Added `FileDiffWithContent` interface extending `FileDiff` with optional `patch` field
     - Added `getFileDiffContent()` method to get diff content for a specific file
     - Added `getDiffWithContent()` method that returns all diffs with their patch content
   - **Enhancement in `src/types/api.ts`:**
     - Added `patch?: string` field to `FileDiff` interface
   - **Enhancement in `src/api/loops.ts`:**
     - Updated diff endpoint to use `getDiffWithContent()` instead of `getDiff()`
   - **Enhancement in `src/components/LoopDetails.tsx`:**
     - Added `DiffPatchViewer` component with syntax highlighting for diff lines
     - Added `expandedFiles` state to track which files are expanded
     - Made file rows clickable with expand/collapse indicators (▶/▼)
     - Shows actual diff content with color coding (green for additions, red for deletions, blue for hunk headers)

4. **Updated branch naming format**
   - **Issue:** Branch names used loop ID (`ralph/{loop-id}`) which wasn't human-readable
   - **New format:** `ralph/{loop-title}-{start-date-and-time}`
   - **Example:** `ralph/add-dark-mode-2026-01-20-15-30-45`
   - **Fix in `src/core/loop-engine.ts`:**
     - Added `generateBranchName()` function that:
       - Sanitizes loop name (lowercase, remove special chars, replace spaces with hyphens)
       - Limits name length to 40 characters
       - Formats timestamp as `YYYY-MM-DD-HH-MM-SS`
       - Combines: `{prefix}{safe-name}-{timestamp}`
     - Updated `setupGitBranch()` to use the new function
   - **Updated test in `tests/e2e/git-workflow.test.ts`:**
     - Renamed test to "branch name includes loop name and timestamp"
     - Updated assertions to check for sanitized loop name and date pattern

**Files Modified:**
- `src/hooks/useLoop.ts` - Added progressContent state and handling
- `src/components/LoopDetails.tsx` - Pass progressContent to LogViewer, expandable diff UI, Prompt tab
- `src/components/CreateLoopForm.tsx` - Added placeholder styling classes
- `src/core/git-service.ts` - Added getDiffWithContent and FileDiffWithContent
- `src/types/api.ts` - Added patch field to FileDiff
- `src/api/loops.ts` - Use getDiffWithContent in diff endpoint
- `src/core/loop-engine.ts` - New branch naming with generateBranchName()
- `tests/e2e/git-workflow.test.ts` - Updated branch name test

**Verification Results:**
- `bun run build` - **PASS**
- `bun test` - **135 tests PASS**
- `bun x tsc --noEmit` - **PASS**

---

### 2026-01-20 - Prompt Tab Addition (Current Session)

**Goal:** Allow users to see the original requested prompt in the loop details

**Implementation:**
- Added new "Prompt" tab to `LoopDetails` component
- Tab displays the original task prompt from `config.prompt`
- Shows prompt in a styled pre-formatted block with monospace font
- Tab order: Log → Prompt → Plan → Status → Diff

**Files Modified:**
- `src/components/LoopDetails.tsx` - Added Prompt tab to tabs array and content area

**Verification Results:**
- `bun run build` - **PASS**
- `bun test` - **135 tests PASS**

---

### 2026-01-20 - Application Logging in UI (Current Session)

**Goal:** Show comprehensive application-level logs in the UI, not just AI agent output. Users need to see what the loop engine is doing internally.

**Implementation:**

1. **Added `loop.log` event type in `src/types/events.ts`:**
   - New `LoopLogEvent` interface with `level`, `message`, `details`, and `timestamp`
   - New `LogLevel` type: `"info" | "warn" | "error" | "debug"`
   - Added to the `LoopEvent` union type

2. **Added `emitLog` helper in `src/core/loop-engine.ts`:**
   - Private helper method to emit log events consistently
   - Takes `level`, `message`, and optional `details` object

3. **Added comprehensive logging throughout LoopEngine:**
   - `start()`: Starting loop, git setup, backend connection
   - `stop()`: Stopping loop, aborting session
   - `pause()`: Pausing execution
   - `resume()`: Resuming execution
   - `setupGitBranch()`: Checking git repo, uncommitted changes, branch creation/checkout
   - `setupSession()`: Backend connection, session creation
   - `runLoop()`: Stop pattern detection, max iterations, waiting between iterations
   - `runIteration()`: Building prompt, sending to AI, subscribing to events, evaluating stop pattern
   - `commitIteration()`: Checking for changes, generating commit message, committing

4. **Updated `useLoop` hook in `src/hooks/useLoop.ts`:**
   - Added `LogEntry` interface matching the event structure
   - Added `logs` state to accumulate log entries
   - Added handler for `loop.log` events
   - Added `logs` to `UseLoopResult` interface and return object

5. **Updated `LogViewer` component in `src/components/LogViewer.tsx`:**
   - Added `LogEntry` interface
   - Added `logs` prop to accept application logs
   - Added `getLogLevelColor()` and `getLogLevelBadge()` helpers
   - Logs are now sorted by timestamp along with messages and tool calls
   - Each log entry shows: timestamp, level badge (INFO/WARN/ERROR/DEBUG), message, and expandable details

6. **Updated `LoopDetails` component:**
   - Passes `logs` from `useLoop` to `LogViewer`

**Log Events Emitted:**
- Loop lifecycle: starting, started, stopping, stopped, pausing, resuming
- Git operations: checking repo, checking changes, creating/checking out branch, committing
- Backend operations: connecting, creating session
- Iteration flow: starting iteration, building prompt, sending to AI, evaluating stop pattern
- AI events: response started, response complete, tool calls
- Errors and warnings: failed operations with details

**Files Modified:**
- `src/types/events.ts` - Added `LoopLogEvent` type and `LogLevel`
- `src/core/loop-engine.ts` - Added `emitLog()` and comprehensive logging
- `src/hooks/useLoop.ts` - Added `logs` state and `loop.log` event handling
- `src/components/LogViewer.tsx` - Added log entry rendering with level badges
- `src/components/LoopDetails.tsx` - Pass logs to LogViewer

**Verification Results:**
- `bun run build` - **PASS**
- `bun test` - **135 tests PASS**

---

### 2026-01-20 - TypeScript Fix (Current Session)

**Issue Fixed:**
- Fixed TypeScript errors in `src/core/loop-engine.ts` around lines 479, 549, and 580
- The `toolCalls` Map was typed as `Map<string, { name: string; input: unknown }>` but the code was storing and reading an `id` property

**Fix Applied:**
- Updated the Map type to `Map<string, { id: string; name: string; input: unknown }>`

**Files Modified:**
- `src/core/loop-engine.ts` - Fixed toolCalls Map type

**Verification Results:**
- `bun x tsc --noEmit` - **PASS** (no errors)
- `bun test` - **135 tests PASS**
- `bun run build` - **PASS**

---

### 2026-01-20 - Duplicate Events Fix (Current Session)

**Issue:**
- Users were seeing duplicate events in the log viewer
- For example: "AI started generating response" appearing 3 times, or the same bash tool call with input appearing 7-8 times before showing output
- Root cause: The OpenCode SDK emits `message.updated` and `message.part.updated` events repeatedly as messages/parts are being built up - each update was being treated as a new event

**Fix Applied in `src/backends/opencode/index.ts`:**

1. **Updated `subscribeToEvents()` method:**
   - Added `emittedMessageStarts` Set to track message IDs we've already emitted `message.start` events for
   - Added `toolPartStatus` Map to track tool part IDs and their last known status

2. **Updated `translateEvent()` method:**
   - For `message.updated`: Only emit `message.start` once per message ID (skip if already in Set)
   - For `message.part.updated` with tool type: Only emit `tool.start` or `tool.complete` when status changes (skip if same status already emitted)
   - Text deltas (`message.delta`) are always unique content, so no deduplication needed

**Deduplication Logic:**
- `message.start`: Emit once per message ID, then skip subsequent `message.updated` events for same message
- `tool.start`: Emit once when status is "running", skip subsequent "running" updates
- `tool.complete`: Emit once when status is "completed", skip subsequent "completed" updates  
- `tool.error`: Emit once when status is "error", skip subsequent "error" updates

**Files Modified:**
- `src/backends/opencode/index.ts` - Added deduplication tracking to event subscription

**Verification Results:**
- `bun x tsc --noEmit` - **PASS** (no errors)
- `bun test` - **135 tests PASS**
- `bun run build` - **PASS**

---

### 2026-01-20 - Tab Update Indicators (Current Session)

**Feature:** Show visual indicator on inactive tabs when they have new updates

**Implementation in `src/components/LoopDetails.tsx`:**

1. **Added state to track tabs with unseen updates:**
   - `tabsWithUpdates`: Set of TabIds that have unread changes
   - Refs to track previous counts/values: `prevMessagesCount`, `prevToolCallsCount`, `prevLogsCount`, `prevDiffCount`, `prevPlanContent`, `prevStatusContent`

2. **Added change detection effects:**
   - **Log tab**: Detects changes in `messages`, `toolCalls`, or `logs` arrays
   - **Diff tab**: Detects when `diffContent` array grows
   - **Plan tab**: Detects when `planContent.content` changes
   - **Status tab**: Detects when `statusContent.content` changes
   - Only marks tab as having updates if it's not the active tab

3. **Added `handleTabChange()` function:**
   - Switches to the new tab
   - Clears the update indicator for that tab

4. **Added visual indicator:**
   - Small blue dot (2x2 rounded-full) positioned at top-right of tab button
   - Only shows when tab has updates AND is not active

**Visual Result:**
- When user is on "Log" tab and new files appear in diff, the "Diff" tab shows a blue dot
- When user clicks on "Diff" tab, the dot disappears
- Same behavior for Log, Plan, Status, and Diff tabs

**Files Modified:**
- `src/components/LoopDetails.tsx` - Added tab update indicator system

**Verification Results:**
- `bun x tsc --noEmit` - **PASS** (no errors)
- `bun test` - **135 tests PASS**
- `bun run build` - **PASS**
