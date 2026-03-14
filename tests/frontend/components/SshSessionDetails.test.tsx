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
const TEST_PUBLIC_KEY = `-----BEGIN PUBLIC KEY-----
MIICIjANBgkqhkiG9w0BAQEFAAOCAg8AMIICCgKCAgEAsKNhd9E/OQ+lbqKlfYjv
69xGawOr9J0cMf2Qj3jWXaXv6mm1xrDBMYNboWkjxV6AZAG9zDJO6s8eP/rj7s3P
7dfmoHGRfqoItqqt6WkKxZxjrnDc0l43wcdGaGm0fL5f4enJv+0Ft9Y+BSHhMl+m
ENb+JvTFFK3bz38eLI8Td2RLIqjQ+bTR0M55VdlyIJvtZ4bAzn9IdABzd8hIp/Fq
ZI97s5nsyDqX5ePG7e9UY9kfF4sxhQ1jlwmkIYlQmVl3zY6fWihc+YVHL7XWE/90
cwJp+7qyc0w90j+5vMuJcfFm7F8FG7Zz+oOkkeNbeqMHEaJwVIi9vtHbljH5jtmd
Tib0ROswpXTuhp2cDEgfZiF5m6o6Yws1eIqUhYaEfpOUqseYjPe6Klbjyl90m7Xq
QpPbjq5q7UL/ase5r4n4t0JgcLZw1oP98rVAx+VFE+UViVd9qqH7CFhxxR9t7LFa
NwUWw/pj0oI3Qul2lJfXaogfXzdcguVRik/yi0zQ5p5ArRBPEtmeNcEqA9x1ApNQ
h8ND8r3lVAjFrX8+pj1fmPSxaIXgQPywAzr5kgdWz3BOEkrd5alvd+6kLxC2ErMA
tYXzrp47C+1F7elWjBhHsqlhHSl7zQxqXqetisXZ4uEyv+4S0M3O+Q+iLeidcbLQ
Vrt5VIv2q/QnK29KDywKJrsCAwEAAQ==
-----END PUBLIC KEY-----`;

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
    globalThis.localStorage?.clear();
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
    await user.click(getByText("Install fresh"));
    await user.click(getByText("Fresh"));

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
      expect(terminalConnection.sentMessages).toContain(JSON.stringify({
        type: "terminal.input",
        data: "curl https://raw.githubusercontent.com/sinelaw/fresh/refs/heads/master/scripts/install.sh | sh",
      }));
      expect(terminalConnection.sentMessages).toContain(JSON.stringify({
        type: "terminal.input",
        data: "fresh\n",
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

  test("keeps neovim and fresh touch controls grouped at the end after separators", async () => {
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

    expect(buttonLabels.slice(-6, -2)).toEqual([
      "Install Neovim",
      "Neovim",
      "Ntree",
      ":q",
    ]);
    expect(buttonLabels.slice(-2)).toEqual([
      "Install fresh",
      "Fresh",
    ]);
    expect(separators).toHaveLength(4);
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

  test("connects a standalone SSH session terminal with a stored browser credential", async () => {
    globalThis.localStorage?.setItem("ralpher.sshServerCredential.server-1", JSON.stringify({
      encryptedCredential: {
        algorithm: "RSA-OAEP-256",
        fingerprint: "fp-1",
        version: 1,
        ciphertext: "ciphertext",
      },
      storedAt: new Date().toISOString(),
    }));
    api.get("/api/ssh-server-sessions/:id", (req) => ({
      config: {
        id: req.params["id"]!,
        sshServerId: "server-1",
        name: "Standalone Session",
        remoteSessionName: "ralpher-standalone-1",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
      state: { status: "ready" },
    }));
    api.get("/api/ssh-servers/:id/public-key", () => ({
      algorithm: "RSA-OAEP-256",
      publicKey: TEST_PUBLIC_KEY,
      fingerprint: "fp-1",
      version: 1,
      createdAt: new Date().toISOString(),
    }));
    api.post("/api/ssh-servers/:id/credentials", () => ({
      credentialToken: "token-123",
      expiresAt: new Date().toISOString(),
    }));

    const { getByText } = renderWithUser(
      <SshSessionDetails sshSessionId="standalone-ssh-1" onBack={() => {}} />,
    );

    await waitFor(() => {
      expect(getByText("Standalone Session")).toBeTruthy();
      expect(ws.getConnections("/api/ssh-terminal")).toHaveLength(1);
    });

    const terminalConnection = ws.getConnections("/api/ssh-terminal")[0]!;
    expect(terminalConnection.queryParams["sshServerSessionId"]).toBe("standalone-ssh-1");
    expect(terminalConnection.queryParams["credentialToken"]).toBe("token-123");
  });

  test("does not re-probe the workspace endpoint or remint standalone terminal credentials on session refresh", async () => {
    let standaloneStatus = "ready";

    globalThis.localStorage?.setItem("ralpher.sshServerCredential.server-1", JSON.stringify({
      encryptedCredential: {
        algorithm: "RSA-OAEP-256",
        fingerprint: "fp-1",
        version: 1,
        ciphertext: "ciphertext",
      },
      storedAt: new Date().toISOString(),
    }));

    api.get("/api/ssh-sessions/:id", () => ({
      error: "not_found",
      message: "SSH session not found",
    }), 404);
    api.get("/api/ssh-server-sessions/:id", (req) => ({
      config: {
        id: req.params["id"]!,
        sshServerId: "server-1",
        name: "Refresh Stable Session",
        remoteSessionName: "ralpher-standalone-refresh",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
      state: { status: standaloneStatus },
    }));
    api.get("/api/ssh-servers/:id/public-key", () => ({
      algorithm: "RSA-OAEP-256",
      publicKey: TEST_PUBLIC_KEY,
      fingerprint: "fp-1",
      version: 1,
      createdAt: new Date().toISOString(),
    }));
    api.post("/api/ssh-servers/:id/credentials", () => ({
      credentialToken: "token-123",
      expiresAt: new Date().toISOString(),
    }));

    const { getByText } = renderWithUser(
      <SshSessionDetails sshSessionId="standalone-ssh-refresh" onBack={() => {}} />,
    );

    await waitFor(() => {
      expect(getByText("Refresh Stable Session")).toBeTruthy();
      expect(api.calls("/api/ssh-sessions/:id", "GET")).toHaveLength(1);
      expect(api.calls("/api/ssh-server-sessions/:id", "GET")).toHaveLength(1);
      expect(api.calls("/api/ssh-servers/:id/public-key", "GET")).toHaveLength(1);
      expect(api.calls("/api/ssh-servers/:id/credentials", "POST")).toHaveLength(1);
      expect(ws.getConnections("/api/ws")).toHaveLength(1);
      expect(ws.getConnections("/api/ssh-terminal")).toHaveLength(1);
    });

    standaloneStatus = "connected";
    const sessionConnection = ws.getConnections("/api/ws")[0]!;

    await act(async () => {
      ws.sendEventTo(sessionConnection, {
        type: "ssh_session.status",
        sshSessionId: "standalone-ssh-refresh",
        status: "connected",
      });
    });

    await waitFor(() => {
      expect(api.calls("/api/ssh-server-sessions/:id", "GET")).toHaveLength(2);
    });

    expect(api.calls("/api/ssh-sessions/:id", "GET")).toHaveLength(1);
    expect(api.calls("/api/ssh-servers/:id/public-key", "GET")).toHaveLength(1);
    expect(api.calls("/api/ssh-servers/:id/credentials", "POST")).toHaveLength(1);
    expect(ws.getConnections("/api/ws")).toHaveLength(1);
    expect(ws.getConnections("/api/ssh-terminal")).toHaveLength(1);
    expect(ws.getConnections("/api/ssh-terminal")[0]?.queryParams["credentialToken"]).toBe("token-123");
  });

  test("prompts for a standalone SSH password when no browser credential is stored", async () => {
    api.get("/api/ssh-server-sessions/:id", (req) => ({
      config: {
        id: req.params["id"]!,
        sshServerId: "server-1",
        name: "Password Prompt Session",
        remoteSessionName: "ralpher-standalone-2",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
      state: { status: "ready" },
    }));
    api.get("/api/ssh-servers/:id/public-key", () => ({
      algorithm: "RSA-OAEP-256",
      publicKey: TEST_PUBLIC_KEY,
      fingerprint: "fp-1",
      version: 1,
      createdAt: new Date().toISOString(),
    }));
    api.post("/api/ssh-servers/:id/credentials", () => ({
      credentialToken: "token-456",
      expiresAt: new Date().toISOString(),
    }));

    const { getByLabelText, getByText, queryByText, user } = renderWithUser(
      <SshSessionDetails sshSessionId="standalone-ssh-2" onBack={() => {}} />,
    );

    await waitFor(() => {
      expect(getByText("Password Prompt Session")).toBeTruthy();
      expect(getByText("SSH password required")).toBeTruthy();
    });

    expect(ws.getConnections("/api/ssh-terminal")).toHaveLength(0);

    await user.type(getByLabelText("SSH password"), "secret");
    await user.click(getByText("Continue"));

    await waitFor(() => {
      expect(queryByText("SSH password required")).toBeNull();
      expect(api.calls("/api/ssh-servers/:id/credentials", "POST")).toHaveLength(1);
    });

    expect(api.calls("/api/ssh-servers/:id/credentials", "POST")[0]?.params["id"]).toBe("server-1");
    expect(globalThis.localStorage?.getItem("ralpher.sshServerCredential.server-1")).toBeTruthy();
  });
});
