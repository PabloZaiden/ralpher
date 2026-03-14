import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { constants, publicEncrypt } from "node:crypto";
import { mkdtemp, rm } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";

import { ensureDataDirectories, closeDatabase } from "../../src/persistence/database";
import { sshServerManager } from "../../src/core/ssh-server-manager";
import { sshServerKeyManager } from "../../src/core/ssh-server-key-manager";
import { TestCommandExecutor } from "../mocks/mock-executor";

class SshServerTestExecutor extends TestCommandExecutor {
  public deleteCommands: string[] = [];

  override async exec(command: string, args: string[], options?: Parameters<TestCommandExecutor["exec"]>[2]) {
    if (command === "bash" && args[0] === "-lc" && args[1]?.includes("command -v dtach")) {
      return {
        success: true,
        stdout: "dtach - version 0.9\n",
        stderr: "",
        exitCode: 0,
      };
    }
    if (command === "bash" && args[0] === "-lc" && args[1]?.includes(".dtach.sock")) {
      this.deleteCommands.push(args[1]);
      return {
        success: true,
        stdout: "",
        stderr: "",
        exitCode: 0,
      };
    }
    return await super.exec(command, args, options);
  }
}

class MissingDtachExecutor extends SshServerTestExecutor {
  override async exec(command: string, args: string[], options?: Parameters<TestCommandExecutor["exec"]>[2]) {
    if (command === "bash" && args[0] === "-lc" && args[1]?.includes("command -v dtach")) {
      return {
        success: false,
        stdout: "",
        stderr: "dtach missing",
        exitCode: 127,
      };
    }
    return await super.exec(command, args, options);
  }
}

let dataDir: string;
let executor: SshServerTestExecutor;

async function issueCredentialToken(serverId: string, password = "secret"): Promise<string> {
  const publicKey = await sshServerKeyManager.ensurePublicKey(serverId);
  const ciphertext = publicEncrypt({
    key: publicKey.publicKey,
    padding: constants.RSA_PKCS1_OAEP_PADDING,
    oaepHash: "sha256",
  }, Buffer.from(password, "utf8")).toString("base64");
  const exchange = await (await import("../../src/core/ssh-credential-manager")).sshCredentialManager.issueToken(serverId, {
    algorithm: publicKey.algorithm,
    fingerprint: publicKey.fingerprint,
    version: publicKey.version,
    ciphertext,
  });
  return exchange.credentialToken;
}

describe("SshServerManager", () => {
  beforeEach(async () => {
    dataDir = await mkdtemp(join(tmpdir(), "ralpher-ssh-server-manager-"));
    process.env["RALPHER_DATA_DIR"] = dataDir;
    await ensureDataDirectories();
    executor = new SshServerTestExecutor();
    sshServerManager.setExecutorFactoryForTesting(() => executor);
  });

  afterEach(async () => {
    sshServerManager.setExecutorFactoryForTesting(null);
    closeDatabase();
    delete process.env["RALPHER_DATA_DIR"];
    await rm(dataDir, { recursive: true, force: true });
  });

  test("creates, lists, updates, and deletes standalone SSH servers", async () => {
    const server = await sshServerManager.createServer({
      name: "Shared host",
      address: "ssh.example.com",
      username: "deploy",
    });

    expect(server.publicKey.publicKey).toContain("BEGIN PUBLIC KEY");
    expect((await sshServerManager.listServers())).toHaveLength(1);

    const updated = await sshServerManager.updateServer(server.config.id, {
      name: "Renamed host",
    });
    expect(updated.config.name).toBe("Renamed host");

    expect(await sshServerManager.deleteServer(server.config.id)).toBe(true);
    expect(await sshServerManager.getServer(server.config.id)).toBeNull();
  });

  test("creates standalone SSH sessions without requiring a credential token up front", async () => {
    const server = await sshServerManager.createServer({
      name: "Shared host",
      address: "ssh.example.com",
      username: "deploy",
    });

    const session = await sshServerManager.createSession(server.config.id, {
      name: "Deploy shell",
    });
    expect(session.config.name).toBe("Deploy shell");
    expect(session.config.connectionMode).toBe("dtach");

    const deleteToken = await issueCredentialToken(server.config.id);
    expect(await sshServerManager.deleteSession(session.config.id, {
      credentialToken: deleteToken,
    })).toBe(true);
    expect(executor.deleteCommands.some((command) => command.includes(session.config.remoteSessionName))).toBe(true);
  });

  test("still creates standalone sessions when dtach is unavailable at creation time", async () => {
    sshServerManager.setExecutorFactoryForTesting(() => new MissingDtachExecutor());
    const server = await sshServerManager.createServer({
      name: "Shared host",
      address: "ssh.example.com",
      username: "deploy",
    });

    const session = await sshServerManager.createSession(server.config.id, {});
    expect(session.config.connectionMode).toBe("dtach");
  });
});
