import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { App } from "@/App";
import { createMockApi } from "../helpers/mock-api";
import { createMockWebSocket } from "../helpers/mock-websocket";
import { renderWithUser, waitFor, act } from "../helpers/render";
import { createLoop, createSshSession, createWorkspace } from "../helpers/factories";

const api = createMockApi();
const ws = createMockWebSocket();

function isoNow(): string {
  return new Date().toISOString();
}

function createMatchMediaMock(matches: boolean): typeof window.matchMedia {
  return (query: string) =>
    ({
      matches,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    }) as MediaQueryList;
}

function createSshServer(overrides?: Partial<{
  id: string;
  name: string;
  address: string;
  username: string;
}>) {
  return {
    config: {
      id: overrides?.id ?? "server-1",
      name: overrides?.name ?? "Build host",
      address: overrides?.address ?? "server.example.com",
      username: overrides?.username ?? "ubuntu",
      createdAt: isoNow(),
      updatedAt: isoNow(),
    },
    publicKey: {
      algorithm: "RSA-OAEP-256" as const,
      publicKey: "test-key",
      fingerprint: "fingerprint",
      version: 1,
      createdAt: isoNow(),
    },
  };
}

function createStandaloneSession(serverId: string, overrides?: Partial<{ id: string; name: string }>) {
  return {
    config: {
      id: overrides?.id ?? "standalone-session-1",
      sshServerId: serverId,
      name: overrides?.name ?? "Standalone SSH",
      connectionMode: "dtach" as const,
      remoteSessionName: "ralpher-standalone",
      createdAt: isoNow(),
      updatedAt: isoNow(),
    },
    state: {
      status: "ready",
    },
  };
}

function setupDefaultApi(options?: {
  loops?: ReturnType<typeof createLoop>[];
  workspaces?: ReturnType<typeof createWorkspace>[];
  sshSessions?: ReturnType<typeof createSshSession>[];
  sshServers?: ReturnType<typeof createSshServer>[];
  standaloneSessionsByServerId?: Record<string, ReturnType<typeof createStandaloneSession>[]>;
}) {
  const loops = options?.loops ?? [];
  const workspaces = options?.workspaces ?? [];
  const sshSessions = options?.sshSessions ?? [];
  const sshServers = options?.sshServers ?? [];
  const standaloneSessionsByServerId = options?.standaloneSessionsByServerId ?? {};

  api.get("/api/loops", () => loops);
  api.get("/api/workspaces", () => workspaces);
  api.get("/api/ssh-sessions", () => sshSessions);
  api.get("/api/ssh-servers", () => sshServers);
  api.get("/api/ssh-servers/:id/sessions", (req) => standaloneSessionsByServerId[req.params["id"]!] ?? []);
  api.get("/api/config", () => ({ remoteOnly: false }));
  api.get("/api/health", () => ({ status: "ok", version: "1.0.0" }));
  api.get("/api/preferences/last-model", () => null);
  api.get("/api/preferences/log-level", () => ({ level: "info" }));
  api.get("/api/preferences/markdown-rendering", () => ({ enabled: true }));
  api.get("/api/models", () => []);
  api.get("/api/loops/:id", (req) => {
    return loops.find((loop) => loop.config.id === req.params["id"])
      ?? createLoop({ config: { id: req.params["id"], name: `Loop ${req.params["id"]}` } });
  });
  api.get("/api/loops/:id/comments", () => ({ success: true, comments: [] }));
  api.get("/api/loops/:id/diff", () => []);
  api.get("/api/loops/:id/plan", () => ({ exists: false, content: "" }));
  api.get("/api/loops/:id/status-file", () => ({ exists: false, content: "" }));
  api.get("/api/loops/:id/pull-request", () => ({
    enabled: false,
    destinationType: "disabled",
    disabledReason: "disabled",
  }));
  api.get("/api/loops/:id/port-forwards", () => []);
  api.get("/api/ssh-sessions/:id", (req) => {
    return sshSessions.find((session) => session.config.id === req.params["id"])
      ?? createSshSession({ config: { id: req.params["id"]!, name: `SSH ${req.params["id"]!}` } });
  });
  api.get("/api/ssh-server-sessions/:id", (req) => {
    const session = Object.values(standaloneSessionsByServerId).flat().find((item) => item.config.id === req.params["id"]);
    if (!session) {
      throw new Error("Standalone session not found");
    }
    return session;
  });
  api.get("/api/ssh-servers/:id", (req) => {
    return sshServers.find((server) => server.config.id === req.params["id"])
      ?? createSshServer({ id: req.params["id"]! });
  });
}

beforeEach(() => {
  api.reset();
  api.install();
  ws.reset();
  ws.install();
  window.location.hash = "";
  setupDefaultApi();
});

afterEach(() => {
  api.uninstall();
  ws.uninstall();
  window.location.hash = "";
});

describe("App shell", () => {
  test("renders the shell overview by default", async () => {
    const { getByRole, getByText } = renderWithUser(<App />);

    await waitFor(() => {
      expect(getByRole("heading", { name: "Ralpher" })).toBeTruthy();
      expect(getByText("Recent activity")).toBeTruthy();
      expect(getByText("Workspace map")).toBeTruthy();
    });
  });

  test("renders shell-native workspace composer from the hash route", async () => {
    const { getByRole } = renderWithUser(<App />, { route: "#/new/workspace" });

    await waitFor(() => {
      expect(getByRole("heading", { name: "Create a workspace" })).toBeTruthy();
      expect(getByRole("button", { name: "Create Workspace" })).toBeTruthy();
    });
  });

  test("renders settings as a shell route instead of a modal", async () => {
    const { getByRole, getByText, queryByRole } = renderWithUser(<App />, { route: "#/settings" });

    await waitFor(() => {
      expect(getByRole("heading", { name: "Settings" })).toBeTruthy();
      expect(getByText("Render Markdown")).toBeTruthy();
    });

    expect(queryByRole("dialog")).toBeNull();
  });

  test("renders loop details inside the shell without a back button", async () => {
    const loop = createLoop({
      config: { id: "loop-1", name: "Shell Loop", workspaceId: "workspace-1" },
    });
    setupDefaultApi({ loops: [loop] });
    const { getAllByText, queryByRole } = renderWithUser(<App />, { route: "#/loop/loop-1" });

    await waitFor(() => {
      expect(getAllByText("Shell Loop").length).toBeGreaterThan(0);
    });
    expect(queryByRole("button", { name: /Back/ })).toBeNull();
  });

  test("renders workspace and SSH server detail views from dedicated shell routes", async () => {
    const workspace = createWorkspace({ id: "workspace-1", name: "Frontend", directory: "/workspaces/frontend" });
    const server = createSshServer({ id: "server-1", name: "Deploy host" });
    setupDefaultApi({ workspaces: [workspace], sshServers: [server] });

    const workspaceRender = renderWithUser(<App />, { route: "#/workspace/workspace-1" });

    await waitFor(() => {
      expect(workspaceRender.getByRole("heading", { name: "Frontend" })).toBeTruthy();
      expect(workspaceRender.getAllByText("/workspaces/frontend").length).toBeGreaterThan(0);
    });

    workspaceRender.unmount();

    const serverRender = renderWithUser(<App />, { route: "#/server/server-1" });

    await waitFor(() => {
      expect(serverRender.getByRole("heading", { name: "Deploy host" })).toBeTruthy();
      expect(serverRender.getByText("No standalone sessions yet for this SSH server.")).toBeTruthy();
    });
  });

  test("navigates to a loop when a sidebar item is clicked", async () => {
    const workspace = createWorkspace({ id: "workspace-1", name: "Frontend", directory: "/workspaces/frontend" });
    const loop = createLoop({
      config: { id: "loop-1", name: "Sidebar Loop", workspaceId: workspace.id },
      state: { status: "running", startedAt: isoNow(), currentIteration: 1 },
    });
    setupDefaultApi({ workspaces: [workspace], loops: [loop] });

    const { getAllByText, user } = renderWithUser(<App />);

    await waitFor(() => {
      expect(getAllByText("Sidebar Loop").length).toBeGreaterThan(0);
    });

    await user.click(getAllByText("Sidebar Loop")[0]!);

    await waitFor(() => {
      expect(window.location.hash).toBe("#/loop/loop-1");
    });
  });

  test("reacts to hash changes with the new shell routes", async () => {
    const { getByRole } = renderWithUser(<App />);

    await waitFor(() => {
      expect(getByRole("heading", { name: "Ralpher" })).toBeTruthy();
    });

    await act(async () => {
      window.location.hash = "/new/ssh-server";
      window.dispatchEvent(new HashChangeEvent("hashchange"));
    });

    await waitFor(() => {
      expect(getByRole("heading", { name: "Register a standalone SSH server" })).toBeTruthy();
    });
  });

  test("lets users collapse and expand sidebar sections", async () => {
    const { getByRole, getByText, queryByText, user } = renderWithUser(<App />);

    await waitFor(() => {
      expect(getByRole("button", { name: "Collapse Workspaces section" })).toBeTruthy();
      expect(getByText("No workspaces yet.")).toBeTruthy();
    });

    const collapseButton = getByRole("button", { name: "Collapse Workspaces section" });
    expect(collapseButton).toHaveAttribute("aria-expanded", "true");

    await user.click(collapseButton);

    await waitFor(() => {
      expect(getByRole("button", { name: "Expand Workspaces section" })).toBeTruthy();
      expect(queryByText("No workspaces yet.")).toBeNull();
    });

    await user.click(getByRole("button", { name: "Expand Workspaces section" }));

    await waitFor(() => {
      expect(getByRole("button", { name: "Collapse Workspaces section" })).toBeTruthy();
      expect(getByText("No workspaces yet.")).toBeTruthy();
    });
  });

  test("restores collapsed sidebar sections from browser storage", async () => {
    const firstRender = renderWithUser(<App />);

    await waitFor(() => {
      expect(firstRender.getByRole("button", { name: "Collapse Workspaces section" })).toBeTruthy();
    });

    await firstRender.user.click(firstRender.getByRole("button", { name: "Collapse Workspaces section" }));

    await waitFor(() => {
      expect(firstRender.getByRole("button", { name: "Expand Workspaces section" })).toBeTruthy();
      expect(firstRender.queryByText("No workspaces yet.")).toBeNull();
    });

    firstRender.unmount();

    const secondRender = renderWithUser(<App />);

    await waitFor(() => {
      expect(secondRender.getByRole("button", { name: "Expand Workspaces section" })).toBeTruthy();
      expect(secondRender.queryByText("No workspaces yet.")).toBeNull();
    });
  });

  test("hides and reopens the sidebar with header icon controls", async () => {
    const originalMatchMedia = window.matchMedia;
    window.matchMedia = createMatchMediaMock(true);

    try {
      const { getByLabelText, user } = renderWithUser(<App />);
      const sidebar = document.querySelector("aside");

      expect(sidebar).toBeTruthy();
      expect(getByLabelText("Hide sidebar")).toBeTruthy();

      await user.click(getByLabelText("Hide sidebar"));

      await waitFor(() => {
        expect(sidebar).toHaveAttribute("hidden");
        expect(getByLabelText("Open sidebar")).toBeTruthy();
      });

      await user.click(getByLabelText("Open sidebar"));

      await waitFor(() => {
        expect(sidebar).not.toHaveAttribute("hidden");
        expect(getByLabelText("Hide sidebar")).toBeTruthy();
      });
    } finally {
      window.matchMedia = originalMatchMedia;
    }
  });

  test("settings button navigates to the shell settings view", async () => {
    const { getByLabelText, getByRole, user } = renderWithUser(<App />);

    await waitFor(() => {
      expect(getByRole("heading", { name: "Ralpher" })).toBeTruthy();
    });

    await user.click(getByLabelText("Open settings"));

    await waitFor(() => {
      expect(window.location.hash).toBe("#/settings");
      expect(getByRole("heading", { name: "Settings" })).toBeTruthy();
    });
  });

  test("header brand returns to the overview route", async () => {
    const { getByRole, user } = renderWithUser(<App />, { route: "#/settings" });

    await waitFor(() => {
      expect(getByRole("heading", { name: "Settings" })).toBeTruthy();
    });

    await user.click(getByRole("button", { name: /ralpher/i }));

    await waitFor(() => {
      expect(window.location.hash).toBe("#/");
      expect(getByRole("heading", { name: "Ralpher" })).toBeTruthy();
    });
  });
});
