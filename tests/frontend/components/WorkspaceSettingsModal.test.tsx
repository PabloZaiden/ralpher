/**
 * Tests for WorkspaceSettingsModal AGENTS.md optimization UI.
 *
 * Covers loading state, error + retry, and successful recovery
 * for the AGENTS.md optimization section.
 */

import { test, expect, describe, mock, beforeEach, afterEach } from "bun:test";
import { WorkspaceSettingsModal } from "@/components/WorkspaceSettingsModal";
import { renderWithUser, waitFor } from "../helpers/render";
import { createMockApi, MockApiError } from "../helpers/mock-api";
import { createWorkspace, createServerSettings } from "../helpers/factories";
import type { ConnectionStatus } from "@/types/settings";

const api = createMockApi();

beforeEach(() => {
  api.reset();
  api.install();
});

afterEach(() => {
  api.uninstall();
});

/** Create a workspace with server settings configured. */
function makeWorkspace(overrides?: Parameters<typeof createWorkspace>[0]) {
  return createWorkspace({
    id: "ws-test-1",
    name: "Test Workspace",
    directory: "/workspaces/test",
    serverSettings: createServerSettings({ mode: "connect" }),
    ...overrides,
  });
}

/** Default connection status (idle, not connected). */
function makeStatus(overrides?: Partial<ConnectionStatus>): ConnectionStatus {
  return {
    connected: false,
    mode: "spawn",
    ...overrides,
  };
}

/** Default modal props. */
function defaultProps() {
  return {
    isOpen: true,
    onClose: mock(),
    workspace: makeWorkspace(),
    status: makeStatus(),
    onSave: mock(() => Promise.resolve(true)),
    onTest: mock(() => Promise.resolve({ success: true })),
  };
}

/** AgentsMdStatus returned by GET /api/workspaces/:id/agents-md */
function agentsMdStatus(overrides?: {
  isOptimized?: boolean;
  updateAvailable?: boolean;
  fileExists?: boolean;
}) {
  return {
    content: "# AGENTS.md content",
    fileExists: overrides?.fileExists ?? true,
    analysis: {
      isOptimized: overrides?.isOptimized ?? false,
      currentVersion: overrides?.isOptimized ? 1 : null,
      updateAvailable: overrides?.updateAvailable ?? false,
    },
  };
}

describe("WorkspaceSettingsModal AGENTS.md optimization", () => {
  describe("loading state", () => {
    test("shows loading message while fetching AGENTS.md status", async () => {
      // Register a handler that never resolves (simulating a slow connection)
      let resolveHandler!: (value: unknown) => void;
      const pendingPromise = new Promise((resolve) => {
        resolveHandler = resolve;
      });
      api.get("/api/workspaces/:id/agents-md", () => pendingPromise);

      const { getByText } = renderWithUser(
        <WorkspaceSettingsModal {...defaultProps()} />
      );

      // The loading message should appear while the fetch is pending
      await waitFor(() => {
        expect(getByText("Checking AGENTS.md status...")).toBeInTheDocument();
      });

      // Resolve to avoid dangling promise
      resolveHandler(agentsMdStatus());
    });

    test("loading message disappears after successful fetch", async () => {
      api.get("/api/workspaces/:id/agents-md", () => agentsMdStatus());

      const { queryByText } = renderWithUser(
        <WorkspaceSettingsModal {...defaultProps()} />
      );

      // Wait for the fetch to complete
      await waitFor(() => {
        expect(queryByText("Checking AGENTS.md status...")).not.toBeInTheDocument();
      });
    });
  });

  describe("error and retry", () => {
    test("shows error message when fetch fails", async () => {
      api.get("/api/workspaces/:id/agents-md", () => {
        throw new MockApiError(500, { message: "ECONNREFUSED: connection refused" });
      });

      const { getByText } = renderWithUser(
        <WorkspaceSettingsModal {...defaultProps()} />
      );

      // Should show a user-friendly error (via formatOptimizerError)
      await waitFor(() => {
        expect(getByText("Could not connect to the server. Check your connection settings and try again.")).toBeInTheDocument();
      });
    });

    test("shows Retry button when error occurs", async () => {
      api.get("/api/workspaces/:id/agents-md", () => {
        throw new MockApiError(500, { message: "Connection timed out" });
      });

      const { getByText } = renderWithUser(
        <WorkspaceSettingsModal {...defaultProps()} />
      );

      await waitFor(() => {
        expect(getByText("Retry")).toBeInTheDocument();
      });
    });

    test("does not show Optimize button when error is present", async () => {
      api.get("/api/workspaces/:id/agents-md", () => {
        throw new MockApiError(500, { message: "Server error" });
      });

      const { queryByText } = renderWithUser(
        <WorkspaceSettingsModal {...defaultProps()} />
      );

      await waitFor(() => {
        expect(queryByText("Retry")).toBeInTheDocument();
      });

      // Optimize button should not be shown when there's an error
      expect(queryByText("Optimize AGENTS.md")).not.toBeInTheDocument();
    });
  });

  describe("recovery on retry", () => {
    test("recovers from error when Retry is clicked and fetch succeeds", async () => {
      let callCount = 0;
      api.get("/api/workspaces/:id/agents-md", () => {
        callCount++;
        if (callCount === 1) {
          // First call fails
          throw new MockApiError(500, { message: "ECONNREFUSED: connection refused" });
        }
        // Second call succeeds
        return agentsMdStatus({ isOptimized: false });
      });

      const { getByText, queryByText, user } = renderWithUser(
        <WorkspaceSettingsModal {...defaultProps()} />
      );

      // Wait for the error to show
      await waitFor(() => {
        expect(getByText("Retry")).toBeInTheDocument();
      });

      // Click Retry
      await user.click(getByText("Retry"));

      // Error should clear and status should show
      await waitFor(() => {
        expect(queryByText("Could not connect to the server. Check your connection settings and try again.")).not.toBeInTheDocument();
      });

      // Now the AGENTS.md status info should appear
      await waitFor(() => {
        expect(getByText("AGENTS.md exists but is not optimized for Ralpher.")).toBeInTheDocument();
      });
    });

    test("Optimize button becomes enabled after successful retry", async () => {
      let callCount = 0;
      api.get("/api/workspaces/:id/agents-md", () => {
        callCount++;
        if (callCount === 1) {
          throw new MockApiError(500, { message: "Timeout" });
        }
        return agentsMdStatus({ isOptimized: false });
      });

      const { getByText, user } = renderWithUser(
        <WorkspaceSettingsModal {...defaultProps()} />
      );

      // Wait for error, click Retry
      await waitFor(() => {
        expect(getByText("Retry")).toBeInTheDocument();
      });
      await user.click(getByText("Retry"));

      // Wait for the Optimize button to appear and be enabled
      await waitFor(() => {
        const optimizeText = getByText("Optimize AGENTS.md");
        const button = optimizeText.closest("button")!;
        expect(button).not.toBeDisabled();
      });
    });
  });

  describe("successful status display", () => {
    test("shows 'not optimized' message when AGENTS.md exists but is not optimized", async () => {
      api.get("/api/workspaces/:id/agents-md", () => agentsMdStatus({ isOptimized: false }));

      const { getByText } = renderWithUser(
        <WorkspaceSettingsModal {...defaultProps()} />
      );

      await waitFor(() => {
        expect(getByText("AGENTS.md exists but is not optimized for Ralpher.")).toBeInTheDocument();
      });
    });

    test("shows 'no file found' message when AGENTS.md does not exist", async () => {
      api.get("/api/workspaces/:id/agents-md", () => agentsMdStatus({ fileExists: false }));

      const { getByText } = renderWithUser(
        <WorkspaceSettingsModal {...defaultProps()} />
      );

      await waitFor(() => {
        expect(getByText("No AGENTS.md file found. One will be created.")).toBeInTheDocument();
      });
    });

    test("shows Optimized badge when AGENTS.md is already optimized", async () => {
      api.get("/api/workspaces/:id/agents-md", () => agentsMdStatus({ isOptimized: true }));

      const { getByText } = renderWithUser(
        <WorkspaceSettingsModal {...defaultProps()} />
      );

      await waitFor(() => {
        expect(getByText("Optimized")).toBeInTheDocument();
      });
    });

    test("shows update available message when update is available", async () => {
      api.get("/api/workspaces/:id/agents-md", () => agentsMdStatus({ isOptimized: true, updateAvailable: true }));

      const { getByText } = renderWithUser(
        <WorkspaceSettingsModal {...defaultProps()} />
      );

      await waitFor(() => {
        expect(getByText("An updated version of the Ralpher guidelines is available.")).toBeInTheDocument();
      });
    });

    test("disables Optimize button while status is null (not yet loaded)", async () => {
      let resolveHandler!: (value: unknown) => void;
      const pendingPromise = new Promise((resolve) => {
        resolveHandler = resolve;
      });
      api.get("/api/workspaces/:id/agents-md", () => pendingPromise);

      const { getByText } = renderWithUser(
        <WorkspaceSettingsModal {...defaultProps()} />
      );

      // While loading, the loading indicator should appear
      await waitFor(() => {
        expect(getByText("Checking AGENTS.md status...")).toBeInTheDocument();
      });

      // The Optimize button is rendered but disabled because status is null
      const optimizeText = getByText("Optimize AGENTS.md");
      const button = optimizeText.closest("button")!;
      expect(button).toBeDisabled();

      resolveHandler(agentsMdStatus());
    });
  });

  describe("section visibility", () => {
    test("AGENTS.md section is shown even when not connected", async () => {
      api.get("/api/workspaces/:id/agents-md", () => agentsMdStatus());

      const { getByText } = renderWithUser(
        <WorkspaceSettingsModal
          {...defaultProps()}
          status={makeStatus({ connected: false })}
        />
      );

      await waitFor(() => {
        expect(getByText("AGENTS.md Optimization")).toBeInTheDocument();
      });
    });

    test("AGENTS.md section is not shown when workspace is null", () => {
      const props = defaultProps();

      const { queryByText } = renderWithUser(
        <WorkspaceSettingsModal {...props} workspace={null} />
      );

      expect(queryByText("AGENTS.md Optimization")).not.toBeInTheDocument();
    });
  });
});
