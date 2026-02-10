# Ralpher Code Review — Summary & Guide

**Date:** 2026-02-07
**Codebase:** ~27,328 LOC across 90 files, 10 modules
**Stack:** Bun + React 19 + Tailwind CSS v4 + SQLite

---

## How to Read This Review

This code review is split across **four analysis documents**, each examining the same codebase from a different perspective. Findings are naturally referenced across documents where they overlap, but each document stands on its own and provides unique insights that the others do not.

### Reading Order

For a **first-time reader**, this recommended order moves from broad architecture down to file-level detail:

| Order | Document | Purpose | Best For |
|:-----:|----------|---------|----------|
| 1 | **[layers.md](layers.md)** | Analyzes the 6 architectural layers and their interactions | Understanding the system architecture, dependency flow, cross-layer violations, and error propagation patterns |
| 2 | **[functionalities.md](functionalities.md)** | Traces 10 end-to-end features across all layers | Understanding how features actually work, data flow through the system, and integration issues between layers |
| 3 | **[modules.md](modules.md)** | Reviews each `src/` directory as a cohesive unit | Evaluating module health, cohesion, coupling, API surface quality, and test coverage per module |
| 4 | **[files.md](files.md)** | Detailed file-by-file analysis with line-level findings | Looking up specific issues in specific files, getting exact locations and fix guidance |

For a **targeted reader** looking for specific information:

| If you want to... | Read |
|-------------------|------|
| Fix the most critical bugs first | [Top 10 Architectural Recommendations](#top-10-recommendations) below, or `layers.md` § Top 10 |
| Understand the overall health of the codebase | [Overall Assessment](#overall-assessment) below |
| Reduce code duplication | `functionalities.md` § CF-3 (Systematic Code Duplication) |
| Understand a specific module's issues | `modules.md` § Module N |
| Find all issues in a specific file | `files.md` § directory/file section |
| See the dependency/layering violations | `layers.md` § Cross-Layer Analysis |
| Assess test coverage | `layers.md` § Test Coverage per layer, or `functionalities.md` § CF-6 |
| Identify dead code | `files.md` — search for "Dead/legacy code" dimension, or `modules.md` § Module 5 (types) |

---

## Overall Assessment

### Codebase Health: C+

The Ralpher codebase is **functional and well-organized at the directory level**, with clean separation between frontend and backend. The application works and delivers its core value. However, it carries significant technical debt concentrated in a handful of areas:

**What works well:**
- Clean module boundaries — each `src/` directory has a clear purpose
- Bun idioms are used correctly throughout
- GitService's `withExecutor()` dependency injection pattern is excellent
- The migration system is well-designed with idempotency checks
- Frontend test coverage is strong (715 tests) with well-designed infrastructure
- Zod validation schemas provide good runtime type checking at the API boundary
- Common UI components (Button, Card, Modal, Badge) are well-scoped

**What needs attention:**
- Two 2,000+ LOC files (`loop-manager.ts` at 2,409, `loop-engine.ts` at 2,079) carry all business logic with deeply nested control flow
- `Dashboard.tsx` (1,118 LOC) is a god component with 26 state variables
- No centralized state machine for loop status transitions
- Systematic code duplication across API handlers, hooks, and components (~540 LOC recoverable)
- API layer bypasses Core to access Persistence directly in several places
- Error handling is inconsistent — errors frequently swallowed at layer boundaries

---

## Finding Summary

### By Severity

| Severity | files.md | modules.md | functionalities.md | layers.md | Description |
|----------|:--------:|:----------:|:-------------------:|:---------:|-------------|
| Critical | 5 | 3 | 2 | 2 | Data loss, security vulnerabilities, or silent failures in production |
| Major | 79 | 52 | 30 | 45 | Significant code quality, maintainability, or correctness issues |
| Minor | 123 | 31 | 21 | 34 | Style, convention, or low-risk issues |
| Suggestion | 22 | 3 | 8 | 9 | Recommendations for improvement, not defects |

*Note: Several findings have been reclassified. Critical counts reduced: 2 findings in files.md, modules.md, functionalities.md, and layers.md marked "By Design" (fire-and-forget async patterns are intentional for long-running processes). 1 Critical in each document marked N/A (authentication handled by reverse proxy).*

### By Dimension (Across All Documents)

The most prevalent issue categories, ordered by frequency:

| Dimension | Occurrences | Impact |
|-----------|:-----------:|--------|
| **Code duplication** | 30+ | ~540 LOC recoverable across API helpers, hooks, components, and logger constants |
| **Error handling** | 25+ | Errors swallowed at boundaries, no user-facing feedback, crash-on-corrupt-data |
| **Consistency** | 20+ | Mixed patterns for error responses, logger init, HTTP handlers, barrel exports |
| **Dead/legacy code** | 15+ | 16 unused type aliases, dead functions, vestigial modules |
| **Type safety** | 12+ | `unknown` returns, unsafe casts, no typed API client |
| **Security** | 10+ | SQL injection pattern, no WebSocket origin check |
| **Complexity** | 8+ | God methods (200+ LOC), god component, 8-parameter functions |
| **Performance** | 8+ | Unbounded buffers, missing memoization, unnecessary async overhead |
| **State management** | 6+ | No state machine, scattered transitions, direct mutation before persistence |
| **Accessibility** | 3+ | No focus trapping in modals, zoom-disabled viewport, no error boundaries |

---

## Critical Findings

These are the highest-severity issues that should be addressed first:

### ~~1. Fire-and-Forget Async (Active Bug)~~ 1. Fire-and-Forget Async — By Design
**Files:** `core/loop-manager.ts:381-383`, `core/loop-manager.ts:800-805`, `backends/opencode/index.ts:834-851`
**Analysis:** `layers.md` § B1, `functionalities.md` § 1.1, 8.1, `modules.md` § C1.1, C4.1

~~`engine.start().catch()` is called without `await`, meaning the API returns "success" before the engine finishes starting. If the engine fails, the loop silently enters an inconsistent state with no error surfaced. This directly violates the AGENTS.md guideline: "CRITICAL: Always await async operations in API handlers."~~

**By Design — Intentional Architecture:** All fire-and-forget patterns in the codebase are intentional:

1. **`loop-manager.ts:381-383` and `800-805`** — The loop engine runs a `while`-loop with multiple AI iterations that may take hours. Awaiting would block the HTTP response indefinitely. The engine has comprehensive self-contained error handling: `handleError()` updates loop state to "failed", emits error events, and `trackConsecutiveError()` provides a failsafe exit.

2. **`opencode/index.ts:834-851`** — This async IIFE is purely diagnostic logging code inside a `session.idle` handler. It has its own `try/catch`, and blocking for it would delay event processing unnecessarily.

See `AGENTS.md` § Async Patterns for the documented exception policy.

### 2. ~~Unauthenticated Destructive Endpoints (Security)~~ — Not Applicable
**Files:** `api/settings.ts:115` (server kill), `api/settings.ts:79` (DB reset)
**Analysis:** `layers.md` § A1, A2, `functionalities.md` § 7.1, 7.2

~~`POST /api/server/kill` calls `process.exit(0)` with no authentication. Any client with network access can terminate the server. `POST /api/settings/reset-all` deletes the entire database with no confirmation gate.~~

**Not Applicable:** Ralpher runs behind a reverse proxy that enforces authentication and authorization at the infrastructure level. All destructive endpoints are protected by the proxy before requests reach the application. See `AGENTS.md` § Authentication & Authorization.

### 3. SQL Injection Pattern (Security)
**Files:** `persistence/migrations/index.ts:57`
**Analysis:** `layers.md` § D1, `functionalities.md` § 10.1, `modules.md` § C3.1

`getTableColumns()` interpolates `tableName` directly into a PRAGMA query. Currently called only with hardcoded strings, but the function signature accepts any string — a dangerous pattern.

### 4. God Component (Complexity)
**Files:** `components/Dashboard.tsx` (1,118 LOC)
**Analysis:** `layers.md` § P1, `modules.md` § C7.1

Dashboard manages 26 state variables, contains raw `fetch()` calls, business logic for loop grouping/sorting, and modal state for 5+ dialogs. Should be decomposed into 5-6 sub-components.

### 5. Timer Leak (Resource Leak)
**Files:** `utils/name-generator.ts:112-115`
**Analysis:** `modules.md` § C6.1, `files.md` § utils/name-generator #1

`setTimeout` in `Promise.race` is never cleared when the main promise resolves first. Creates orphan timers during rapid loop creation.

---

## Architectural Concerns

### Layer Dependency Violations

```
                    +------------------+
                    |   Presentation   |
                    |  (10,495 LOC)    |
                    +--------+---------+
                             | fetch() -- no typed client
                             v
                    +------------------+
                    |       API        |
                    |   (3,545 LOC)    |
                    +---+----------+---+
                        |          |
             correct    |          | VIOLATION
                        v          v
              +--------------+  +--------------+
               | Core Business|  |  Data Access  |
               |  (6,285 LOC) |  |  (2,061 LOC)  |
               +------+-------+  +--------------+
                      |                 ^
                      |    correct      |
                      +-----------------+
                      |
                      v
               +--------------+
               |   External   |
               | Integration  |
               |  (2,597 LOC) |
               +--------------+
                      |
                      v
               +--------------+
               |    Shared    |
               |Infrastructure|
               |  (2,345 LOC) |
               +--------------+
```

**Key violations:**
1. **API -> Data Access** (bypasses Core): `api/loops.ts` imports `updateLoopState`, `getActiveLoopByDirectory`, `getReviewComments` directly from persistence
2. **Shared Infrastructure -> External Integration** (reverse dependency): `types/loop.ts` imports `TodoItem` from `backends/types.ts`

### Missing State Machine

Loop status transitions (`draft` -> `idle` -> `starting` -> `running` -> `completed` -> `merged`) are validated ad-hoc across scattered methods in `loop-manager.ts`, `loop-engine.ts`, and `api/loops.ts`. No centralized transition table exists, making it easy to introduce invalid transitions.

### Dual Logger Systems

Two independent logger implementations (`core/logger.ts` and `lib/logger.ts`) share identical constants but differ in behavior. The backend logger does NOT propagate runtime log level changes to sub-loggers. The frontend logger does.

---

## Code Duplication Hotspots

| Duplication | LOC Savings | Where |
|-------------|:-----------:|-------|
| `errorResponse()` helper | ~30 | 3 API files (loops, models, settings) |
| Loop action functions (14 identical boilerplate) | ~260 | `hooks/loopActions.ts` |
| Preflight validation | ~50 | `api/loops.ts` (create + draft/start) |
| Model selector UI | ~100 | `CreateLoopForm.tsx` + `LoopActionBar.tsx` |
| Workspace lookup + 404 | ~40 | 5 places in `api/workspaces.ts` |
| Logger constants | ~40 | `core/logger.ts` + `lib/logger.ts` |
| Branch name generation | ~20 | `loop-manager.ts` + `loop-engine.ts` |
| **Total estimated** | **~540** | — |

---

## Test Coverage Overview

| Area | LOC | Tests | Coverage Level |
|------|----:|------:|----------------|
| Core business logic | 7,794 | Many | Good (~70%) — unit + scenario tests |
| React components | 7,527 | 520 | Good (~70%) — common + feature + container |
| React hooks | 2,477 | 126 | Good (~65%) — useLoop, useLoops, useWorkspaces, loopActions |
| Persistence/migrations | 2,061 | Good | Moderate (~50%) — migration tests + indirect |
| API endpoints | 3,397 | Partial | Moderate (~40%) — main flows tested |
| E2E scenarios (frontend) | — | 50 | Good workflow coverage |
| External integration | 2,597 | Minimal | Poor (~15%) — mostly error-path tests |
| Utilities | 457 | Partial | Poor — only name-generator tested |

**Notable gaps:** `useWebSocket` (no direct tests), `loop-status.ts` (0% despite critical UI logic), `event-stream.ts` (0% despite being a concurrency primitive), `sanitizeBranchName` (0%), `remote-command-executor.ts` (0%).

---

## Top 10 Recommendations

These address the highest-impact systemic issues spanning multiple layers. They are ordered by priority (impact vs. complexity).

| # | Recommendation | Impact | Complexity | Where to Read More |
|---|---------------|--------|:----------:|-------------------|
| 1 | ~~**Fix fire-and-forget async** — Await `engine.start()` in LoopManager and the async IIFE in `translateEvent()`~~ **By Design** — Intentional for long-running processes with self-contained error handling | ~~Critical~~ N/A | ~~Low~~ N/A | `layers.md` § B1, `functionalities.md` § 1.1 |
| 2 | ~~**Add authentication to destructive endpoints** — `POST /api/server/kill` and `/api/settings/reset-all` need auth~~ **Not Applicable** — authentication and authorization are enforced by a reverse proxy at the infrastructure level | ~~Critical~~ N/A | ~~Low~~ N/A | `layers.md` § A1, A2 |
| 3 | **Introduce a loop state machine** — Centralize all status transitions with a transition table | Major | Medium | `layers.md` § B2, `functionalities.md` § CF-5 |
| 4 | **Enforce layered architecture** — Remove direct persistence imports from API. Add query methods to LoopManager | Major | Medium | `layers.md` § A3, A4, `functionalities.md` § CF-2 |
| 5 | **Extract shared helpers** — `errorResponse()`, `apiCall<T>()`, `ModelSelector`, `requireWorkspace()` (~540 LOC savings) | Major | Low | `functionalities.md` § CF-3, `modules.md` § C2.2 |
| 6 | **Decompose Dashboard.tsx** — Extract LoopList, DashboardHeader, DashboardModals sub-components (currently 1,118 LOC with 26 state variables) | Major | Medium | `layers.md` § P1, `modules.md` § C7.1 |
| 7 | **Add error boundaries + user-facing error feedback** — Root ErrorBoundary, toast notifications | Major | Low | `layers.md` § P2, P10, `functionalities.md` § CF-4 |
| 8 | **Fix backend logger sub-logger sync** — Port caching pattern from `lib/logger.ts` to `core/logger.ts` | Major | Low | `layers.md` § S3, `functionalities.md` § 7.3 |
| 9 | **Fix data integrity risks** — Replace INSERT OR REPLACE with upsert, add JSON.parse error handling, validate table names | Major | Low | `layers.md` § D1-D3, `functionalities.md` § 10.1-10.3 |
| 10 | **Decompose god methods** — Break `acceptLoop()` (200 LOC) and `runIteration()` (250 LOC) into focused sub-methods | Major | Medium | `layers.md` § B4, B5, `modules.md` § C1.8, C1.9 |

---

## Document Details

### [files.md](files.md) — File-by-File Analysis

**Scope:** Every source file in the codebase reviewed individually.
**Findings:** 5 Critical (2 By Design, 1 N/A), 79 Major, 123 Minor, 22 Suggestions (229 total)
**Structure:**
- Files grouped by directory (`src/core/`, `src/api/`, `src/persistence/`, etc.)
- Each file has: purpose, LOC, and a findings table with severity, dimension, line numbers, and description
- Includes frontend test infrastructure review (post-PR #84 update)
- Ends with Test Quality Notes

**Unique value:** Line-level precision. When you need to know the exact location and nature of an issue, this is where to look.

### [modules.md](modules.md) — Module-Level Analysis

**Scope:** 10 `src/` modules reviewed as architectural units.
**Findings:** 3 Critical (2 By Design, 1 N/A), 52 Major (2 resolved), 31 Minor (1 N/A), 3 Suggestions (89 active)
**Structure:**
- Executive summary table with per-module health metrics
- Each module has: file inventory, LOC breakdown, module-level findings, API surface analysis, cohesion & coupling assessment, and prioritized recommendations

**Unique value:** Module health assessment. Reveals cohesion problems, coupling issues, and API surface quality that are invisible at the file level. The barrel export analysis (what's exported vs. what's actually imported) is particularly useful.

### [functionalities.md](functionalities.md) — Cross-Cutting Functionality Analysis

**Scope:** 10 end-to-end functionalities traced through all layers.
**Findings:** 2 Critical (2 By Design, 1 N/A), 30 Major (1 By Design), 21 Minor, 8 Suggestions (61 active)
**Structure:**
- Each functionality has: description, files involved (per layer), data flow diagram, findings table, integration concerns, and recommendations
- Ends with 7 cross-functionality concerns (CF-1 through CF-7) and overall prioritized recommendations

**Functionalities covered:**
1. Loop Lifecycle
2. Plan Mode
3. Review Cycles
4. Git Operations
5. Workspace Management
6. Real-Time Events
7. Settings & Preferences
8. Backend Abstraction
9. Remote Command Execution
10. Database & Migrations

**Unique value:** Data flow and integration analysis. Shows how features actually work end-to-end and reveals integration concerns that are invisible when reviewing files or modules in isolation.

### [layers.md](layers.md) — Architectural Layer Analysis

**Scope:** 6 architectural layers with cross-layer interaction analysis.
**Findings:** 2 Critical (2 By Design, 1 N/A), 45 Major (1 N/A), 34 Minor, 9 Suggestions (90 active)
**Structure:**
- Layer overview with health scores (A-F scale)
- Each layer has: files, LOC, health score, pattern analysis (strengths + anti-patterns), findings, interface quality (inbound/outbound), test coverage, and recommendations
- Cross-Layer Analysis section with dependency flow diagram, data flow patterns, error propagation analysis, and type safety assessment
- Top 10 Architectural Recommendations
- Finding totals by dimension
- File-to-layer mapping appendix

**Layers analyzed:**
1. Presentation (10,495 LOC) — Health: C
2. API (3,545 LOC) — Health: C+
3. Core Business Logic (6,285 LOC) — Health: C+
4. Data Access (2,061 LOC) — Health: B-
5. External Integration (2,597 LOC) — Health: C
6. Shared Infrastructure (2,345 LOC) — Health: B

**Unique value:** System-level perspective. The cross-layer analysis reveals layering violations, error propagation gaps, and type safety boundaries that no other document captures. The health scores provide a quick at-a-glance assessment of each layer's quality.

---

## Glossary

| Term | Definition |
|------|-----------|
| **Fire-and-forget** | Calling an async function without `await`, causing the caller to continue without waiting for completion or catching errors. *Note: This pattern can be intentional for long-running processes that have their own error handling.* |
| **God component/method** | A component or method that handles too many responsibilities, making it hard to understand, test, and maintain |
| **TOCTOU** | Time-of-check-time-of-use — a race condition where the state checked before an action changes between the check and the action |
| **Barrel export** | An `index.ts` file that re-exports from multiple modules, providing a single import path for a directory |
| **Upsert** | `INSERT ... ON CONFLICT DO UPDATE` — inserts a new row or updates the existing one, without triggering DELETE cascades |
| **ReDoS** | Regular expression Denial of Service — a crafted regex pattern that causes catastrophic backtracking |
| **Layer bypass** | When a higher layer (e.g., API) directly accesses a lower layer (e.g., Persistence) instead of going through the intermediate layer (e.g., Core) |
| **State machine** | A formal model defining valid states and transitions, preventing invalid state changes at the type level |
| **AbortController** | A browser API for canceling in-flight fetch requests — prevents race conditions when switching between views |
| **Focus trapping** | Constraining keyboard focus within a modal dialog so users cannot tab to background content |
