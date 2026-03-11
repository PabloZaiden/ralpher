import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { createServer } from "node:net";
import { createWorkspace } from "../../src/persistence/workspaces";
import { initializeDatabase, closeDatabase } from "../../src/persistence/database";
import { saveSshSession } from "../../src/persistence/ssh-sessions";
import { SshTerminalBridge } from "../../src/core/ssh-terminal-bridge";
import type { SshSession, Workspace } from "../../src/types";

async function getAvailablePort(): Promise<number> {
  return await new Promise((resolve, reject) => {
    const server = createServer();
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        server.close();
        reject(new Error("Failed to allocate port"));
        return;
      }
      const port = address.port;
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve(port);
      });
    });
  });
}

async function commandExists(command: string): Promise<boolean> {
  const result = await Bun.$`which ${command}`.quiet().nothrow();
  return result.exitCode === 0;
}

async function runQuiet(command: string[]): Promise<void> {
  const proc = Bun.spawn(command, {
    stdout: "ignore",
    stderr: "pipe",
  });
  const exitCode = await proc.exited;
  if (exitCode !== 0) {
    throw new Error(await new Response(proc.stderr).text());
  }
}

const canRunRealSshBridge = async () =>
  await commandExists("sshd")
  && await commandExists("ssh")
  && await commandExists("ssh-keygen")
  && await commandExists("tmux");

describe("SshTerminalBridge integration", () => {
  let tempDir: string;
  let originalHome: string | undefined;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "ralpher-ssh-bridge-"));
    process.env["RALPHER_DATA_DIR"] = join(tempDir, "data");
    await initializeDatabase();
    originalHome = process.env["HOME"];
  });

  afterEach(async () => {
    closeDatabase();
    if (originalHome === undefined) {
      delete process.env["HOME"];
    } else {
      process.env["HOME"] = originalHome;
    }
    delete process.env["RALPHER_DATA_DIR"];
    await rm(tempDir, { recursive: true, force: true });
  });

  test("connects through a real local sshd and tears it down when capabilities are available", async () => {
    if (!(await canRunRealSshBridge())) {
      return;
    }

    const homeDir = join(tempDir, "home");
    const sshDir = join(homeDir, ".ssh");
    const serverDir = join(tempDir, "server");
    const workspaceDir = join(tempDir, "workspace");
    await mkdir(sshDir, { recursive: true });
    await mkdir(serverDir, { recursive: true });
    await mkdir(workspaceDir, { recursive: true });

    await Bun.$`git init ${workspaceDir}`.quiet();
    await Bun.$`git -C ${workspaceDir} config user.email "test@test.com"`.quiet();
    await Bun.$`git -C ${workspaceDir} config user.name "Test User"`.quiet();
    await Bun.$`touch ${workspaceDir}/README.md`.quiet();
    await Bun.$`git -C ${workspaceDir} add .`.quiet();
    await Bun.$`git -C ${workspaceDir} commit -m "Initial commit"`.quiet();

    await runQuiet(["ssh-keygen", "-q", "-t", "rsa", "-N", "", "-f", join(sshDir, "id_rsa")]);
    const publicKey = await readFile(join(sshDir, "id_rsa.pub"), "utf8");
    await writeFile(join(sshDir, "authorized_keys"), publicKey, { mode: 0o600 });
    await runQuiet(["ssh-keygen", "-q", "-t", "rsa", "-N", "", "-f", join(serverDir, "ssh_host_rsa_key")]);

    const usernameResult = await Bun.$`whoami`.text();
    const username = usernameResult.trim();
    const port = await getAvailablePort();
    const pidFile = join(serverDir, "sshd.pid");
    const configPath = join(serverDir, "sshd_config");
    await writeFile(configPath, [
      `Port ${port}`,
      "ListenAddress 127.0.0.1",
      `HostKey ${join(serverDir, "ssh_host_rsa_key")}`,
      `PidFile ${pidFile}`,
      "PasswordAuthentication no",
      "ChallengeResponseAuthentication no",
      "UsePAM no",
      "PermitRootLogin no",
      "PubkeyAuthentication yes",
      `AuthorizedKeysFile ${join(sshDir, "authorized_keys")}`,
      `AllowUsers ${username}`,
      `StrictModes no`,
      `Subsystem sftp internal-sftp`,
    ].join("\n"));

    process.env["HOME"] = homeDir;

    const sshd = Bun.spawn(["/usr/sbin/sshd", "-D", "-f", configPath], {
      stdout: "ignore",
      stderr: "pipe",
    });

    try {
      for (let attempt = 0; attempt < 40; attempt++) {
        const probe = await Bun.$`ssh -o BatchMode=yes -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -p ${String(port)} ${username}@127.0.0.1 -- true`.quiet().nothrow();
        if (probe.exitCode === 0) {
          break;
        }
        if (attempt === 39) {
          const stderr = await new Response(sshd.stderr).text();
          throw new Error(`sshd did not become ready: ${stderr}`);
        }
        await Bun.sleep(100);
      }

      const workspace: Workspace = {
        id: crypto.randomUUID(),
        name: "SSH Test Workspace",
        directory: workspaceDir,
        serverSettings: {
          agent: {
            provider: "opencode",
            transport: "ssh",
            hostname: "127.0.0.1",
            port,
            username,
          },
        },
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      await createWorkspace(workspace);

      const session: SshSession = {
        config: {
          id: crypto.randomUUID(),
          name: "Bridge Session",
          workspaceId: workspace.id,
          directory: workspaceDir,
          remoteSessionName: `ralpher-${crypto.randomUUID().replace(/-/g, "").slice(0, 24)}`,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
        state: {
          status: "ready",
        },
      };
      await saveSshSession(session);

      let output = "";
      const bridge = new SshTerminalBridge(session.config.id, {
        onOutput: (chunk) => {
          output += chunk;
        },
      });

      await bridge.connect();
      await bridge.resize(120, 32);
      bridge.sendInput("printf 'SSH_BRIDGE_SIZE:'; stty size; printf ':DONE\\n'\n");
      bridge.sendInput("echo SSH_BRIDGE_OK\n");

      for (let attempt = 0; attempt < 50; attempt++) {
        if (output.includes("SSH_BRIDGE_OK") && output.includes("SSH_BRIDGE_SIZE:32 120:DONE")) {
          break;
        }
        await Bun.sleep(100);
      }

      expect(output).toContain("SSH_BRIDGE_SIZE:32 120:DONE");
      expect(output).toContain("SSH_BRIDGE_OK");
      await bridge.dispose();
    } finally {
      sshd.kill();
      await sshd.exited;
    }
  });
});
