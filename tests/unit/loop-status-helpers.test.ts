/**
 * Unit tests for loop status helpers.
 * Covers all exported functions from src/utils/loop-status.ts.
 */

import { describe, test, expect } from "bun:test";
import {
  getStatusLabel,
  canAccept,
  isFinalState,
  isLoopActive,
  isLoopRunning,
  canJumpstart,
  isAwaitingFeedback,
  getPlanningStatusLabel,
  isLoopPlanReady,
} from "../../src/utils/loop-status";
import type { Loop, LoopStatus } from "../../src/types/loop";

/**
 * All possible LoopStatus values for exhaustive testing.
 */
const ALL_STATUSES: LoopStatus[] = [
  "idle",
  "draft",
  "planning",
  "starting",
  "running",
  "waiting",
  "completed",
  "stopped",
  "failed",
  "max_iterations",
  "resolving_conflicts",
  "merged",
  "pushed",
  "deleted",
];

/**
 * Helper to create a minimal Loop object for testing.
 */
function createTestLoop(overrides: {
  status: LoopStatus;
  planMode?: {
    active: boolean;
    feedbackRounds: number;
    planningFolderCleared: boolean;
    isPlanReady: boolean;
  };
}): Loop {
  return {
    config: {
      id: "test-loop-1",
      name: "Test Loop",
      workspaceId: "ws-1",
    },
    state: {
      status: overrides.status,
      planMode: overrides.planMode,
    },
  } as Loop;
}

// ============================================================================
// getStatusLabel
// ============================================================================

describe("getStatusLabel", () => {
  test("returns human-readable labels for all statuses", () => {
    const expectedLabels: Record<LoopStatus, string> = {
      idle: "Idle",
      draft: "Draft",
      planning: "Planning",
      starting: "Starting",
      running: "Running",
      waiting: "Waiting",
      completed: "Completed",
      stopped: "Stopped",
      failed: "Failed",
      max_iterations: "Max Iterations",
      resolving_conflicts: "Resolving Conflicts",
      merged: "Merged",
      pushed: "Pushed",
      deleted: "Deleted",
    };

    for (const status of ALL_STATUSES) {
      expect(getStatusLabel(status)).toBe(expectedLabels[status]);
    }
  });

  test("returns 'Resolving Conflicts' when syncState has conflicts and loop is running", () => {
    expect(getStatusLabel("running", { status: "conflicts" })).toBe("Resolving Conflicts");
  });

  test("returns 'Resolving Conflicts' when syncState has conflicts and loop is starting", () => {
    expect(getStatusLabel("starting", { status: "conflicts" })).toBe("Resolving Conflicts");
  });

  test("returns 'Resolving Conflicts' when syncState has conflicts and loop is waiting", () => {
    expect(getStatusLabel("waiting", { status: "conflicts" })).toBe("Resolving Conflicts");
  });

  test("does NOT return 'Resolving Conflicts' for non-active statuses with syncState conflicts", () => {
    const nonActiveStatuses: LoopStatus[] = [
      "idle", "draft", "planning", "completed", "stopped", "failed",
      "max_iterations", "merged", "pushed", "deleted",
    ];
    for (const status of nonActiveStatuses) {
      // These statuses should show their normal label, not the sync conflict label
      expect(getStatusLabel(status, { status: "conflicts" })).toBe(getStatusLabel(status));
    }
  });

  test("returns normal label when syncState is null", () => {
    expect(getStatusLabel("running", null)).toBe("Running");
  });

  test("returns normal label when syncState is undefined", () => {
    expect(getStatusLabel("running", undefined)).toBe("Running");
  });

  test("returns normal label when syncState has non-conflict status", () => {
    expect(getStatusLabel("running", { status: "synced" })).toBe("Running");
  });

  test("returns the raw status string for unknown statuses", () => {
    // Edge case: unknown status falls through default case
    expect(getStatusLabel("unknown_status" as LoopStatus)).toBe("unknown_status");
  });
});

// ============================================================================
// canAccept
// ============================================================================

describe("canAccept", () => {
  test("returns true for completed", () => {
    expect(canAccept("completed")).toBe(true);
  });

  test("returns true for max_iterations", () => {
    expect(canAccept("max_iterations")).toBe(true);
  });

  test("returns false for all other statuses", () => {
    const nonAcceptable: LoopStatus[] = [
      "idle", "draft", "planning", "starting", "running", "waiting",
      "stopped", "failed", "resolving_conflicts", "merged", "pushed", "deleted",
    ];
    for (const status of nonAcceptable) {
      expect(canAccept(status)).toBe(false);
    }
  });
});

// ============================================================================
// isFinalState
// ============================================================================

describe("isFinalState", () => {
  test("returns true for merged", () => {
    expect(isFinalState("merged")).toBe(true);
  });

  test("returns true for pushed", () => {
    expect(isFinalState("pushed")).toBe(true);
  });

  test("returns true for deleted", () => {
    expect(isFinalState("deleted")).toBe(true);
  });

  test("returns false for all non-final statuses", () => {
    const nonFinal: LoopStatus[] = [
      "idle", "draft", "planning", "starting", "running", "waiting",
      "completed", "stopped", "failed", "max_iterations", "resolving_conflicts",
    ];
    for (const status of nonFinal) {
      expect(isFinalState(status)).toBe(false);
    }
  });
});

// ============================================================================
// isLoopActive
// ============================================================================

describe("isLoopActive", () => {
  test("returns true for running", () => {
    expect(isLoopActive("running")).toBe(true);
  });

  test("returns true for waiting", () => {
    expect(isLoopActive("waiting")).toBe(true);
  });

  test("returns true for starting", () => {
    expect(isLoopActive("starting")).toBe(true);
  });

  test("returns false for all non-active statuses", () => {
    const nonActive: LoopStatus[] = [
      "idle", "draft", "planning", "completed", "stopped", "failed",
      "max_iterations", "resolving_conflicts", "merged", "pushed", "deleted",
    ];
    for (const status of nonActive) {
      expect(isLoopActive(status)).toBe(false);
    }
  });
});

// ============================================================================
// isLoopRunning
// ============================================================================

describe("isLoopRunning", () => {
  test("returns true for running", () => {
    expect(isLoopRunning("running")).toBe(true);
  });

  test("returns true for starting", () => {
    expect(isLoopRunning("starting")).toBe(true);
  });

  test("returns false for waiting (active but not 'running')", () => {
    expect(isLoopRunning("waiting")).toBe(false);
  });

  test("returns false for all non-running statuses", () => {
    const nonRunning: LoopStatus[] = [
      "idle", "draft", "planning", "waiting", "completed", "stopped", "failed",
      "max_iterations", "resolving_conflicts", "merged", "pushed", "deleted",
    ];
    for (const status of nonRunning) {
      expect(isLoopRunning(status)).toBe(false);
    }
  });
});

// ============================================================================
// canJumpstart
// ============================================================================

describe("canJumpstart", () => {
  test("returns true for completed", () => {
    expect(canJumpstart("completed")).toBe(true);
  });

  test("returns true for stopped", () => {
    expect(canJumpstart("stopped")).toBe(true);
  });

  test("returns true for failed", () => {
    expect(canJumpstart("failed")).toBe(true);
  });

  test("returns true for max_iterations", () => {
    expect(canJumpstart("max_iterations")).toBe(true);
  });

  test("returns false for all non-jumpstartable statuses", () => {
    const nonJumpstartable: LoopStatus[] = [
      "idle", "draft", "planning", "starting", "running", "waiting",
      "resolving_conflicts", "merged", "pushed", "deleted",
    ];
    for (const status of nonJumpstartable) {
      expect(canJumpstart(status)).toBe(false);
    }
  });
});

// ============================================================================
// isAwaitingFeedback
// ============================================================================

describe("isAwaitingFeedback", () => {
  test("returns true for pushed status with reviewModeAddressable true", () => {
    expect(isAwaitingFeedback("pushed", true)).toBe(true);
  });

  test("returns true for merged status with reviewModeAddressable true", () => {
    expect(isAwaitingFeedback("merged", true)).toBe(true);
  });

  test("returns false for pushed status with reviewModeAddressable false", () => {
    expect(isAwaitingFeedback("pushed", false)).toBe(false);
  });

  test("returns false for merged status with reviewModeAddressable false", () => {
    expect(isAwaitingFeedback("merged", false)).toBe(false);
  });

  test("returns false for pushed status with reviewModeAddressable undefined", () => {
    expect(isAwaitingFeedback("pushed", undefined)).toBe(false);
  });

  test("returns false for non-pushed/merged statuses even with reviewModeAddressable true", () => {
    const nonFeedback: LoopStatus[] = [
      "idle", "draft", "planning", "starting", "running", "waiting",
      "completed", "stopped", "failed", "max_iterations", "resolving_conflicts", "deleted",
    ];
    for (const status of nonFeedback) {
      expect(isAwaitingFeedback(status, true)).toBe(false);
    }
  });
});

// ============================================================================
// getPlanningStatusLabel
// ============================================================================

describe("getPlanningStatusLabel", () => {
  test("returns 'Planning' when isPlanReady is false", () => {
    expect(getPlanningStatusLabel(false)).toBe("Planning");
  });

  test("returns 'Plan Ready' when isPlanReady is true", () => {
    expect(getPlanningStatusLabel(true)).toBe("Plan Ready");
  });
});

// ============================================================================
// isLoopPlanReady
// ============================================================================

describe("isLoopPlanReady", () => {
  test("returns true for planning loop with isPlanReady === true", () => {
    const loop = createTestLoop({
      status: "planning",
      planMode: {
        active: true,
        feedbackRounds: 0,
        planningFolderCleared: false,
        isPlanReady: true,
      },
    });
    expect(isLoopPlanReady(loop)).toBe(true);
  });

  test("returns false for planning loop with isPlanReady === false", () => {
    const loop = createTestLoop({
      status: "planning",
      planMode: {
        active: true,
        feedbackRounds: 0,
        planningFolderCleared: false,
        isPlanReady: false,
      },
    });
    expect(isLoopPlanReady(loop)).toBe(false);
  });

  test("returns false for planning loop without planMode", () => {
    const loop = createTestLoop({
      status: "planning",
    });
    expect(isLoopPlanReady(loop)).toBe(false);
  });

  test("returns false for non-planning status even with isPlanReady true", () => {
    const nonPlanningStatuses: LoopStatus[] = [
      "idle", "draft", "starting", "running", "waiting", "completed",
      "stopped", "failed", "max_iterations", "resolving_conflicts",
      "merged", "pushed", "deleted",
    ];
    for (const status of nonPlanningStatuses) {
      const loop = createTestLoop({
        status,
        planMode: {
          active: true,
          feedbackRounds: 0,
          planningFolderCleared: false,
          isPlanReady: true,
        },
      });
      expect(isLoopPlanReady(loop)).toBe(false);
    }
  });
});
