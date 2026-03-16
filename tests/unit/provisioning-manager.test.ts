import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { backendManager } from "../../src/core/backend-manager";
import {
  extractRepoName,
  parseDevboxCredentialContent,
  parseDevboxStatusOutput,
  ProvisioningManager,
  provisioningManager,
} from "../../src/core/provisioning-manager";
import { sshServerManager } from "../../src/core/ssh-server-manager";
import { getWorkspace } from "../../src/persistence/workspaces";
import { ensureDataDirectories, getDatabase } from "../../src/persistence/database";
import { createMockBackend } from "../mocks/mock-backend";
import {
  createDevboxStatusOutput,
  ProvisioningTestExecutor,
} from "../mocks/provisioning-test-executor";

async function waitForProvisioningStatus(
  manager: ProvisioningManager,
  jobId: string,
  expectedStatuses: Array<"completed" | "failed" | "cancelled">,
): Promise<NonNullable<Awaited<ReturnType<ProvisioningManager["getJobSnapshot"]>>>> {
  const deadline = Date.now() + 5000;
  let lastSnapshot: Awaited<ReturnType<ProvisioningManager["getJobSnapshot"]>> = null;

  while (Date.now() < deadline) {
    lastSnapshot = await manager.getJobSnapshot(jobId);
    if (lastSnapshot && expectedStatuses.includes(lastSnapshot.job.state.status as never)) {
      return lastSnapshot;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }

  throw new Error(`Timed out waiting for provisioning status. Last snapshot: ${JSON.stringify(lastSnapshot)}`);
}

describe("ProvisioningManager", () => {
  let testDataDir: string;

  beforeEach(async () => {
    testDataDir = await mkdtemp(join(tmpdir(), "ralpher-provisioning-unit-"));
    process.env["RALPHER_DATA_DIR"] = testDataDir;
    await ensureDataDirectories();
    const db = getDatabase();
    db.run("DELETE FROM workspaces");
    db.run("DELETE FROM ssh_server_sessions");
    db.run("DELETE FROM ssh_servers");
    backendManager.setBackendForTesting(createMockBackend());
    provisioningManager.resetForTesting();
  });

  afterEach(async () => {
    sshServerManager.setExecutorFactoryForTesting(null);
    backendManager.resetForTesting();
    provisioningManager.resetForTesting();
    await rm(testDataDir, { recursive: true, force: true });
    delete process.env["RALPHER_DATA_DIR"];
  });

  test("extractRepoName handles https and SSH repository URLs", () => {
    expect(extractRepoName("https://github.com/octocat/example.git")).toBe("example");
    expect(extractRepoName("https://github.com/octocat/example")).toBe("example");
    expect(extractRepoName("git@github.com:octocat/example.git")).toBe("example");
  });

  test("parseDevboxStatusOutput validates JSON devbox output", () => {
    const parsed = parseDevboxStatusOutput(createDevboxStatusOutput({
      sshUser: null,
      password: null,
    }));
    expect(parsed.running).toBe(true);
    expect(parsed.port).toBe(5005);
    expect(parsed.sshUser).toBeNull();
    expect(parsed.password).toBeNull();
  });

  test("parseDevboxCredentialContent supports JSON and key-value formats", () => {
    expect(parseDevboxCredentialContent(JSON.stringify({
      username: "vscode",
      password: "secret",
    }))).toEqual({
      username: "vscode",
      password: "secret",
    });
    expect(parseDevboxCredentialContent("user=vscode\npassword=secret\n")).toEqual({
      username: "vscode",
      password: "secret",
    });
  });

  test("provisions a workspace and falls back to .sshcred when devbox status omits password", async () => {
    const server = await sshServerManager.createServer({
      name: "Builder",
      address: "10.0.0.5",
      username: "remote-user",
    });
    const executor = new ProvisioningTestExecutor({
      devboxStatusOutput: createDevboxStatusOutput({
        sshUser: null,
        password: null,
        hasCredentialFile: true,
        credentialPath: "/tmp/devbox/.sshcred",
      }),
      credentialFileContent: "username=devbox-user\npassword=devbox-secret\n",
    });
    sshServerManager.setExecutorFactoryForTesting(() => executor);

    const manager = new ProvisioningManager(5_000, 500);
    const started = await manager.startJob({
      name: "Automatic Workspace",
      sshServerId: server.config.id,
      repoUrl: "git@github.com:octocat/example.git",
      basePath: "/workspaces",
      provider: "copilot",
    });

    const snapshot = await waitForProvisioningStatus(manager, started.job.config.id, ["completed"]);
    expect(snapshot.job.state.status).toBe("completed");
    expect(snapshot.job.state.currentStep).toBe("workspace_ready");
    expect(snapshot.job.state.workspaceId).toBeTruthy();

    const workspace = await getWorkspace(snapshot.job.state.workspaceId!);
    expect(workspace?.directory).toBe("/workspaces/devbox");
    expect(workspace?.serverSettings.agent.transport).toBe("ssh");
    if (workspace?.serverSettings.agent.transport !== "ssh") {
      throw new Error("Expected SSH transport");
    }
    expect(workspace.serverSettings.agent.hostname).toBe("10.0.0.5");
    expect(workspace.serverSettings.agent.port).toBe(5005);
    expect(workspace.serverSettings.agent.username).toBe("devbox-user");
    expect(workspace.serverSettings.agent.password).toBe("devbox-secret");
    expect(snapshot.logs.at(-1)?.text).toBe(
      "Workspace connection test succeeded. Workspace Automatic Workspace was created successfully and is ready.",
    );
    expect(snapshot.logs.at(-1)?.step).toBe("workspace_ready");
    expect(executor.calls[0]).toEqual({
      command: "bash",
      args: ["-lc", "command -v devbox >/dev/null 2>&1"],
      cwd: "/",
    });
  });
});
