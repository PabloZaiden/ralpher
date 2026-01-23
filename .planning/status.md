# Command Execution Layer - Status

**Last Updated**: 2026-01-22

## Overview

The Command Execution Layer provides an abstraction for running shell commands and file operations. All commands go through a PTY+WebSocket connection to the opencode server, regardless of whether it's local (spawn mode) or remote (connect mode).

## Current Status: ✅ COMPLETE (Unified Architecture + SDK v2 Migration)

All commands now go through a single `CommandExecutorImpl` that uses PTY+WebSocket. Commands are queued to ensure only one runs at a time, preventing server overload.

---

## SDK v2 Migration (2026-01-22) ✅

All opencode SDK imports have been migrated from `@opencode-ai/sdk` to `@opencode-ai/sdk/v2`.

### Key Changes

**v1 API style** (old):
```typescript
client.pty.get({ path: { id: ptyId }, query: { directory } })
client.file.read({ query: { directory, path } })
```

**v2 API style** (new):
```typescript
client.pty.get({ ptyID: ptyId, directory })
client.file.read({ directory, path })
```

### Files Updated for v2

| File | Changes |
|------|---------|
| `src/backends/opencode/index.ts` | All session, event, provider calls use v2 flattened params |
| `src/core/remote-command-executor.ts` | All pty and file calls use v2 (`ptyID`, flattened params) |
| `src/api/test-pty.ts` | `project.current()` call uses v2 style |

### Verification

- Build passes with no TypeScript errors
- All 145 tests pass

---

## Architecture Changes (Previous)

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

1. **Non-interactive execution**: Commands are prefixed with environment variables to disable pagers and prompts:
   - `GIT_PAGER=cat` - Disable git's pager (less)
   - `GIT_TERMINAL_PROMPT=0` - Disable git credential prompts
   - `PAGER=cat` - Disable general pager
   - `TERM=dumb` - Tell programs we're not on an interactive terminal

2. **Directory parameter in WebSocket URL**: The `directory` query parameter is now included in WebSocket URLs to ensure the server uses the correct Instance context.

## Known Limitations

1. **Exit Code Detection**: PTY combines stdout/stderr; we use an exit marker to capture actual exit code
2. **ANSI Escape Codes**: Output may contain terminal escape codes
3. **No Streaming**: Output is collected and returned as a whole

---

## PTY WebSocket "Session not found" Error - RESOLVED

**Issue**: When running in Docker (connect mode), PTY WebSocket connections fail with "Session not found" error.

**Root Causes Found (2026-01-22)**:

1. **PTY closing before WebSocket connect**: The PTY was being created with the command directly, causing it to run and exit immediately before the WebSocket connection could be established.

2. **Missing `directory` parameter in PTY API calls**: The `pty.create()` and `pty.remove()` calls were missing the `directory` parameter, which is required for the opencode server to scope the PTY to the correct Instance context.

### The Fix

**Issue 1 Fix - Create shell without command:**
```typescript
// Old (broken): Command runs immediately and PTY closes
await client.pty.create({ command, args, cwd, title });

// New (correct): Create persistent shell, send command via WebSocket
await client.pty.create({ directory, cwd, title });
ws.onopen = () => ws.send(`${command}; echo "${marker}:$?"\n`);
```

**Issue 2 Fix - Add directory parameter:**
```typescript
// pty.create() - needs directory for Instance scoping
await client.pty.create({
  directory: this.directory,  // Required!
  cwd,
  title: `ralpher-cmd-${Date.now()}`,
});

// pty.remove() - also needs directory
await client.pty.remove({
  ptyID: ptyId,
  directory: this.directory,  // Required!
});
```

### How It Works Now

1. **Create PTY shell** - Pass `directory`, `cwd`, and `title`. The `directory` scopes to the Instance, `cwd` is where the shell runs.
2. **Connect via WebSocket** - URL includes `?directory=...` query param for Instance scoping.
3. **Set clean environment** - Disable shell prompts (`PS1=""`, `PS2=""`) and pagers.
4. **Use start/end markers** - Echo unique START marker, run command, capture exit code, echo END marker with exit code.
5. **Extract clean output** - Parse only the content between START and END markers, ignoring all shell noise.
6. **Cleanup** - Close WebSocket and remove PTY session (with `directory` param).

### Command Execution Pattern

```typescript
// The full command sent via WebSocket:
const fullCommand = [
  'PS1=""',           // Disable primary prompt
  'PS2=""',           // Disable secondary prompt
  "GIT_PAGER=cat",    // Disable git pager
  "GIT_TERMINAL_PROMPT=0",  // Disable git credential prompts
  "PAGER=cat",        // Disable general pager
  "TERM=dumb",        // Non-interactive terminal
  `echo "${startMarker}"`,  // Unique start marker
  `${command} ${args}`,     // The actual command
  `__ec=$?; echo "${endMarker}:$__ec"`,  // End marker with exit code
].join("; ");
```

This ensures:
- No shell prompts pollute the output
- No pagers wait for input
- Output is cleanly delimited between markers
- Exit code is reliably captured

### Files Changed

- `src/core/remote-command-executor.ts`:
  - Added `directory: this.directory` to `pty.create()` call (line ~196)
  - Added `directory: this.directory` to `pty.remove()` call (line ~245)
  - Removed `command` and `args` from `pty.create()` call
  - Renamed `connectAndCollectOutput` to `connectSendCommandAndCollectOutput`
  - **Added clean shell environment** (`PS1=""`, `PS2=""`, etc.)
  - **Added start/end marker pattern** for clean output parsing
  - Added `shellEscape()` helper for proper argument quoting
  - Added exit code parsing from end marker output
  - Added `directory` query parameter to WebSocket URL
  - Added environment variables prefix to disable pagers/prompts

---

## Verification Commands

```bash
# Build
bun run build

# Run tests
bun run test

# Test in Docker
docker build -t ralpher .
docker run --rm -p 8080:80 \
  -e OPENCODE_URL=http://host:4096 \
  -e OPENCODE_AUTH_TOKEN=your-token \
  ralpher
```

---

## Related Documents

- [command-executor-design.md](./command-executor-design.md) - Design document
