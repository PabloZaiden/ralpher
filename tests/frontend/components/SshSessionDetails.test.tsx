import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { createMockApi } from "../helpers/mock-api";
import { createMockWebSocket } from "../helpers/mock-websocket";
import { createSshSession } from "../helpers/factories";
import { act, renderWithUser, waitFor } from "../helpers/render";

let clipboardWrites: string[] = [];

class MockTerminal {
  cols = 80;
  rows = 24;
  dataHandler: ((data: string) => void) | null = null;
  writes: string[] = [];
  focusCalls = 0;

  constructor() {
    lastTerminal = this;
  }

  loadAddon() {}
  open() {}
  focus() {
    this.focusCalls += 1;
  }
  write(data: string) {
    this.writes.push(data);
  }
  writeln(data: string) {
    this.writes.push(`${data}\n`);
  }

  onData(handler: (data: string) => void) {
    this.dataHandler = handler;
    return {
      dispose: () => {
        this.dataHandler = null;
      },
    };
  }

  dispose() {
    this.dataHandler = null;
  }
}

class MockFitAddon {
  fit() {}
}

let lastTerminal: MockTerminal | null = null;

mock.module("@xterm/xterm", () => ({
  Terminal: MockTerminal,
}));

mock.module("@xterm/addon-fit", () => ({
  FitAddon: MockFitAddon,
}));

mock.module("@xterm/xterm/css/xterm.css", () => ({}));

const { SshSessionDetails } = await import("@/components/SshSessionDetails");

const api = createMockApi();
const ws = createMockWebSocket();

describe("SshSessionDetails", () => {
  beforeEach(() => {
    api.reset();
    api.install();
    ws.reset();
    ws.install();
    lastTerminal = null;
    clipboardWrites = [];
  });

  afterEach(() => {
    api.uninstall();
    ws.uninstall();
  });

  test("starts with compact collapsed bars and no redundant terminal action buttons", async () => {
    api.get("/api/ssh-sessions/:id", (req) =>
      createSshSession({ config: { id: req.params["id"]!, name: "SSH Compact Layout" } }),
    );

    const { getByText, queryByText, user } = renderWithUser(
      <SshSessionDetails sshSessionId="ssh-compact-1" onBack={() => {}} />,
    );

    await waitFor(() => {
      expect(getByText("SSH Compact Layout")).toBeTruthy();
      expect(ws.getConnections("/api/ssh-terminal")).toHaveLength(1);
      expect(lastTerminal).not.toBeNull();
    });

    expect(queryByText("Refresh")).toBeNull();
    expect(queryByText("Reconnect Terminal")).toBeNull();
    expect(queryByText("Workspace ID")).toBeNull();
    expect(queryByText("Ctrl")).toBeNull();

    await user.click(getByText("Session Info"));
    await waitFor(() => {
      expect(getByText("Workspace ID")).toBeTruthy();
    });

    await user.click(getByText("Touch controls"));
    await waitFor(() => {
      expect(getByText("Ctrl")).toBeTruthy();
    });
  });

  test("applies active modifiers to the next typed terminal key and touch key", async () => {
    api.get("/api/ssh-sessions/:id", (req) =>
      createSshSession({ config: { id: req.params["id"]!, name: "SSH Mobile Session" } }),
    );

    const { getByText, user } = renderWithUser(
      <SshSessionDetails sshSessionId="ssh-mobile-1" onBack={() => {}} />,
    );

    await waitFor(() => {
      expect(getByText("SSH Mobile Session")).toBeTruthy();
    });

    await waitFor(() => {
      expect(ws.getConnections("/api/ssh-terminal")).toHaveLength(1);
      expect(lastTerminal).not.toBeNull();
    });

    const terminalConnection = ws.getConnections("/api/ssh-terminal")[0]!;
    await act(async () => {
      ws.sendEventTo(terminalConnection, {
        type: "terminal.connected",
        sshSessionId: "ssh-mobile-1",
      });
    });

    await user.click(getByText("Touch controls"));
    await user.click(getByText("Ctrl"));
    await act(async () => {
      lastTerminal?.dataHandler?.("c");
    });

    await waitFor(() => {
      expect(terminalConnection.sentMessages).toContain(JSON.stringify({
        type: "terminal.input",
        data: "\u0003",
      }));
    });

    expect(getByText("Modifiers off")).toBeTruthy();

    await user.click(getByText("Alt"));
    await user.click(getByText("↑"));

    await waitFor(() => {
      expect(terminalConnection.sentMessages).toContain(JSON.stringify({
        type: "terminal.input",
        data: "\u001b[1;3A",
      }));
    });
  });

  test("keeps the terminal mounted, refocuses it, and sends no input until a real key", async () => {
    api.get("/api/ssh-sessions/:id", (req) =>
      createSshSession({ config: { id: req.params["id"]!, name: "SSH Modifier Stability" } }),
    );

    const { getByText, user } = renderWithUser(
      <SshSessionDetails sshSessionId="ssh-mobile-modifier-stability" onBack={() => {}} />,
    );

    await waitFor(() => {
      expect(getByText("SSH Modifier Stability")).toBeTruthy();
    });

    await waitFor(() => {
      expect(ws.getConnections("/api/ssh-terminal")).toHaveLength(1);
      expect(lastTerminal).not.toBeNull();
    });

    const terminalConnection = ws.getConnections("/api/ssh-terminal")[0]!;
    await act(async () => {
      ws.sendEventTo(terminalConnection, {
        type: "terminal.connected",
        sshSessionId: "ssh-mobile-modifier-stability",
      });
    });

    await user.click(getByText("Touch controls"));

    const initialTerminal = lastTerminal;
    const initialFocusCalls = initialTerminal?.focusCalls ?? 0;
    const initialInputMessages = terminalConnection.sentMessages.filter((message) =>
      message.includes("\"type\":\"terminal.input\"")
    );

    await user.click(getByText("Ctrl"));

    expect(lastTerminal).toBe(initialTerminal);
    expect(lastTerminal?.focusCalls).toBe(initialFocusCalls + 1);
    expect(
      terminalConnection.sentMessages.filter((message) => message.includes("\"type\":\"terminal.input\"")),
    ).toEqual(initialInputMessages);
  });

  test("supports shift-tab from the touch controls", async () => {
    api.get("/api/ssh-sessions/:id", (req) =>
      createSshSession({ config: { id: req.params["id"]!, name: "SSH Shift Tab" } }),
    );

    const { getByText, user } = renderWithUser(
      <SshSessionDetails sshSessionId="ssh-mobile-2" onBack={() => {}} />,
    );

    await waitFor(() => {
      expect(getByText("SSH Shift Tab")).toBeTruthy();
    });

    await waitFor(() => {
      expect(ws.getConnections("/api/ssh-terminal")).toHaveLength(1);
      expect(lastTerminal).not.toBeNull();
    });

    const terminalConnection = ws.getConnections("/api/ssh-terminal")[0]!;
    await act(async () => {
      ws.sendEventTo(terminalConnection, {
        type: "terminal.connected",
        sshSessionId: "ssh-mobile-2",
      });
    });

    await user.click(getByText("Touch controls"));
    await user.click(getByText("Shift"));
    await user.click(getByText("Tab"));

    await waitFor(() => {
      expect(terminalConnection.sentMessages).toContain(JSON.stringify({
        type: "terminal.input",
        data: "\u001b[Z",
      }));
    });
  });

  test("sends a Ctrl+C touch shortcut", async () => {
    api.get("/api/ssh-sessions/:id", (req) =>
      createSshSession({ config: { id: req.params["id"]!, name: "SSH Ctrl C" } }),
    );

    const { getByText, user } = renderWithUser(
      <SshSessionDetails sshSessionId="ssh-mobile-ctrl-c" onBack={() => {}} />,
    );

    await waitFor(() => {
      expect(getByText("SSH Ctrl C")).toBeTruthy();
    });

    await waitFor(() => {
      expect(ws.getConnections("/api/ssh-terminal")).toHaveLength(1);
      expect(lastTerminal).not.toBeNull();
    });

    const terminalConnection = ws.getConnections("/api/ssh-terminal")[0]!;
    await act(async () => {
      ws.sendEventTo(terminalConnection, {
        type: "terminal.connected",
        sshSessionId: "ssh-mobile-ctrl-c",
      });
    });

    await user.click(getByText("Touch controls"));
    await user.click(getByText("Ctrl+C"));

    await waitFor(() => {
      expect(terminalConnection.sentMessages).toContain(JSON.stringify({
        type: "terminal.input",
        data: "\u0003",
      }));
    });
  });

  test("sends raw text shortcuts from touch controls", async () => {
    api.get("/api/ssh-sessions/:id", (req) =>
      createSshSession({ config: { id: req.params["id"]!, name: "SSH Text Shortcuts" } }),
    );

    const { getByText, user } = renderWithUser(
      <SshSessionDetails sshSessionId="ssh-mobile-text-shortcuts" onBack={() => {}} />,
    );

    await waitFor(() => {
      expect(getByText("SSH Text Shortcuts")).toBeTruthy();
    });

    await waitFor(() => {
      expect(ws.getConnections("/api/ssh-terminal")).toHaveLength(1);
      expect(lastTerminal).not.toBeNull();
    });

    const terminalConnection = ws.getConnections("/api/ssh-terminal")[0]!;
    await act(async () => {
      ws.sendEventTo(terminalConnection, {
        type: "terminal.connected",
        sshSessionId: "ssh-mobile-text-shortcuts",
      });
    });

    await user.click(getByText("Touch controls"));
    await user.click(getByText("Install Neovim"));
    await user.click(getByText("Neovim"));
    await user.click(getByText("Ntree"));
    await user.click(getByText(":q"));

    await waitFor(() => {
      expect(terminalConnection.sentMessages).toContain(JSON.stringify({
        type: "terminal.input",
        data: "sudo apt update && sudo apt install neovim",
      }));
      expect(terminalConnection.sentMessages).toContain(JSON.stringify({
        type: "terminal.input",
        data: "nvim\n",
      }));
      expect(terminalConnection.sentMessages).toContain(JSON.stringify({
        type: "terminal.input",
        data: ":Ntree\n",
      }));
      expect(terminalConnection.sentMessages).toContain(JSON.stringify({
        type: "terminal.input",
        data: ":q\n",
      }));
    });
  });

  test("wraps touch controls instead of forcing horizontal scrolling", async () => {
    api.get("/api/ssh-sessions/:id", (req) =>
      createSshSession({ config: { id: req.params["id"]!, name: "SSH Wrapped Controls" } }),
    );

    const { getByText, getByTestId, user } = renderWithUser(
      <SshSessionDetails sshSessionId="ssh-mobile-wrap" onBack={() => {}} />,
    );

    await waitFor(() => {
      expect(getByText("SSH Wrapped Controls")).toBeTruthy();
    });

    await user.click(getByText("Touch controls"));

    await waitFor(() => {
      expect(getByText("Pane ↓")).toBeTruthy();
    });

    const layout = getByTestId("ssh-touch-controls-layout");
    const buttons = getByTestId("ssh-touch-controls-buttons");

    expect(layout.className).not.toContain("overflow-x-auto");
    expect(buttons.className).toContain("flex-wrap");
    expect(buttons.className).not.toContain("min-w-max");
  });

  test("keeps neovim-related touch controls grouped at the end after a separator", async () => {
    api.get("/api/ssh-sessions/:id", (req) =>
      createSshSession({ config: { id: req.params["id"]!, name: "SSH Neovim Group" } }),
    );

    const { getByText, getByTestId, user } = renderWithUser(
      <SshSessionDetails sshSessionId="ssh-mobile-neovim-group" onBack={() => {}} />,
    );

    await waitFor(() => {
      expect(getByText("SSH Neovim Group")).toBeTruthy();
    });

    await user.click(getByText("Touch controls"));

    const buttons = getByTestId("ssh-touch-controls-buttons");
    const buttonLabels = Array.from(buttons.querySelectorAll("button")).map((button) =>
      button.textContent?.trim() ?? "",
    );
    const separators = buttons.querySelectorAll("span[aria-hidden='true']");

    expect(buttonLabels.slice(-4)).toEqual([
      "Install Neovim",
      "Neovim",
      "Ntree",
      ":q",
    ]);
    expect(separators).toHaveLength(3);
  });

  test("sends tmux helper shortcuts from touch controls", async () => {
    api.get("/api/ssh-sessions/:id", (req) =>
      createSshSession({ config: { id: req.params["id"]!, name: "SSH Tmux Helpers" } }),
    );

    const { getByText, user } = renderWithUser(
      <SshSessionDetails sshSessionId="ssh-mobile-3" onBack={() => {}} />,
    );

    await waitFor(() => {
      expect(getByText("SSH Tmux Helpers")).toBeTruthy();
    });

    await waitFor(() => {
      expect(ws.getConnections("/api/ssh-terminal")).toHaveLength(1);
      expect(lastTerminal).not.toBeNull();
    });

    const terminalConnection = ws.getConnections("/api/ssh-terminal")[0]!;
    await act(async () => {
      ws.sendEventTo(terminalConnection, {
        type: "terminal.connected",
        sshSessionId: "ssh-mobile-3",
      });
    });

    await user.click(getByText("Touch controls"));
    await user.click(getByText("Split"));
    await user.click(getByText("Next"));
    await user.click(getByText("Pane ↑"));
    await user.click(getByText("Pane ↓"));

    await waitFor(() => {
      expect(terminalConnection.sentMessages).toContain(JSON.stringify({
        type: "terminal.input",
        data: "\u0002\"",
      }));
      expect(terminalConnection.sentMessages).toContain(JSON.stringify({
        type: "terminal.input",
        data: "\u0002o",
      }));
      expect(terminalConnection.sentMessages).toContain(JSON.stringify({
        type: "terminal.input",
        data: "\u0002\u001b[1;5A",
      }));
      expect(terminalConnection.sentMessages).toContain(JSON.stringify({
        type: "terminal.input",
        data: "\u0002\u001b[1;5B",
      }));
    });
  });

  test("waits for terminal readiness before sending the initial resize", async () => {
    api.get("/api/ssh-sessions/:id", (req) =>
      createSshSession({ config: { id: req.params["id"]!, name: "SSH Ready Gate" } }),
    );

    const { getByText } = renderWithUser(
      <SshSessionDetails sshSessionId="ssh-ready-1" onBack={() => {}} />,
    );

    await waitFor(() => {
      expect(getByText("SSH Ready Gate")).toBeTruthy();
      expect(ws.getConnections("/api/ssh-terminal")).toHaveLength(1);
      expect(lastTerminal).not.toBeNull();
    });

    const terminalConnection = ws.getConnections("/api/ssh-terminal")[0]!;
    const resizePayload = JSON.stringify({
      type: "terminal.resize",
      cols: 80,
      rows: 24,
    });

    expect(terminalConnection.sentMessages).not.toContain(resizePayload);

    await act(async () => {
      ws.sendEventTo(terminalConnection, {
        type: "terminal.connected",
        sshSessionId: "ssh-ready-1",
      });
    });

    await waitFor(() => {
      expect(terminalConnection.sentMessages).toContain(resizePayload);
    });
  });

  test("treats the first terminal output as a readiness fallback when terminal.connected is missing", async () => {
    api.get("/api/ssh-sessions/:id", (req) =>
      createSshSession({ config: { id: req.params["id"]!, name: "SSH Buffered Output" } }),
    );

    const { getByText } = renderWithUser(
      <SshSessionDetails sshSessionId="ssh-buffer-1" onBack={() => {}} />,
    );

    await waitFor(() => {
      expect(getByText("SSH Buffered Output")).toBeTruthy();
      expect(ws.getConnections("/api/ssh-terminal")).toHaveLength(1);
      expect(lastTerminal).not.toBeNull();
    });

    const terminalConnection = ws.getConnections("/api/ssh-terminal")[0]!;
    const resizePayload = JSON.stringify({
      type: "terminal.resize",
      cols: 80,
      rows: 24,
    });

    await act(async () => {
      ws.sendEventTo(terminalConnection, {
        type: "terminal.output",
        data: "prompt$ ",
      });
    });

    await waitFor(() => {
      expect(lastTerminal?.writes).toContain("prompt$ ");
      expect(terminalConnection.sentMessages).toContain(resizePayload);
      expect(getByText("open")).toBeTruthy();
    });
  });

  test("keeps the terminal mounted during SSH session status refreshes", async () => {
    api.get("/api/ssh-sessions/:id", (req) =>
      createSshSession({ config: { id: req.params["id"]!, name: "SSH Refresh Stable" } }),
    );

    const { getByText, queryByText } = renderWithUser(
      <SshSessionDetails sshSessionId="ssh-refresh-1" onBack={() => {}} />,
    );

    await waitFor(() => {
      expect(getByText("SSH Refresh Stable")).toBeTruthy();
      expect(ws.getConnections("/api/ssh-terminal")).toHaveLength(1);
      expect(ws.getConnections("/api/ws?sshSessionId=ssh-refresh-1")).toHaveLength(1);
      expect(lastTerminal).not.toBeNull();
    });

    const terminalConnection = ws.getConnections("/api/ssh-terminal")[0]!;
    const sessionConnection = ws.getConnections("/api/ws?sshSessionId=ssh-refresh-1")[0]!;

    await act(async () => {
      ws.sendEventTo(terminalConnection, {
        type: "terminal.connected",
        sshSessionId: "ssh-refresh-1",
      });
    });

    await act(async () => {
      ws.sendEventTo(sessionConnection, {
        type: "ssh_session.status",
        sshSessionId: "ssh-refresh-1",
        status: "connected",
        timestamp: new Date().toISOString(),
      });
    });

    await waitFor(() => {
      expect(queryByText("Loading SSH session...")).toBeNull();
      expect(ws.getConnections("/api/ssh-terminal")).toHaveLength(1);
      expect(getByText("Touch controls")).toBeTruthy();
      expect(lastTerminal).not.toBeNull();
    });
  });

  test("copies terminal clipboard messages to the browser clipboard", async () => {
    api.get("/api/ssh-sessions/:id", (req) =>
      createSshSession({ config: { id: req.params["id"]!, name: "SSH Clipboard" } }),
    );

    const { getByText } = renderWithUser(
      <SshSessionDetails
        sshSessionId="ssh-clipboard-1"
        onBack={() => {}}
        copyTextToClipboard={async (text) => {
          clipboardWrites.push(text);
        }}
      />,
    );

    await waitFor(() => {
      expect(getByText("SSH Clipboard")).toBeTruthy();
      expect(ws.getConnections("/api/ssh-terminal")).toHaveLength(1);
      expect(lastTerminal).not.toBeNull();
    });

    const terminalConnection = ws.getConnections("/api/ssh-terminal")[0]!;
    await waitFor(() => {
      expect(terminalConnection.isOpen).toBe(true);
    });

    await act(async () => {
      ws.sendEventTo(terminalConnection, {
        type: "terminal.clipboard",
        text: "copied from remote",
      });
    });

    await waitFor(() => {
      expect(clipboardWrites).toEqual(["copied from remote"]);
    });
  });
});
