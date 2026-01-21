# Ralph Loops Management System - Implementation Status

**Last Updated:** 2026-01-20  
**Current Phase:** Phase 6 - Testing & Polish (COMPLETE)  
**Overall Progress:** All phases complete!

---

## Phase Summary

| Phase | Name | Status | Progress |
|-------|------|--------|----------|
| 1 | Foundation | **Complete** | 5/5 |
| 2 | OpenCode Backend | **Complete** | 5/5 |
| 3 | Loop Engine + Git | **Complete** | 8/8 |
| 4 | API Layer | **Complete** | 5/5 |
| 5 | Frontend | **Complete** | 9/9 |
| 6 | Testing & Polish | **Complete** | 6/6 |

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
| 6.6 | Documentation updates | **Complete** |

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

---

### 2026-01-20 - AI Response Content in Logs (Current Session)

**Feature:** Show accumulated AI response text in log entries, updated as content streams in

**Problem:** The "AI started generating response" log entry didn't show the actual response content. Users couldn't see what the AI was saying without expanding the streaming progress content.

**Implementation:**

1. **Added `id` field to `LoopLogEvent` in `src/types/events.ts`:**
   - Unique ID for each log entry, used to update existing entries

2. **Updated `emitLog()` in `src/core/loop-engine.ts`:**
   - Now generates and returns a unique log ID
   - Accepts optional `id` parameter to update existing entries
   - Returns the log ID for tracking

3. **Updated message handling in `runIteration()`:**
   - `message.start`: Creates log entry with ID, initial empty `responseContent` in details
   - `message.delta`: Updates the same log entry with accumulated `responseContent`
   - `message.complete`: Final update with complete response and length

4. **Updated `useLoop` hook in `src/hooks/useLoop.ts`:**
   - `handleSSEEvent` for `loop.log` now updates existing entries by ID
   - If log with same ID exists, updates it in place
   - If new ID, appends to log list

**Result:**
- The "AI started generating response" / "AI generating response..." / "AI finished generating response" log entry now has a `responseContent` field in its details
- Users can expand the details to see what the AI is saying
- The same log entry updates in place as content streams in (no duplicate entries)

**Files Modified:**
- `src/types/events.ts` - Added `id` field to `LoopLogEvent`
- `src/core/loop-engine.ts` - Updated `emitLog()` to support IDs and updates, track response in log details
- `src/hooks/useLoop.ts` - Updated log handling to update existing entries by ID

**Verification Results:**
- `bun x tsc --noEmit` - **PASS** (no errors)
- `bun test` - **135 tests PASS**
- `bun run build` - **PASS**

---

### 2026-01-20 - Test Fixes for Error Continuation Behavior (Current Session)

**Issue:**
- Two tests were failing after the error handling behavior was changed to "continue on error instead of failing"
- The tests expected the loop to fail immediately on first error, but now loops continue until `maxConsecutiveErrors` is reached

**Failing Tests:**
1. `tests/unit/loop-engine.test.ts` - "LoopEngine > handles errors gracefully"
2. `tests/e2e/full-loop.test.ts` - "Full Loop Workflow > handles backend errors gracefully"

**Root Cause:**
- The `trackConsecutiveError()` method logic was: on first error, set count=1 and return `false`
- Even with `maxConsecutiveErrors: 1`, this meant the first error would NOT trigger failsafe
- A second error was required to trigger `return newCount >= maxErrors` (2 >= 1)

**Fixes Applied:**

1. **Updated test config** (`tests/unit/loop-engine.test.ts`):
   - Added `maxConsecutiveErrors: 1` to the test loop so it fails after first error

2. **Updated test config** (`tests/e2e/full-loop.test.ts`):
   - Added `maxConsecutiveErrors: 1` to the createLoop call

3. **Fixed logic bug** (`src/core/loop-engine.ts`):
   - In `trackConsecutiveError()`, on first error now returns `1 >= maxErrors`
   - This correctly handles the `maxConsecutiveErrors: 1` case where we should fail on the very first error

**Files Modified:**
- `src/core/loop-engine.ts` - Fixed trackConsecutiveError() logic for first error
- `tests/unit/loop-engine.test.ts` - Added maxConsecutiveErrors: 1 to test
- `tests/e2e/full-loop.test.ts` - Added maxConsecutiveErrors: 1 to test

**Verification Results:**
- `bun x tsc --noEmit` - **PASS** (no errors)
- `bun test` - **135 tests PASS**
- `bun run build` - **PASS**

---

### 2026-01-20 - Diff Indicator and AI Reasoning Display (Current Session)

**Issues Fixed:**

1. **Diff panel update indicator not showing**
   - **Problem:** The diff tab indicator only triggered when `diffContent.length` changed, but diff content was only fetched when the user clicked on the diff tab
   - **Solution:** 
     - Added `gitChangeCounter` state to `useLoop` hook that increments on `loop.iteration.end` and `loop.git.commit` events
     - Also trigger diff indicator when `toolCalls.length` changes (tool calls often mean file operations)
     - Component now watches these signals instead of `diffContent.length`

2. **AI reasoning/thinking not displayed in logs**
   - **Problem:** The OpenCode SDK emits `ReasoningPart` events for AI chain-of-thought reasoning, but we weren't handling them
   - **Solution:**
     - Added `reasoning.delta` to `AgentEvent` type in `src/backends/types.ts`
     - Added handler for `part.type === "reasoning"` in OpenCode backend's `translateEvent()` method
     - Added `reasoning.delta` case in LoopEngine's event handler to create and update "AI reasoning..." log entries
     - Reasoning content is now displayed in the log viewer under the "agent" log level

**Files Modified:**
- `src/hooks/useLoop.ts` - Added `gitChangeCounter` state and increment on git-related events
- `src/components/LoopDetails.tsx` - Watch `gitChangeCounter` and `toolCalls.length` for diff indicator
- `src/backends/types.ts` - Added `reasoning.delta` to `AgentEvent` union type
- `src/backends/opencode/index.ts` - Handle `reasoning` part type in `translateEvent()`
- `src/core/loop-engine.ts` - Handle `reasoning.delta` events, track reasoning content in logs

**Verification Results:**
- `bun x tsc --noEmit` - **PASS** (no errors)
- `bun test` - **135 tests PASS**
- `bun run build` - **PASS**

---

### 2026-01-20 - UI Cleanup (Current Session)

**Issues Fixed:**

1. **Removed "Discard Branch" option**
   - **Problem:** The discard branch option was redundant since "Delete Loop" now handles cleanup
   - **Solution:** Removed the "Discard Branch" button from loop details, keeping only "Accept (Merge)" and "Delete Loop"
   - Removed `discardConfirm` state, `handleDiscard` function, and the confirmation modal

2. **Removed redundant "Create Loop" button in empty state**
   - **Problem:** The empty state showed a "Create Loop" button, but there's already a "New Loop" button always visible in the header
   - **Solution:** Removed the button, updated the message to say "Click 'New Loop' to create your first Ralph Loop"

**Files Modified:**
- `src/components/LoopDetails.tsx` - Removed discard button, modal, state, and handler
- `src/components/Dashboard.tsx` - Removed redundant "Create Loop" button from empty state

**Verification Results:**
- `bun x tsc --noEmit` - **PASS** (no errors)
- `bun test` - **135 tests PASS**
- `bun run build` - **PASS**

---

### 2026-01-20 - Model Selection Feature (Current Session)

**Feature:** Allow users to select the AI model when creating a new loop

**Implementation:**

1. **Added `getModels()` method to OpenCodeBackend** (`src/backends/opencode/index.ts`):
   - Calls `client.provider.list()` from the OpenCode SDK
   - Returns list of all available models with provider info and connection status
   - Added `ModelInfo` interface with providerID, providerName, modelID, modelName, connected fields

2. **Created user preferences persistence** (`src/persistence/preferences.ts`):
   - New module for storing user preferences
   - Stores last used model selection in `data/preferences.json`
   - Functions: `loadPreferences()`, `savePreferences()`, `getLastModel()`, `setLastModel()`

3. **Added API endpoints for models and preferences** (`src/api/models.ts`):
   - `GET /api/models?directory=<path>` - Get available models from OpenCode for a given directory
   - `GET /api/preferences/last-model` - Get last used model
   - `PUT /api/preferences/last-model` - Set last used model

4. **Updated CreateLoopForm component** (`src/components/CreateLoopForm.tsx`):
   - Added new props: `models`, `modelsLoading`, `lastModel`, `onDirectoryChange`
   - Added model dropdown with grouped optgroups (connected providers first, then disconnected)
   - Models are loaded when directory is entered (with 500ms debounce)
   - Last used model is pre-selected if available
   - Disconnected provider models are shown but disabled

5. **Updated Dashboard component** (`src/components/Dashboard.tsx`):
   - Fetches last model on mount
   - Fetches available models when directory changes in form
   - Passes models, modelsLoading, lastModel, and onDirectoryChange to CreateLoopForm
   - Updates lastModel state when loop is created with a model

6. **Updated loops API to save last model** (`src/api/loops.ts`):
   - When creating a loop with a model, saves it as last used model (fire and forget)

7. **Added ModelInfo to API types** (`src/types/api.ts`):
   - Added `ModelInfo` interface for API responses

**User Flow:**
1. User opens "New Loop" modal
2. User enters the working directory
3. After 500ms, models are fetched from OpenCode for that directory
4. Dropdown shows available models grouped by provider (connected first)
5. If user has previously created a loop, their last model is pre-selected
6. User selects a model (optional - defaults to opencode config if not selected)
7. When loop is created, the selected model is saved as last used

**Files Created:**
- `src/persistence/preferences.ts` - User preferences persistence
- `src/api/models.ts` - Models and preferences API endpoints

**Files Modified:**
- `src/backends/opencode/index.ts` - Added `getModels()` method and `ModelInfo` type
- `src/components/CreateLoopForm.tsx` - Added model dropdown with new props
- `src/components/Dashboard.tsx` - Added model fetching and state management
- `src/api/loops.ts` - Save last model when creating loop
- `src/api/index.ts` - Export new models routes
- `src/persistence/index.ts` - Export preferences module
- `src/types/api.ts` - Added `ModelInfo` interface

**Verification Results:**
- `bun x tsc --noEmit` - **PASS** (no errors)
- `bun test` - **135 tests PASS**
- `bun run build` - **PASS**

---

### 2026-01-20 - Loop Continuation Bug Fix (Current Session)

**Issue Reported:**
User observed that after an error occurred during iteration (e.g., "File not found"), the loop engine logged "Waiting before next iteration..." but then hung indefinitely instead of continuing to the next iteration.

**Root Cause:**
The `delay(1000)` call between iterations was blocking. When the async generator for SSE events was broken out of (on error), the underlying HTTP connection cleanup may have been interfering with the subsequent delay/continuation.

**Fixes Applied:**

1. **Removed the delay between iterations** (`src/core/loop-engine.ts`):
   - Removed `await this.delay(1000)` between iterations
   - Removed the "waiting" status since it's no longer used
   - Removed the unused `delay()` method
   - Updated `shouldContinue()` to only check for "running" and "starting" statuses
   - Updated `pause()` to only check for "running" status

2. **Added AbortController to SSE subscription** (`src/backends/opencode/index.ts`):
   - Added `AbortController` to properly cancel the SSE subscription when consumer breaks out
   - Added `try/finally` block to ensure `abortController.abort()` is called on cleanup
   - This ensures the underlying HTTP connection is properly closed

3. **Added debug logging** (`src/core/loop-engine.ts`):
   - Added logging at `runLoop` entry with state details
   - Added logging after each iteration check
   - Added logging when exiting `runLoop` with reason

4. **Added test for error-then-continue scenario** (`tests/unit/loop-engine.test.ts`):
   - New test: "continues to next iteration after error event from backend"
   - Tests that iteration 1 can error, and iteration 2 continues and completes
   - Includes timeout to detect if engine hangs

5. **Fixed mock backend in loops-control tests** (`tests/api/loops-control.test.ts`):
   - Updated `subscribeToEvents` to yield proper events (message.start, message.delta, message.complete)
   - Previously yielded nothing, which caused tests to hang

**Files Modified:**
- `src/core/loop-engine.ts` - Removed delay, added logging, cleaned up waiting status
- `src/backends/opencode/index.ts` - Added AbortController for SSE cleanup
- `tests/unit/loop-engine.test.ts` - Added error-continuation test
- `tests/api/loops-control.test.ts` - Fixed mock backend subscribeToEvents

**Verification Results:**
- `bun x tsc --noEmit` - **PASS** (no errors)
- `bun test` - **136 tests PASS**
- `bun run build` - **PASS**

---

### 2026-01-20 - Pending Prompt (Next Iteration Tuning) Feature (IN PROGRESS)

**Goal:** Allow users to modify/tune the prompt that will be used for the NEXT iteration of an ongoing loop, without affecting the current iteration.

**Use Case:**
- User starts a loop with a prompt like "Implement dark mode"
- During iteration 1, user realizes they forgot to mention "also update the tests"
- User can now update the "pending prompt" which will be used starting from iteration 2
- The current iteration continues with the original prompt

**Design:**

1. **State:**
   - Add `pendingPrompt?: string` to `LoopState`
   - When set, the next iteration uses `pendingPrompt` instead of `config.prompt`
   - After the iteration starts, `pendingPrompt` is cleared (consumed)

2. **API:**
   - `PUT /api/loops/:id/pending-prompt` - Set the pending prompt for next iteration
   - `DELETE /api/loops/:id/pending-prompt` - Clear the pending prompt
   - Both work only when loop is in running/starting states

3. **UI:**
   - Prompt tab shows both "Original Prompt" and "Pending Prompt (for next iteration)"
   - When loop is running, show editable textarea for pending prompt
   - Show indicator when a pending prompt is set
   - Clear pending prompt button

**Goals Checklist:**
- [x] `pendingPrompt` field added to `LoopState`
- [x] API endpoint to set/clear pending prompt
- [x] LoopEngine uses pendingPrompt when building prompt for iteration
- [x] pendingPrompt is cleared after being used
- [x] UI allows editing pending prompt while loop is running
- [x] UI shows indicator when pending prompt differs from original ("Scheduled" badge)
- [x] Tests for pending prompt functionality (8 new tests)
- [x] All verification passes

**Files Modified:**
- `src/types/loop.ts` - Added `pendingPrompt?: string` to LoopState
- `src/api/loops.ts` - Added PUT/DELETE `/api/loops/:id/pending-prompt` endpoints
- `src/core/loop-engine.ts` - Added `setPendingPrompt()`, `clearPendingPrompt()` methods; Updated `buildPrompt()` to use pendingPrompt and clear after use
- `src/core/loop-manager.ts` - Added `setPendingPrompt()`, `clearPendingPrompt()` methods that delegate to engine
- `src/hooks/useLoop.ts` - Added `setPendingPrompt()`, `clearPendingPrompt()` methods and interface
- `src/components/LoopDetails.tsx` - Replaced Prompt tab with full editor: shows original prompt (read-only), pending prompt editor when running, "Scheduled" indicator

**Tests Added:**
- `tests/unit/loop-engine.test.ts`:
  - "setPendingPrompt updates state"
  - "buildPrompt uses pendingPrompt and clears it after use"
- `tests/api/loops-control.test.ts`:
  - "PUT /api/loops/:id/pending-prompt returns 409 when loop is not running"
  - "PUT /api/loops/:id/pending-prompt requires prompt in body"
  - "PUT /api/loops/:id/pending-prompt rejects empty prompt"
  - "DELETE /api/loops/:id/pending-prompt returns 409 when loop is not running"
  - "PUT /api/loops/:id/pending-prompt returns 404 for non-existent loop"
  - "DELETE /api/loops/:id/pending-prompt returns 404 for non-existent loop"

**Verification Results:**
- `bun x tsc --noEmit` - **PASS** (no errors)
- `bun test` - **147 tests PASS** (8 new tests)
- `bun run build` - **PASS**

**Status:** COMPLETE

---

### 2026-01-20 - Diff Indicator Fix (Current Session)

**Issue Reported:**
The Diff tab indicator wasn't showing when files were modified. It only triggered on `loop.iteration.end` and `loop.git.commit` events.

**Fix Applied:**
Updated `src/hooks/useLoop.ts` to also increment `gitChangeCounter` when a tool call completes (`event.tool.status === "completed"`). Since tools like write, edit, and bash often modify files, this ensures the diff indicator shows as soon as changes are made.

**Files Modified:**
- `src/hooks/useLoop.ts` - Increment gitChangeCounter on tool completion

**Verification Results:**
- `bun x tsc --noEmit` - **PASS** (no errors)
- `bun test` - **136 tests PASS**
- `bun run build` - **PASS**

---

### 2026-01-20 - Messages and Tool Calls Persistence (Current Session)

**Issue Reported:**
Tool call details (input/output) and messages disappear after page refresh. Only application logs (`loop.log` events) were being persisted to the loop state and restored on refresh. Messages (`loop.message` events) and tool calls (`loop.tool_call` events) were only stored in React state from SSE events.

**Solution:**
Added persistence for messages and tool calls in the same pattern as logs:
1. Store messages and tool calls in `LoopState` alongside logs
2. Persist them when events are emitted from the loop engine
3. Load them from loop state when the page is refreshed

**Implementation:**

1. **Added new types to `src/types/loop.ts`:**
   - `PersistedMessage` interface - mirrors `MessageData` for persistence
   - `PersistedToolCall` interface - mirrors `ToolCallData` for persistence
   - Added `messages?: PersistedMessage[]` to `LoopState`
   - Added `toolCalls?: PersistedToolCall[]` to `LoopState`
   - Updated `createInitialState()` to include empty `messages` and `toolCalls` arrays

2. **Added persistence methods to `src/core/loop-engine.ts`:**
   - `persistMessage(message: MessageData)` - saves message to loop state
   - `persistToolCall(toolCall: ToolCallData)` - saves/updates tool call in loop state
   - `clearIterationData()` - clears messages and tool calls for new iteration
   - Called `persistMessage()` when emitting `loop.message` events
   - Called `persistToolCall()` when emitting `loop.tool_call` events (both start and complete)
   - Called `clearIterationData()` at the start of each iteration

3. **Updated `src/hooks/useLoop.ts`:**
   - Load persisted messages on page refresh (when `messages.length === 0`)
   - Load persisted tool calls on page refresh (when `toolCalls.length === 0`)
   - Added `messages.length` and `toolCalls.length` to `refresh` callback dependencies

**Data Limits:**
- Messages: Keep last 100 to prevent memory issues
- Tool calls: Keep last 200 to prevent memory issues
- Logs: Keep last 500 (unchanged)

**Files Modified:**
- `src/types/loop.ts` - Added PersistedMessage, PersistedToolCall types and LoopState fields
- `src/core/loop-engine.ts` - Added persistence methods and calls
- `src/hooks/useLoop.ts` - Load persisted data on refresh

**Verification Results:**
- `bun x tsc --noEmit` - **PASS** (no errors)
- `bun test` - **136 tests PASS**
- `bun run build` - **PASS**

---

### 2026-01-20 - Removed Git Toggle Option (Current Session)

**Issue Reported:**
The option to disable git integration was breaking other things. Git should always be enabled.

**Solution:**
Removed the `enabled` field from `GitConfig` interface and all related checks. Git is now always enabled for all loops.

**Changes Made:**

1. **Source Files Modified:**
   - `src/types/loop.ts` - Removed `enabled` field from `GitConfig` interface; Removed `enabled: true` from `DEFAULT_LOOP_CONFIG.git`
   - `src/core/loop-manager.ts` - Removed `gitEnabled?: boolean` from `CreateLoopOptions`; Removed git.enabled checks from `createLoop()`, `deleteLoop()`, `startLoop()`, `acceptLoop()`, `discardLoop()`
   - `src/core/loop-engine.ts` - Removed `if (this.config.git.enabled)` checks - now always sets up git branch and commits
   - `src/api/loops.ts` - Removed `gitEnabled: body.git?.enabled` from createLoop call
   - `src/components/LoopDetails.tsx` - Changed `{config.git.enabled && state.git && (` to `{state.git && (`
   - `src/components/CreateLoopForm.tsx` - Removed gitEnabled checkbox

2. **Test Files Modified:**
   - `tests/unit/persistence.test.ts` - Removed `enabled: true` from git config objects (4 places)
   - `tests/unit/loop-manager.test.ts` - Removed `gitEnabled` option from tests
   - `tests/unit/loop-engine.test.ts` - Removed `enabled: false` from git config; Added git initialization in `beforeEach()`
   - `tests/e2e/full-loop.test.ts` - Removed all `gitEnabled: false` options; Added `initGit: true` to test setup
   - `tests/e2e/git-workflow.test.ts` - Removed all `gitEnabled: true` options; Removed 3 tests for "git disabled" behavior
   - `tests/api/loops-crud.test.ts` - Updated test to use `git: { branchPrefix: "custom/" }` instead of `git: { enabled: false }`
   - `tests/api/loops-control.test.ts` - Removed `git: { enabled: true/false }` options; Updated test descriptions from "git disabled" to "idle status"

**Test Count Change:**
- Before: ~147 tests
- After: 144 tests (removed 3 tests that tested "git disabled" behavior)

**Verification Results:**
- `bun x tsc --noEmit` - **PASS** (no errors)
- `bun test` - **144 tests PASS**
- `bun run build` - **PASS**

---

### 2026-01-20 - Replaced Build Script with Standalone Executable (Current Session)

**Issue:**
The old `build.ts` script only built client-side assets to `dist/`, which was useless because:
1. Bun's `serve()` with HTML imports already handles client bundling at runtime
2. The `dist/` folder wasn't used by anything for deployment

**Solution:**
Replaced with a proper production build script that creates a **standalone executable** using `bun build --compile`.

**Changes Made:**

1. **Removed old build script:**
   - Deleted `build.ts` (root level)
   - Deleted `dist/` directory with old client-only assets

2. **Created new build script at `scripts/build.ts`:**
   - Uses `bun build --compile` to create a standalone executable
   - Includes the Bun runtime and all dependencies
   - Supports cross-compilation with `--target` flag (e.g., `linux-x64`, `darwin-arm64`)
   - Supports custom output name with `--output` flag
   - Output: `dist/ralpher` (~55 MB standalone executable)

3. **Updated `package.json`:**
   - Changed `build` script to `bun run scripts/build.ts`
   - Added `test` script with timeout: `bun test --timeout 15000`

4. **Updated `AGENTS.md`:**
   - Updated production build documentation
   - Documented cross-compilation options
   - Fixed test section to reflect configured test runner

**New Build Usage:**
```bash
bun run build                       # Build for current platform
bun run build --target=linux-x64    # Cross-compile for Linux
bun run build --output=my-app       # Custom output name
./dist/ralpher                      # Run the standalone executable
```

**Files Changed:**
- Deleted: `build.ts`
- Created: `scripts/build.ts`
- Modified: `package.json`, `AGENTS.md`

**Verification Results:**
- `bun x tsc --noEmit` - **PASS** (no errors)
- `bun test` - **144 tests PASS**
- `bun run build` - **PASS** (produces 55 MB standalone executable)

---

### 2026-01-20 - Documentation Updates (Current Session)

**Goal:** Update all READMEs and API documentation to reflect the current state of the project.

**Files Created/Updated:**

1. **README.md** - Complete rewrite with:
   - Project overview and Ralph Loop explanation
   - Key features list
   - Quick start guide (installation, development, production)
   - Cross-compilation instructions
   - Configuration (environment variables, data directory)
   - Usage guide (creating, starting, accepting loops)
   - API quick reference table
   - Project structure
   - Technology stack
   - Testing commands
   - The Ralph Wiggum Technique explanation
   - Contributing guidelines

2. **docs/API.md** - New comprehensive API documentation with:
   - Base URL and authentication info
   - Response format specification
   - All endpoints documented:
     - Health check
     - Loops CRUD (GET, POST, PATCH, DELETE)
     - Loop control (start, stop, accept, discard, purge)
     - Pending prompt (PUT, DELETE)
     - Loop data (diff, plan, status-file)
     - Models API
     - Preferences API
     - Planning directory check
     - SSE events
   - Request/response examples
   - Error codes and descriptions
   - Data type references
   - Usage examples with curl

3. **AGENTS.md** - Updated with:
   - Current project structure
   - New files and directories
   - Updated patterns and guidelines
   - Git integration details
   - Common patterns for adding endpoints and events
   - TypeScript fix patterns

4. **.planning/status.md** - Updated to mark Phase 6 as complete

**Verification Results:**
- `bun x tsc --noEmit` - **PASS** (no errors)
- `bun test` - **144 tests PASS**
- `bun run build` - **PASS**

**Status:** Phase 6 COMPLETE - All implementation phases finished!

---