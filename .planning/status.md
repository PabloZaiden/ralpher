# Ralph Loops Management System - Implementation Status

**Last Updated:** 2026-01-20  
**Current Phase:** Phase 1 - Foundation  
**Overall Progress:** Planning Complete, Ready for Implementation

---

## Phase Summary

| Phase | Name | Status | Progress |
|-------|------|--------|----------|
| 1 | Foundation | Not Started | 0/5 |
| 2 | OpenCode Backend | Not Started | 0/5 |
| 3 | Loop Engine + Git | Not Started | 0/8 |
| 4 | API Layer | Not Started | 0/5 |
| 5 | Frontend | Not Started | 0/9 |
| 6 | Testing & Polish | Not Started | 0/6 |

---

## Phase 1: Foundation

| Task | Description | Status |
|------|-------------|--------|
| 1.1 | Create data directory structure | Not Started |
| 1.2 | Create type definitions (`src/types/*.ts`) | Not Started |
| 1.3 | Implement persistence paths config | Not Started |
| 1.4 | Implement SimpleEventEmitter | Not Started |
| 1.5 | Create AgentBackend interface and registry | Not Started |

---

## Phase 2: OpenCode Backend

| Task | Description | Status |
|------|-------------|--------|
| 2.1 | Install `@opencode-ai/sdk` | Not Started |
| 2.2 | Implement OpenCodeBackend class | Not Started |
| 2.3 | Implement spawn mode | Not Started |
| 2.4 | Implement connect mode | Not Started |
| 2.5 | Implement event subscription adapter | Not Started |

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
- [ ] `bun x tsc --noEmit` passes
- [ ] `bun run build` succeeds
- [ ] `bun test` passes

### Functional Requirements
- [ ] F1: Create loop via API
- [ ] F2: Start/stop loops
- [ ] F3: Loop iterates until complete
- [ ] F4: Respects maxIterations
- [ ] F5: Connect to existing opencode
- [ ] F6: Spawn new opencode
- [ ] F7: Git branch per loop
- [ ] F8: Git commit per iteration
- [ ] F9: Git merge on accept
- [ ] F10: Events stream via SSE
- [ ] F11: Persists across restarts
- [ ] F12: Web UI shows loops
- [ ] F13: Web UI real-time log

---

## Notes

*Add implementation notes, blockers, and decisions here as work progresses.*

---

## Next Steps

1. Begin Phase 1: Foundation
2. Create type definitions first
3. Implement persistence layer
4. Update this status document after each task
