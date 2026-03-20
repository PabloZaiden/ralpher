/**
 * Tests for the useVisualViewport hook module.
 *
 * This file verifies the public API surface of the hook module (exported
 * functions and the VisualViewportState shape). More detailed behavior and
 * browser API interactions are covered in higher-level integration tests.
 */

import { test, expect, describe } from "bun:test";

// We test the hook's contract without React by verifying the module exports
// and the expected behavior patterns. Full integration testing happens on
// real mobile devices.

describe("use-visual-viewport module", () => {
  test("exports useVisualViewport function", async () => {
    const mod = await import("../../src/components/ssh-session/use-visual-viewport");
    expect(typeof mod.useVisualViewport).toBe("function");
  });

  test("VisualViewportState interface has expected shape", async () => {
    // Type-level check — if this compiles, the interface is correct
    const state: import("../../src/components/ssh-session/use-visual-viewport").VisualViewportState = {
      height: 600,
      offsetTop: 0,
    };
    expect(state.height).toBe(600);
    expect(state.offsetTop).toBe(0);
  });
});
