/**
 * Tests for the LoopRow component.
 */

import { describe, expect, test } from "bun:test";
import { LoopRow } from "@/components/LoopRow";
import { renderWithUser } from "../helpers/render";
import { createLoopWithStatus } from "../helpers/factories";

describe("LoopRow", () => {
  test("wraps long names and keeps metadata in a wrapping layout", () => {
    const longName = `Loop ${"with-a-very-long-row-title-".repeat(6)}`;
    const loop = createLoopWithStatus("running", {
      config: { name: longName },
      state: {
        currentIteration: 12,
        lastActivityAt: new Date().toISOString(),
      },
    });

    const { getByText, getByTitle } = renderWithUser(<LoopRow loop={loop} />);

    const title = getByText(longName);
    expect(title.className).toContain("break-words");
    expect(title.className).toContain("[overflow-wrap:anywhere]");
    expect(title.className.includes("truncate")).toBe(false);

    const metaContainer = getByTitle("Iterations").parentElement;
    expect(metaContainer).toBeTruthy();
    if (!(metaContainer instanceof HTMLElement)) {
      throw new Error("Expected loop row metadata container");
    }
    expect(metaContainer.className).toContain("flex-wrap");
  });
});
