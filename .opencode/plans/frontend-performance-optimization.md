# Frontend Performance Optimization Plan

**Created**: 2026-02-04  
**Status**: Ready for Implementation

## Problem Statement

The frontend dashboard experiences severe performance issues:

1. **Input Lag**: Typing in textboxes triggers expensive re-renders of all accumulated logs/messages
2. **Memory Consumption**: Long-running loops accumulate thousands of log entries, causing high memory usage
3. **Mobile Auto-Refresh**: Excessive memory/power consumption triggers browser auto-refresh on mobile devices
4. **Mobile UI**: Model dropdown takes too much horizontal space, compressing the message input field

## User Requirements (from feedback)

> "Right now, the biggest issue is the every keystroke thing and that typing triggers expensive re-computation. Then continue with logviewer virtualization. I do need to have access to all the logs, but minimize how much memory the whole thing consumes, so don't cap it. Also, make sure that, for instance, if the loop detail screen for a loop is not open, we should not keep any of its data in memory."

### Key Constraints

- ✅ **DO NOT** cap log history - users need full access
- ✅ **DO** optimize memory consumption through virtualization
- ✅ **DO** release loop data when LoopDetails component unmounts
- ✅ **DO** fix expensive re-computation on every keystroke

## Root Cause Analysis

### 1. Expensive Re-renders on Keystroke

**Problem**: 
- Every character typed triggers parent component re-render
- Child components (LogViewer, TodoViewer) don't have memoization
- They re-render even when their props haven't changed
- Rendering thousands of log entries is expensive

**Evidence**:
- `src/components/LogViewer.tsx`: No React.memo() wrapper
- `src/components/TodoViewer.tsx`: No React.memo() wrapper
- Input handlers (`onChange={e => setValue(e.target.value)}`) trigger immediate state updates

### 2. No Virtualization

**Problem**:
- LogViewer renders ALL log entries as DOM nodes (src/components/LogViewer.tsx)
- With 1000+ entries, this creates thousands of DOM nodes
- Browser must paint/layout all nodes on every render

**Evidence**:
- Lines render messages, tool calls, and logs sequentially without windowing
- No use of virtual scrolling libraries

### 3. Memory Not Released

**Problem**:
- `useLoop` hook maintains state even when LoopDetails is not rendered
- Dashboard maintains reference to loops array globally
- No cleanup when navigating away from a loop

**Evidence**:
- `src/hooks/useLoop.ts`: Sets state that persists even after component unmount
- `src/hooks/useLoops.ts`: Maintains full loops array in memory
- WebSocket connections may stay active

### 4. Mobile Layout Issues

**Problem**:
- Model dropdown (`src/components/LoopActionBar.tsx:206`) uses `w-auto` with no max-width
- Can expand to accommodate long model names
- Compresses message input to unusable width on small screens

## Solution Architecture

### Strategy 1: Prevent Unnecessary Re-renders (HIGH PRIORITY)

**Goal**: Make typing responsive by preventing expensive child re-renders

**Approach**:
1. Wrap `LogViewer` and `TodoViewer` with `React.memo()`
2. Ensure prop references are stable (use `useCallback` for functions)
3. Consider debouncing input handlers (only update state every 100ms)

**Impact**: 
- Typing becomes instant (no lag)
- Re-renders only happen when logs actually change
- 90% of performance issue resolved

### Strategy 2: Add Virtualization (HIGH PRIORITY)

**Goal**: Render only visible log entries to minimize DOM nodes and memory

**Approach**:
1. Install `react-window` or `react-virtualized` library
2. Modify `LogViewer` to use virtual list
3. Render only visible + buffer rows (e.g., 50-100 visible rows out of 10,000 total)
4. Keep full data array in memory, but only create DOM nodes for visible items

**Impact**:
- Dramatically reduces DOM node count (100 visible vs 10,000 total)
- Lower memory pressure on mobile browsers
- Smooth scrolling even with large logs

### Strategy 3: Memory Management (HIGH PRIORITY)

**Goal**: Release loop data when not actively viewing it

**Approach**:
1. Modify `useLoop` hook to cleanup on unmount
   - Disconnect WebSocket
   - Clear state arrays
2. Dashboard should NOT maintain detailed loop data
   - Only keep minimal info (id, name, status, iteration count)
   - Fetch full details only when LoopDetails opens

**Impact**:
- Memory usage scales with number of OPEN loops, not total loops
- If you have 50 loops but only view 1, memory = 1 loop's data
- Prevents memory leaks over time

### Strategy 4: Mobile Layout Fix (MEDIUM PRIORITY)

**Goal**: Ensure message input gets adequate space on mobile

**Approach**:
1. Add `max-w-[120px] sm:max-w-none` to model dropdown
2. Change to `w-28 sm:w-32 md:w-48 flex-shrink-0`
3. Ensure input uses `flex-1 min-w-0` to take remaining space

**Impact**:
- Model dropdown: ~28% of space on mobile (120px / 375px)
- Message input: ~70% of space (sufficient for typing)
- Better mobile UX

## Implementation Plan

### Task 1: Memoize Heavy Components

**Priority**: 🔴 Critical (fixes input lag)

**Files**:
- `src/components/LogViewer.tsx`
- `src/components/TodoViewer.tsx`

**Changes**:
```typescript
// LogViewer.tsx
import { memo } from "react";

export const LogViewer = memo(function LogViewer({
  messages,
  toolCalls,
  logs,
  showDebugLogs,
  autoScroll,
  maxHeight,
  id,
}: LogViewerProps) {
  // ... existing code
});

// TodoViewer.tsx
export const TodoViewer = memo(function TodoViewer({
  todos,
  id,
}: TodoViewerProps) {
  // ... existing code
});
```

**Testing**:
- Type in LoopActionBar message input
- Verify: No lag, instant keystroke response
- Verify: LogViewer only re-renders when messages/logs change

---

### Task 2: Add Debouncing to Input Handlers (Optional Enhancement)

**Priority**: 🟡 Medium (nice-to-have, not required if memo works)

**Files**:
- `src/components/LoopActionBar.tsx`
- `src/components/AddressCommentsModal.tsx`
- `src/components/PlanReviewPanel.tsx`

**Approach**:
- Use `useMemo` + `debounce` (from lodash or custom implementation)
- Delay state updates by 50-100ms
- Only if Task 1 doesn't fully resolve the lag

---

### Task 3: Add Virtualization to LogViewer

**Priority**: 🔴 Critical (reduces memory pressure)

**Files**:
- `src/components/LogViewer.tsx`
- `package.json` (add `react-window` dependency)

**Steps**:
1. Install library: `bun add react-window @types/react-window`
2. Replace flat list with `<VariableSizeList>` or `<FixedSizeList>`
3. Implement row renderer function
4. Calculate row heights (or use fixed height estimate)
5. Maintain auto-scroll behavior
6. Keep filter logic (showDebugLogs) intact

**Example Structure**:
```typescript
import { FixedSizeList as List } from 'react-window';

// Flatten all items into single array with type markers
const items = [
  ...messages.map(m => ({ type: 'message', data: m })),
  ...toolCalls.map(tc => ({ type: 'toolCall', data: tc })),
  ...logs.filter(/* debug filter */).map(l => ({ type: 'log', data: l })),
];

// Sort by timestamp
const sortedItems = items.sort((a, b) => a.data.timestamp - b.data.timestamp);

// Row renderer
const Row = ({ index, style }) => {
  const item = sortedItems[index];
  return (
    <div style={style}>
      {item.type === 'message' && <MessageEntry message={item.data} />}
      {item.type === 'toolCall' && <ToolCallEntry toolCall={item.data} />}
      {item.type === 'log' && <LogEntry log={item.data} />}
    </div>
  );
};

// List component
return (
  <List
    height={600}
    itemCount={sortedItems.length}
    itemSize={60} // Estimate, can be variable
    width="100%"
  >
    {Row}
  </List>
);
```

**Challenges**:
- Auto-scroll: Use `scrollToItem` when new items arrive
- Variable heights: Messages can be multi-line
- Interleaving: Messages, tool calls, logs need proper sorting

**Testing**:
- Load loop with 10,000+ log entries
- Verify: Only ~50-100 DOM nodes rendered (check DevTools)
- Verify: Smooth scrolling
- Verify: Memory usage is reasonable

---

### Task 4: Memory Management - Cleanup on Unmount

**Priority**: 🔴 Critical (prevents memory leaks)

**Files**:
- `src/hooks/useLoop.ts`
- Potentially `src/hooks/useWebSocket.ts`

**Changes in `useLoop.ts`**:
```typescript
export function useLoop(loopId: string): UseLoopResult {
  // ... existing state

  // Add cleanup effect
  useEffect(() => {
    return () => {
      // Clear all state on unmount
      setLoop(null);
      setMessages([]);
      setToolCalls([]);
      setLogs([]);
      setTodos([]);
      // WebSocket cleanup is handled by useLoopEvents hook
    };
  }, [loopId]);

  // ... rest of code
}
```

**Changes in `useWebSocket.ts`** (if needed):
- Ensure WebSocket connection is properly closed on unmount
- Verify cleanup function is working

**Testing**:
1. Open LoopDetails for a loop
2. Open Chrome DevTools → Memory → Take Heap Snapshot
3. Close LoopDetails (go back to Dashboard)
4. Take another Heap Snapshot
5. Compare: Verify loop data is released (memory should drop significantly)

---

### Task 5: Mobile Layout Fix

**Priority**: 🟡 Medium (UX improvement)

**Files**:
- `src/components/LoopActionBar.tsx`

**Changes**:
Line 206:
```typescript
// Before:
className="w-auto min-w-32 flex-shrink sm:w-48 h-9 ..."

// After:
className="w-28 sm:w-32 md:w-48 max-w-[120px] sm:max-w-none flex-shrink-0 h-9 ..."
```

Line 264 (message input - verify it uses):
```typescript
className="flex-1 min-w-0 h-9 ..." // Ensures it takes remaining space
```

**Testing**:
- Open in responsive mode (375px width - iPhone SE)
- Measure model dropdown width (should be ~120px max)
- Measure message input width (should be ~240px+)
- Test on real mobile device (iOS Safari, Android Chrome)

---

### Task 6: Comprehensive Testing

**Priority**: 🔴 Critical

#### Automated Tests

```bash
bun run test
bun run build
```

Ensure all existing tests pass.

#### Manual Performance Tests

1. **Input Responsiveness Test**:
   - Create a long-running loop (100+ iterations, 5000+ log entries)
   - Navigate to LoopDetails
   - Type in the LoopActionBar message input
   - Type in the "Address Comments" modal textarea
   - Type in the PlanReviewPanel feedback textarea
   - **Expected**: Instant keystroke response, no lag

2. **Memory Leak Test**:
   - Open DevTools → Performance Monitor
   - Open LoopDetails for Loop A (note memory usage)
   - Close LoopDetails (go back to Dashboard)
   - **Expected**: Memory drops back down
   - Open LoopDetails for Loop B
   - Close LoopDetails
   - **Expected**: Memory stays stable (no accumulation)

3. **Virtualization Test**:
   - Open LoopDetails for loop with 10,000+ entries
   - Open DevTools → Elements → Inspect DOM
   - Count actual rendered `<div>` nodes in log viewer
   - **Expected**: ~50-100 nodes (visible + buffer), not 10,000
   - Scroll to bottom of logs
   - **Expected**: Smooth scrolling, no jank

4. **Mobile Layout Test**:
   - Open in responsive mode (375px width)
   - Queue a message in LoopActionBar
   - **Expected**: Model dropdown ≤ 120px, message input ≥ 240px
   - Test on real iOS Safari and Android Chrome
   - **Expected**: Can comfortably type in message field

#### Performance Metrics (Chrome DevTools)

| Metric | Before | Target | Measurement Method |
|--------|--------|--------|--------------------|
| Keystroke lag | 200-500ms | < 50ms | Type in input, observe delay |
| DOM nodes (10k logs) | ~30,000 | < 200 | Elements tab → Count nodes |
| Memory (1 loop open) | ~100MB | ~20-30MB | Memory tab → Heap size |
| Memory (after closing) | Doesn't drop | Drops to baseline | Compare heap snapshots |
| Mobile input width | ~100px | > 200px | Measure in responsive mode |

---

## Implementation Order

1. **Task 1** (Memoization) - Quick win, highest impact on input lag
2. **Task 3** (Virtualization) - Bigger change, but critical for memory
3. **Task 4** (Memory cleanup) - Important for long-term stability
4. **Task 5** (Mobile layout) - Quick CSS fix
5. **Task 6** (Testing) - Comprehensive verification

**Estimated Duration**: 4-6 hours total

## Success Criteria

- ✅ Typing in any input field is instant (< 50ms lag)
- ✅ Memory usage stays reasonable (< 50MB per open loop)
- ✅ Memory is released when closing LoopDetails
- ✅ LogViewer renders only visible items (< 200 DOM nodes)
- ✅ Mobile message input has adequate width (> 50% of action bar)
- ✅ All existing tests pass
- ✅ Build succeeds with no errors
- ✅ No memory leaks detected in DevTools profiling

## Risks & Mitigation

| Risk | Impact | Mitigation |
|------|--------|------------|
| Virtualization breaks auto-scroll | High | Use react-window's `scrollToItem` API |
| Variable row heights cause jumpiness | Medium | Calculate heights or use overscan |
| Memoization doesn't work due to prop changes | High | Use useCallback for function props |
| WebSocket not cleaning up | High | Add explicit cleanup in useEffect return |
| Tests fail due to virtualization changes | Medium | Update tests to work with virtual list |

## Rollback Plan

If any task causes issues:
1. Revert the specific commit
2. Use git stash to save changes
3. Debug and re-attempt with fixes
4. Each task is independent (except memoization is prerequisite for debouncing)

## Future Enhancements (Out of Scope)

- IndexedDB persistence for logs (offload from RAM to disk)
- Lazy loading for Dashboard loop cards
- Web Worker for log processing
- User-configurable log retention policy
- Compress old logs in memory
