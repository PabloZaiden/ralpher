# Ralph Loops Management System - Implementation Plan

## Status: Ready for Implementation

**Created:** 2026-01-20  
**Version:** 1.0.0  

---

## 1. Feature Overview

### 1.1 What is Ralpher?

Ralpher is a full-stack web application and API system for managing **Ralph Loops** in opencode. A Ralph Loop (Ralph Wiggum technique) is an autonomous AI development pattern that solves the problem of context accumulation ("context rot") in AI coding assistants.

The pattern works by using an external loop to repeatedly feed prompts to an AI agent, which works on a task until a specific completion condition (`<promise>COMPLETE</promise>`) is met. Each iteration starts with a fresh context window, relying on the filesystem for state persistence.

### 1.2 Goals

1. **API System**: Provide a RESTful API to start, stop, monitor, and configure Ralph Loops
2. **Web Interface**: Deliver a real-time web dashboard to visualize and manage active loops
3. **Agent Backend Abstraction**: Use opencode SDK initially, but abstract for future backend support
4. **Multiple Loops**: Support running multiple independent Ralph Loops concurrently
5. **Git Integration**: Branch per loop, commit per iteration, merge on accept
6. **Persistence**: Single data directory for Docker volume mounting
7. **Real-time Updates**: Stream all loop events to the web UI via Server-Sent Events (SSE)
8. **Testability**: 100% testable API and components for agent verification

### 1.3 Core Principles

| Principle | Description |
|-----------|-------------|
| **Fresh Context per Iteration** | Each iteration starts with a clean context window |
| **State Persistence** | Progress tracked via `.planning/plan.md` and `.planning/status.md` in target project |
| **Stop Condition** | Loop terminates when AI output ends with `<promise>COMPLETE</promise>` |
| **Git Safety** | Work isolated in branch, committed per iteration, merged on acceptance |

---

## 2. Technical Architecture

### 2.1 System Overview

```
┌─────────────────────────────────────────────────────────────────────────┐
│                           RALPHER SERVER                                 │
│                                                                         │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │                      BACKEND ABSTRACTION                         │   │
│  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────────┐  │   │
│  │  │  OpenCode   │  │   Future    │  │       Future            │  │   │
│  │  │   Backend   │  │   Backend   │  │       Backend           │  │   │
│  │  └──────┬──────┘  └──────┬──────┘  └───────────┬─────────────┘  │   │
│  │         └────────────────┴─────────────────────┘                 │   │
│  │                          │                                       │   │
│  │                  AgentBackend Interface                          │   │
│  └──────────────────────────┼───────────────────────────────────────┘   │
│                             │                                           │
│  ┌──────────────────────────┴───────────────────────────────────────┐   │
│  │                        CORE ENGINE                                │   │
│  │  ┌─────────────────┐  ┌─────────────────┐  ┌──────────────────┐  │   │
│  │  │   Loop Engine   │  │  Loop Manager   │  │  Event Emitter   │  │   │
│  │  │  (iteration)    │  │  (CRUD/state)   │  │  (pub/sub)       │  │   │
│  │  └─────────────────┘  └─────────────────┘  └──────────────────┘  │   │
│  │                                                                   │   │
│  │  ┌─────────────────────────────────────────────────────────────┐ │   │
│  │  │                      Git Service                             │ │   │
│  │  │  (branch/commit/merge per loop)                              │ │   │
│  │  └─────────────────────────────────────────────────────────────┘ │   │
│  └──────────────────────────────────────────────────────────────────┘   │
│                             │                                           │
│  ┌──────────────────────────┴───────────────────────────────────────┐   │
│  │                       PERSISTENCE LAYER                           │   │
│  │                                                                   │   │
│  │   data/loops/                    data/sessions/                   │   │
│  │   └── {loop-id}.json             └── {backend}.json               │   │
│  │   (Docker volume mountable)      (Docker volume mountable)        │   │
│  └───────────────────────────────────────────────────────────────────┘   │
│                                                                         │
│  ┌─────────────────┐  ┌─────────────────────────────────────────────┐   │
│  │   REST API      │  │              SSE Endpoint                    │   │
│  │   /api/loops/*  │  │              /api/events                     │   │
│  └─────────────────┘  └─────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────────┘
```

### 2.2 Technology Stack

| Component | Technology | Notes |
|-----------|------------|-------|
| Runtime | Bun 1.3.5+ | Already configured |
| Language | TypeScript (strict) | Existing configuration |
| Backend | Bun serve() | Native HTTP server |
| Frontend | React 19 | Already installed |
| Styling | Tailwind CSS v4 | Already configured |
| Agent Integration | @opencode-ai/sdk | NPM package |
| Persistence | JSON files | File-based storage |
| Real-time | SSE (Server-Sent Events) | Native browser support |
| Git | Bun.$ shell | Native git commands |

### 2.3 Directory Structure

```
ralpher/
├── src/
│   ├── index.ts                    # Server entry point (enhanced)
│   ├── index.html                  # HTML entry (existing)
│   ├── frontend.tsx                # React bootstrap (existing)
│   ├── index.css                   # Global styles (existing)
│   │
│   ├── api/                        # API layer
│   │   ├── routes.ts               # Route definitions
│   │   ├── loops.ts                # Loop CRUD & control endpoints
│   │   ├── events.ts               # SSE endpoint
│   │   └── health.ts               # Health check
│   │
│   ├── backends/                   # Agent backend abstraction
│   │   ├── types.ts                # AgentBackend interface
│   │   ├── registry.ts             # Backend registry
│   │   └── opencode/               # OpenCode implementation
│   │       ├── index.ts            # OpenCodeBackend class
│   │       └── adapter.ts          # SDK adapter
│   │
│   ├── core/                       # Business logic
│   │   ├── loop-engine.ts          # Ralph Loop execution
│   │   ├── loop-manager.ts         # Loop lifecycle
│   │   ├── git-service.ts          # Git operations
│   │   └── event-emitter.ts        # Simple pub/sub
│   │
│   ├── persistence/                # Data layer
│   │   ├── paths.ts                # Path configuration
│   │   ├── loops.ts                # Loop storage
│   │   └── sessions.ts             # Session storage
│   │
│   ├── types/                      # TypeScript types
│   │   ├── loop.ts                 # Loop types
│   │   ├── events.ts               # Event types
│   │   └── api.ts                  # API types
│   │
│   ├── components/                 # React components
│   │   ├── App.tsx                 # Main app (enhanced)
│   │   ├── Dashboard.tsx           # Loop dashboard
│   │   ├── LoopCard.tsx            # Loop card
│   │   ├── LoopDetails.tsx         # Detail view
│   │   ├── CreateLoopForm.tsx      # Creation form
│   │   ├── LogViewer.tsx           # Real-time logs
│   │   └── common/                 # Shared components
│   │       ├── Button.tsx
│   │       ├── Card.tsx
│   │       ├── Badge.tsx
│   │       └── Modal.tsx
│   │
│   └── hooks/                      # React hooks
│       ├── useLoops.ts             # Loops state
│       ├── useSSE.ts               # SSE connection
│       └── useLoop.ts              # Single loop
│
├── data/                           # Data root (Docker mountable)
│   ├── .gitkeep                    # Placeholder
│   ├── loops/                      # Loop configurations
│   │   └── .gitkeep
│   └── sessions/                   # Backend session mappings
│       └── .gitkeep
│
├── tests/                          # Test files
│   ├── setup.ts                    # Test utilities
│   ├── mocks/
│   │   └── mock-backend.ts         # Mock AgentBackend
│   ├── unit/                       # Unit tests
│   ├── api/                        # API integration tests
│   └── e2e/                        # End-to-end tests
│
├── .planning/                      # Planning docs
│   ├── plan.md                     # This document
│   └── status.md                   # Implementation status
│
└── [existing files...]
```

---

## 3. Data Models

### 3.1 Loop Configuration

```typescript
interface LoopConfig {
  id: string;                       // Unique identifier (UUID)
  name: string;                     // Human-readable name
  directory: string;                // Absolute path to working directory
  prompt: string;                   // The task prompt/PRD
  createdAt: string;                // ISO timestamp
  updatedAt: string;                // ISO timestamp
  
  // Backend configuration
  backend: {
    type: "opencode";               // Backend type (extensible)
    mode: "spawn" | "connect";      // Spawn new or connect to existing
    hostname?: string;              // For connect mode
    port?: number;                  // For connect mode
  };
  
  // Model configuration (optional - inherits from backend config)
  model?: {
    providerID: string;             // e.g., "anthropic"
    modelID: string;                // e.g., "claude-3-5-sonnet-20241022"
  };
  
  // Loop behavior
  maxIterations?: number;           // Optional iteration limit (default: unlimited)
  stopPattern: string;              // Regex for completion detection
                                    // Default: "<promise>COMPLETE</promise>$"
  
  // Git integration (default: enabled)
  git: {
    enabled: boolean;               // Default: true
    branchPrefix: string;           // Default: "ralph/"
    commitPrefix: string;           // Default: "[Ralph]"
  };
}
```

### 3.2 Loop State

```typescript
interface LoopState {
  id: string;                       // Same as config ID
  status: LoopStatus;               // Current status
  currentIteration: number;         // Current iteration count
  startedAt?: string;               // When loop was started
  completedAt?: string;             // When loop finished
  lastActivityAt?: string;          // Last event timestamp
  
  // Backend session info
  session?: {
    id: string;                     // Backend session ID
    serverUrl?: string;             // Backend server URL
  };
  
  // Error tracking
  error?: {
    message: string;
    iteration: number;
    timestamp: string;
  };
  
  // Git state (when git.enabled)
  git?: {
    originalBranch: string;         // Branch we started from
    workingBranch: string;          // Branch we created
    commits: GitCommit[];           // Commits made during loop
  };
  
  // Iteration history (last N for display)
  recentIterations: IterationSummary[];
}

type LoopStatus = 
  | "idle"            // Created but not started
  | "starting"        // Initializing backend connection
  | "running"         // Actively executing an iteration
  | "waiting"         // Between iterations
  | "paused"          // Manually paused
  | "completed"       // Successfully completed (stop pattern matched)
  | "stopped"         // Manually stopped
  | "failed"          // Error occurred
  | "max_iterations"; // Hit iteration limit

interface IterationSummary {
  iteration: number;
  startedAt: string;
  completedAt: string;
  messageCount: number;
  toolCallCount: number;
  outcome: "continue" | "complete" | "error";
}

interface GitCommit {
  iteration: number;
  sha: string;
  message: string;
  timestamp: string;
  filesChanged: number;
}
```

### 3.3 Loop Events

```typescript
type LoopEvent = 
  | { type: "loop.created"; loopId: string; config: LoopConfig }
  | { type: "loop.started"; loopId: string; iteration: number }
  | { type: "loop.iteration.start"; loopId: string; iteration: number }
  | { type: "loop.iteration.end"; loopId: string; iteration: number; outcome: string }
  | { type: "loop.message"; loopId: string; iteration: number; message: MessageData }
  | { type: "loop.tool_call"; loopId: string; iteration: number; tool: ToolCallData }
  | { type: "loop.progress"; loopId: string; iteration: number; content: string }
  | { type: "loop.git.commit"; loopId: string; iteration: number; commit: GitCommit }
  | { type: "loop.paused"; loopId: string }
  | { type: "loop.resumed"; loopId: string }
  | { type: "loop.completed"; loopId: string; totalIterations: number }
  | { type: "loop.stopped"; loopId: string; reason: string }
  | { type: "loop.error"; loopId: string; error: string; iteration: number }
  | { type: "loop.deleted"; loopId: string }
  | { type: "loop.accepted"; loopId: string; mergeCommit: string }
  | { type: "loop.discarded"; loopId: string };
```

---

## 4. Agent Backend Abstraction

### 4.1 Interface Definition

```typescript
// src/backends/types.ts
interface AgentBackend {
  readonly name: string;
  
  // Connection lifecycle
  connect(config: BackendConnectionConfig): Promise<void>;
  disconnect(): Promise<void>;
  isConnected(): boolean;
  
  // Session management
  createSession(options: CreateSessionOptions): Promise<AgentSession>;
  getSession(id: string): Promise<AgentSession | null>;
  deleteSession(id: string): Promise<void>;
  
  // Messaging
  sendPrompt(sessionId: string, prompt: PromptInput): Promise<AgentResponse>;
  sendPromptAsync(sessionId: string, prompt: PromptInput): Promise<void>;
  abortSession(sessionId: string): Promise<void>;
  
  // Events
  subscribeToEvents(sessionId: string): AsyncIterable<AgentEvent>;
}

interface BackendConnectionConfig {
  mode: "spawn" | "connect";
  hostname?: string;
  port?: number;
  directory: string;
}

interface AgentSession {
  id: string;
  title?: string;
  createdAt: string;
}

interface PromptInput {
  parts: PromptPart[];
  model?: { providerID: string; modelID: string };
}

interface AgentResponse {
  id: string;
  content: string;
  parts: AgentPart[];
  usage?: { inputTokens: number; outputTokens: number };
}

type AgentEvent = 
  | { type: "message.start"; messageId: string }
  | { type: "message.delta"; content: string }
  | { type: "message.complete"; content: string }
  | { type: "tool.start"; toolName: string; input: unknown }
  | { type: "tool.complete"; toolName: string; output: unknown }
  | { type: "error"; message: string };
```

### 4.2 Backend Registry

```typescript
// src/backends/registry.ts
class BackendRegistry {
  private backends = new Map<string, () => AgentBackend>();
  
  register(name: string, factory: () => AgentBackend): void;
  get(name: string): AgentBackend | undefined;
  list(): string[];
}

// Usage:
registry.register("opencode", () => new OpenCodeBackend());
// Future: registry.register("claude-code", () => new ClaudeCodeBackend());
```

---

## 5. Git Integration

### 5.1 Workflow

```
User starts loop on branch "main"
    │
    ▼
┌─────────────────────────────────────┐
│ 1. Create branch: ralph/{loop-id}   │  ◄── Only if git.enabled
│    (from current HEAD)              │
└─────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────┐
│ 2. Run iteration N                  │
│    AI makes changes to files        │
└─────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────┐
│ 3. Commit: "[Ralph] Iteration N"    │  ◄── Only if git.enabled
│    Include all changed files        │
└─────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────┐
│ 4. Check stop condition             │
│    - If not complete → goto 2       │
│    - If complete → mark done        │
└─────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────┐
│ 5. Loop complete                    │
│    Status: "completed"              │
│    Ready for review                 │
└─────────────────────────────────────┘
    │
    ▼ (User reviews and accepts)
┌─────────────────────────────────────┐
│ 6. Accept → Merge commit to main    │  ◄── Only if git.enabled
│    POST /api/loops/:id/accept       │
└─────────────────────────────────────┘
```

### 5.2 Uncommitted Changes Handling

When starting a loop with uncommitted changes:

1. API returns `409 Conflict` with:
   ```json
   {
     "error": "uncommitted_changes",
     "message": "Target directory has uncommitted changes",
     "options": ["commit", "stash", "cancel"],
     "changedFiles": ["src/foo.ts", "src/bar.ts"]
   }
   ```

2. Frontend shows modal with options:
   - **Commit changes**: Commits with "[Pre-Ralph] Uncommitted changes"
   - **Stash changes**: Stashes, restores after loop ends
   - **Cancel**: Don't start

3. User re-submits with `handleUncommitted` option

### 5.3 Git Service

```typescript
// src/core/git-service.ts
interface GitService {
  // Info
  isGitRepo(directory: string): Promise<boolean>;
  getCurrentBranch(directory: string): Promise<string>;
  hasUncommittedChanges(directory: string): Promise<boolean>;
  getChangedFiles(directory: string): Promise<string[]>;
  
  // Branch operations
  createBranch(directory: string, branchName: string): Promise<void>;
  checkoutBranch(directory: string, branchName: string): Promise<void>;
  deleteBranch(directory: string, branchName: string): Promise<void>;
  
  // Commit operations
  stageAll(directory: string): Promise<void>;
  commit(directory: string, message: string): Promise<string>; // returns SHA
  
  // Stash operations
  stash(directory: string): Promise<void>;
  stashPop(directory: string): Promise<void>;
  
  // Merge operations
  mergeBranch(directory: string, sourceBranch: string, targetBranch: string): Promise<string>;
  
  // Diff
  getDiff(directory: string, baseBranch: string): Promise<FileDiff[]>;
}
```

---

## 6. API Design

### 6.1 Loops CRUD

| Method | Path | Description | Request Body | Response |
|--------|------|-------------|--------------|----------|
| `GET` | `/api/loops` | List all loops | - | `Loop[]` |
| `POST` | `/api/loops` | Create new loop | `CreateLoopRequest` | `Loop` |
| `GET` | `/api/loops/:id` | Get loop details | - | `Loop` |
| `PATCH` | `/api/loops/:id` | Update loop config | `Partial<LoopConfig>` | `Loop` |
| `DELETE` | `/api/loops/:id` | Delete loop | - | `{ success: boolean }` |

### 6.2 Loop Control

| Method | Path | Description | Request Body | Response |
|--------|------|-------------|--------------|----------|
| `POST` | `/api/loops/:id/start` | Start execution | `{ handleUncommitted? }` | `{ success }` or `409` |
| `POST` | `/api/loops/:id/stop` | Stop execution | - | `{ success: boolean }` |
| `POST` | `/api/loops/:id/pause` | Pause loop | - | `{ success: boolean }` |
| `POST` | `/api/loops/:id/resume` | Resume paused | - | `{ success: boolean }` |
| `POST` | `/api/loops/:id/accept` | Merge branch | - | `{ success, mergeCommit }` |
| `POST` | `/api/loops/:id/discard` | Delete branch | - | `{ success: boolean }` |

### 6.3 Loop Data

| Method | Path | Description | Response |
|--------|------|-------------|----------|
| `GET` | `/api/loops/:id/messages` | Get messages | `Message[]` |
| `GET` | `/api/loops/:id/logs` | Get logs | `LogEntry[]` |
| `GET` | `/api/loops/:id/diff` | Get git diff | `FileDiff[]` |
| `GET` | `/api/loops/:id/plan` | Get plan.md | `{ content: string }` |
| `GET` | `/api/loops/:id/status-file` | Get status.md | `{ content: string }` |

### 6.4 Events (SSE)

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/events` | Global SSE stream |
| `GET` | `/api/loops/:id/events` | Single loop SSE stream |

### 6.5 System

| Method | Path | Description | Response |
|--------|------|-------------|----------|
| `GET` | `/api/health` | Health check | `{ healthy, version }` |

---

## 7. Frontend Design

### 7.1 Page Structure

```
App
├── Header (logo, navigation)
├── Main Content
│   ├── Dashboard View (/)
│   │   ├── LoopGrid
│   │   │   └── LoopCard (for each loop)
│   │   └── CreateLoopButton
│   │
│   └── Loop Detail View (/:id)
│       ├── LoopHeader (name, status, branch)
│       ├── LoopStats (iterations, commits)
│       ├── TabView
│       │   ├── Log Tab (real-time messages)
│       │   ├── Plan Tab (plan.md viewer)
│       │   ├── Status Tab (status.md viewer)
│       │   └── Diff Tab (changed files)
│       └── ActionBar (start, stop, accept, discard)
│
└── CreateLoopModal
```

### 7.2 Key Components

| Component | Purpose |
|-----------|---------|
| `Dashboard` | Grid of all loops with status |
| `LoopCard` | Summary card with quick actions |
| `LoopDetails` | Full detail view with tabs |
| `LogViewer` | Real-time streaming log |
| `CreateLoopForm` | New loop creation form |
| `DiffViewer` | Show git diff |

### 7.3 Hooks

```typescript
// Native SSE hook
function useSSE<T>(url: string) {
  const [events, setEvents] = useState<T[]>([]);
  const [status, setStatus] = useState<"connecting" | "open" | "closed">("connecting");
  
  useEffect(() => {
    const source = new EventSource(url);
    source.onopen = () => setStatus("open");
    source.onmessage = (e) => setEvents(prev => [...prev, JSON.parse(e.data)]);
    source.onerror = () => setStatus("closed");
    return () => source.close();
  }, [url]);
  
  return { events, status };
}
```

---

## 8. Data Directory

### 8.1 Structure

```
data/                           # SINGLE DATA ROOT
├── .gitkeep                    # Ensures dir exists
├── loops/                      # Loop configs + state
│   ├── .gitkeep
│   └── {loop-id}.json          # Combined config + state
└── sessions/                   # Backend session mappings
    ├── .gitkeep
    └── opencode.json           # Maps loop IDs → session IDs
```

### 8.2 Environment Configuration

```bash
# Override data directory location
RALPHER_DATA_DIR=/mnt/persistent/ralpher-data
```

### 8.3 Docker Usage

```yaml
services:
  ralpher:
    image: ralpher:latest
    volumes:
      - ralpher-data:/app/data
    environment:
      - RALPHER_DATA_DIR=/app/data

volumes:
  ralpher-data:
```

---

## 9. Implementation Phases

### Phase 1: Foundation (High Priority)

| Task | Description | Status |
|------|-------------|--------|
| 1.1 | Create data directory structure | Pending |
| 1.2 | Create type definitions (`src/types/*.ts`) | Pending |
| 1.3 | Implement persistence paths config | Pending |
| 1.4 | Implement SimpleEventEmitter | Pending |
| 1.5 | Create AgentBackend interface and registry | Pending |

### Phase 2: OpenCode Backend (High Priority)

| Task | Description | Status |
|------|-------------|--------|
| 2.1 | Install `@opencode-ai/sdk` | Pending |
| 2.2 | Implement OpenCodeBackend class | Pending |
| 2.3 | Implement spawn mode | Pending |
| 2.4 | Implement connect mode | Pending |
| 2.5 | Implement event subscription adapter | Pending |

### Phase 3: Loop Engine + Git (High Priority)

| Task | Description | Status |
|------|-------------|--------|
| 3.1 | Implement loop engine core | Pending |
| 3.2 | Implement iteration execution | Pending |
| 3.3 | Implement stop pattern detection | Pending |
| 3.4 | Implement loop manager | Pending |
| 3.5 | Implement GitService | Pending |
| 3.6 | Integrate git branch on start | Pending |
| 3.7 | Integrate git commit on iteration end | Pending |
| 3.8 | Implement accept/discard endpoints | Pending |

### Phase 4: API Layer (High Priority)

| Task | Description | Status |
|------|-------------|--------|
| 4.1 | Refactor `src/index.ts` for modular routes | Pending |
| 4.2 | Implement loops CRUD endpoints | Pending |
| 4.3 | Implement loop control endpoints | Pending |
| 4.4 | Implement SSE endpoint | Pending |
| 4.5 | Add health check endpoint | Pending |

### Phase 5: Frontend (Medium Priority)

| Task | Description | Status |
|------|-------------|--------|
| 5.1 | Implement useSSE hook | Pending |
| 5.2 | Implement useLoops hook | Pending |
| 5.3 | Create common UI components | Pending |
| 5.4 | Create Dashboard and LoopCard | Pending |
| 5.5 | Create LoopDetails with tabs | Pending |
| 5.6 | Create LogViewer | Pending |
| 5.7 | Create CreateLoopForm | Pending |
| 5.8 | Implement client-side routing | Pending |
| 5.9 | Add git info to UI | Pending |

### Phase 6: Testing & Polish (Medium Priority)

| Task | Description | Status |
|------|-------------|--------|
| 6.1 | Create test setup and mock backend | Pending |
| 6.2 | Write unit tests for core modules | Pending |
| 6.3 | Write API integration tests | Pending |
| 6.4 | Write E2E tests | Pending |
| 6.5 | Error handling and loading states | Pending |
| 6.6 | Documentation updates | Pending |

---

## 10. Testing Strategy

### 10.1 Test Structure

```
tests/
├── setup.ts                   # Test utilities
├── mocks/
│   └── mock-backend.ts        # Mock AgentBackend
├── unit/
│   ├── loop-engine.test.ts
│   ├── event-emitter.test.ts
│   ├── git-service.test.ts
│   └── persistence.test.ts
├── api/
│   ├── loops-crud.test.ts
│   ├── loops-control.test.ts
│   ├── loops-git.test.ts
│   ├── events-sse.test.ts
│   └── health.test.ts
└── e2e/
    └── full-loop.test.ts
```

### 10.2 Agent Verification Commands

```bash
# Run all tests
bun test

# Run specific test file
bun test tests/api/loops-crud.test.ts

# Run tests matching pattern
bun test --test-name-pattern "creates a new loop"

# Type check
bun x tsc --noEmit

# Build verification
bun run build
```

### 10.3 Test Coverage Checklist

| Component | Tests |
|-----------|-------|
| `POST /api/loops` | Creates loop, returns 201 |
| `GET /api/loops` | Returns array |
| `GET /api/loops/:id` | Returns loop or 404 |
| `PATCH /api/loops/:id` | Updates and persists |
| `DELETE /api/loops/:id` | Removes loop |
| `POST /api/loops/:id/start` | Changes status, creates branch |
| `POST /api/loops/:id/stop` | Aborts, updates status |
| `POST /api/loops/:id/accept` | Merges branch |
| `GET /api/events` | Streams via SSE |
| Loop iteration | Executes, checks stop |
| Git operations | Branch, commit, merge |
| Persistence | Save, load, list, delete |

---

## 11. Dependencies

### 11.1 New Dependencies

```json
{
  "dependencies": {
    "@opencode-ai/sdk": "latest"
  }
}
```

### 11.2 No External Event Library

Using native patterns:
- Backend: Simple EventEmitter class (~30 lines)
- Frontend: Native browser EventSource API

---

## 12. Verification Criteria

### 12.1 Functional

| ID | Requirement | Verification |
|----|-------------|--------------|
| F1 | Create loop via API | POST returns 201 |
| F2 | Start/stop loops | Status changes correctly |
| F3 | Loop iterates until complete | Reaches "completed" status |
| F4 | Respects maxIterations | Reaches "max_iterations" status |
| F5 | Connect to existing opencode | Loop executes |
| F6 | Spawn new opencode | Creates server |
| F7 | Git branch per loop | Branch exists |
| F8 | Git commit per iteration | Commits created |
| F9 | Git merge on accept | Merge commit exists |
| F10 | Events stream via SSE | Browser receives events |
| F11 | Persists across restarts | Loops restored |
| F12 | Web UI shows loops | Dashboard displays |
| F13 | Web UI real-time log | LogViewer updates |

### 12.2 Non-Functional

| ID | Requirement | Verification |
|----|-------------|--------------|
| N1 | TypeScript strict | `bun x tsc --noEmit` |
| N2 | Build succeeds | `bun run build` |
| N3 | Tests pass | `bun test` |
| N4 | Follows patterns | Code review |

---

## 13. Next Steps

1. Review and approve this plan
2. Begin Phase 1 implementation
3. Update `.planning/status.md` as work progresses
4. Run `bun test` after each phase

---

*This document is the source of truth for Ralph Loops Management System implementation.*
