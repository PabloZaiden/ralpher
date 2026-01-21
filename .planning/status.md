# Global Server Configuration - Implementation Status

## Current Phase: Not Started

## Task Status

### Phase 1: Backend Infrastructure

| # | Task | Status | Notes |
|---|------|--------|-------|
| 1 | Create settings types (`src/types/settings.ts`) | Pending | |
| 2 | Update preferences with serverSettings | Pending | |
| 3 | Create BackendManager singleton | Pending | |
| 4 | Create Settings API endpoints | Pending | |

### Phase 2: Update Existing Backend Logic

| # | Task | Status | Notes |
|---|------|--------|-------|
| 5 | Update Models API to use global backend | Pending | |
| 6 | Update LoopManager to use global backend | Pending | |
| 7 | Update LoopEngine to use global backend | Pending | |
| 8 | Initialize BackendManager on startup | Pending | |

### Phase 3: Update API and Types

| # | Task | Status | Notes |
|---|------|--------|-------|
| 9 | Remove BackendConfig from loop types | Pending | |
| 10 | Update CreateLoopRequest (remove backend) | Pending | |
| 11 | Update Loops API (remove backend parsing) | Pending | |
| 12 | Add SSE events for server status | Pending | |
| 13 | Register settings routes in api/index.ts | Pending | |

### Phase 4: Frontend UI

| # | Task | Status | Notes |
|---|------|--------|-------|
| 14 | Create useServerSettings hook | Pending | |
| 15 | Create ConnectionStatusBar component | Pending | |
| 16 | Create ServerSettingsModal component | Pending | |
| 17 | Update Dashboard with settings UI | Pending | |
| 18 | Update CreateLoopForm (remove backend options) | Pending | |

### Phase 5: Testing and Cleanup

| # | Task | Status | Notes |
|---|------|--------|-------|
| 19 | Update tests | Pending | |
| 20 | Run verification (tsc, build, test) | Pending | |

## Verification Checklist

- [ ] `bun x tsc --noEmit` - TypeScript passes
- [ ] `bun run build` - Build succeeds
- [ ] `bun run test` - All tests pass
- [ ] Manual test: Settings modal opens from gear icon
- [ ] Manual test: Can switch between spawn/connect modes
- [ ] Manual test: Connection status bar shows correct state
- [ ] Manual test: Models load correctly in remote mode
- [ ] Manual test: Create loop works without backend options
- [ ] Manual test: Loops run correctly with global server settings

## Next Steps

1. Start with Phase 1, Task 1: Create settings types

## Blockers

None currently.

## Notes

- No backward compatibility needed - old per-loop backend config will be removed entirely
- Settings persist across restarts via preferences.json
- Default mode is "spawn" (local server)
