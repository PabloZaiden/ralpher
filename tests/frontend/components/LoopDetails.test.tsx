/**
 * Tests for LoopDetails component.
 *
 * Tests loop data display, tab navigation, planning mode, action buttons,
 * modal flows, connection status, loading/error states, and the action bar.
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { createMockApi, MockApiError } from "../helpers/mock-api";
import { createMockWebSocket } from "../helpers/mock-websocket";
import { renderWithUser, waitFor } from "../helpers/render";
import {
  createLoopWithStatus,
  createFileDiff,
} from "../helpers/factories";
import { LoopDetails } from "@/components/LoopDetails";

const api = createMockApi();
const ws = createMockWebSocket();

const LOOP_ID = "loop-1";

/** Set up default API routes for LoopDetails. */
function setupDefaultApi(loopOverrides?: Parameters<typeof createLoopWithStatus>[1]) {
  const loop = createLoopWithStatus("running", {
    config: { id: LOOP_ID, name: "Test Loop", prompt: "Fix the bug", ...(loopOverrides?.config ?? {}) },
    state: loopOverrides?.state,
  });

  // Core loop endpoint
  api.get("/api/loops/:id", () => loop);
  // Diff, plan, status-file
  api.get("/api/loops/:id/diff", () => []);
  api.get("/api/loops/:id/plan", () => ({ exists: false, content: "" }));
  api.get("/api/loops/:id/status-file", () => ({ exists: false, content: "" }));
  // Comments
  api.get("/api/loops/:id/comments", () => ({ success: true, comments: [] }));
  // Models
  api.get("/api/models", () => []);
  // Preferences
  api.get("/api/preferences/markdown-rendering", () => ({ enabled: true }));
  api.get("/api/preferences/log-level", () => ({ level: "info" }));
  // Actions (POST/PUT/DELETE)
  api.post("/api/loops/:id/accept", () => ({ success: true, mergeCommit: "abc123" }));
  api.post("/api/loops/:id/push", () => ({ success: true }));
  api.delete("/api/loops/:id", () => ({ success: true }));
  api.post("/api/loops/:id/purge", () => ({ success: true }));
  api.post("/api/loops/:id/mark-merged", () => ({ success: true }));
  api.post("/api/loops/:id/address-comments", () => ({ success: true }));
  api.post("/api/loops/:id/pending", () => ({ success: true }));
  api.delete("/api/loops/:id/pending", () => ({ success: true }));
  api.put("/api/loops/:id", () => loop);
  api.post("/api/loops/:id/plan/feedback", () => ({ success: true }));
  api.post("/api/loops/:id/plan/accept", () => ({ success: true }));
  api.post("/api/loops/:id/plan/discard", () => ({ success: true }));

  return loop;
}

beforeEach(() => {
  api.reset();
  api.install();
  ws.reset();
  ws.install();
});

afterEach(() => {
  api.uninstall();
  ws.uninstall();
});

// ─── Loading state ───────────────────────────────────────────────────────────

describe("loading state", () => {
  test("shows loading spinner while fetching loop", async () => {
    // Return a never-resolving promise so we stay in loading
    let resolveLoop!: (loop: ReturnType<typeof createLoopWithStatus>) => void;
    const pendingPromise = new Promise<ReturnType<typeof createLoopWithStatus>>((resolve) => {
      resolveLoop = resolve;
    });
    api.get("/api/loops/:id", () => pendingPromise as unknown as ReturnType<typeof createLoopWithStatus>);
    api.get("/api/models", () => []);
    api.get("/api/preferences/markdown-rendering", () => ({ enabled: true }));
    api.get("/api/preferences/log-level", () => ({ level: "info" }));

    const { container } = renderWithUser(<LoopDetails loopId={LOOP_ID} />);

    // The loading state shows an animate-spin element
    const spinner = container.querySelector(".animate-spin");
    expect(spinner).toBeTruthy();

    // Clean up
    resolveLoop(createLoopWithStatus("running", { config: { id: LOOP_ID } }));
  });
});

// ─── Loop not found ──────────────────────────────────────────────────────────

describe("loop not found", () => {
  test("shows loop not found when API returns error", async () => {
    api.get("/api/loops/:id", () => {
      throw new MockApiError(404, { error: "not_found" });
    });
    api.get("/api/models", () => []);
    api.get("/api/preferences/markdown-rendering", () => ({ enabled: true }));
    api.get("/api/preferences/log-level", () => ({ level: "info" }));

    const { getByText } = renderWithUser(<LoopDetails loopId={LOOP_ID} />);

    await waitFor(() => {
      expect(getByText("Not found")).toBeTruthy();
    });
    // The error detail is shown in the paragraph below
    expect(getByText("Loop not found")).toBeTruthy();
  });

  test("shows back button in not found state", async () => {
    api.get("/api/loops/:id", () => {
      throw new MockApiError(404, { error: "not_found" });
    });
    api.get("/api/models", () => []);
    api.get("/api/preferences/markdown-rendering", () => ({ enabled: true }));
    api.get("/api/preferences/log-level", () => ({ level: "info" }));

    const onBack = () => {};
    const { getByText } = renderWithUser(
      <LoopDetails loopId={LOOP_ID} onBack={onBack} />,
    );

    await waitFor(() => {
      expect(getByText("Not found")).toBeTruthy();
    });

    // Back button should also be present
    const backBtn = document.querySelector('button');
    expect(backBtn?.textContent).toContain("Back");
  });
});

// ─── Header display ──────────────────────────────────────────────────────────

describe("header display", () => {
  test("renders loop name in header", async () => {
    setupDefaultApi();
    const { getByText } = renderWithUser(<LoopDetails loopId={LOOP_ID} />);

    await waitFor(() => {
      expect(getByText("Test Loop")).toBeTruthy();
    });
  });

  test("renders status badge", async () => {
    setupDefaultApi();
    const { getByText } = renderWithUser(<LoopDetails loopId={LOOP_ID} />);

    await waitFor(() => {
      expect(getByText("Running")).toBeTruthy();
    });
  });

  test("renders back button", async () => {
    setupDefaultApi();
    const onBack = () => {};
    const { getByRole } = renderWithUser(
      <LoopDetails loopId={LOOP_ID} onBack={onBack} />,
    );

    await waitFor(() => {
      expect(getByRole("button", { name: /Back/ })).toBeTruthy();
    });
  });

  test("calls onBack when back button is clicked", async () => {
    setupDefaultApi();
    let backCalled = false;
    const onBack = () => { backCalled = true; };
    const { getByRole, user } = renderWithUser(
      <LoopDetails loopId={LOOP_ID} onBack={onBack} />,
    );

    await waitFor(() => {
      expect(getByRole("button", { name: /Back/ })).toBeTruthy();
    });

    await user.click(getByRole("button", { name: /Back/ }));
    expect(backCalled).toBe(true);
  });

  test("renders rename button", async () => {
    setupDefaultApi();
    const { container } = renderWithUser(<LoopDetails loopId={LOOP_ID} />);

    await waitFor(() => {
      const renameBtn = container.querySelector('button[aria-label="Rename loop"]');
      expect(renameBtn).toBeTruthy();
    });
  });

  test("shows active indicator for running loops", async () => {
    setupDefaultApi();
    const { container } = renderWithUser(<LoopDetails loopId={LOOP_ID} />);

    await waitFor(() => {
      const pinger = container.querySelector(".animate-ping");
      expect(pinger).toBeTruthy();
    });
  });

  test("does not show active indicator for completed loops", async () => {
    const loop = createLoopWithStatus("completed", {
      config: { id: LOOP_ID, name: "Done Loop" },
    });
    api.get("/api/loops/:id", () => loop);
    api.get("/api/loops/:id/diff", () => []);
    api.get("/api/loops/:id/plan", () => ({ exists: false, content: "" }));
    api.get("/api/loops/:id/status-file", () => ({ exists: false, content: "" }));
    api.get("/api/loops/:id/comments", () => ({ success: true, comments: [] }));
    api.get("/api/models", () => []);
    api.get("/api/preferences/markdown-rendering", () => ({ enabled: true }));
    api.get("/api/preferences/log-level", () => ({ level: "info" }));

    const { getByText, container } = renderWithUser(<LoopDetails loopId={LOOP_ID} />);

    await waitFor(() => {
      expect(getByText("Done Loop")).toBeTruthy();
    });

    const pinger = container.querySelector(".animate-ping");
    expect(pinger).toBeNull();
  });

  test("shows directory in header", async () => {
    setupDefaultApi();
    const { getByText } = renderWithUser(<LoopDetails loopId={LOOP_ID} />);

    await waitFor(() => {
      expect(getByText("/workspaces/test-project")).toBeTruthy();
    });
  });
});

// ─── Info bar ────────────────────────────────────────────────────────────────

describe("info bar", () => {
  test("renders iteration info", async () => {
    setupDefaultApi();
    const { getByText } = renderWithUser(<LoopDetails loopId={LOOP_ID} />);

    await waitFor(() => {
      expect(getByText(/Iteration:/)).toBeTruthy();
    });
  });

  test("renders git branch info", async () => {
    setupDefaultApi();
    const { getByText } = renderWithUser(<LoopDetails loopId={LOOP_ID} />);

    await waitFor(() => {
      expect(getByText("main")).toBeTruthy();
      expect(getByText(/ralph\//)).toBeTruthy();
    });
  });

  test("renders model info", async () => {
    setupDefaultApi();
    const { getByText } = renderWithUser(<LoopDetails loopId={LOOP_ID} />);

    await waitFor(() => {
      expect(getByText(/anthropic\/claude-sonnet/)).toBeTruthy();
    });
  });
});

// ─── Connection status ───────────────────────────────────────────────────────

describe("connection status", () => {
  test("shows Live when websocket is open", async () => {
    setupDefaultApi();
    const { getByText } = renderWithUser(<LoopDetails loopId={LOOP_ID} />);

    await waitFor(() => {
      expect(getByText("Live")).toBeTruthy();
    });
  });
});

// ─── Tab navigation ──────────────────────────────────────────────────────────

describe("tab navigation", () => {
  test("renders all tab labels", async () => {
    setupDefaultApi();
    const { getByText } = renderWithUser(<LoopDetails loopId={LOOP_ID} />);

    await waitFor(() => {
      expect(getByText("Test Loop")).toBeTruthy();
    });

    // All tabs should be visible
    for (const tabLabel of ["Log", "Info", "Prompt", "Plan", "Status", "Diff", "Review", "Actions"]) {
      expect(getByText(tabLabel)).toBeTruthy();
    }
  });

  test("Log tab is active by default", async () => {
    setupDefaultApi();
    const { getByText } = renderWithUser(<LoopDetails loopId={LOOP_ID} />);

    await waitFor(() => {
      expect(getByText("Test Loop")).toBeTruthy();
    });

    // Log tab button should have active styling (border-blue-500)
    const logTab = getByText("Log").closest("button");
    expect(logTab).toBeTruthy();
    expect(logTab!.className).toContain("border-blue-500");
  });

  test("can switch to Info tab", async () => {
    setupDefaultApi();
    const { getByText, user } = renderWithUser(<LoopDetails loopId={LOOP_ID} />);

    await waitFor(() => {
      expect(getByText("Test Loop")).toBeTruthy();
    });

    await user.click(getByText("Info"));

    await waitFor(() => {
      expect(getByText("Loop Information")).toBeTruthy();
    });
  });

  test("can switch to Prompt tab", async () => {
    setupDefaultApi();
    const { getByText, user } = renderWithUser(<LoopDetails loopId={LOOP_ID} />);

    await waitFor(() => {
      expect(getByText("Test Loop")).toBeTruthy();
    });

    await user.click(getByText("Prompt"));

    await waitFor(() => {
      expect(getByText("Original Task Prompt")).toBeTruthy();
    });
  });

  test("Prompt tab shows the loop prompt text", async () => {
    setupDefaultApi();
    const { getByText, user } = renderWithUser(<LoopDetails loopId={LOOP_ID} />);

    await waitFor(() => {
      expect(getByText("Test Loop")).toBeTruthy();
    });

    await user.click(getByText("Prompt"));

    await waitFor(() => {
      expect(getByText("Fix the bug")).toBeTruthy();
    });
  });

  test("can switch to Plan tab", async () => {
    const loop = createLoopWithStatus("running", {
      config: { id: LOOP_ID, name: "Test Loop" },
    });
    api.get("/api/loops/:id", () => loop);
    api.get("/api/loops/:id/diff", () => []);
    api.get("/api/loops/:id/plan", () => ({ exists: true, content: "# My Plan\nDo things" }));
    api.get("/api/loops/:id/status-file", () => ({ exists: false, content: "" }));
    api.get("/api/loops/:id/comments", () => ({ success: true, comments: [] }));
    api.get("/api/models", () => []);
    api.get("/api/preferences/markdown-rendering", () => ({ enabled: true }));
    api.get("/api/preferences/log-level", () => ({ level: "info" }));

    const { getByText, user } = renderWithUser(<LoopDetails loopId={LOOP_ID} />);

    await waitFor(() => {
      expect(getByText("Test Loop")).toBeTruthy();
    });

    await user.click(getByText("Plan"));

    await waitFor(() => {
      expect(getByText(/My Plan/)).toBeTruthy();
    });
  });

  test("Plan tab shows message when no plan exists", async () => {
    setupDefaultApi();
    const { getByText, user } = renderWithUser(<LoopDetails loopId={LOOP_ID} />);

    await waitFor(() => {
      expect(getByText("Test Loop")).toBeTruthy();
    });

    await user.click(getByText("Plan"));

    await waitFor(() => {
      expect(getByText(/No plan\.md file found/)).toBeTruthy();
    });
  });

  test("can switch to Diff tab", async () => {
    setupDefaultApi();
    const { getByText, user } = renderWithUser(<LoopDetails loopId={LOOP_ID} />);

    await waitFor(() => {
      expect(getByText("Test Loop")).toBeTruthy();
    });

    await user.click(getByText("Diff"));

    await waitFor(() => {
      expect(getByText("No changes yet.")).toBeTruthy();
    });
  });

  test("Diff tab shows file changes when available", async () => {
    const loop = createLoopWithStatus("running", {
      config: { id: LOOP_ID, name: "Test Loop" },
    });
    const diffs = [
      createFileDiff({ path: "src/app.ts", status: "modified", additions: 5, deletions: 2 }),
      createFileDiff({ path: "src/new.ts", status: "added", additions: 20, deletions: 0 }),
    ];
    api.get("/api/loops/:id", () => loop);
    api.get("/api/loops/:id/diff", () => diffs);
    api.get("/api/loops/:id/plan", () => ({ exists: false, content: "" }));
    api.get("/api/loops/:id/status-file", () => ({ exists: false, content: "" }));
    api.get("/api/loops/:id/comments", () => ({ success: true, comments: [] }));
    api.get("/api/models", () => []);
    api.get("/api/preferences/markdown-rendering", () => ({ enabled: true }));
    api.get("/api/preferences/log-level", () => ({ level: "info" }));

    const { getByText, user } = renderWithUser(<LoopDetails loopId={LOOP_ID} />);

    await waitFor(() => {
      expect(getByText("Test Loop")).toBeTruthy();
    });

    await user.click(getByText("Diff"));

    await waitFor(() => {
      expect(getByText("src/app.ts")).toBeTruthy();
      expect(getByText("src/new.ts")).toBeTruthy();
    });
  });

  test("can switch to Review tab", async () => {
    setupDefaultApi();
    const { getByText, user } = renderWithUser(<LoopDetails loopId={LOOP_ID} />);

    await waitFor(() => {
      expect(getByText("Test Loop")).toBeTruthy();
    });

    await user.click(getByText("Review"));

    await waitFor(() => {
      expect(getByText(/does not have review mode enabled/)).toBeTruthy();
    });
  });

  test("Review tab shows review info when review mode is enabled", async () => {
    const loop = createLoopWithStatus("pushed", {
      config: { id: LOOP_ID, name: "Review Loop" },
      state: {
        reviewMode: {
          addressable: true,
          completionAction: "push",
          reviewCycles: 2,
          reviewBranches: ["review-1", "review-2"],
        },
      },
    });
    api.get("/api/loops/:id", () => loop);
    api.get("/api/loops/:id/diff", () => []);
    api.get("/api/loops/:id/plan", () => ({ exists: false, content: "" }));
    api.get("/api/loops/:id/status-file", () => ({ exists: false, content: "" }));
    api.get("/api/loops/:id/comments", () => ({ success: true, comments: [] }));
    api.get("/api/models", () => []);
    api.get("/api/preferences/markdown-rendering", () => ({ enabled: true }));
    api.get("/api/preferences/log-level", () => ({ level: "info" }));

    const { getByText, user } = renderWithUser(<LoopDetails loopId={LOOP_ID} />);

    await waitFor(() => {
      expect(getByText("Review Loop")).toBeTruthy();
    });

    await user.click(getByText("Review"));

    await waitFor(() => {
      expect(getByText("Review Mode Status")).toBeTruthy();
    });
    expect(getByText("Yes")).toBeTruthy(); // Addressable: Yes
    expect(getByText("push")).toBeTruthy(); // Completion action: push
    expect(getByText("review-1")).toBeTruthy();
    expect(getByText("review-2")).toBeTruthy();
  });

  test("can switch to Actions tab", async () => {
    setupDefaultApi();
    const { getByText, user } = renderWithUser(<LoopDetails loopId={LOOP_ID} />);

    await waitFor(() => {
      expect(getByText("Test Loop")).toBeTruthy();
    });

    await user.click(getByText("Actions"));

    await waitFor(() => {
      // Running loop shows Delete Loop button in actions tab
      expect(getByText("Delete Loop")).toBeTruthy();
    });
  });
});

// ─── Actions tab content ─────────────────────────────────────────────────────

describe("actions tab content", () => {
  test("running loop shows delete action", async () => {
    setupDefaultApi();
    const { getByText, user } = renderWithUser(<LoopDetails loopId={LOOP_ID} />);

    await waitFor(() => {
      expect(getByText("Test Loop")).toBeTruthy();
    });

    await user.click(getByText("Actions"));

    await waitFor(() => {
      expect(getByText("Delete Loop")).toBeTruthy();
    });
  });

  test("completed loop shows accept and delete actions", async () => {
    const loop = createLoopWithStatus("completed", {
      config: { id: LOOP_ID, name: "Completed Loop" },
    });
    api.get("/api/loops/:id", () => loop);
    api.get("/api/loops/:id/diff", () => []);
    api.get("/api/loops/:id/plan", () => ({ exists: false, content: "" }));
    api.get("/api/loops/:id/status-file", () => ({ exists: false, content: "" }));
    api.get("/api/loops/:id/comments", () => ({ success: true, comments: [] }));
    api.get("/api/models", () => []);
    api.get("/api/preferences/markdown-rendering", () => ({ enabled: true }));
    api.get("/api/preferences/log-level", () => ({ level: "info" }));

    const { getByText, user } = renderWithUser(<LoopDetails loopId={LOOP_ID} />);

    await waitFor(() => {
      expect(getByText("Completed Loop")).toBeTruthy();
    });

    await user.click(getByText("Actions"));

    await waitFor(() => {
      expect(getByText("Accept")).toBeTruthy();
      expect(getByText("Delete Loop")).toBeTruthy();
    });
  });

  test("pushed loop shows address comments, mark merged, and purge actions", async () => {
    const loop = createLoopWithStatus("pushed", {
      config: { id: LOOP_ID, name: "Pushed Loop" },
      state: {
        reviewMode: {
          addressable: true,
          completionAction: "push",
          reviewCycles: 1,
          reviewBranches: [],
        },
      },
    });
    api.get("/api/loops/:id", () => loop);
    api.get("/api/loops/:id/diff", () => []);
    api.get("/api/loops/:id/plan", () => ({ exists: false, content: "" }));
    api.get("/api/loops/:id/status-file", () => ({ exists: false, content: "" }));
    api.get("/api/loops/:id/comments", () => ({ success: true, comments: [] }));
    api.get("/api/models", () => []);
    api.get("/api/preferences/markdown-rendering", () => ({ enabled: true }));
    api.get("/api/preferences/log-level", () => ({ level: "info" }));

    const { getByText, user } = renderWithUser(<LoopDetails loopId={LOOP_ID} />);

    await waitFor(() => {
      expect(getByText("Pushed Loop")).toBeTruthy();
    });

    await user.click(getByText("Actions"));

    await waitFor(() => {
      expect(getByText("Address Comments")).toBeTruthy();
      expect(getByText("Mark as Merged")).toBeTruthy();
      expect(getByText("Purge Loop")).toBeTruthy();
    });
  });
});

// ─── Modals ──────────────────────────────────────────────────────────────────

describe("delete modal", () => {
  test("opens delete modal from actions tab", async () => {
    setupDefaultApi();
    const { getByText, user } = renderWithUser(<LoopDetails loopId={LOOP_ID} />);

    await waitFor(() => {
      expect(getByText("Test Loop")).toBeTruthy();
    });

    await user.click(getByText("Actions"));

    await waitFor(() => {
      expect(getByText("Delete Loop")).toBeTruthy();
    });

    // Click the Delete Loop action button in the actions tab
    const deleteBtn = Array.from(document.querySelectorAll("button")).find(
      (b) => b.textContent?.includes("Delete Loop") && b.textContent?.includes("Cancel and delete"),
    );
    expect(deleteBtn).toBeTruthy();
    await user.click(deleteBtn!);

    await waitFor(() => {
      // The DeleteLoopModal shows a confirmation
      expect(getByText(/Are you sure/)).toBeTruthy();
    });
  });
});

describe("accept modal", () => {
  test("opens accept modal from actions tab for completed loop", async () => {
    const loop = createLoopWithStatus("completed", {
      config: { id: LOOP_ID, name: "Accept Loop" },
    });
    api.get("/api/loops/:id", () => loop);
    api.get("/api/loops/:id/diff", () => []);
    api.get("/api/loops/:id/plan", () => ({ exists: false, content: "" }));
    api.get("/api/loops/:id/status-file", () => ({ exists: false, content: "" }));
    api.get("/api/loops/:id/comments", () => ({ success: true, comments: [] }));
    api.get("/api/models", () => []);
    api.get("/api/preferences/markdown-rendering", () => ({ enabled: true }));
    api.get("/api/preferences/log-level", () => ({ level: "info" }));

    const { getByText, user } = renderWithUser(<LoopDetails loopId={LOOP_ID} />);

    await waitFor(() => {
      expect(getByText("Accept Loop")).toBeTruthy();
    });

    await user.click(getByText("Actions"));

    await waitFor(() => {
      // The Accept action button in the actions tab
      const acceptBtn = Array.from(document.querySelectorAll("button")).find(
        (b) => b.textContent?.includes("Accept") && b.textContent?.includes("Accept changes"),
      );
      expect(acceptBtn).toBeTruthy();
    });

    const acceptBtn = Array.from(document.querySelectorAll("button")).find(
      (b) => b.textContent?.includes("Accept") && b.textContent?.includes("Accept changes"),
    );
    await user.click(acceptBtn!);

    await waitFor(() => {
      expect(getByText("Finalize Loop")).toBeTruthy();
    });
  });
});

describe("purge modal", () => {
  test("opens purge modal from actions tab for pushed loop", async () => {
    const loop = createLoopWithStatus("pushed", {
      config: { id: LOOP_ID, name: "Purge Loop" },
    });
    api.get("/api/loops/:id", () => loop);
    api.get("/api/loops/:id/diff", () => []);
    api.get("/api/loops/:id/plan", () => ({ exists: false, content: "" }));
    api.get("/api/loops/:id/status-file", () => ({ exists: false, content: "" }));
    api.get("/api/loops/:id/comments", () => ({ success: true, comments: [] }));
    api.get("/api/models", () => []);
    api.get("/api/preferences/markdown-rendering", () => ({ enabled: true }));
    api.get("/api/preferences/log-level", () => ({ level: "info" }));

    const { getByText, user } = renderWithUser(<LoopDetails loopId={LOOP_ID} />);

    await waitFor(() => {
      expect(getByText("Purge Loop")).toBeTruthy();
    });

    await user.click(getByText("Actions"));

    await waitFor(() => {
      const purgeBtn = Array.from(document.querySelectorAll("button")).find(
        (b) => b.textContent?.includes("Purge Loop") && b.textContent?.includes("Delete this loop"),
      );
      expect(purgeBtn).toBeTruthy();
    });

    const purgeBtn = Array.from(document.querySelectorAll("button")).find(
      (b) => b.textContent?.includes("Purge Loop") && b.textContent?.includes("Delete this loop"),
    );
    await user.click(purgeBtn!);

    await waitFor(() => {
      // Purge modal confirmation
      expect(getByText(/permanently delete/i)).toBeTruthy();
    });
  });
});

describe("address comments modal", () => {
  test("opens address comments modal from actions tab", async () => {
    const loop = createLoopWithStatus("pushed", {
      config: { id: LOOP_ID, name: "Comment Loop" },
      state: {
        reviewMode: {
          addressable: true,
          completionAction: "push",
          reviewCycles: 1,
          reviewBranches: [],
        },
      },
    });
    api.get("/api/loops/:id", () => loop);
    api.get("/api/loops/:id/diff", () => []);
    api.get("/api/loops/:id/plan", () => ({ exists: false, content: "" }));
    api.get("/api/loops/:id/status-file", () => ({ exists: false, content: "" }));
    api.get("/api/loops/:id/comments", () => ({ success: true, comments: [] }));
    api.get("/api/models", () => []);
    api.get("/api/preferences/markdown-rendering", () => ({ enabled: true }));
    api.get("/api/preferences/log-level", () => ({ level: "info" }));

    const { getByText, user } = renderWithUser(<LoopDetails loopId={LOOP_ID} />);

    await waitFor(() => {
      expect(getByText("Comment Loop")).toBeTruthy();
    });

    await user.click(getByText("Actions"));

    await waitFor(() => {
      const addrBtn = Array.from(document.querySelectorAll("button")).find(
        (b) => b.textContent?.includes("Address Comments") && b.textContent?.includes("Submit comments"),
      );
      expect(addrBtn).toBeTruthy();
    });

    const addrBtn = Array.from(document.querySelectorAll("button")).find(
      (b) => b.textContent?.includes("Address Comments") && b.textContent?.includes("Submit comments"),
    );
    await user.click(addrBtn!);

    await waitFor(() => {
      expect(getByText("Address Reviewer Comments")).toBeTruthy();
    });
  });
});

describe("mark merged modal", () => {
  test("opens mark merged modal from actions tab", async () => {
    const loop = createLoopWithStatus("pushed", {
      config: { id: LOOP_ID, name: "Merge Loop" },
    });
    api.get("/api/loops/:id", () => loop);
    api.get("/api/loops/:id/diff", () => []);
    api.get("/api/loops/:id/plan", () => ({ exists: false, content: "" }));
    api.get("/api/loops/:id/status-file", () => ({ exists: false, content: "" }));
    api.get("/api/loops/:id/comments", () => ({ success: true, comments: [] }));
    api.get("/api/models", () => []);
    api.get("/api/preferences/markdown-rendering", () => ({ enabled: true }));
    api.get("/api/preferences/log-level", () => ({ level: "info" }));

    const { getByText, user } = renderWithUser(<LoopDetails loopId={LOOP_ID} />);

    await waitFor(() => {
      expect(getByText("Merge Loop")).toBeTruthy();
    });

    await user.click(getByText("Actions"));

    await waitFor(() => {
      const mergeBtn = Array.from(document.querySelectorAll("button")).find(
        (b) => b.textContent?.includes("Mark as Merged") && b.textContent?.includes("Switch to base"),
      );
      expect(mergeBtn).toBeTruthy();
    });

    const mergeBtn = Array.from(document.querySelectorAll("button")).find(
      (b) => b.textContent?.includes("Mark as Merged") && b.textContent?.includes("Switch to base"),
    );
    await user.click(mergeBtn!);

    await waitFor(() => {
      // MarkMergedModal description about switching branches
      expect(getByText(/switch your repository back to the original branch/i)).toBeTruthy();
    });
  });
});

describe("rename modal", () => {
  test("opens rename modal when rename button is clicked", async () => {
    setupDefaultApi();
    const { getByText, container, user } = renderWithUser(
      <LoopDetails loopId={LOOP_ID} />,
    );

    await waitFor(() => {
      expect(getByText("Test Loop")).toBeTruthy();
    });

    const renameBtn = container.querySelector('button[aria-label="Rename loop"]');
    expect(renameBtn).toBeTruthy();

    await user.click(renameBtn as HTMLElement);

    await waitFor(() => {
      expect(getByText("Rename Loop")).toBeTruthy();
    });
  });
});

// ─── Planning mode ───────────────────────────────────────────────────────────

describe("planning mode", () => {
  test("shows unified tab UI with plan tab active when in planning status", async () => {
    const loop = createLoopWithStatus("planning", {
      config: { id: LOOP_ID, name: "Planning Loop" },
    });
    api.get("/api/loops/:id", () => loop);
    api.get("/api/loops/:id/diff", () => []);
    api.get("/api/loops/:id/plan", () => ({ exists: true, content: "# The Plan" }));
    api.get("/api/loops/:id/status-file", () => ({ exists: false, content: "" }));
    api.get("/api/loops/:id/comments", () => ({ success: true, comments: [] }));
    api.get("/api/models", () => []);
    api.get("/api/preferences/markdown-rendering", () => ({ enabled: true }));
    api.get("/api/preferences/log-level", () => ({ level: "info" }));

    const { getByText } = renderWithUser(<LoopDetails loopId={LOOP_ID} />);

    await waitFor(() => {
      expect(getByText("Planning Loop")).toBeTruthy();
    });

    // All tabs should be visible in the unified UI
    await waitFor(() => {
      expect(getByText("Plan")).toBeTruthy();
      expect(getByText("Actions")).toBeTruthy();
      expect(getByText("Log")).toBeTruthy();
    });
  });

  test("shows Planning status badge for planning loop", async () => {
    const loop = createLoopWithStatus("planning", {
      config: { id: LOOP_ID, name: "Planning Loop" },
    });
    api.get("/api/loops/:id", () => loop);
    api.get("/api/loops/:id/diff", () => []);
    api.get("/api/loops/:id/plan", () => ({ exists: false, content: "" }));
    api.get("/api/loops/:id/status-file", () => ({ exists: false, content: "" }));
    api.get("/api/loops/:id/comments", () => ({ success: true, comments: [] }));
    api.get("/api/models", () => []);
    api.get("/api/preferences/markdown-rendering", () => ({ enabled: true }));
    api.get("/api/preferences/log-level", () => ({ level: "info" }));

    const { getByText } = renderWithUser(<LoopDetails loopId={LOOP_ID} />);

    await waitFor(() => {
      expect(getByText("Planning")).toBeTruthy();
    });
  });

  test("shows Plan Ready badge when plan is ready for review", async () => {
    const loop = createLoopWithStatus("planning", {
      config: { id: LOOP_ID, name: "Plan Ready Loop" },
      state: {
        planMode: {
          active: true,
          feedbackRounds: 0,
          planningFolderCleared: false,
          isPlanReady: true,
        },
      },
    });
    api.get("/api/loops/:id", () => loop);
    api.get("/api/loops/:id/diff", () => []);
    api.get("/api/loops/:id/plan", () => ({ exists: true, content: "# Ready Plan" }));
    api.get("/api/loops/:id/status-file", () => ({ exists: false, content: "" }));
    api.get("/api/loops/:id/comments", () => ({ success: true, comments: [] }));
    api.get("/api/models", () => []);
    api.get("/api/preferences/markdown-rendering", () => ({ enabled: true }));
    api.get("/api/preferences/log-level", () => ({ level: "info" }));

    const { getByText } = renderWithUser(<LoopDetails loopId={LOOP_ID} />);

    await waitFor(() => {
      expect(getByText("Plan Ready")).toBeTruthy();
    });
  });

  test("shows spinner in log panel when planning with isPlanReady=false", async () => {
    // When status is "planning" and isPlanReady is false, the LogViewer
    // should receive isActive=true so it shows the "Working..." spinner
    const loop = createLoopWithStatus("planning", {
      config: { id: LOOP_ID, name: "Active Planning Loop" },
    });
    api.get("/api/loops/:id", () => loop);
    api.get("/api/loops/:id/diff", () => []);
    api.get("/api/loops/:id/plan", () => ({ exists: false, content: "" }));
    api.get("/api/loops/:id/status-file", () => ({ exists: false, content: "" }));
    api.get("/api/loops/:id/comments", () => ({ success: true, comments: [] }));
    api.get("/api/models", () => []);
    api.get("/api/preferences/markdown-rendering", () => ({ enabled: true }));
    api.get("/api/preferences/log-level", () => ({ level: "info" }));

    const { getByText, user } = renderWithUser(<LoopDetails loopId={LOOP_ID} />);

    await waitFor(() => {
      expect(getByText("Active Planning Loop")).toBeTruthy();
    });

    // Switch to Log tab (planning mode defaults to Plan tab)
    await user.click(getByText("Log"));

    // The LogViewer should show the spinner since isPlanReady is false
    await waitFor(() => {
      expect(getByText("Working...")).toBeTruthy();
    });
  });

  test("does not show spinner in log panel when planning with isPlanReady=true", async () => {
    // When status is "planning" and isPlanReady is true, the LogViewer
    // should receive isActive=false so it shows "No logs yet. Waiting for activity."
    const loop = createLoopWithStatus("planning", {
      config: { id: LOOP_ID, name: "Plan Ready No Spinner" },
      state: {
        planMode: {
          active: true,
          feedbackRounds: 0,
          planningFolderCleared: false,
          isPlanReady: true,
        },
      },
    });
    api.get("/api/loops/:id", () => loop);
    api.get("/api/loops/:id/diff", () => []);
    api.get("/api/loops/:id/plan", () => ({ exists: true, content: "# Plan" }));
    api.get("/api/loops/:id/status-file", () => ({ exists: false, content: "" }));
    api.get("/api/loops/:id/comments", () => ({ success: true, comments: [] }));
    api.get("/api/models", () => []);
    api.get("/api/preferences/markdown-rendering", () => ({ enabled: true }));
    api.get("/api/preferences/log-level", () => ({ level: "info" }));

    const { getByText, queryByText, user } = renderWithUser(<LoopDetails loopId={LOOP_ID} />);

    await waitFor(() => {
      expect(getByText("Plan Ready No Spinner")).toBeTruthy();
    });

    // Switch to Log tab
    await user.click(getByText("Log"));

    // The LogViewer should NOT show the spinner since isPlanReady is true
    await waitFor(() => {
      expect(getByText("No logs yet. Waiting for activity.")).toBeTruthy();
    });
    expect(queryByText("Working...")).toBeNull();
  });

  test("shows pulsing cyan activity indicator when planning with isPlanReady=false", async () => {
    const loop = createLoopWithStatus("planning", {
      config: { id: LOOP_ID, name: "Cyan Indicator Loop" },
    });
    api.get("/api/loops/:id", () => loop);
    api.get("/api/loops/:id/diff", () => []);
    api.get("/api/loops/:id/plan", () => ({ exists: false, content: "" }));
    api.get("/api/loops/:id/status-file", () => ({ exists: false, content: "" }));
    api.get("/api/loops/:id/comments", () => ({ success: true, comments: [] }));
    api.get("/api/models", () => []);
    api.get("/api/preferences/markdown-rendering", () => ({ enabled: true }));
    api.get("/api/preferences/log-level", () => ({ level: "info" }));

    const { getByText, container } = renderWithUser(<LoopDetails loopId={LOOP_ID} />);

    await waitFor(() => {
      expect(getByText("Cyan Indicator Loop")).toBeTruthy();
    });

    // Should have a pulsing cyan indicator (animate-ping + bg-cyan-400)
    const header = container.querySelector("header");
    expect(header).toBeTruthy();
    const cyanPinger = header!.querySelector(".animate-ping.bg-cyan-400");
    expect(cyanPinger).toBeTruthy();

    // Should NOT have a blue pulsing indicator (that's for running state)
    const bluePinger = header!.querySelector(".animate-ping.bg-blue-400");
    expect(bluePinger).toBeNull();
  });

  test("shows static amber activity indicator when planning with isPlanReady=true", async () => {
    const loop = createLoopWithStatus("planning", {
      config: { id: LOOP_ID, name: "Amber Indicator Loop" },
      state: {
        planMode: {
          active: true,
          feedbackRounds: 0,
          planningFolderCleared: false,
          isPlanReady: true,
        },
      },
    });
    api.get("/api/loops/:id", () => loop);
    api.get("/api/loops/:id/diff", () => []);
    api.get("/api/loops/:id/plan", () => ({ exists: true, content: "# Plan" }));
    api.get("/api/loops/:id/status-file", () => ({ exists: false, content: "" }));
    api.get("/api/loops/:id/comments", () => ({ success: true, comments: [] }));
    api.get("/api/models", () => []);
    api.get("/api/preferences/markdown-rendering", () => ({ enabled: true }));
    api.get("/api/preferences/log-level", () => ({ level: "info" }));

    const { getByText, container } = renderWithUser(<LoopDetails loopId={LOOP_ID} />);

    await waitFor(() => {
      expect(getByText("Amber Indicator Loop")).toBeTruthy();
    });

    // Should have a static amber dot (bg-amber-500 without animate-ping)
    const header = container.querySelector("header");
    expect(header).toBeTruthy();
    const amberDot = header!.querySelector(".bg-amber-500");
    expect(amberDot).toBeTruthy();

    // Should NOT have any animate-ping element (amber dot is static)
    const pinger = header!.querySelector(".animate-ping");
    expect(pinger).toBeNull();
  });

  test("running loop shows pulsing blue indicator, not planning indicators", async () => {
    setupDefaultApi();
    const { getByText, container } = renderWithUser(<LoopDetails loopId={LOOP_ID} />);

    await waitFor(() => {
      expect(getByText("Test Loop")).toBeTruthy();
    });

    // Should have a pulsing blue indicator
    const header = container.querySelector("header");
    expect(header).toBeTruthy();
    const bluePinger = header!.querySelector(".animate-ping.bg-blue-400");
    expect(bluePinger).toBeTruthy();

    // Should NOT have cyan or amber indicators
    const cyanPinger = header!.querySelector(".animate-ping.bg-cyan-400");
    expect(cyanPinger).toBeNull();
    const amberDot = header!.querySelector(".bg-amber-500");
    expect(amberDot).toBeNull();
  });
});

// ─── LoopActionBar ───────────────────────────────────────────────────────────

describe("loop action bar", () => {
  test("shows action bar for active loops", async () => {
    setupDefaultApi();
    const { container } = renderWithUser(<LoopDetails loopId={LOOP_ID} />);

    await waitFor(() => {
      // The LoopActionBar has a text input for messaging
      const input = container.querySelector("input[type='text']");
      expect(input).toBeTruthy();
    });
  });

  test("does not show action bar for final-state loops", async () => {
    const loop = createLoopWithStatus("merged", {
      config: { id: LOOP_ID, name: "Merged Loop" },
    });
    api.get("/api/loops/:id", () => loop);
    api.get("/api/loops/:id/diff", () => []);
    api.get("/api/loops/:id/plan", () => ({ exists: false, content: "" }));
    api.get("/api/loops/:id/status-file", () => ({ exists: false, content: "" }));
    api.get("/api/loops/:id/comments", () => ({ success: true, comments: [] }));
    api.get("/api/models", () => []);
    api.get("/api/preferences/markdown-rendering", () => ({ enabled: true }));
    api.get("/api/preferences/log-level", () => ({ level: "info" }));

    const { getByText, container } = renderWithUser(<LoopDetails loopId={LOOP_ID} />);

    await waitFor(() => {
      expect(getByText("Merged Loop")).toBeTruthy();
    });

    // The action bar should not be present for merged loops (final state, not jumpstartable)
    const input = container.querySelector("input[type='text']");
    expect(input).toBeNull();
  });
});

// ─── Error display ───────────────────────────────────────────────────────────

describe("error display", () => {
  test("shows loop error when loop has error state", async () => {
    const loop = createLoopWithStatus("failed", {
      config: { id: LOOP_ID, name: "Failed Loop" },
      state: {
        error: {
          message: "Something went wrong in iteration 2",
          iteration: 2,
          timestamp: new Date().toISOString(),
        },
      },
    });
    api.get("/api/loops/:id", () => loop);
    api.get("/api/loops/:id/diff", () => []);
    api.get("/api/loops/:id/plan", () => ({ exists: false, content: "" }));
    api.get("/api/loops/:id/status-file", () => ({ exists: false, content: "" }));
    api.get("/api/loops/:id/comments", () => ({ success: true, comments: [] }));
    api.get("/api/models", () => []);
    api.get("/api/preferences/markdown-rendering", () => ({ enabled: true }));
    api.get("/api/preferences/log-level", () => ({ level: "info" }));

    const { getByText } = renderWithUser(<LoopDetails loopId={LOOP_ID} />);

    await waitFor(() => {
      expect(getByText("Loop Error")).toBeTruthy();
    });
    expect(getByText("Something went wrong in iteration 2")).toBeTruthy();
    expect(getByText(/Iteration: 2/)).toBeTruthy();
  });
});

// ─── Log tab details ─────────────────────────────────────────────────────────

describe("log tab", () => {
  test("shows Logs and TODOs sections", async () => {
    setupDefaultApi();
    const { getByText } = renderWithUser(<LoopDetails loopId={LOOP_ID} />);

    await waitFor(() => {
      expect(getByText("Logs")).toBeTruthy();
    });
    expect(getByText("TODOs")).toBeTruthy();
  });

  test("shows log filter checkboxes", async () => {
    setupDefaultApi();
    const { getByText } = renderWithUser(<LoopDetails loopId={LOOP_ID} />);

    await waitFor(() => {
      expect(getByText("Show system info")).toBeTruthy();
      expect(getByText("Show reasoning")).toBeTruthy();
      expect(getByText("Show tools")).toBeTruthy();
    });
  });

  test("shows autoscroll toggle", async () => {
    setupDefaultApi();
    const { getByText } = renderWithUser(<LoopDetails loopId={LOOP_ID} />);

    await waitFor(() => {
      expect(getByText("Autoscroll")).toBeTruthy();
    });
  });
});

// ─── Prompt tab details ──────────────────────────────────────────────────────

describe("prompt tab", () => {
  test("shows pending prompt when loop has one", async () => {
    const loop = createLoopWithStatus("running", {
      config: { id: LOOP_ID, name: "Pending Loop", prompt: "Initial task" },
      state: {
        pendingPrompt: "Please also fix the tests",
      },
    });
    api.get("/api/loops/:id", () => loop);
    api.get("/api/loops/:id/diff", () => []);
    api.get("/api/loops/:id/plan", () => ({ exists: false, content: "" }));
    api.get("/api/loops/:id/status-file", () => ({ exists: false, content: "" }));
    api.get("/api/loops/:id/comments", () => ({ success: true, comments: [] }));
    api.get("/api/models", () => []);
    api.get("/api/preferences/markdown-rendering", () => ({ enabled: true }));
    api.get("/api/preferences/log-level", () => ({ level: "info" }));

    const { getByText, user } = renderWithUser(<LoopDetails loopId={LOOP_ID} />);

    await waitFor(() => {
      expect(getByText("Pending Loop")).toBeTruthy();
    });

    await user.click(getByText("Prompt"));

    await waitFor(() => {
      expect(getByText("Queued Message")).toBeTruthy();
      // The pending prompt text appears both in the Prompt tab <pre> and in the LoopActionBar
      const matches = document.querySelectorAll("pre");
      const pendingPre = Array.from(matches).find(
        (el) => el.textContent === "Please also fix the tests",
      );
      expect(pendingPre).toBeTruthy();
    });
  });

  test("shows tip about action bar for active loops", async () => {
    setupDefaultApi();
    const { getByText, user } = renderWithUser(<LoopDetails loopId={LOOP_ID} />);

    await waitFor(() => {
      expect(getByText("Test Loop")).toBeTruthy();
    });

    await user.click(getByText("Prompt"));

    await waitFor(() => {
      expect(getByText(/Use the action bar/)).toBeTruthy();
    });
  });

  test("shows info message for non-active loops", async () => {
    const loop = createLoopWithStatus("completed", {
      config: { id: LOOP_ID, name: "Done Loop", prompt: "Fix bug" },
    });
    api.get("/api/loops/:id", () => loop);
    api.get("/api/loops/:id/diff", () => []);
    api.get("/api/loops/:id/plan", () => ({ exists: false, content: "" }));
    api.get("/api/loops/:id/status-file", () => ({ exists: false, content: "" }));
    api.get("/api/loops/:id/comments", () => ({ success: true, comments: [] }));
    api.get("/api/models", () => []);
    api.get("/api/preferences/markdown-rendering", () => ({ enabled: true }));
    api.get("/api/preferences/log-level", () => ({ level: "info" }));

    const { getByText, user } = renderWithUser(<LoopDetails loopId={LOOP_ID} />);

    await waitFor(() => {
      expect(getByText("Done Loop")).toBeTruthy();
    });

    await user.click(getByText("Prompt"));

    await waitFor(() => {
      expect(getByText(/Messages can only be queued/)).toBeTruthy();
    });
  });
});

// ─── Status badge variations ─────────────────────────────────────────────────

describe("status badge variations", () => {
  const statuses = [
    { status: "completed" as const, label: "Completed" },
    { status: "failed" as const, label: "Failed" },
    { status: "stopped" as const, label: "Stopped" },
    { status: "merged" as const, label: "Merged" },
    { status: "pushed" as const, label: "Pushed" },
    { status: "deleted" as const, label: "Deleted" },
  ];

  for (const { status, label } of statuses) {
    test(`shows ${label} badge for ${status} loop`, async () => {
      const loop = createLoopWithStatus(status, {
        config: { id: LOOP_ID, name: `${label} Loop` },
      });
      api.get("/api/loops/:id", () => loop);
      api.get("/api/loops/:id/diff", () => []);
      api.get("/api/loops/:id/plan", () => ({ exists: false, content: "" }));
      api.get("/api/loops/:id/status-file", () => ({ exists: false, content: "" }));
      api.get("/api/loops/:id/comments", () => ({ success: true, comments: [] }));
      api.get("/api/models", () => []);
      api.get("/api/preferences/markdown-rendering", () => ({ enabled: true }));
      api.get("/api/preferences/log-level", () => ({ level: "info" }));

      const { getByText } = renderWithUser(<LoopDetails loopId={LOOP_ID} />);

      await waitFor(() => {
        expect(getByText(label)).toBeTruthy();
      });
    });
  }
});

// ─── Review tab comment history ──────────────────────────────────────────────

describe("review tab comment history", () => {
  test("shows comments grouped by review cycle", async () => {
    const loop = createLoopWithStatus("pushed", {
      config: { id: LOOP_ID, name: "Review Loop" },
      state: {
        reviewMode: {
          addressable: true,
          completionAction: "push",
          reviewCycles: 2,
          reviewBranches: [],
        },
      },
    });
    api.get("/api/loops/:id", () => loop);
    api.get("/api/loops/:id/diff", () => []);
    api.get("/api/loops/:id/plan", () => ({ exists: false, content: "" }));
    api.get("/api/loops/:id/status-file", () => ({ exists: false, content: "" }));
    api.get("/api/loops/:id/comments", () => ({
      success: true,
      comments: [
        {
          id: "c1",
          loopId: LOOP_ID,
          reviewCycle: 1,
          commentText: "Fix the formatting",
          status: "addressed",
          createdAt: new Date().toISOString(),
          addressedAt: new Date().toISOString(),
        },
        {
          id: "c2",
          loopId: LOOP_ID,
          reviewCycle: 2,
          commentText: "Add more tests",
          status: "pending",
          createdAt: new Date().toISOString(),
        },
      ],
    }));
    api.get("/api/models", () => []);
    api.get("/api/preferences/markdown-rendering", () => ({ enabled: true }));
    api.get("/api/preferences/log-level", () => ({ level: "info" }));

    const { getByText, user } = renderWithUser(<LoopDetails loopId={LOOP_ID} />);

    await waitFor(() => {
      expect(getByText("Review Loop")).toBeTruthy();
    });

    await user.click(getByText("Review"));

    await waitFor(() => {
      expect(getByText("Review Cycle 1")).toBeTruthy();
      expect(getByText("Review Cycle 2")).toBeTruthy();
    });
    expect(getByText("Fix the formatting")).toBeTruthy();
    expect(getByText("Add more tests")).toBeTruthy();
    expect(getByText("Addressed")).toBeTruthy();
    expect(getByText("Pending")).toBeTruthy();
  });

  test("shows no comments message when empty", async () => {
    const loop = createLoopWithStatus("pushed", {
      config: { id: LOOP_ID, name: "Review Loop" },
      state: {
        reviewMode: {
          addressable: true,
          completionAction: "push",
          reviewCycles: 0,
          reviewBranches: [],
        },
      },
    });
    api.get("/api/loops/:id", () => loop);
    api.get("/api/loops/:id/diff", () => []);
    api.get("/api/loops/:id/plan", () => ({ exists: false, content: "" }));
    api.get("/api/loops/:id/status-file", () => ({ exists: false, content: "" }));
    api.get("/api/loops/:id/comments", () => ({ success: true, comments: [] }));
    api.get("/api/models", () => []);
    api.get("/api/preferences/markdown-rendering", () => ({ enabled: true }));
    api.get("/api/preferences/log-level", () => ({ level: "info" }));

    const { getByText, user } = renderWithUser(<LoopDetails loopId={LOOP_ID} />);

    await waitFor(() => {
      expect(getByText("Review Loop")).toBeTruthy();
    });

    await user.click(getByText("Review"));

    await waitFor(() => {
      expect(getByText("No comments yet.")).toBeTruthy();
    });
  });
});
