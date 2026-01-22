# SSE to WebSocket Migration Plan

## Goal

Replace Server-Sent Events (SSE) with WebSockets for real-time event streaming. This improves compatibility with authentication proxies (like Authentik) that don't handle SSE well.

## Why WebSockets?

1. **Better proxy compatibility**: WebSockets handle cookies/credentials naturally
2. **No buffering issues**: Proxies recognize WS protocol and don't buffer
3. **Bidirectional**: Enables future features like client-to-server commands
4. **Simpler reconnection**: Standard patterns, better browser support

## Current SSE Architecture

- **Server**: `src/api/events.ts` - SSE endpoints using `ReadableStream`
- **Server**: `src/core/event-emitter.ts` - Event pub/sub with `createSSEStream()`
- **Client**: `src/hooks/useSSE.ts` - React hook using fetch-based SSE
- **Endpoints**:
  - `GET /api/events` - Global event stream
  - `GET /api/loops/:id/events` - Loop-specific event stream

## New WebSocket Architecture

### Server Changes

1. **New file**: `src/api/websocket.ts` - WebSocket upgrade handler
2. **Update**: `src/index.ts` - Add WebSocket handler to Bun.serve()
3. **Update**: `src/core/event-emitter.ts` - Remove SSE stream creation (optional cleanup)
4. **Remove/Update**: `src/api/events.ts` - Remove SSE endpoints or keep for backwards compat

### Client Changes

1. **Update**: `src/hooks/useSSE.ts` → rename to `useEvents.ts` or keep name
2. Replace fetch-based SSE with native WebSocket API

### Endpoints

- `WS /api/ws` - Global WebSocket connection
- `WS /api/ws?loopId=<id>` - Optional loop filtering via query param

## Implementation Tasks

### Phase 1: Server WebSocket Support

- [ ] Create WebSocket handler in `src/api/websocket.ts`
- [ ] Integrate WebSocket handler with Bun.serve() in `src/index.ts`
- [ ] Subscribe WebSocket clients to event emitter
- [ ] Handle connection close/cleanup
- [ ] Support optional loopId query param for filtering

### Phase 2: Client WebSocket Support

- [ ] Update `src/hooks/useSSE.ts` to use WebSocket
- [ ] Implement reconnection logic with exponential backoff
- [ ] Handle connection status properly
- [ ] Maintain same hook API for minimal component changes

### Phase 3: Cleanup & Documentation

- [ ] Remove old SSE endpoints (or deprecate)
- [ ] Update `docs/API.md` with WebSocket documentation
- [ ] Update `README.md` quick reference
- [ ] Test with auth proxy (Authentik)

## Verification Criteria

1. WebSocket connects successfully through Authentik proxy
2. Cookies are sent with WebSocket upgrade request
3. Events stream correctly (loop created, started, messages, etc.)
4. Reconnection works after disconnect
5. Loop-specific filtering works
6. Build passes, no TypeScript errors

## Rollback Plan

If WebSocket doesn't work, revert to fetch-based SSE and investigate proxy configuration.
