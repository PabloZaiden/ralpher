# Command Execution Layer - Status

**Last Updated**: 2026-01-22

## Overview

The Command Execution Layer provides an abstraction for running shell commands and file operations that works in both spawn mode (local) and connect mode (remote via PTY+WebSocket).

## Current Status: ✅ COMPLETE

All planned features have been implemented.

---

## Phase 1: Core Infrastructure ✅

| Task | Status | Notes |
|------|--------|-------|
| Create CommandExecutor interface | ✅ Done | `src/core/command-executor.ts` |
| Implement LocalCommandExecutor | ✅ Done | Uses `Bun.$` and `Bun.file()` |
| Implement RemoteCommandExecutor | ✅ Done | PTY + WebSocket for output capture |
| Update GitService | ✅ Done | Accepts CommandExecutor via constructor |
| Update LoopManager | ✅ Done | Gets executor from BackendManager |
| Update BackendManager | ✅ Done | Returns mode-appropriate executor |
| Update OpenCodeBackend | ✅ Done | Exposes SDK client and directory |

---

## Phase 2: WebSocket PTY Output Capture ✅

| Task | Status | Notes |
|------|--------|-------|
| Research PTY WebSocket API | ✅ Done | `/pty/{id}/connect` endpoint |
| Implement WebSocket connection | ✅ Done | Full output capture |
| Handle authentication | ✅ Done | Basic auth via query param |
| Implement timeout handling | ✅ Done | Default 30s timeout |
| Implement error detection | ✅ Done | Heuristic pattern matching |
| SDK API optimizations | ✅ Done | Direct API for common git queries |

---

## Phase 3: API Routes ✅

| Task | Status | Notes |
|------|--------|-------|
| Update `/api/git/branches` | ✅ Done | Uses mode-appropriate executor |
| Update `/api/loops/:id/diff` | ✅ Done | Uses mode-appropriate git service |
| Update `/api/loops/:id/plan` | ✅ Done | Uses executor.readFile() |
| Update `/api/loops/:id/status-file` | ✅ Done | Uses executor.readFile() |
| Update `/api/check-planning-dir` | ✅ Done | Uses executor.directoryExists/listDirectory() |

---

## Phase 4: Testing ✅

| Task | Status | Notes |
|------|--------|-------|
| Build passes | ✅ Done | No TypeScript errors |
| Unit tests pass | ✅ Done | All 145 tests pass |
| Update test fixtures | ✅ Done | Removed gitService injection |

---

## Files Changed

### New Files
- `src/core/command-executor.ts` - Interface definitions
- `src/core/local-command-executor.ts` - Local implementation
- `src/core/remote-command-executor.ts` - Remote implementation with WebSocket

### Modified Files
- `src/core/git-service.ts` - Uses CommandExecutor
- `src/core/loop-manager.ts` - Dynamic executor per operation
- `src/core/backend-manager.ts` - Provides executor based on mode
- `src/backends/opencode/index.ts` - Exposes SDK client
- `src/api/git.ts` - Uses mode-appropriate git service
- `src/api/loops.ts` - Uses mode-appropriate executor for file ops
- `tests/setup.ts` - Test fixture updates
- `tests/unit/loop-manager.test.ts` - Test fixture updates

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
│  │              getCommandExecutor(directory)               │   │
│  └────────────────────────┬────────────────────────────────┘   │
│                           │                                      │
│         ┌─────────────────┼─────────────────┐                   │
│         ▼                                   ▼                   │
│  ┌──────────────────┐             ┌────────────────────┐        │
│  │LocalCommandExec  │             │RemoteCommandExec   │        │
│  │   (Bun.$)        │             │(PTY+WebSocket)     │        │
│  └──────────────────┘             └────────────────────┘        │
│         │                                   │                   │
│         ▼                                   ▼                   │
│    Local Files                       Remote Server              │
│    Local Git                         (via opencode)             │
└─────────────────────────────────────────────────────────────────┘
```

---

## RemoteCommandExecutor Flow

```
Command Execution (ALL commands go through PTY):
1. exec("git", ["checkout", "-b", "feature"])
   │
   └── Use PTY with WebSocket
       ├── 1. POST /pty (create session)
       ├── 2. Connect WebSocket to /pty/{id}/connect
       ├── 3. Collect output from message events
       ├── 4. Wait for close event
       ├── 5. Check for error patterns in output
       └── 6. DELETE /pty/{id} (cleanup)

File Operations:
- fileExists(path) → client.file.read() and check for error
- readFile(path) → client.file.read()
- directoryExists(path) → client.file.list() and check for error
- listDirectory(path) → client.file.list()
```

Note: We previously tried using SDK APIs (vcs.get, file.status) for common git queries,
but this caused issues because the SDK APIs have different semantics and error handling
than actual git commands. All git operations now go through PTY for consistency.

---

## Known Limitations

1. **Exit Code Detection**: PTY combines stdout/stderr and we use heuristic error detection instead of actual exit codes
2. **ANSI Escape Codes**: Output may contain terminal escape codes (not currently stripped)
3. **No Streaming**: Output is collected and returned as a whole, not streamed

---

## Future Improvements (Optional)

- [ ] End-to-end testing in Docker with real remote server
- [ ] PTY pooling for performance
- [ ] ANSI escape code stripping option
- [ ] Streaming output for long-running commands

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
