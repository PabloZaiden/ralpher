# Ralph Loops Management System - Implementation Status

**Last Updated:** 2026-01-20  
**Current Phase:** Phase 5 - Frontend (COMPLETE)  
**Overall Progress:** Phase 5 Complete, Ready for Phase 6

---

## Phase Summary

| Phase | Name | Status | Progress |
|-------|------|--------|----------|
| 1 | Foundation | **Complete** | 5/5 |
| 2 | OpenCode Backend | **Complete** | 5/5 |
| 3 | Loop Engine + Git | **Complete** | 8/8 |
| 4 | API Layer | **Complete** | 5/5 |
| 5 | Frontend | **Complete** | 9/9 |
| 6 | Testing & Polish | Not Started | 0/6 |

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
| 6.1 | Create test setup and mock backend | **Partial** |
| 6.2 | Write unit tests for core modules | **Complete** |
| 6.3 | Write API integration tests | **Complete** |
| 6.4 | Write E2E tests | Not Started |
| 6.5 | Error handling and loading states | Not Started |
| 6.6 | Documentation updates | Not Started |

---

## Verification Checklist

### Build & Type Check
- [x] `bun run build` succeeds
- [x] `bun test` passes (108 tests)
- [ ] `bun x tsc --noEmit` passes (pre-existing errors in build.ts)

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

### Pre-existing Issue

- `bun x tsc --noEmit` has errors in `build.ts` (lines 36, 61, 67, 85, 86, 88)
- These are pre-existing and not related to the new code
- The new code is type-safe and follows strict mode

---

## Next Steps

1. **Begin Phase 6: Testing & Polish**
   - Write E2E tests for full loop workflow
   - Add comprehensive error handling
   - Add loading states and skeletons
   - Update documentation (README, AGENTS.md updates)

2. **Key improvements to consider:**
   - Dark mode toggle in UI
   - Keyboard shortcuts
   - Toast notifications for actions
   - More detailed diff viewer with syntax highlighting
   - Markdown rendering for plan.md and status.md
   - Loop templates/presets

3. **Important considerations:**
   - Test with actual opencode server
   - Verify SSE reconnection behavior
   - Test git operations in real project
