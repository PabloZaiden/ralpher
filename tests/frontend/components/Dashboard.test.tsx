/**
 * Tests for Dashboard component.
 *
 * Tests loop grid rendering grouped by workspace/status, header elements,
 * modal flows, navigation, connection status, and error display.
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { createMockApi } from "../helpers/mock-api";
import { createMockWebSocket } from "../helpers/mock-websocket";
import { renderWithUser, waitFor, act } from "../helpers/render";
import { createLoop, createLoopWithStatus, createWorkspace } from "../helpers/factories";
import { Dashboard } from "@/components/Dashboard";

const api = createMockApi();
const ws = createMockWebSocket();

/** Set up the default API routes Dashboard requires. */
function setupDefaultApi() {
  api.get("/api/loops", () => []);
  api.get("/api/workspaces", () => []);
  api.get("/api/config", () => ({ remoteOnly: false }));
  api.get("/api/health", () => ({ status: "ok", version: "1.0.0" }));
  api.get("/api/preferences/last-model", () => null);
  api.get("/api/preferences/log-level", () => ({ level: "info" }));
  api.get("/api/models", () => []);
  api.get("/api/check-planning-dir", () => ({ warning: null }));
  api.get("/api/git/branches", () => ({ branches: [], currentBranch: "" }));
  api.get("/api/git/default-branch", () => ({ defaultBranch: "main" }));
  // Workspace settings (used by useWorkspaceServerSettings hook)
  api.get("/api/workspaces/:id", () => null);
  api.get("/api/workspaces/:id/status", () => null);
}

beforeEach(() => {
  api.reset();
  api.install();
  ws.reset();
  ws.install();
  setupDefaultApi();
});

afterEach(() => {
  api.uninstall();
  ws.uninstall();
});

// ─── Header rendering ───────────────────────────────────────────────────────

describe("header rendering", () => {
  test("renders title 'Ralpher'", async () => {
    const { getByText } = renderWithUser(<Dashboard />);

    await waitFor(() => {
      expect(getByText("Ralpher")).toBeTruthy();
    });
  });

  test("renders version from health API", async () => {
    api.get("/api/health", () => ({ status: "ok", version: "2.3.1" }));

    const { getByText } = renderWithUser(<Dashboard />);

    await waitFor(() => {
      expect(getByText("v2.3.1")).toBeTruthy();
    });
  });

  test("renders New Loop button", async () => {
    const { getByRole } = renderWithUser(<Dashboard />);

    await waitFor(() => {
      expect(getByRole("button", { name: "New Loop" })).toBeTruthy();
    });
  });

  test("renders New Workspace button", async () => {
    const { getByRole } = renderWithUser(<Dashboard />);

    await waitFor(() => {
      expect(getByRole("button", { name: "New Workspace" })).toBeTruthy();
    });
  });

  test("renders Settings button", async () => {
    const { getByTitle } = renderWithUser(<Dashboard />);

    await waitFor(() => {
      expect(getByTitle("App Settings")).toBeTruthy();
    });
  });
});

// ─── Connection status ──────────────────────────────────────────────────────

describe("connection status", () => {
  test("shows Connected when WebSocket is open", async () => {
    const { getByText } = renderWithUser(<Dashboard />);

    // WebSocket auto-opens in mock, so useLoops should report "open"
    await waitFor(() => {
      expect(getByText("Connected")).toBeTruthy();
    });
  });
});

// ─── Empty state ────────────────────────────────────────────────────────────

describe("empty state", () => {
  test("shows 'No loops yet' when no loops exist", async () => {
    const { getByText } = renderWithUser(<Dashboard />);

    await waitFor(() => {
      expect(getByText("No loops yet")).toBeTruthy();
    });
    expect(getByText(/Click "New Loop"/)).toBeTruthy();
  });
});

// ─── Loop grid rendering ────────────────────────────────────────────────────

describe("loop grid rendering", () => {
  test("renders loops grouped by workspace", async () => {
    const ws1 = createWorkspace({ id: "ws-1", name: "Frontend" });
    const ws2 = createWorkspace({ id: "ws-2", name: "Backend" });
    const loop1 = createLoopWithStatus("running", {
      config: { id: "l1", name: "Fix UI bug", workspaceId: "ws-1" },
    });
    const loop2 = createLoopWithStatus("completed", {
      config: { id: "l2", name: "Add API endpoint", workspaceId: "ws-2" },
    });

    api.get("/api/loops", () => [loop1, loop2]);
    api.get("/api/workspaces", () => [ws1, ws2]);

    const { getByText } = renderWithUser(<Dashboard />);

    await waitFor(() => {
      expect(getByText("Frontend")).toBeTruthy();
      expect(getByText("Backend")).toBeTruthy();
    });
    expect(getByText("Fix UI bug")).toBeTruthy();
    expect(getByText("Add API endpoint")).toBeTruthy();
  });

  test("renders workspace directory and loop count", async () => {
    const workspace = createWorkspace({
      id: "ws-1",
      name: "My Project",
      directory: "/home/user/my-project",
    });
    const loop = createLoopWithStatus("running", {
      config: { id: "l1", name: "Task 1", workspaceId: "ws-1" },
    });

    api.get("/api/loops", () => [loop]);
    api.get("/api/workspaces", () => [workspace]);

    const { getByText } = renderWithUser(<Dashboard />);

    await waitFor(() => {
      expect(getByText("/home/user/my-project")).toBeTruthy();
    });
    expect(getByText("(1 loop)")).toBeTruthy();
  });

  test("renders status group headers for active loops", async () => {
    const workspace = createWorkspace({ id: "ws-1", name: "Project" });
    const runningLoop = createLoopWithStatus("running", {
      config: { id: "l1", name: "Running Task", workspaceId: "ws-1" },
    });
    const completedLoop = createLoopWithStatus("completed", {
      config: { id: "l2", name: "Done Task", workspaceId: "ws-1" },
    });

    api.get("/api/loops", () => [runningLoop, completedLoop]);
    api.get("/api/workspaces", () => [workspace]);

    const { getByText } = renderWithUser(<Dashboard />);

    await waitFor(() => {
      expect(getByText("Active (1)")).toBeTruthy();
    });
    expect(getByText("Completed (1)")).toBeTruthy();
  });

  test("renders draft loops in Drafts section", async () => {
    const workspace = createWorkspace({ id: "ws-1", name: "Project" });
    const draftLoop = createLoopWithStatus("draft", {
      config: { id: "l1", name: "Draft Task", workspaceId: "ws-1" },
    });

    api.get("/api/loops", () => [draftLoop]);
    api.get("/api/workspaces", () => [workspace]);

    const { getByText } = renderWithUser(<Dashboard />);

    await waitFor(() => {
      expect(getByText("Drafts (1)")).toBeTruthy();
    });
    expect(getByText("Draft Task")).toBeTruthy();
  });

  test("renders awaiting feedback loops in correct section", async () => {
    const workspace = createWorkspace({ id: "ws-1", name: "Project" });
    const pushedLoop = createLoopWithStatus("pushed", {
      config: { id: "l1", name: "Pushed Task", workspaceId: "ws-1" },
      state: {
        reviewMode: {
          addressable: true,
          completionAction: "push",
          reviewCycles: 1,
          reviewBranches: [],
        },
      },
    });

    api.get("/api/loops", () => [pushedLoop]);
    api.get("/api/workspaces", () => [workspace]);

    const { getByText } = renderWithUser(<Dashboard />);

    await waitFor(() => {
      expect(getByText("Awaiting Feedback (1)")).toBeTruthy();
    });
  });

  test("renders unassigned loops when loop has no workspace", async () => {
    const loop = createLoopWithStatus("running", {
      config: { id: "l1", name: "Orphan Loop", workspaceId: "" },
    });

    api.get("/api/loops", () => [loop]);
    api.get("/api/workspaces", () => []);

    const { getByText } = renderWithUser(<Dashboard />);

    await waitFor(() => {
      expect(getByText("Unassigned")).toBeTruthy();
    });
    expect(getByText("Orphan Loop")).toBeTruthy();
  });

  test("renders archived loops (merged/pushed/deleted)", async () => {
    const workspace = createWorkspace({ id: "ws-1", name: "Project" });
    const mergedLoop = createLoopWithStatus("merged", {
      config: { id: "l1", name: "Merged Loop", workspaceId: "ws-1" },
    });

    api.get("/api/loops", () => [mergedLoop]);
    api.get("/api/workspaces", () => [workspace]);

    const { getByText } = renderWithUser(<Dashboard />);

    await waitFor(() => {
      expect(getByText("Archived (1)")).toBeTruthy();
    });
  });
});

// ─── Loop card click navigation ─────────────────────────────────────────────

describe("loop card click navigation", () => {
  test("calls onSelectLoop when an active loop card is clicked", async () => {
    const workspace = createWorkspace({ id: "ws-1", name: "Project" });
    const loop = createLoopWithStatus("running", {
      config: { id: "loop-123", name: "Click Me", workspaceId: "ws-1" },
    });

    api.get("/api/loops", () => [loop]);
    api.get("/api/workspaces", () => [workspace]);

    let selectedLoopId: string | undefined;
    const { getByText, user } = renderWithUser(
      <Dashboard onSelectLoop={(id) => { selectedLoopId = id; }} />,
    );

    await waitFor(() => {
      expect(getByText("Click Me")).toBeTruthy();
    });

    await user.click(getByText("Click Me"));

    expect(selectedLoopId).toBe("loop-123");
  });

  test("calls onSelectLoop when a completed loop card is clicked", async () => {
    const workspace = createWorkspace({ id: "ws-1", name: "Project" });
    const loop = createLoopWithStatus("completed", {
      config: { id: "loop-456", name: "Done Loop", workspaceId: "ws-1" },
    });

    api.get("/api/loops", () => [loop]);
    api.get("/api/workspaces", () => [workspace]);

    let selectedLoopId: string | undefined;
    const { getByText, user } = renderWithUser(
      <Dashboard onSelectLoop={(id) => { selectedLoopId = id; }} />,
    );

    await waitFor(() => {
      expect(getByText("Done Loop")).toBeTruthy();
    });

    await user.click(getByText("Done Loop"));

    expect(selectedLoopId).toBe("loop-456");
  });
});

// ─── Create loop modal ──────────────────────────────────────────────────────

describe("create loop modal", () => {
  test("opens create loop modal when 'New Loop' is clicked", async () => {
    const { getByRole, getByText, user } = renderWithUser(<Dashboard />);

    await waitFor(() => {
      expect(getByRole("button", { name: "New Loop" })).toBeTruthy();
    });

    await user.click(getByRole("button", { name: "New Loop" }));

    await waitFor(() => {
      expect(getByText("Create New Loop")).toBeTruthy();
    });
  });

  test("closes create loop modal on cancel", async () => {
    const { getByRole, getByText, queryByText, user } = renderWithUser(<Dashboard />);

    await waitFor(() => {
      expect(getByRole("button", { name: "New Loop" })).toBeTruthy();
    });

    await user.click(getByRole("button", { name: "New Loop" }));

    await waitFor(() => {
      expect(getByText("Create New Loop")).toBeTruthy();
    });

    // The modal has a Cancel button in footer
    await user.click(getByRole("button", { name: "Cancel" }));

    await waitFor(() => {
      expect(queryByText("Create New Loop")).toBeNull();
    });
  });
});

// ─── Delete loop modal ──────────────────────────────────────────────────────

describe("delete loop modal", () => {
  test("opens delete modal when delete action is triggered on loop card", async () => {
    const workspace = createWorkspace({ id: "ws-1", name: "Project" });
    const loop = createLoopWithStatus("completed", {
      config: { id: "l1", name: "Delete Me", workspaceId: "ws-1" },
    });

    api.get("/api/loops", () => [loop]);
    api.get("/api/workspaces", () => [workspace]);
    api.delete("/api/loops/:id", () => ({ success: true }));

    const { getByText, getByRole, user } = renderWithUser(<Dashboard />);

    await waitFor(() => {
      expect(getByText("Delete Me")).toBeTruthy();
    });

    // LoopCard renders a Delete button for completed loops
    const deleteButtons = document.querySelectorAll('button');
    const deleteBtn = Array.from(deleteButtons).find(b => b.textContent === 'Delete');
    expect(deleteBtn).toBeTruthy();

    await user.click(deleteBtn!);

    await waitFor(() => {
      expect(getByText("Delete Loop")).toBeTruthy();
    });
  });
});

// ─── Accept loop modal ──────────────────────────────────────────────────────

describe("accept loop modal", () => {
  test("opens accept modal when accept action is triggered on completed loop", async () => {
    const workspace = createWorkspace({ id: "ws-1", name: "Project" });
    const loop = createLoopWithStatus("completed", {
      config: { id: "l1", name: "Accept Me", workspaceId: "ws-1" },
    });

    api.get("/api/loops", () => [loop]);
    api.get("/api/workspaces", () => [workspace]);

    const { getByText, user } = renderWithUser(<Dashboard />);

    await waitFor(() => {
      expect(getByText("Accept Me")).toBeTruthy();
    });

    // LoopCard renders an "Accept" button for completed loops
    const buttons = document.querySelectorAll('button');
    const acceptBtn = Array.from(buttons).find(b => b.textContent === 'Accept');
    expect(acceptBtn).toBeTruthy();

    await user.click(acceptBtn!);

    await waitFor(() => {
      // AcceptLoopModal shows "Finalize Loop" heading
      expect(getByText("Finalize Loop")).toBeTruthy();
    });
  });
});

// ─── Purge loop modal ───────────────────────────────────────────────────────

describe("purge loop modal", () => {
  test("opens purge modal for archived loops", async () => {
    const workspace = createWorkspace({ id: "ws-1", name: "Project" });
    const loop = createLoopWithStatus("merged", {
      config: { id: "l1", name: "Purge Me", workspaceId: "ws-1" },
    });

    api.get("/api/loops", () => [loop]);
    api.get("/api/workspaces", () => [workspace]);

    const { getByText, user } = renderWithUser(<Dashboard />);

    await waitFor(() => {
      expect(getByText("Purge Me")).toBeTruthy();
    });

    // LoopCard renders a "Purge" button for archived loops
    const buttons = document.querySelectorAll('button');
    const purgeBtn = Array.from(buttons).find(b => b.textContent === 'Purge');
    expect(purgeBtn).toBeTruthy();

    await user.click(purgeBtn!);

    await waitFor(() => {
      expect(getByText("Purge Loop")).toBeTruthy();
    });
  });
});

// ─── Address comments modal ─────────────────────────────────────────────────

describe("address comments modal", () => {
  test("opens address comments modal for awaiting feedback loops", async () => {
    const workspace = createWorkspace({ id: "ws-1", name: "Project" });
    const loop = createLoopWithStatus("pushed", {
      config: { id: "l1", name: "Comment Loop", workspaceId: "ws-1" },
      state: {
        reviewMode: {
          addressable: true,
          completionAction: "push",
          reviewCycles: 1,
          reviewBranches: [],
        },
      },
    });

    api.get("/api/loops", () => [loop]);
    api.get("/api/workspaces", () => [workspace]);

    const { getByText, user } = renderWithUser(<Dashboard />);

    await waitFor(() => {
      expect(getByText("Comment Loop")).toBeTruthy();
    });

    // LoopCard renders "Address Comments" button for addressable loops
    const buttons = document.querySelectorAll('button');
    const addressBtn = Array.from(buttons).find(b => b.textContent?.includes('Address Comments'));
    expect(addressBtn).toBeTruthy();

    await user.click(addressBtn!);

    await waitFor(() => {
      expect(getByText("Address Reviewer Comments")).toBeTruthy();
    });
  });
});

// ─── Rename loop modal ──────────────────────────────────────────────────────

describe("rename loop modal", () => {
  test("opens rename modal when rename is triggered", async () => {
    const workspace = createWorkspace({ id: "ws-1", name: "Project" });
    const loop = createLoopWithStatus("running", {
      config: { id: "l1", name: "Rename Me", workspaceId: "ws-1" },
    });

    api.get("/api/loops", () => [loop]);
    api.get("/api/workspaces", () => [workspace]);

    const { getByText, user, getByLabelText } = renderWithUser(<Dashboard />);

    await waitFor(() => {
      expect(getByText("Rename Me")).toBeTruthy();
    });

    // LoopCard renders a rename button with aria-label "Rename loop"
    const renameBtn = document.querySelector('button[aria-label="Rename loop"]');
    expect(renameBtn).toBeTruthy();

    await user.click(renameBtn as HTMLElement);

    await waitFor(() => {
      expect(getByText("Rename Loop")).toBeTruthy();
    });
  });
});

// ─── App settings modal ─────────────────────────────────────────────────────

describe("app settings modal", () => {
  test("opens app settings modal when settings button is clicked", async () => {
    const { getByTitle, getByText, user } = renderWithUser(<Dashboard />);

    await waitFor(() => {
      expect(getByTitle("App Settings")).toBeTruthy();
    });

    await user.click(getByTitle("App Settings"));

    await waitFor(() => {
      expect(getByText("App Settings")).toBeTruthy();
    });
  });
});

// ─── Create workspace modal ─────────────────────────────────────────────────

describe("create workspace modal", () => {
  test("opens create workspace modal when 'New Workspace' is clicked", async () => {
    const { getByRole, getByText, user } = renderWithUser(<Dashboard />);

    await waitFor(() => {
      expect(getByRole("button", { name: "New Workspace" })).toBeTruthy();
    });

    await user.click(getByRole("button", { name: "New Workspace" }));

    await waitFor(() => {
      expect(getByRole("heading", { name: "Create Workspace" })).toBeTruthy();
    });
  });
});

// ─── Empty workspaces section ───────────────────────────────────────────────

describe("empty workspaces section", () => {
  test("shows empty workspaces that have no loops", async () => {
    const workspace = createWorkspace({ id: "ws-1", name: "Empty Project" });

    api.get("/api/loops", () => []);
    api.get("/api/workspaces", () => [workspace]);

    const { getByText } = renderWithUser(<Dashboard />);

    await waitFor(() => {
      expect(getByText("Empty Workspaces")).toBeTruthy();
    });
    expect(getByText("Empty Project")).toBeTruthy();
  });
});

// ─── Error display ──────────────────────────────────────────────────────────

describe("error display", () => {
  test("displays error message when loops fail to load", async () => {
    // Override the default loops handler to return an error
    api.get("/api/loops", () => {
      throw { status: 500, body: { error: "server_error" } };
    });

    const { getByText } = renderWithUser(<Dashboard />);

    await waitFor(() => {
      // The useLoops hook sets an error string on failed fetch
      expect(getByText(/Failed to fetch loops/)).toBeTruthy();
    });
  });
});

// ─── Multiple status groups ─────────────────────────────────────────────────

describe("multiple status groups in same workspace", () => {
  test("renders all status groups for a workspace with mixed loops", async () => {
    const workspace = createWorkspace({ id: "ws-1", name: "Full Project" });
    const draft = createLoopWithStatus("draft", {
      config: { id: "d1", name: "Draft 1", workspaceId: "ws-1" },
    });
    const running = createLoopWithStatus("running", {
      config: { id: "r1", name: "Running 1", workspaceId: "ws-1" },
    });
    const completed = createLoopWithStatus("completed", {
      config: { id: "c1", name: "Completed 1", workspaceId: "ws-1" },
    });

    api.get("/api/loops", () => [draft, running, completed]);
    api.get("/api/workspaces", () => [workspace]);

    const { getByText } = renderWithUser(<Dashboard />);

    await waitFor(() => {
      expect(getByText("Full Project")).toBeTruthy();
    });
    expect(getByText("Drafts (1)")).toBeTruthy();
    expect(getByText("Active (1)")).toBeTruthy();
    expect(getByText("Completed (1)")).toBeTruthy();
    expect(getByText("Draft 1")).toBeTruthy();
    expect(getByText("Running 1")).toBeTruthy();
    expect(getByText("Completed 1")).toBeTruthy();
  });

  test("renders multiple loops count in section headers", async () => {
    const workspace = createWorkspace({ id: "ws-1", name: "Busy Project" });
    const r1 = createLoopWithStatus("running", {
      config: { id: "r1", name: "Run 1", workspaceId: "ws-1" },
    });
    const r2 = createLoopWithStatus("running", {
      config: { id: "r2", name: "Run 2", workspaceId: "ws-1" },
    });
    const r3 = createLoopWithStatus("running", {
      config: { id: "r3", name: "Run 3", workspaceId: "ws-1" },
    });

    api.get("/api/loops", () => [r1, r2, r3]);
    api.get("/api/workspaces", () => [workspace]);

    const { getByText } = renderWithUser(<Dashboard />);

    await waitFor(() => {
      expect(getByText("Active (3)")).toBeTruthy();
    });
    expect(getByText("(3 loops)")).toBeTruthy();
  });
});

// ─── Edit draft flow ────────────────────────────────────────────────────────

describe("edit draft flow", () => {
  test("opens edit modal with 'Edit Draft Loop' title when draft loop is clicked", async () => {
    const workspace = createWorkspace({ id: "ws-1", name: "Project" });
    const draft = createLoopWithStatus("draft", {
      config: {
        id: "draft-1",
        name: "My Draft",
        workspaceId: "ws-1",
        prompt: "Do something",
      },
    });

    api.get("/api/loops", () => [draft]);
    api.get("/api/workspaces", () => [workspace]);

    const { getByText, user } = renderWithUser(<Dashboard />);

    await waitFor(() => {
      expect(getByText("My Draft")).toBeTruthy();
    });

    // Clicking a draft card opens the edit form
    // Draft cards have an "Edit" button
    const buttons = document.querySelectorAll('button');
    const editBtn = Array.from(buttons).find(b => b.textContent === 'Edit');
    expect(editBtn).toBeTruthy();

    await user.click(editBtn!);

    await waitFor(() => {
      expect(getByText("Edit Draft Loop")).toBeTruthy();
    });
  });
});

// ─── Workspace settings modal ───────────────────────────────────────────────

describe("workspace settings modal", () => {
  test("opens workspace settings when gear icon is clicked", async () => {
    const workspace = createWorkspace({ id: "ws-1", name: "Settings Project" });
    const loop = createLoopWithStatus("running", {
      config: { id: "l1", name: "Task", workspaceId: "ws-1" },
    });

    api.get("/api/loops", () => [loop]);
    api.get("/api/workspaces", () => [workspace]);
    api.get("/api/workspaces/:id", (req) => workspace);
    api.get("/api/workspaces/:id/status", () => ({ connected: true }));

    const { getByText, user } = renderWithUser(<Dashboard />);

    await waitFor(() => {
      expect(getByText("Settings Project")).toBeTruthy();
    });

    // Click the workspace gear icon (next to workspace name)
    const gearBtns = document.querySelectorAll('button[title="Workspace Settings"]');
    expect(gearBtns.length).toBeGreaterThan(0);

    await user.click(gearBtns[0] as HTMLElement);

    await waitFor(() => {
      expect(getByText("Workspace Settings")).toBeTruthy();
    });
  });
});
