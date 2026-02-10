/**
 * Unit tests for loop status helpers: getPlanningStatusLabel and isLoopPlanReady.
 */

import { describe, test, expect } from "bun:test";
import { getPlanningStatusLabel, isLoopPlanReady } from "../../src/utils/loop-status";
import type { Loop } from "../../src/types/loop";

/**
 * Helper to create a minimal Loop object for testing.
 * Uses type assertion since we only need status and planMode for these tests.
 */
function createTestLoop(overrides: {
  status: string;
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

describe("getPlanningStatusLabel", () => {
  test("returns 'Planning' when isPlanReady is false", () => {
    expect(getPlanningStatusLabel(false)).toBe("Planning");
  });

  test("returns 'Plan Ready' when isPlanReady is true", () => {
    expect(getPlanningStatusLabel(true)).toBe("Plan Ready");
  });
});

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
    const loop = createTestLoop({
      status: "running",
      planMode: {
        active: true,
        feedbackRounds: 0,
        planningFolderCleared: false,
        isPlanReady: true,
      },
    });
    expect(isLoopPlanReady(loop)).toBe(false);
  });

  test("returns false for completed loop", () => {
    const loop = createTestLoop({ status: "completed" });
    expect(isLoopPlanReady(loop)).toBe(false);
  });

  test("returns false for draft loop", () => {
    const loop = createTestLoop({ status: "draft" });
    expect(isLoopPlanReady(loop)).toBe(false);
  });

  test("returns false for idle loop", () => {
    const loop = createTestLoop({ status: "idle" });
    expect(isLoopPlanReady(loop)).toBe(false);
  });
});
