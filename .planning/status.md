# Command Execution Layer - Status

**Last Updated**: 2026-01-22

## Overview

The Command Execution Layer provides an abstraction for running shell commands and file operations. All commands go through a PTY+WebSocket connection to the opencode server, regardless of whether it's local (spawn mode) or remote (connect mode).

## Current Status: ✅ COMPLETE (Unified Architecture)

All commands now go through a single `CommandExecutorImpl` that uses PTY+WebSocket. Commands are queued to ensure only one runs at a time, preventing server overload.

---

## Architecture Changes (Latest)

### Unified Command Execution
- **Removed `LocalCommandExecutor`** - No longer separate local vs remote execution
- **Renamed `RemoteCommandExecutor` to `CommandExecutorImpl`** - Single implementation for all modes
- **Added command queue** - Ensures only 1 command runs at a time
- All git operations and file commands go through PTY+WebSocket

### Key Components
| Component | Purpose |
|-----------|---------|
| `CommandExecutorImpl` | Single executor using PTY+WebSocket for all commands |
| `CommandExecutorConfig` | Configuration for the executor |
| Command Queue | Ensures sequential execution (one at a time) |

---

## Phase 1: Core Infrastructure ✅

| Task | Status | Notes |
|------|--------|-------|
| Create CommandExecutor interface | ✅ Done | `src/core/command-executor.ts` |
| Implement CommandExecutorImpl | ✅ Done | Uses PTY + WebSocket for all commands |
| Add command queue | ✅ Done | Only 1 command runs at a time |
| Update GitService | ✅ Done | Requires executor (no default) |
| Update LoopManager | ✅ Done | Gets executor from BackendManager |
| Update BackendManager | ✅ Done | Always uses CommandExecutorImpl |
| Update OpenCodeBackend | ✅ Done | Exposes SDK client and directory |

---

## Phase 2: WebSocket PTY Output Capture ✅

| Task | Status | Notes |
|------|--------|-------|
| Research PTY WebSocket API | ✅ Done | `/pty/{id}/connect` endpoint |
| Implement WebSocket connection | ✅ Done | Full output capture |
| Handle authentication | ✅ Done | Basic auth via headers |
| Implement timeout handling | ✅ Done | Default 30s timeout |
| Implement error detection | ✅ Done | Heuristic pattern matching |

---

## Phase 3: API Routes ✅

| Task | Status | Notes |
|------|--------|-------|
| Update `/api/git/branches` | ✅ Done | Uses mode-appropriate executor |
| Update `/api/loops/:id/diff` | ✅ Done | Optimized to 2 git calls |
| Update `/api/loops/:id/plan` | ✅ Done | Uses executor.readFile() |
| Update `/api/loops/:id/status-file` | ✅ Done | Uses executor.readFile() |
| Update `/api/check-planning-dir` | ✅ Done | Uses executor.directoryExists/listDirectory() |

---

## Phase 4: Testing ✅

| Task | Status | Notes |
|------|--------|-------|
| Build passes | ✅ Done | No TypeScript errors |
| Unit tests pass | ✅ Done | All 145 tests pass |
| TestCommandExecutor | ✅ Done | For tests only (uses Bun.$) |
| BackendManager test hooks | ✅ Done | setExecutorFactoryForTesting() |

---

## Files Changed

### New Files
- `src/core/command-executor.ts` - Interface definitions
- `src/core/remote-command-executor.ts` - CommandExecutorImpl (renamed from RemoteCommandExecutor)
- `tests/mocks/mock-executor.ts` - TestCommandExecutor for tests

### Removed Files
- `src/core/local-command-executor.ts` - No longer needed

### Modified Files
- `src/core/git-service.ts` - Requires executor (no default)
- `src/core/loop-manager.ts` - Gets executor via BackendManager
- `src/core/backend-manager.ts` - Always uses CommandExecutorImpl, test hooks
- `src/core/loop-engine.ts` - Requires gitService parameter
- `src/backends/opencode/index.ts` - Exposes SDK client
- `src/api/git.ts` - Uses mode-appropriate git service
- `src/api/loops.ts` - Uses mode-appropriate executor for file ops
- `tests/setup.ts` - Uses TestCommandExecutor
- `tests/unit/*.ts` - Updated for new architecture
- `tests/api/*.ts` - Updated for new architecture

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        API Layer                                │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────────┐  │
│  │ /api/git/*   │  │ /api/loops/* │  │ /api/check-planning  │  │
│  └──────┬───────┘  └──────┬───────┘  └──────────┬───────────┘  │
│         │                 │                      │              │
│         └─────────────────┼──────────────────────┘              │
│                           ▼                                      │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │                   BackendManager                         │   │
│  │              getCommandExecutorAsync(directory)          │   │
│  └────────────────────────┬────────────────────────────────┘   │
│                           │                                      │
│                           ▼                                      │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │                 CommandExecutorImpl                      │   │
│  │            (PTY + WebSocket + Command Queue)             │   │
│  └────────────────────────┬────────────────────────────────┘   │
│                           │                                      │
│                           ▼                                      │
│                   opencode Server                                │
│              (local spawn or remote connect)                     │
└─────────────────────────────────────────────────────────────────┘
```

---

## Command Queue Flow

```
exec("git status")  ─┐
                     │
exec("git diff")  ───┼──► Queue ──► Execute one at a time
                     │
exec("git log")   ───┘

1. Command added to queue
2. If not already executing, start processing
3. Execute command via PTY
4. Wait for completion
5. Process next in queue
```

---

## Reliability Improvements

1. **PTY Ready Delay**: Added 50ms delay after PTY creation before WebSocket connection to ensure the PTY is ready
2. **WebSocket Retry**: Added retry mechanism (up to 3 attempts with exponential backoff: 100ms, 200ms, 400ms) for transient WebSocket connection failures ("Expected 101 status code")

## Known Limitations

1. **Exit Code Detection**: PTY combines stdout/stderr and we use heuristic error detection
2. **ANSI Escape Codes**: Output may contain terminal escape codes
3. **No Streaming**: Output is collected and returned as a whole

---

## Verification Commands

```bash
# Build
bun run build

# Run tests
bun run test
```

---

## Related Documents

- [command-executor-design.md](./command-executor-design.md) - Design document
