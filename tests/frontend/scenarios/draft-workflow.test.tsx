/**
 * E2E Scenario: Draft Workflow
 *
 * Tests draft loop workflows: creating a draft, editing it, starting it,
 * and deleting a draft without starting.
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { createMockApi } from "../helpers/mock-api";
import { createMockWebSocket } from "../helpers/mock-websocket";
import { renderWithUser, waitFor } from "../helpers/render";
import {
  createLoopWithStatus,
  createWorkspaceWithLoopCount,
  createModelInfo,
} from "../helpers/factories";
import { App } from "@/App";

const api = createMockApi();
const ws = createMockWebSocket();

const WORKSPACE = createWorkspaceWithLoopCount({
  id: "ws-1",
  name: "My Project",
  directory: "/workspaces/my-project",
  loopCount: 1,
});

function connectedModel() {
  return createModelInfo({
    providerID: "anthropic",
    modelID: "claude-sonnet-4-20250514",
    modelName: "Claude Sonnet 4",
    providerName: "Anthropic",
    connected: true,
  });
}

function draftLoop(id = "draft-1", name = "My Draft") {
  return createLoopWithStatus("draft", {
    config: {
      id,
      name,
      directory: "/workspaces/my-project",
      workspaceId: "ws-1",
      prompt: "Build a feature",
      model: { providerID: "anthropic", modelID: "claude-sonnet-4-20250514" },
      planMode: false,
    },
  });
}

function setupBaseApi() {
  api.get("/api/config", () => ({ remoteOnly: false }));
  api.get("/api/health", () => ({ status: "ok", version: "1.0.0" }));
  api.get("/api/preferences/last-model", () => null);
  api.get("/api/preferences/log-level", () => ({ level: "info" }));
  api.get("/api/preferences/last-directory", () => null);
  api.get("/api/models", () => [connectedModel()]);
  api.get("/api/git/branches", () => ({
    branches: [{ name: "main", isCurrent: true, isDefault: true }],
    currentBranch: "main",
  }));
  api.get("/api/git/default-branch", () => ({ defaultBranch: "main" }));
  api.get("/api/check-planning-dir", () => ({ warning: null }));
}

beforeEach(() => {
  api.reset();
  api.install();
  ws.reset();
  ws.install();
  window.location.hash = "";
});

afterEach(() => {
  api.uninstall();
  ws.uninstall();
  window.location.hash = "";
});

// ─── Draft workflow scenarios ────────────────────────────────────────────────

describe("draft workflow scenario", () => {
  test("draft loop appears in Drafts section with Edit button", async () => {
    setupBaseApi();
    const draft = draftLoop();
    api.get("/api/loops", () => [draft]);
    api.get("/api/workspaces", () => [WORKSPACE]);

    const { getByText } = renderWithUser(<App />);

    await waitFor(() => {
      expect(getByText("My Draft")).toBeTruthy();
    });

    // Should be in Drafts section
    expect(getByText(/Drafts \(1\)/)).toBeTruthy();

    // Should show Draft badge (getStatusLabel returns lowercase "draft")
    expect(getByText("draft")).toBeTruthy();

    // Should show Edit button (not "Accept")
    expect(getByText("Edit")).toBeTruthy();
  });

  test("clicking Edit on draft card opens edit modal", async () => {
    setupBaseApi();
    const draft = draftLoop();
    api.get("/api/loops", () => [draft]);
    api.get("/api/workspaces", () => [WORKSPACE]);

    const { getByText, getByRole, user } = renderWithUser(<App />);

    await waitFor(() => {
      expect(getByText("My Draft")).toBeTruthy();
    });

    // Click Edit on the card
    await user.click(getByText("Edit"));

    // Edit Draft Loop modal opens
    await waitFor(() => {
      expect(getByRole("heading", { name: "Edit Draft Loop" })).toBeTruthy();
    });
  });

  test("edit draft modal shows Start Loop button", async () => {
    setupBaseApi();
    const draft = draftLoop();
    api.get("/api/loops", () => [draft]);
    api.get("/api/workspaces", () => [WORKSPACE]);

    const { getByText, getByRole, user } = renderWithUser(<App />);

    await waitFor(() => {
      expect(getByText("My Draft")).toBeTruthy();
    });

    // Open edit modal
    await user.click(getByText("Edit"));

    await waitFor(() => {
      expect(getByRole("heading", { name: "Edit Draft Loop" })).toBeTruthy();
    });

    // Should have "Start Loop" button (not "Create Loop")
    await waitFor(() => {
      const startBtn = Array.from(document.querySelectorAll("button")).find(
        (b) => b.textContent?.includes("Start Loop"),
      );
      expect(startBtn).toBeTruthy();
    });

    // Should have "Update Draft" button
    const updateBtn = Array.from(document.querySelectorAll("button")).find(
      (b) => b.textContent?.includes("Update Draft"),
    );
    expect(updateBtn).toBeTruthy();
  });

  test("start draft loop calls draft/start API", async () => {
    setupBaseApi();
    const draft = draftLoop();
    api.get("/api/loops", () => [draft]);
    api.get("/api/workspaces", () => [WORKSPACE]);
    api.post("/api/loops/:id/draft/start", () => ({ success: true }));

    const { getByText, getByRole, user } = renderWithUser(<App />);

    await waitFor(() => {
      expect(getByText("My Draft")).toBeTruthy();
    });

    // Open edit modal
    await user.click(getByText("Edit"));

    await waitFor(() => {
      expect(getByRole("heading", { name: "Edit Draft Loop" })).toBeTruthy();
    });

    // Wait for Start Loop button
    await waitFor(() => {
      const startBtn = Array.from(document.querySelectorAll("button")).find(
        (b) => b.textContent?.includes("Start Loop"),
      );
      expect(startBtn).toBeTruthy();
    });

    // Click Start Loop
    const startBtn = Array.from(document.querySelectorAll("button")).find(
      (b) => b.textContent?.includes("Start Loop"),
    );
    await user.click(startBtn!);

    // API should have been called
    await waitFor(() => {
      const calls = api.calls("/api/loops/:id/draft/start", "POST");
      expect(calls.length).toBeGreaterThan(0);
    });
  });

  test("delete draft from dashboard card", async () => {
    setupBaseApi();
    const draft = draftLoop();
    api.get("/api/loops", () => [draft]);
    api.get("/api/workspaces", () => [WORKSPACE]);
    api.delete("/api/loops/:id", () => ({ success: true }));

    const { getByText, user } = renderWithUser(<App />);

    await waitFor(() => {
      expect(getByText("My Draft")).toBeTruthy();
    });

    // The draft card shows a Delete button (ghost/red)
    const deleteBtn = Array.from(document.querySelectorAll("button")).find(
      (b) => b.textContent?.trim() === "Delete",
    );
    expect(deleteBtn).toBeTruthy();
    await user.click(deleteBtn!);

    // Delete confirmation modal should appear
    await waitFor(() => {
      expect(getByText(/Are you sure/i)).toBeTruthy();
    });

    // Confirm delete - find the Delete button inside the modal footer
    // The modal's confirm button is a danger-variant button, distinct from the card's ghost "Delete"
    const allDeleteBtns = Array.from(document.querySelectorAll("button")).filter(
      (b) => b.textContent?.trim() === "Delete",
    );
    // The last "Delete" button is the one in the confirmation modal
    const confirmBtn = allDeleteBtns[allDeleteBtns.length - 1];
    expect(confirmBtn).toBeTruthy();
    await user.click(confirmBtn!);

    // API should be called
    await waitFor(() => {
      const calls = api.calls("/api/loops/:id", "DELETE");
      expect(calls.length).toBeGreaterThan(0);
    });
  });

  test("save as draft from create loop form", async () => {
    setupBaseApi();
    api.get("/api/loops", () => []);
    api.get("/api/workspaces", () => [WORKSPACE]);
    api.post("/api/loops", () => draftLoop("new-draft", "New Draft"));
    api.put("/api/preferences/last-model", () => ({ success: true }));
    api.put("/api/preferences/last-directory", () => ({ success: true }));

    const { getByText, getByRole, getByLabelText, user } = renderWithUser(<App />);

    await waitFor(() => {
      expect(getByText("Ralpher")).toBeTruthy();
    });

    // Open create modal
    await user.click(getByText("New Loop"));
    await waitFor(() => {
      expect(getByRole("heading", { name: "Create New Loop" })).toBeTruthy();
    });

    // Select workspace
    const wsSelect = document.querySelector("select#workspace") as HTMLSelectElement;
    await user.selectOptions(wsSelect, "ws-1");

    // Wait for form to be ready
    await waitFor(() => {
      const draftBtn = Array.from(document.querySelectorAll("button")).find(
        (b) => b.textContent?.includes("Save as Draft"),
      );
      expect(draftBtn).toBeTruthy();
    });

    // Fill in prompt
    const promptTextarea = getByLabelText(/Prompt/) as HTMLTextAreaElement;
    await user.type(promptTextarea, "X");

    // Click "Save as Draft" instead of "Create Loop"
    const draftBtn = Array.from(document.querySelectorAll("button")).find(
      (b) => b.textContent?.includes("Save as Draft"),
    );
    expect(draftBtn).toBeTruthy();
    await user.click(draftBtn!);

    // API should have been called with draft flag
    await waitFor(() => {
      const calls = api.calls("/api/loops", "POST");
      expect(calls.length).toBeGreaterThan(0);
      const body = calls[0]!.body as Record<string, unknown>;
      expect(body["draft"]).toBe(true);
    });
  });
});
