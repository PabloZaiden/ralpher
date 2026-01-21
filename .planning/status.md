# Global Server Configuration - Implementation Status

## Current Phase: Phase 4 Complete - All Phases Done

## Summary

The global server configuration feature is **complete**. OpenCode server settings are now a **global Ralpher-wide setting** instead of per-loop configuration. All phases (1-5) are implemented and all tests pass.

## Task Status

### Phase 1: Backend Infrastructure - COMPLETE

| # | Task | Status | Notes |
|---|------|--------|-------|
| 1 | Create settings types (`src/types/settings.ts`) | Done | Created `ServerSettings`, `ConnectionStatus`, `ServerMode` types |
| 2 | Update preferences with serverSettings | Done | Added `serverSettings` field, `getServerSettings()`, `setServerSettings()` |
| 3 | Create BackendManager singleton | Done | Created `src/core/backend-manager.ts` with full connection management |
| 4 | Create Settings API endpoints | Done | Created `src/api/settings.ts` with GET/PUT settings, status, test endpoints |

### Phase 2: Update Existing Backend Logic - COMPLETE

| # | Task | Status | Notes |
|---|------|--------|-------|
| 5 | Update Models API to use global backend | Done | Uses `backendManager.getSettings()` |
| 6 | Update LoopManager to use global backend | Done | Removed backend options from `CreateLoopOptions`, uses `backendManager.getBackend()` |
| 7 | Update LoopEngine to use global backend | Done | Uses `backendManager.getSettings()` in `setupSession()` |
| 8 | Initialize BackendManager on startup | Done | Added `backendManager.initialize()` in `src/index.ts` |

### Phase 3: Update API and Types - COMPLETE

| # | Task | Status | Notes |
|---|------|--------|-------|
| 9 | Remove BackendConfig from loop types | Done | Removed `BackendConfig` interface and `backend` from `LoopConfig` |
| 10 | Update CreateLoopRequest (remove backend) | Done | Removed `backend` property from request type |
| 11 | Update Loops API (remove backend parsing) | Done | Removed backend-related code from loops.ts |
| 12 | Add SSE events for server status | Done | Server events already defined in backend-manager.ts |
| 13 | Register settings routes in api/index.ts | Done | Completed as part of Phase 1 |

### Phase 4: Frontend UI - COMPLETE

| # | Task | Status | Notes |
|---|------|--------|-------|
| 14 | Create useServerSettings hook | Done | Hook at `src/hooks/useServerSettings.ts` |
| 15 | Create ConnectionStatusBar component | Done | Component at `src/components/ConnectionStatusBar.tsx` |
| 16 | Create ServerSettingsModal component | Done | Component at `src/components/ServerSettingsModal.tsx` |
| 17 | Update Dashboard with settings UI | Done | Added status bar and modal to Dashboard |
| 18 | Update CreateLoopForm (remove backend options) | Done | Removed backend mode selection from form |

### Phase 5: Testing and Cleanup - COMPLETE (for current scope)

| # | Task | Status | Notes |
|---|------|--------|-------|
| 19 | Update tests | Done | Fixed all tests, added test helpers to BackendManager |
| 20 | Run verification (tsc, build, test) | Done | All 144 tests pass |

## Verification Checklist

- [x] `bun x tsc --noEmit` - TypeScript passes (0 errors)
- [x] `bun run build` - Build succeeds
- [x] `bun run test` - All 144 tests pass
- [ ] Manual test: Settings modal opens from gear icon
- [ ] Manual test: Can switch between spawn/connect modes
- [ ] Manual test: Connection status bar shows correct state
- [ ] Manual test: Models load correctly in remote mode
- [x] Manual test: Create loop works without backend options
- [x] Manual test: Loops run correctly with global server settings

## Files Created

| File | Purpose |
|------|---------|
| `src/types/settings.ts` | ServerSettings, ConnectionStatus types |
| `src/core/backend-manager.ts` | Global backend connection management |
| `src/api/settings.ts` | Settings REST endpoints |
| `src/hooks/useServerSettings.ts` | React hook for server settings state |
| `src/components/ConnectionStatusBar.tsx` | Status indicator in Dashboard header |
| `src/components/ServerSettingsModal.tsx` | Modal for configuring server settings |

## Files Modified

| File | Changes |
|------|---------|
| `src/persistence/preferences.ts` | Added serverSettings, getter/setter functions |
| `src/api/index.ts` | Added settings routes |
| `src/api/models.ts` | Uses backendManager for server mode |
| `src/api/loops.ts` | Removed backend options from create |
| `src/core/loop-manager.ts` | Uses backendManager.getBackend() |
| `src/core/loop-engine.ts` | Uses backendManager.getSettings() |
| `src/types/loop.ts` | Removed BackendConfig, backend from LoopConfig |
| `src/types/api.ts` | Removed backend from CreateLoopRequest |
| `src/index.ts` | Initializes backendManager on startup |
| `src/components/CreateLoopForm.tsx` | Removed backend mode UI |
| `src/components/Dashboard.tsx` | Added ConnectionStatusBar and ServerSettingsModal |
| `src/hooks/index.ts` | Added export for useServerSettings |
| `tests/setup.ts` | Added backendManager test helpers |
| `tests/e2e/full-loop.test.ts` | Removed backend assertions |
| `tests/unit/loop-engine.test.ts` | Removed backend from test config |
| `tests/unit/loop-manager.test.ts` | Removed backend assertions |

## Important Notes

- **BackendManager** is a singleton exported as `backendManager` from `src/core/backend-manager.ts`
- **BackendManager.initialize()** is called on startup to load settings from preferences
- **Settings persist** via `preferences.json` using `getServerSettings()`/`setServerSettings()`
- **Default mode is "spawn"** (local server)
- **Test helpers** `setBackendForTesting()` and `resetForTesting()` allow injecting mock backends

## Next Steps (Manual Testing)

All automated phases are complete. The following manual testing steps remain:

1. Start the application with `bun run dev`
2. Verify the ConnectionStatusBar appears in the Dashboard header (next to "Ralph Loops" title)
3. Click the status bar to open the ServerSettingsModal
4. Test switching between "Spawn Local Server" and "Connect to Existing Server" modes
5. In connect mode, test the "Test Connection" button
6. Save settings and verify they persist after page refresh

## Implementation Complete

The global server configuration feature is fully implemented with:
- Backend: BackendManager singleton manages all server connections
- API: Settings endpoints for GET/PUT settings, status, and test
- Frontend: ConnectionStatusBar shows current status, ServerSettingsModal for configuration
- Persistence: Settings saved to preferences.json

## API Reference

### Settings Endpoints

```
GET  /api/settings/server        - Get current server settings
PUT  /api/settings/server        - Update server settings
GET  /api/settings/server/status - Get current connection status
POST /api/settings/server/test   - Test connection with provided settings
```

### Settings Request/Response

```typescript
// GET/PUT /api/settings/server
interface ServerSettings {
  mode: "spawn" | "connect";
  hostname?: string;  // For connect mode
  port?: number;      // For connect mode (default: 4096)
}

// GET /api/settings/server/status
interface ConnectionStatus {
  connected: boolean;
  mode: "spawn" | "connect";
  serverUrl?: string;
  error?: string;
}
```
