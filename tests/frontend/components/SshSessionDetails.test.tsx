import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { createMockApi } from "../helpers/mock-api";
import { createMockWebSocket } from "../helpers/mock-websocket";
import { createSshSession } from "../helpers/factories";
import { renderWithUser, waitFor } from "../helpers/render";

class MockTerminal {
  cols = 80;
  rows = 24;
  dataHandler: ((data: string) => void) | null = null;

  loadAddon() {}
  open() {}
  focus() {}
  write() {}
  writeln() {}

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
  });

  afterEach(() => {
    api.uninstall();
    ws.uninstall();
  });

  test("sends mobile-friendly modifier combinations and special keys over the terminal websocket", async () => {
    api.get("/api/ssh-sessions/:id", (req) =>
      createSshSession({ config: { id: req.params["id"]!, name: "SSH Mobile Session" } }),
    );

    const { getByText, getByLabelText, user } = renderWithUser(
      <SshSessionDetails sshSessionId="ssh-mobile-1" onBack={() => {}} />,
    );

    await waitFor(() => {
      expect(getByText("SSH Mobile Session")).toBeTruthy();
    });

    await waitFor(() => {
      expect(ws.getConnections("/api/ssh-terminal")).toHaveLength(1);
    });

    const terminalConnection = ws.getConnections("/api/ssh-terminal")[0]!;

    await user.click(getByText("Ctrl"));
    await user.type(getByLabelText("Send a key with the active modifiers"), "c");
    await user.click(getByText("Send Key"));

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
    });

    const terminalConnection = ws.getConnections("/api/ssh-terminal")[0]!;

    await user.click(getByText("Shift"));
    await user.click(getByText("Tab"));

    await waitFor(() => {
      expect(terminalConnection.sentMessages).toContain(JSON.stringify({
        type: "terminal.input",
        data: "\u001b[Z",
      }));
    });
  });
});
