# PTY Command Execution Cleanup Plan

**Created**: 2026-01-22
**Status**: In Progress

## Overview

After successfully implementing PTY-based remote command execution, we need to clean up the code, remove test artifacts, simplify the implementation, and unify the branch listing/validation logic for both spawn and connect modes.

## Goals

1. Remove unnecessary retry logic from command execution
2. Remove test button and API endpoint used for debugging
3. Add proper integration test for PTY command execution
4. Simplify `connectSendCommandAndCollectOutput` method
5. Remove debug logging added during troubleshooting
6. Unify branch listing and directory validation for spawn/connect modes

---

## Tasks

### Phase 1: Remove Test Artifacts

- [x] Remove `/api/test-pty` endpoint from `src/api/test-pty.ts`
- [x] Remove test-pty route from `src/api/index.ts`
- [x] Remove any UI button that triggers the test endpoint (if exists)

### Phase 2: Simplify Command Executor

- [x] Remove retry logic from `execViaPty` method (keep single attempt)
- [x] Simplify `connectSendCommandAndCollectOutput` - reduce code duplication
- [x] Remove excessive debug logging (keep essential logs)
- [x] Clean up the marker parsing logic

### Phase 3: Remove Debug Logging

**DECISION: Keep debug logging throughout the app for easier troubleshooting**

- [x] ~~Remove debug logs from `hasUncommittedChanges` in git-service.ts~~ (KEPT - useful for tracing)
- [x] ~~Remove verbose raw output logging from remote-command-executor.ts~~ (KEPT - useful for tracing)
- [x] ~~Remove debug console.logs from loop-engine.ts~~ (KEPT - useful for tracing)

### Phase 4: Add Integration Test

- [x] Create integration test for command execution (`tests/integration/command-executor.test.ts`)
- [x] Test exec method with simple commands (echo, ls)
- [x] Test git commands (status, branch, checkout)
- [x] Test file operations (fileExists, readFile, listDirectory)
- [x] Test marker parsing logic for PTY output extraction

### Phase 5: Unify Branch Listing/Validation

**Already unified - all code uses `backendManager.getCommandExecutorAsync(directory)`**

- [x] Check current implementation of branch listing API - uses `getCommandExecutorAsync`
- [x] Ensure it uses CommandExecutor for both modes - already unified
- [x] Check directory validation logic - uses same pattern
- [x] Unify any divergent code paths - no divergence found

### Phase 6: Final Cleanup

- [x] Update cleanup-plan.md with completed work
- [x] Run full test suite - 171 tests pass
- [x] Verify build passes

---

## Files to Modify

| File | Changes |
|------|---------|
| `src/api/test-pty.ts` | Delete entire file |
| `src/api/index.ts` | Remove test-pty import and route |
| `src/core/remote-command-executor.ts` | Remove retry logic, simplify marker parsing, remove debug logs |
| `src/core/git-service.ts` | Remove debug logging from hasUncommittedChanges |
| `src/core/loop-engine.ts` | Remove debug console.logs |
| `tests/integration/pty-execution.test.ts` | New file - integration test |
| `src/api/git.ts` | Check/unify branch listing |

---

## Progress

- [x] Phase 1: Remove Test Artifacts (Completed)
- [x] Phase 2: Simplify Command Executor (Completed)
- [x] Phase 3: Debug Logging (KEPT - decision to keep for traceability)
- [x] Phase 4: Add Integration Test (Completed)
- [x] Phase 5: Unify Branch Listing/Validation (Already unified)
- [x] Phase 6: Final Cleanup (Completed)
