# Global Server Configuration Feature

## Overview

Make the OpenCode server selection a global Ralpher-wide setting instead of a per-loop configuration.

## Problem Statement

Currently, the server connection mode (spawn local vs connect to existing) is configured per-loop in the "Create Loop" form. This has several issues:

1. **Inconsistent experience**: Each loop can use a different server, which is confusing
2. **Remote server limitation**: When connecting to a remote server, model discovery fails because it tries to spawn a local server to fetch models
3. **No visibility**: There's no indication of current server status in the dashboard
4. **Repeated configuration**: Users must configure hostname/port for each loop

## Goals

1. Make server selection a global Ralpher-wide setting
2. Add a settings panel/modal accessible from a gear icon in the dashboard
3. Show connection status indicator (status bar) in the dashboard
4. Remove per-loop backend configuration from the create loop form and API
5. Fetch models from the configured server (local spawn or remote)
6. Persist settings across Ralpher restarts

## Solution Design

### Architecture Overview

```
+-------------------------------------------------------------------+
|                         DASHBOARD                                  |
+-------------------------------------------------------------------+
|  +-----------------+  +----------------------------------------+  |
|  | Settings Icon   |  | Status Bar: "Connected to remote"     |  |
|  | (gear icon)     |  | or "Using local server"                |  |
|  +--------+--------+  +----------------------------------------+  |
|           |                                                        |
|           v                                                        |
|  +---------------------------------------------------------------+ |
|  |                  SETTINGS MODAL                               | |
|  |  Server Mode: ( ) Spawn local  (*) Connect to existing       | |
|  |  Hostname: [remote-server.example.com]                        | |
|  |  Port:     [4096]                                             | |
|  |  Status: OK Connected                                         | |
|  |  [Test Connection]  [Save]  [Cancel]                          | |
|  +---------------------------------------------------------------+ |
+-------------------------------------------------------------------+
```

### Key Components

| Component | Description |
|-----------|-------------|
| `ServerSettings` type | Mode (spawn/connect), hostname, port |
| `ConnectionStatus` type | connected, mode, serverUrl, error |
| `BackendManager` | Singleton managing global backend connection |
| Settings API | `/api/settings/server/*` endpoints |
| `ServerSettingsModal` | UI modal for server configuration |
| `ConnectionStatusBar` | Status bar showing connection state |
| `useServerSettings` hook | React hook for settings state |

### New API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/settings/server` | GET | Get current server settings |
| `/api/settings/server` | PUT | Update server settings |
| `/api/settings/server/status` | GET | Get connection status |
| `/api/settings/server/test` | POST | Test connection with provided settings |

## Implementation Tasks

### Phase 1: Backend Infrastructure

| # | Task | Files | Description |
|---|------|-------|-------------|
| 1 | Create settings types | `src/types/settings.ts` (new) | `ServerSettings` and `ConnectionStatus` interfaces |
| 2 | Update preferences | `src/persistence/preferences.ts` | Add `serverSettings` field, add getter/setter functions |
| 3 | Create BackendManager | `src/core/backend-manager.ts` (new) | Singleton managing global connection: `initialize()`, `connect()`, `disconnect()`, `updateSettings()`, `testConnection()`, `getStatus()`, `getBackend()` |
| 4 | Create Settings API | `src/api/settings.ts` (new) | GET/PUT `/api/settings/server`, GET `/api/settings/server/status`, POST `/api/settings/server/test` |

### Phase 2: Update Existing Backend Logic

| # | Task | Files | Description |
|---|------|-------|-------------|
| 5 | Update Models API | `src/api/models.ts` | Use global BackendManager; for remote mode, fetch models via remote API |
| 6 | Update LoopManager | `src/core/loop-manager.ts` | Use global backend; remove `backendMode`, `backendHostname`, `backendPort` from `CreateLoopOptions` |
| 7 | Update LoopEngine | `src/core/loop-engine.ts` | Get backend from global manager; remove per-loop connection logic |
| 8 | Initialize on startup | `src/index.ts` | Import and initialize BackendManager |

### Phase 3: Update API and Types

| # | Task | Files | Description |
|---|------|-------|-------------|
| 9 | Remove BackendConfig from loop types | `src/types/loop.ts` | Remove `BackendConfig` interface, remove `backend` from `LoopConfig`, update `DEFAULT_LOOP_CONFIG` |
| 10 | Update CreateLoopRequest | `src/types/api.ts` | Remove `backend` field |
| 11 | Update Loops API | `src/api/loops.ts` | Remove backend parsing from request |
| 12 | Add SSE events | `src/types/events.ts`, `src/core/event-emitter.ts` | Add `server.connected`, `server.disconnected`, `server.error` events |
| 13 | Register routes | `src/api/index.ts` | Add settings routes |

### Phase 4: Frontend UI

| # | Task | Files | Description |
|---|------|-------|-------------|
| 14 | Create useServerSettings hook | `src/hooks/useServerSettings.ts` (new) | Fetch/update settings, subscribe to SSE status events |
| 15 | Create ConnectionStatusBar | `src/components/ConnectionStatusBar.tsx` (new) | Show connection mode and status, clickable to open settings |
| 16 | Create ServerSettingsModal | `src/components/ServerSettingsModal.tsx` (new) | Form with mode radio, hostname/port inputs, test button, save/cancel |
| 17 | Update Dashboard | `src/components/Dashboard.tsx` | Add gear icon, ConnectionStatusBar, ServerSettingsModal |
| 18 | Update CreateLoopForm | `src/components/CreateLoopForm.tsx` | Remove `backendMode`, `hostname`, `port` state and UI |

### Phase 5: Testing and Cleanup

| # | Task | Files | Description |
|---|------|-------|-------------|
| 19 | Update tests | `tests/unit/*.test.ts`, `tests/api/*.test.ts` | Remove backend config from loop tests, add BackendManager tests, add settings API tests |
| 20 | Run verification | - | `bun x tsc --noEmit`, `bun run build`, `bun run test` |

## New Files (6)

| File | Purpose |
|------|---------|
| `src/types/settings.ts` | ServerSettings, ConnectionStatus types |
| `src/core/backend-manager.ts` | Global backend connection management |
| `src/api/settings.ts` | Settings REST endpoints |
| `src/hooks/useServerSettings.ts` | React hook for settings |
| `src/components/ConnectionStatusBar.tsx` | Status bar UI |
| `src/components/ServerSettingsModal.tsx` | Settings modal UI |

## Modified Files (13)

| File | Changes |
|------|---------|
| `src/persistence/preferences.ts` | Add serverSettings |
| `src/types/loop.ts` | Remove BackendConfig, remove backend from LoopConfig |
| `src/types/api.ts` | Remove backend from CreateLoopRequest |
| `src/types/events.ts` | Add server status events |
| `src/api/index.ts` | Add settings routes |
| `src/api/loops.ts` | Remove backend parsing |
| `src/api/models.ts` | Use global backend |
| `src/core/loop-manager.ts` | Use global backend |
| `src/core/loop-engine.ts` | Use global backend |
| `src/core/event-emitter.ts` | Add server events |
| `src/index.ts` | Initialize BackendManager |
| `src/components/Dashboard.tsx` | Add settings UI |
| `src/components/CreateLoopForm.tsx` | Remove backend options |

## Design Decisions

1. **Warning on mode switch while loops running**: Yes, show warning but allow switch
2. **Settings take effect immediately**: Yes
3. **Default mode**: `spawn` (local)
4. **Connection health**: Check on connect, report errors only when operations fail
5. **No local path checks for remote directories**: Only validate via API if available
6. **No backward compatibility needed**: Old per-loop backend config can be safely removed
