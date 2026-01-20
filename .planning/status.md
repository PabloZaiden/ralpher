# Ralph Loops Management System - Implementation Status

**Last Updated:** 2026-01-20  
**Current Phase:** Phase 2 - OpenCode Backend (COMPLETE)  
**Overall Progress:** Phase 2 Complete, Ready for Phase 3

---

## Phase Summary

| Phase | Name | Status | Progress |
|-------|------|--------|----------|
| 1 | Foundation | **Complete** | 5/5 |
| 2 | OpenCode Backend | **Complete** | 5/5 |
| 3 | Loop Engine + Git | Not Started | 0/8 |
| 4 | API Layer | Not Started | 0/5 |
| 5 | Frontend | Not Started | 0/9 |
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

### Verification Results

- `bun run build` - **PASS**
- `bun test` - **PASS** (34 tests total)

---

## Phase 3: Loop Engine + Git

| Task | Description | Status |
|------|-------------|--------|
| 3.1 | Implement loop engine core | Not Started |
| 3.2 | Implement iteration execution | Not Started |
| 3.3 | Implement stop pattern detection | Not Started |
| 3.4 | Implement loop manager | Not Started |
| 3.5 | Implement GitService | Not Started |
| 3.6 | Integrate git branch on start | Not Started |
| 3.7 | Integrate git commit on iteration end | Not Started |
| 3.8 | Implement accept/discard endpoints | Not Started |

---

## Phase 4: API Layer

| Task | Description | Status |
|------|-------------|--------|
| 4.1 | Refactor `src/index.ts` for modular routes | Not Started |
| 4.2 | Implement loops CRUD endpoints | Not Started |
| 4.3 | Implement loop control endpoints | Not Started |
| 4.4 | Implement SSE endpoint | Not Started |
| 4.5 | Add health check endpoint | Not Started |

---

## Phase 5: Frontend

| Task | Description | Status |
|------|-------------|--------|
| 5.1 | Implement useSSE hook | Not Started |
| 5.2 | Implement useLoops hook | Not Started |
| 5.3 | Create common UI components | Not Started |
| 5.4 | Create Dashboard and LoopCard | Not Started |
| 5.5 | Create LoopDetails with tabs | Not Started |
| 5.6 | Create LogViewer | Not Started |
| 5.7 | Create CreateLoopForm | Not Started |
| 5.8 | Implement client-side routing | Not Started |
| 5.9 | Add git info to UI | Not Started |

---

## Phase 6: Testing & Polish

| Task | Description | Status |
|------|-------------|--------|
| 6.1 | Create test setup and mock backend | Not Started |
| 6.2 | Write unit tests for core modules | Not Started |
| 6.3 | Write API integration tests | Not Started |
| 6.4 | Write E2E tests | Not Started |
| 6.5 | Error handling and loading states | Not Started |
| 6.6 | Documentation updates | Not Started |

---

## Verification Checklist

### Build & Type Check
- [x] `bun run build` succeeds
- [x] `bun test` passes (34 tests)
- [ ] `bun x tsc --noEmit` passes (pre-existing errors in build.ts)

### Functional Requirements
- [ ] F1: Create loop via API
- [ ] F2: Start/stop loops
- [ ] F3: Loop iterates until complete
- [ ] F4: Respects maxIterations
- [x] F5: Connect to existing opencode (OpenCodeBackend.connect with mode="connect")
- [x] F6: Spawn new opencode (OpenCodeBackend.connect with mode="spawn")
- [ ] F7: Git branch per loop
- [ ] F8: Git commit per iteration
- [ ] F9: Git merge on accept
- [ ] F10: Events stream via SSE
- [ ] F11: Persists across restarts
- [ ] F12: Web UI shows loops
- [ ] F13: Web UI real-time log

---

## Notes

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

1. **Begin Phase 3: Loop Engine + Git**
   - Implement `LoopEngine` class in `src/core/loop-engine.ts`
   - Implement iteration execution with prompt/response cycle
   - Implement stop pattern detection (`<promise>COMPLETE</promise>`)
   - Implement `LoopManager` for lifecycle management
   - Implement `GitService` for branch/commit/merge operations

2. **Key files to create:**
   - `src/core/loop-engine.ts` - Core loop execution logic
   - `src/core/loop-manager.ts` - Loop lifecycle management
   - `src/core/git-service.ts` - Git operations using Bun.$

3. **Important considerations:**
   - Each iteration = fresh context window
   - Stop condition: output ends with `<promise>COMPLETE</promise>`
   - Git branch created on loop start (if git.enabled)
   - Git commit after each iteration (if git.enabled)
