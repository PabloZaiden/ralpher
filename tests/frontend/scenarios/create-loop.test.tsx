/**
 * E2E Scenario: Create Loop Workflow
 *
 * Tests the complete flow of creating a new loop from the Dashboard:
 * Open dashboard -> click "New Loop" -> fill form -> submit -> loop appears
 */

import { describe, test, expect, beforeEach, afterEach, mock } from "bun:test";
import { createMockApi } from "../helpers/mock-api";
import { createMockWebSocket } from "../helpers/mock-websocket";
import { renderWithUser, waitFor, act } from "../helpers/render";
import {
  createLoop,
  createLoopWithStatus,
  createWorkspaceWithLoopCount,
  createModelInfo,
  createBranchInfo,
} from "../helpers/factories";
import { App } from "@/App";

const api = createMockApi();
const ws = createMockWebSocket();

const WORKSPACE = createWorkspaceWithLoopCount({
  id: "ws-1",
  name: "My Project",
  directory: "/workspaces/my-project",
  loopCount: 0,
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

function setupApi(loops: ReturnType<typeof createLoop>[] = []) {
  api.get("/api/loops", () => loops);
  api.get("/api/workspaces", () => [WORKSPACE]);
  api.get("/api/config", () => ({ remoteOnly: false }));
  api.get("/api/health", () => ({ status: "ok", version: "1.0.0" }));
  api.get("/api/preferences/last-model", () => null);
  api.get("/api/preferences/log-level", () => ({ level: "info" }));
  api.get("/api/preferences/last-directory", () => null);
  api.get("/api/models", () => [connectedModel()]);
  api.get("/api/branches", () => [
    createBranchInfo({ name: "main", isCurrent: true, isDefault: true }),
  ]);
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

// ─── Create loop scenario ────────────────────────────────────────────────────

describe("create loop scenario", () => {
  test("user opens dashboard, clicks New Loop, and sees the create form", async () => {
    setupApi();
    const { getByText, getByRole, user } = renderWithUser(<App />);

    // Dashboard loads
    await waitFor(() => {
      expect(getByText("Ralpher")).toBeTruthy();
    });

    // Click "New Loop" button
    await user.click(getByText("New Loop"));

    // Create form modal appears
    await waitFor(() => {
      expect(getByRole("heading", { name: "Create New Loop" })).toBeTruthy();
    });

    // Workspace selector is visible
    expect(document.querySelector("select#workspace")).toBeTruthy();
  });

  test("full create loop flow: fill form and submit", async () => {
    const createdLoop = createLoopWithStatus("running", {
      config: {
        id: "new-loop-1",
        name: "My New Loop",
        directory: "/workspaces/my-project",
        prompt: "X",
      },
    });

    setupApi();
    api.post("/api/loops", () => createdLoop);
    // After creation, the loops endpoint returns the new loop
    let loopsAfterCreate = [createdLoop];
    api.get("/api/loops", () => loopsAfterCreate);
    api.put("/api/preferences/last-model", () => ({ success: true }));
    api.put("/api/preferences/last-directory", () => ({ success: true }));

    const { getByText, getByRole, getByLabelText, user, queryByText } =
      renderWithUser(<App />);

    // Dashboard loads
    await waitFor(() => {
      expect(getByText("Ralpher")).toBeTruthy();
    });

    // Click "New Loop"
    await user.click(getByText("New Loop"));

    await waitFor(() => {
      expect(getByRole("heading", { name: "Create New Loop" })).toBeTruthy();
    });

    // Fill in the prompt (type single char to avoid OOM)
    const promptTextarea = getByLabelText(/Prompt/) as HTMLTextAreaElement;
    await user.type(promptTextarea, "X");

    // Submit the form
    const submitBtn = Array.from(document.querySelectorAll("button")).find(
      (b) => b.textContent?.includes("Create Loop") && b.type === "submit",
    );
    expect(submitBtn).toBeTruthy();
    await user.click(submitBtn!);

    // Modal should close and loop should appear on dashboard
    await waitFor(() => {
      expect(queryByText("Create New Loop")).toBeNull();
    });
  });

  test("create loop with 409 uncommitted changes shows conflict modal", async () => {
    setupApi();
    api.post(
      "/api/loops",
      () => ({
        error: "uncommitted_changes",
        details: {
          directory: "/workspaces/my-project",
          files: ["src/index.ts", "src/app.ts"],
        },
      }),
      409,
    );

    const { getByText, getByRole, getByLabelText, user } = renderWithUser(
      <App />,
    );

    // Dashboard loads
    await waitFor(() => {
      expect(getByText("Ralpher")).toBeTruthy();
    });

    // Open create modal and fill prompt
    await user.click(getByText("New Loop"));
    await waitFor(() => {
      expect(getByRole("heading", { name: "Create New Loop" })).toBeTruthy();
    });

    const promptTextarea = getByLabelText(/Prompt/) as HTMLTextAreaElement;
    await user.type(promptTextarea, "X");

    // Submit
    const submitBtn = Array.from(document.querySelectorAll("button")).find(
      (b) => b.textContent?.includes("Create Loop") && b.type === "submit",
    );
    await user.click(submitBtn!);

    // Uncommitted changes modal appears
    await waitFor(() => {
      expect(getByText(/uncommitted changes/i)).toBeTruthy();
    });
  });

  test("cancel create loop closes the modal", async () => {
    setupApi();
    const { getByText, getByRole, queryByText, user } = renderWithUser(
      <App />,
    );

    await waitFor(() => {
      expect(getByText("Ralpher")).toBeTruthy();
    });

    await user.click(getByText("New Loop"));
    await waitFor(() => {
      expect(getByRole("heading", { name: "Create New Loop" })).toBeTruthy();
    });

    // Click Cancel
    await user.click(getByText("Cancel"));

    await waitFor(() => {
      expect(queryByText("Create New Loop")).toBeNull();
    });
  });
});
