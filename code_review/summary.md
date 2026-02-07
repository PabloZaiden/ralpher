# Ralpher Code Review — Summary & Guide

**Date:** 2026-02-07
**Codebase:** ~24,600 LOC across 87 files, 10 modules
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
- Frontend test coverage is strong (698 tests) with well-designed infrastructure
- Zod validation schemas provide good runtime type checking at the API boundary
- Common UI components (Button, Card, Modal, Badge) are well-scoped

**What needs attention:**
- Two 2,000+ LOC files (`loop-manager.ts`, `loop-engine.ts`) carry all business logic with deeply nested control flow
- `Dashboard.tsx` (1,247 LOC) is a god component with ~20+ state variables
- Fire-and-forget async patterns create silent failures (violates AGENTS.md)
- No centralized state machine for loop status transitions
- Systematic code duplication across API handlers, hooks, and components (~530 LOC recoverable)
- API layer bypasses Core to access Persistence directly in several places
- Error handling is inconsistent — errors frequently swallowed at layer boundaries

---

## Finding Summary

### By Severity

| Severity | files.md | modules.md | functionalities.md | layers.md | Description |
|----------|:--------:|:----------:|:-------------------:|:---------:|-------------|
| Critical | 8 | 6 | 5 | 5 | Data loss, security vulnerabilities, or silent failures in production |
| Major | 80 | 52 | 32 | 46 | Significant code quality, maintainability, or correctness issues |
| Minor | 123 | 32 | 21 | 34 | Style, convention, or low-risk issues |
| Suggestion | 22 | 3 | 8 | 9 | Recommendations for improvement, not defects |

**Note:** Finding counts differ between documents because each perspective groups and counts issues differently. A single underlying problem (e.g., fire-and-forget async) may appear as one finding at the layer level but as three findings at the file level (once per occurrence).

### By Dimension (Across All Documents)

The most prevalent issue categories, ordered by frequency:

| Dimension | Occurrences | Impact |
|-----------|:-----------:|--------|
| **Code duplication** | 30+ | ~530 LOC recoverable across API helpers, hooks, components, and logger constants |
| **Error handling** | 25+ | Errors swallowed at boundaries, no user-facing feedback, crash-on-corrupt-data |
| **Consistency** | 20+ | Mixed patterns for error responses, logger init, HTTP handlers, barrel exports |
| **Dead/legacy code** | 15+ | 16 unused type aliases, dead functions, vestigial modules |
| **Type safety** | 12+ | `unknown` returns, unsafe casts, no typed API client |
| **Security** | 10+ | Unauthenticated destructive endpoints, SQL injection pattern, no WebSocket origin check |
| **Complexity** | 8+ | God methods (200+ LOC), god component, 8-parameter functions |
| **Performance** | 8+ | Unbounded buffers, missing memoization, unnecessary async overhead |
| **State management** | 6+ | No state machine, scattered transitions, direct mutation before persistence |
| **Accessibility** | 3+ | No focus trapping in modals, zoom-disabled viewport, no error boundaries |

---

## Critical Findings

These are the highest-severity issues that should be addressed first:

### 1. Fire-and-Forget Async (Active Bug)
**Files:** `core/loop-manager.ts:381-383`, `core/loop-manager.ts:800-805`, `backends/opencode/index.ts:834-851`
**Analysis:** `layers.md` § B1, `functionalities.md` § 1.1, 8.1, `modules.md` § C1.1, C4.1

`engine.start().catch()` is called without `await`, meaning the API returns "success" before the engine finishes starting. If the engine fails, the loop silently enters an inconsistent state with no error surfaced. This directly violates the AGENTS.md guideline: "CRITICAL: Always await async operations in API handlers."

### 2. Unauthenticated Destructive Endpoints (Security)
**Files:** `api/settings.ts:115` (server kill), `api/settings.ts:79` (DB reset)
**Analysis:** `layers.md` § A1, A2, `functionalities.md` § 7.1, 7.2

`POST /api/server/kill` calls `process.exit(0)` with no authentication. Any client with network access can terminate the server. `POST /api/settings/reset-all` deletes the entire database with no confirmation gate.

### 3. SQL Injection Pattern (Security)
**Files:** `persistence/migrations/index.ts:57`
**Analysis:** `layers.md` § D1, `functionalities.md` § 10.1, `modules.md` § C3.1

`getTableColumns()` interpolates `tableName` directly into a PRAGMA query. Currently called only with hardcoded strings, but the function signature accepts any string — a dangerous pattern.

### 4. God Component (Complexity)
**Files:** `components/Dashboard.tsx` (1,247 LOC)
**Analysis:** `layers.md` § P1, `modules.md` § C7.1

Dashboard manages ~20+ state variables, contains raw `fetch()` calls, business logic for loop grouping/sorting, and modal state for 5+ dialogs. Should be decomposed into 5-6 sub-components.

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
                    |   (9,490 LOC)    |
                    +--------+---------+
                             | fetch() -- no typed client
                             v
                    +------------------+
                    |       API        |
                    |   (3,170 LOC)    |
                    +---+----------+---+
                        |          |
             correct    |          | VIOLATION
                        v          v
              +--------------+  +--------------+
              | Core Business|  |  Data Access  |
              |  (5,450 LOC) |  |  (1,948 LOC)  |
              +------+-------+  +--------------+
                     |                 ^
                     |    correct      |
                     +-----------------+
                     |
                     v
              +--------------+
              |   External   |
              | Integration  |
              |  (2,475 LOC) |
              +--------------+
                     |
                     v
              +--------------+
              |    Shared    |
              |Infrastructure|
              |  (2,100 LOC) |
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
| Loop action functions (13 identical boilerplate) | ~250 | `hooks/loopActions.ts` |
| Preflight validation | ~50 | `api/loops.ts` (create + draft/start) |
| Model selector UI | ~100 | `CreateLoopForm.tsx` + `LoopActionBar.tsx` |
| Workspace lookup + 404 | ~40 | 5 places in `api/workspaces.ts` |
| Logger constants | ~40 | `core/logger.ts` + `lib/logger.ts` |
| Branch name generation | ~20 | `loop-manager.ts` + `loop-engine.ts` |
| **Total estimated** | **~530** | — |

---

## Test Coverage Overview

| Area | LOC | Tests | Coverage Level |
|------|----:|------:|----------------|
| Core business logic | 5,450 | Many | Good (~70%) — unit + scenario tests |
| React components | 7,163 | 508 | Good (~70%) — common + feature + container |
| React hooks | 2,263 | 121 | Good (~65%) — useLoop, useLoops, useWorkspaces, loopActions |
| Persistence/migrations | 1,948 | Good | Moderate (~50%) — migration tests + indirect |
| API endpoints | 3,034 | Partial | Moderate (~40%) — main flows tested |
| E2E scenarios (frontend) | — | 50 | Good workflow coverage |
| External integration | 2,475 | Minimal | Poor (~15%) — mostly error-path tests |
| Utilities | 425 | Partial | Poor — only name-generator tested |

**Notable gaps:** `useWebSocket` (no direct tests), `loop-status.ts` (0% despite critical UI logic), `event-stream.ts` (0% despite being a concurrency primitive), `sanitizeBranchName` (0%), `remote-command-executor.ts` (0%).

---

## Top 10 Recommendations

These address the highest-impact systemic issues spanning multiple layers. They are ordered by priority (impact vs. complexity).

| # | Recommendation | Impact | Complexity | Where to Read More |
|---|---------------|--------|:----------:|-------------------|
| 1 | **Fix fire-and-forget async** — Await `engine.start()` in LoopManager and the async IIFE in `translateEvent()` | Critical | Low | `layers.md` § B1, `functionalities.md` § 1.1 |
| 2 | **Add authentication to destructive endpoints** — `POST /api/server/kill` and `/api/settings/reset-all` need auth | Critical | Low | `layers.md` § A1, A2 |
| 3 | **Introduce a loop state machine** — Centralize all status transitions with a transition table | Major | Medium | `layers.md` § B2, `functionalities.md` § CF-5 |
| 4 | **Enforce layered architecture** — Remove direct persistence imports from API. Add query methods to LoopManager | Major | Medium | `layers.md` § A3, A4, `functionalities.md` § CF-2 |
| 5 | **Extract shared helpers** — `errorResponse()`, `apiCall<T>()`, `ModelSelector`, `requireWorkspace()` (~530 LOC savings) | Major | Low | `functionalities.md` § CF-3, `modules.md` § C2.2 |
| 6 | **Decompose Dashboard.tsx** — Extract LoopList, DashboardHeader, DashboardModals sub-components | Major | Medium | `layers.md` § P1, `modules.md` § C7.1 |
| 7 | **Add error boundaries + user-facing error feedback** — Root ErrorBoundary, toast notifications | Major | Low | `layers.md` § P2, P10, `functionalities.md` § CF-4 |
| 8 | **Fix backend logger sub-logger sync** — Port caching pattern from `lib/logger.ts` to `core/logger.ts` | Major | Low | `layers.md` § S3, `functionalities.md` § 7.3 |
| 9 | **Fix data integrity risks** — Replace INSERT OR REPLACE with upsert, add JSON.parse error handling, validate table names | Major | Low | `layers.md` § D1-D3, `functionalities.md` § 10.1-10.3 |
| 10 | **Decompose god methods** — Break `acceptLoop()` (200 LOC) and `runIteration()` (250 LOC) into focused sub-methods | Major | Medium | `layers.md` § B4, B5, `modules.md` § C1.8, C1.9 |

---

## Document Details

### [files.md](files.md) — File-by-File Analysis

**Scope:** Every source file in the codebase reviewed individually.
**Findings:** 8 Critical, 80 Major, 123 Minor, 22 Suggestions (233 total)
**Structure:**
- Files grouped by directory (`src/core/`, `src/api/`, `src/persistence/`, etc.)
- Each file has: purpose, LOC, and a findings table with severity, dimension, line numbers, and description
- Includes frontend test infrastructure review (post-PR #84 update)
- Ends with Test Quality Notes

**Unique value:** Line-level precision. When you need to know the exact location and nature of an issue, this is where to look.

### [modules.md](modules.md) — Module-Level Analysis

**Scope:** 10 `src/` modules reviewed as architectural units.
**Findings:** 6 Critical, 52 Major, 32 Minor, 3 Suggestions (93 total)
**Structure:**
- Executive summary table with per-module health metrics
- Each module has: file inventory, LOC breakdown, module-level findings, API surface analysis, cohesion & coupling assessment, and prioritized recommendations

**Unique value:** Module health assessment. Reveals cohesion problems, coupling issues, and API surface quality that are invisible at the file level. The barrel export analysis (what's exported vs. what's actually imported) is particularly useful.

### [functionalities.md](functionalities.md) — Cross-Cutting Functionality Analysis

**Scope:** 10 end-to-end functionalities traced through all layers.
**Findings:** 5 Critical, 32 Major, 21 Minor, 8 Suggestions (66 total)
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

**Unique value:** Data flow and integration analysis. Shows how features actually work end-to-end and reveals integration bugs that are invisible when reviewing files or modules in isolation (e.g., the fire-and-forget pattern only becomes critical when you trace the full creation-to-execution flow).

### [layers.md](layers.md) — Architectural Layer Analysis

**Scope:** 6 architectural layers with cross-layer interaction analysis.
**Findings:** 5 Critical, 46 Major, 34 Minor, 9 Suggestions (94 total)
**Structure:**
- Layer overview with health scores (A-F scale)
- Each layer has: files, LOC, health score, pattern analysis (strengths + anti-patterns), findings, interface quality (inbound/outbound), test coverage, and recommendations
- Cross-Layer Analysis section with dependency flow diagram, data flow patterns, error propagation analysis, and type safety assessment
- Top 10 Architectural Recommendations
- Finding totals by dimension
- File-to-layer mapping appendix

**Layers analyzed:**
1. Presentation (9,490 LOC) — Health: C
2. API (3,170 LOC) — Health: C+
3. Core Business Logic (5,450 LOC) — Health: C+
4. Data Access (1,948 LOC) — Health: B-
5. External Integration (2,475 LOC) — Health: C
6. Shared Infrastructure (2,100 LOC) — Health: B

**Unique value:** System-level perspective. The cross-layer analysis reveals layering violations, error propagation gaps, and type safety boundaries that no other document captures. The health scores provide a quick at-a-glance assessment of each layer's quality.

---

## Glossary

| Term | Definition |
|------|-----------|
| **Fire-and-forget** | Calling an async function without `await`, causing the caller to continue without waiting for completion or catching errors |
| **God component/method** | A component or method that handles too many responsibilities, making it hard to understand, test, and maintain |
| **TOCTOU** | Time-of-check-time-of-use — a race condition where the state checked before an action changes between the check and the action |
| **Barrel export** | An `index.ts` file that re-exports from multiple modules, providing a single import path for a directory |
| **Upsert** | `INSERT ... ON CONFLICT DO UPDATE` — inserts a new row or updates the existing one, without triggering DELETE cascades |
| **ReDoS** | Regular expression Denial of Service — a crafted regex pattern that causes catastrophic backtracking |
| **Layer bypass** | When a higher layer (e.g., API) directly accesses a lower layer (e.g., Persistence) instead of going through the intermediate layer (e.g., Core) |
| **State machine** | A formal model defining valid states and transitions, preventing invalid state changes at the type level |
| **AbortController** | A browser API for canceling in-flight fetch requests — prevents race conditions when switching between views |
| **Focus trapping** | Constraining keyboard focus within a modal dialog so users cannot tab to background content |
