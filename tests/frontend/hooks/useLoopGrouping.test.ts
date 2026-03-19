import { describe, test, expect } from "bun:test";
import { renderHook } from "@testing-library/react";
import { createLoopWithStatus, createWorkspace } from "../helpers/factories";
import { useLoopGrouping } from "@/hooks/useLoopGrouping";

describe("useLoopGrouping", () => {
  test("orders workspace groups by loop count descending and preserves input order for ties", () => {
    const alphaWorkspace = createWorkspace({ id: "ws-alpha", name: "Alpha", directory: "/workspaces/alpha" });
    const betaWorkspace = createWorkspace({ id: "ws-beta", name: "Beta", directory: "/workspaces/beta" });
    const gammaWorkspace = createWorkspace({ id: "ws-gamma", name: "Gamma", directory: "/workspaces/gamma" });
    const deltaWorkspace = createWorkspace({ id: "ws-delta", name: "Delta", directory: "/workspaces/delta" });

    const loops = [
      createLoopWithStatus("running", {
        config: { id: "loop-beta-1", name: "Beta One", workspaceId: betaWorkspace.id },
      }),
      createLoopWithStatus("completed", {
        config: { id: "loop-alpha-1", name: "Alpha One", workspaceId: alphaWorkspace.id },
      }),
      createLoopWithStatus("planning", {
        config: { id: "loop-beta-2", name: "Beta Two", workspaceId: betaWorkspace.id },
      }),
      createLoopWithStatus("draft", {
        config: { id: "loop-gamma-1", name: "Gamma One", workspaceId: gammaWorkspace.id },
      }),
    ];

    const { result } = renderHook(() =>
      useLoopGrouping(loops, [alphaWorkspace, betaWorkspace, gammaWorkspace, deltaWorkspace])
    );

    expect(result.current.workspaceGroups.map((group) => group.workspace.id)).toEqual([
      betaWorkspace.id,
      alphaWorkspace.id,
      gammaWorkspace.id,
      deltaWorkspace.id,
    ]);
    expect(result.current.workspaceGroups.map((group) => group.loops.length)).toEqual([2, 1, 1, 0]);
  });
});
