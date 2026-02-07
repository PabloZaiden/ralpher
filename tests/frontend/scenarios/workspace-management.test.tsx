/**
 * E2E Scenario: Workspace Management
 *
 * Tests workspace CRUD workflows: creating workspaces, configuring settings,
 * and deleting empty workspaces.
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
  name: "Existing Project",
  directory: "/workspaces/existing",
  loopCount: 0,
});

function setupBaseApi() {
  api.get("/api/config", () => ({ remoteOnly: false }));
  api.get("/api/health", () => ({ status: "ok", version: "1.0.0" }));
  api.get("/api/preferences/last-model", () => null);
  api.get("/api/preferences/log-level", () => ({ level: "info" }));
  api.get("/api/preferences/last-directory", () => null);
  api.get("/api/models", () => [createModelInfo({ connected: true })]);
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

// ─── Workspace management scenarios ──────────────────────────────────────────

describe("workspace management scenario", () => {
  test("clicking New Workspace opens the create workspace modal", async () => {
    setupBaseApi();
    api.get("/api/loops", () => []);
    api.get("/api/workspaces", () => []);

    const { getByText, user } = renderWithUser(<App />);

    await waitFor(() => {
      expect(getByText("Ralpher")).toBeTruthy();
    });

    // Click "New Workspace"
    await user.click(getByText("New Workspace"));

    // Create Workspace modal appears
    await waitFor(() => {
      expect(getByText("Create Workspace")).toBeTruthy();
    });

    // Form fields exist
    expect(document.querySelector("#workspace-name")).toBeTruthy();
    expect(document.querySelector("#workspace-directory")).toBeTruthy();
  });

  test("create workspace flow: fill form and submit", async () => {
    setupBaseApi();
    api.get("/api/loops", () => []);
    api.get("/api/workspaces", () => []);
    api.post("/api/workspaces", () => ({
      id: "ws-new",
      name: "New Project",
      directory: "/workspaces/new-project",
      serverSettings: { mode: "spawn", useHttps: false, allowInsecure: false },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }));

    const { getByText, queryByText, user } = renderWithUser(<App />);

    await waitFor(() => {
      expect(getByText("Ralpher")).toBeTruthy();
    });

    // Open create workspace modal
    await user.click(getByText("New Workspace"));
    await waitFor(() => {
      expect(getByText("Create Workspace")).toBeTruthy();
    });

    // Fill name
    const nameInput = document.querySelector("#workspace-name") as HTMLInputElement;
    await user.type(nameInput, "X");

    // Fill directory
    const dirInput = document.querySelector("#workspace-directory") as HTMLInputElement;
    await user.type(dirInput, "/");

    // Submit the form via "Create Workspace" button in footer
    const createBtns = Array.from(document.querySelectorAll("button")).filter(
      (b) => b.textContent?.trim() === "Create Workspace",
    );
    // The button in the footer (not the modal title)
    const submitBtn = createBtns.find((b) => b.type === "submit");
    expect(submitBtn).toBeTruthy();
    await user.click(submitBtn!);

    // Modal should close after success
    await waitFor(() => {
      expect(queryByText("Create a new workspace")).toBeNull();
    });

    // API was called
    const postCalls = api.calls("/api/workspaces", "POST");
    expect(postCalls.length).toBeGreaterThan(0);
  });

  test("cancel create workspace closes modal", async () => {
    setupBaseApi();
    api.get("/api/loops", () => []);
    api.get("/api/workspaces", () => []);

    const { getByText, queryByText, user } = renderWithUser(<App />);

    await waitFor(() => {
      expect(getByText("Ralpher")).toBeTruthy();
    });

    await user.click(getByText("New Workspace"));
    await waitFor(() => {
      expect(getByText("Create Workspace")).toBeTruthy();
    });

    // Click Cancel
    await user.click(getByText("Cancel"));

    // Modal should close
    await waitFor(() => {
      // The description text should be gone
      expect(queryByText("Create a new workspace with server connection settings.")).toBeNull();
    });
  });

  test("empty workspace shows delete button and can be deleted", async () => {
    setupBaseApi();
    api.get("/api/loops", () => []);
    api.get("/api/workspaces", () => [WORKSPACE]);
    api.delete("/api/workspaces/:id", () => ({ success: true }));

    // Mock confirm to return true
    const originalConfirm = window.confirm;
    window.confirm = () => true;

    const { getByText, getByTitle, user } = renderWithUser(<App />);

    // Empty workspaces section should appear since workspace has no loops
    await waitFor(() => {
      expect(getByText("Empty Workspaces")).toBeTruthy();
    });

    // Workspace name appears in empty section
    expect(getByText("Existing Project")).toBeTruthy();

    // Click the delete button (X icon with title "Delete empty workspace")
    const deleteBtn = getByTitle("Delete empty workspace");
    await user.click(deleteBtn);

    // API should have been called to delete the workspace
    await waitFor(() => {
      const deleteCalls = api.calls("/api/workspaces/:id", "DELETE");
      expect(deleteCalls.length).toBeGreaterThan(0);
    });

    // Restore confirm
    window.confirm = originalConfirm;
  });

  test("workspace settings modal opens from workspace header gear icon", async () => {
    setupBaseApi();

    const loop = createLoopWithStatus("running", {
      config: { id: "ws-loop-1", name: "In Workspace", directory: "/workspaces/existing", workspaceId: "ws-1" },
    });

    api.get("/api/loops", () => [loop]);
    api.get("/api/workspaces", () => [WORKSPACE]);
    api.get("/api/workspaces/:id", () => WORKSPACE);

    const { getByText, user } = renderWithUser(<App />);

    // Wait for workspace header to appear
    await waitFor(() => {
      expect(getByText("Existing Project")).toBeTruthy();
    });

    // Click the gear icon next to workspace name (title "Workspace Settings")
    const gearBtns = Array.from(document.querySelectorAll("button[title='Workspace Settings']"));
    expect(gearBtns.length).toBeGreaterThan(0);
    await user.click(gearBtns[0] as HTMLButtonElement);

    // Workspace settings modal should open
    await waitFor(() => {
      expect(getByText("Workspace Settings")).toBeTruthy();
    });
  });
});
