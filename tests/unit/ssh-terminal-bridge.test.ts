import { describe, expect, test } from "bun:test";

import { buildAttachCommand } from "../../src/core/ssh-terminal-bridge";
import type { SshSession } from "../../src/types";

function createSshSession(): SshSession {
  return {
    config: {
      id: "ssh-session-1",
      name: "SSH Session",
      workspaceId: "workspace-1",
      directory: "/workspaces/example",
      remoteSessionName: "ralpher-session-1",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
    state: {
      status: "ready",
    },
  };
}

describe("buildAttachCommand", () => {
  test("disables the tmux status bar before attaching", () => {
    const command = buildAttachCommand(createSshSession());

    expect(command).toContain("tmux new-session -d -s 'ralpher-session-1' -c '/workspaces/example';");
    expect(command).toContain("tmux set-option -t 'ralpher-session-1' status off;");
    expect(command).toContain("exec tmux attach-session -t 'ralpher-session-1'");
  });
});
