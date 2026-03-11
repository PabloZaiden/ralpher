import { EventEmitter } from "node:events";
import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { mkdtemp, rm } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";

import { backendManager } from "../../src/core/backend-manager";
import type { CommandExecutor, CommandResult } from "../../src/core/command-executor";
import { initializeDatabase, closeDatabase } from "../../src/persistence/database";
import { saveSshSession } from "../../src/persistence/ssh-sessions";
import { createWorkspace } from "../../src/persistence/workspaces";
import type { SshSession, Workspace } from "../../src/types";

class MockStream extends EventEmitter {
  setEncoding() {}
}

class MockChildProcess extends EventEmitter {
  stdout = new MockStream();
  stderr = new MockStream();
  stdin = {
    writable: true,
    write: (_data: string) => true,
  };
  exitCode: number | null = null;
  signalCode: NodeJS.Signals | null = null;
  autoCloseOnKill = true;
  killedSignals: NodeJS.Signals[] = [];

  kill(signal: NodeJS.Signals = "SIGTERM"): boolean {
    this.killedSignals.push(signal);
    if (this.autoCloseOnKill) {
      this.emitClose(null, signal);
    }
    return true;
  }

  emitClose(code: number | null, signal: NodeJS.Signals | null): void {
    this.exitCode = code;
    this.signalCode = signal;
    this.emit("close", code, signal);
  }
}

class ExecutorStub implements CommandExecutor {
  constructor(private readonly execImpl: (command: string, args: string[]) => Promise<CommandResult>) {}

  async exec(command: string, args: string[]): Promise<CommandResult> {
    return await this.execImpl(command, args);
  }

  async fileExists(): Promise<boolean> {
    return false;
  }

  async directoryExists(): Promise<boolean> {
    return false;
  }

  async readFile(): Promise<string | null> {
    return null;
  }

  async listDirectory(): Promise<string[]> {
    return [];
  }

  async writeFile(): Promise<boolean> {
    return false;
  }
}

const actualChildProcessModule = await import("node:child_process");

let currentProc: MockChildProcess | null = null;
let spawnCount = 0;
let lastSpawnCommand: string[] | null = null;
let lastSpawnEnv: NodeJS.ProcessEnv | undefined;
mock.module("node:child_process", () => ({
  ...actualChildProcessModule,
  spawn: (command: string, args: string[], options?: { env?: NodeJS.ProcessEnv }) => {
    spawnCount += 1;
    lastSpawnCommand = [command, ...args];
    lastSpawnEnv = options?.env;
    currentProc = new MockChildProcess();
    return currentProc as unknown as ReturnType<typeof actualChildProcessModule.spawn>;
  },
}));

const { buildAttachCommand, SshTerminalBridge } = await import("../../src/core/ssh-terminal-bridge");

function createTestWorkspace(directory: string): Workspace {
  return {
    id: "workspace-1",
    name: "SSH Workspace",
    directory,
    serverSettings: {
      agent: {
        provider: "copilot",
        transport: "ssh",
        hostname: "localhost",
        username: "tester",
        port: 22,
      },
    },
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

function createTestSession(workspaceId: string, directory: string): SshSession {
  return {
    config: {
      id: "ssh-session-1",
      name: "SSH Session",
      workspaceId,
      directory,
      remoteSessionName: "ralpher-session-1",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
    state: {
      status: "ready",
    },
  };
}

describe("SshTerminalBridge", () => {
  let tempDir: string;
  let workspace: Workspace;
  let session: SshSession;
  let execImpl: (command: string, args: string[]) => Promise<CommandResult>;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "ralpher-ssh-bridge-unit-"));
    process.env["RALPHER_DATA_DIR"] = tempDir;
    await initializeDatabase();

    backendManager.resetForTesting();
    backendManager.enableTestMode();

    spawnCount = 0;
    currentProc = null;
    lastSpawnCommand = null;
    lastSpawnEnv = undefined;
    workspace = createTestWorkspace("/workspaces/example");
    session = createTestSession(workspace.id, workspace.directory);
    await createWorkspace(workspace);
    await saveSshSession(session);

    execImpl = async (command: string, args: string[]) => {
      if (command === "tmux" && args[0] === "-V") {
        return {
          success: true,
          stdout: "tmux 3.4\n",
          stderr: "",
          exitCode: 0,
        };
      }
      if (command === "tmux" && args[0] === "display-message") {
        return {
          success: true,
          stdout: "1\n",
          stderr: "",
          exitCode: 0,
        };
      }
      return {
        success: true,
        stdout: "",
        stderr: "",
        exitCode: 0,
      };
    };
    backendManager.setExecutorFactoryForTesting(() => new ExecutorStub(execImpl));
  });

  afterEach(async () => {
    backendManager.resetForTesting();
    closeDatabase();
    delete process.env["RALPHER_DATA_DIR"];
    await rm(tempDir, { recursive: true, force: true });
  });

  test("buildAttachCommand disables the tmux status bar before attaching", () => {
    const command = buildAttachCommand(session);

    expect(command).toContain("tmux new-session -d -s 'ralpher-session-1' -c '/workspaces/example';");
    expect(command).toContain("tmux set-option -t 'ralpher-session-1' status off;");
    expect(command).toContain("exec tmux attach-session -t 'ralpher-session-1'");
  });

  test("uses a fallback TERM when the server environment does not define one", async () => {
    const previousTerm = process.env["TERM"];
    delete process.env["TERM"];

    try {
      const bridge = new SshTerminalBridge(session.config.id, {
        onOutput: () => {},
      });

      await bridge.connect();

      expect(lastSpawnCommand?.[0]).toBe("ssh");
      expect(lastSpawnEnv?.["TERM"]).toBe("xterm-256color");

      await bridge.dispose();
    } finally {
      if (previousTerm === undefined) {
        delete process.env["TERM"];
      } else {
        process.env["TERM"] = previousTerm;
      }
    }
  });

  test("preserves an existing TERM when opening the SSH terminal", async () => {
    const previousTerm = process.env["TERM"];
    process.env["TERM"] = "screen-256color";

    try {
      const bridge = new SshTerminalBridge(session.config.id, {
        onOutput: () => {},
      });

      await bridge.connect();

      expect(lastSpawnCommand?.[0]).toBe("ssh");
      expect(lastSpawnEnv?.["TERM"]).toBe("screen-256color");

      await bridge.dispose();
    } finally {
      if (previousTerm === undefined) {
        delete process.env["TERM"];
      } else {
        process.env["TERM"] = previousTerm;
      }
    }
  });

  test("marks startup probe failures as failed and tears down the SSH process", async () => {
    execImpl = async (command: string, args: string[]) => {
      if (command === "tmux" && args[0] === "-V") {
        return {
          success: true,
          stdout: "tmux 3.4\n",
          stderr: "",
          exitCode: 0,
        };
      }
      throw new Error("tmux probe failed");
    };

    const onErrorCalls: string[] = [];
    const bridge = new SshTerminalBridge(session.config.id, {
      onOutput: () => {},
      onError: (error) => {
        onErrorCalls.push(String(error));
      },
    });

    await expect(bridge.connect()).rejects.toThrow("tmux probe failed");

    expect(currentProc?.killedSignals).toEqual(["SIGTERM"]);
    expect(onErrorCalls.some((message) => message.includes("tmux probe failed"))).toBe(true);
  });

  test("dispose waits for close and allows reconnecting the same bridge instance", async () => {
    const bridge = new SshTerminalBridge(session.config.id, {
      onOutput: () => {},
    });

    await bridge.connect();
    expect(spawnCount).toBe(1);

    const firstProc = currentProc!;
    firstProc.autoCloseOnKill = false;

    let disposed = false;
    const disposePromise = bridge.dispose().then(() => {
      disposed = true;
    });

    await Bun.sleep(0);
    expect(disposed).toBe(false);
    expect(firstProc.killedSignals).toEqual(["SIGTERM"]);

    firstProc.emitClose(0, "SIGTERM");
    await disposePromise;
    expect(disposed).toBe(true);

    await bridge.connect();
    expect(spawnCount).toBe(2);
  });

  test("treats live stdout as a readiness fallback when tmux probing lags", async () => {
    execImpl = async (command: string, args: string[]) => {
      if (command === "tmux" && args[0] === "-V") {
        return {
          success: true,
          stdout: "tmux 3.4\n",
          stderr: "",
          exitCode: 0,
        };
      }
      if (command === "tmux" && args[0] === "display-message") {
        return {
          success: false,
          stdout: "",
          stderr: "session missing",
          exitCode: 1,
        };
      }
      return {
        success: true,
        stdout: "",
        stderr: "",
        exitCode: 0,
      };
    };

    const outputChunks: string[] = [];
    const bridge = new SshTerminalBridge(session.config.id, {
      onOutput: (chunk) => {
        outputChunks.push(chunk);
      },
      readyTimeoutMs: 500,
    });

    const connectPromise = bridge.connect();
    await Bun.sleep(0);

    currentProc?.stdout.emit("data", "tester@host:~$ ");

    await expect(connectPromise).resolves.toBeUndefined();
    expect(outputChunks).toContain("tester@host:~$ ");
  });
});
