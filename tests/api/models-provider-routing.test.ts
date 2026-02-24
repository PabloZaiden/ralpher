/**
 * API tests for provider-aware model discovery routing.
 */

import { test, expect, describe, beforeEach, afterEach } from "bun:test";
import { mkdtemp, rm } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import type { CommandOptions, CommandResult } from "../../src/core/command-executor";
import { TestCommandExecutor } from "../mocks/mock-executor";

let testDataDir: string;

class CopilotHelpExecutor extends TestCommandExecutor {
  constructor(private readonly helpOutput: string) {
    super();
  }

  override async exec(command: string, args: string[], options?: CommandOptions): Promise<CommandResult> {
    if (command === "copilot" && args.length === 1 && args[0] === "--help") {
      return {
        success: true,
        stdout: this.helpOutput,
        stderr: "",
        exitCode: 0,
      };
    }
    return await super.exec(command, args, options);
  }
}

describe("GET /api/models provider routing", () => {
  beforeEach(async () => {
    testDataDir = await mkdtemp(join(tmpdir(), "ralpher-model-routing-test-"));
    process.env["RALPHER_DATA_DIR"] = testDataDir;

    const { ensureDataDirectories } = await import("../../src/persistence/database");
    await ensureDataDirectories();

    const { backendManager } = await import("../../src/core/backend-manager");
    const { MockOpenCodeBackend } = await import("../mocks/mock-backend");

    // Register a backend with a distinct model to ensure Copilot routing does not use it.
    backendManager.setBackendForTesting(
      new MockOpenCodeBackend({
        models: [
          {
            providerID: "opencode-provider",
            providerName: "OpenCode Provider",
            modelID: "opencode-test-model",
            modelName: "OpenCode Test Model",
            connected: true,
          },
        ],
      }),
    );
    backendManager.setExecutorFactoryForTesting(() => new TestCommandExecutor());
  });

  afterEach(async () => {
    const { backendManager } = await import("../../src/core/backend-manager");
    const { closeDatabase } = await import("../../src/persistence/database");

    backendManager.resetForTesting();
    closeDatabase();

    delete process.env["RALPHER_DATA_DIR"];
    await rm(testDataDir, { recursive: true, force: true });
  });

  test("uses Copilot CLI model list for copilot workspaces", async () => {
    const workDir = await mkdtemp(join(tmpdir(), "ralpher-model-routing-workdir-"));
    const copilotHelpText = `Usage: copilot [options] [command]
  --model <model>                     Set the AI model to use (choices:
                                      "gpt-5.3-codex", "claude-sonnet-4.6",
                                      "gpt-4.1")
  --no-alt-screen                     Disable the terminal alternate screen`;
    try {
      const { backendManager } = await import("../../src/core/backend-manager");
      backendManager.setExecutorFactoryForTesting(() => new CopilotHelpExecutor(copilotHelpText));

      const { createWorkspace } = await import("../../src/persistence/workspaces");
      await createWorkspace({
        id: "copilot-model-workspace",
        name: "Copilot Workspace",
        directory: workDir,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        serverSettings: {
          agent: {
            provider: "copilot",
            transport: "stdio",
          },
        },
      });

      const { modelsRoutes } = await import("../../src/api/models");
      const response = await modelsRoutes["/api/models"].GET(
        new Request(
          `http://localhost/api/models?directory=${encodeURIComponent(workDir)}&workspaceId=copilot-model-workspace`,
        ),
      );

      expect(response.status).toBe(200);
      const models = await response.json() as Array<{ providerID: string; modelID: string }>;
      const modelIds = models.map((model) => model.modelID).sort();

      expect(modelIds).toEqual(["claude-sonnet-4.6", "gpt-4.1", "gpt-5.3-codex"]);
      expect(models.every((model) => model.providerID === "copilot")).toBe(true);
      expect(models.find((model) => model.modelID === "opencode-test-model")).toBeUndefined();
    } finally {
      await rm(workDir, { recursive: true, force: true });
    }
  });
});
