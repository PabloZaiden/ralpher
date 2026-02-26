import { describe, expect, test } from "bun:test";

import { CommandExecutorImpl } from "../../src/core/remote-command-executor";

describe("CommandExecutorImpl SSH spawn cwd", () => {
  test("uses root cwd for SSH command execution", async () => {
    const originalSpawn = Bun.spawn;
    let capturedCwd: string | undefined;
    let capturedCommand: string[] | undefined;

    (Bun as unknown as { spawn: typeof Bun.spawn }).spawn = ((...args: unknown[]) => {
      const command = (args.length === 1
        ? (args[0] as { cmd?: string[] } | undefined)?.cmd
        : args[0]) as string[] | undefined;
      const options = (args.length === 1 ? args[0] : args[1]) as { cwd?: string } | undefined;
      capturedCommand = command;
      capturedCwd = options?.cwd;
      throw new Error("mock spawn failure");
    }) as unknown as typeof Bun.spawn;

    try {
      const executor = new CommandExecutorImpl({
        provider: "ssh",
        directory: "/workspaces/remote-only-path",
        host: "127.0.0.1",
      });

      const result = await executor.exec("pwd", []);
      expect(result.success).toBe(false);
      expect(capturedCwd).toBe("/");
      expect(capturedCommand).toBeDefined();
      const commandTokens = capturedCommand ?? [];
      const scriptArg = commandTokens[commandTokens.indexOf("--") + 1];
      expect(typeof scriptArg).toBe("string");
      expect(scriptArg ?? "").toContain("bash -lc");
      expect(scriptArg ?? "").toContain("source ~/.profile");
      expect(scriptArg ?? "").toContain("&&");
      expect(result.stderr).toContain("mock spawn failure");
    } finally {
      (Bun as unknown as { spawn: typeof Bun.spawn }).spawn = originalSpawn;
    }
  });

  test("wraps git commands in bash and sources shell env", async () => {
    const originalSpawn = Bun.spawn;
    let capturedCommand: string[] | undefined;

    (Bun as unknown as { spawn: typeof Bun.spawn }).spawn = ((...args: unknown[]) => {
      const command = (args.length === 1
        ? (args[0] as { cmd?: string[] } | undefined)?.cmd
        : args[0]) as string[] | undefined;
      capturedCommand = command;
      throw new Error("mock spawn failure");
    }) as unknown as typeof Bun.spawn;

    try {
      const executor = new CommandExecutorImpl({
        provider: "ssh",
        directory: "/workspaces/remote-only-path",
        host: "127.0.0.1",
      });

      const result = await executor.exec("git", ["status", "--porcelain"], {
        cwd: "/workspaces/myrepo",
      });
      expect(result.success).toBe(false);

      const commandTokens = capturedCommand ?? [];
      const scriptArg = commandTokens[commandTokens.indexOf("--") + 1] ?? "";
      expect(scriptArg).toContain("bash -lc");
      expect(scriptArg).toContain("source ~/.profile");
      expect(scriptArg).toContain("git");
      expect(scriptArg).toContain("status");
      expect(scriptArg).toContain("--porcelain");
    } finally {
      (Bun as unknown as { spawn: typeof Bun.spawn }).spawn = originalSpawn;
    }
  });

  test("uses sshpass environment mode for password auth", async () => {
    const originalSpawn = Bun.spawn;
    let capturedCommand: string[] | undefined;
    let capturedEnv: Record<string, string | undefined> | undefined;

    (Bun as unknown as { spawn: typeof Bun.spawn }).spawn = ((...args: unknown[]) => {
      const command = (args.length === 1
        ? (args[0] as { cmd?: string[] } | undefined)?.cmd
        : args[0]) as string[] | undefined;
      const options = (args.length === 1 ? args[0] : args[1]) as { env?: Record<string, string | undefined> } | undefined;
      capturedCommand = command;
      capturedEnv = options?.env;
      throw new Error("mock spawn failure");
    }) as unknown as typeof Bun.spawn;

    try {
      const executor = new CommandExecutorImpl({
        provider: "ssh",
        directory: "/workspaces/remote-only-path",
        host: "127.0.0.1",
        password: "top-secret",
      });

      const result = await executor.exec("pwd", []);
      expect(result.success).toBe(false);

      const commandTokens = capturedCommand ?? [];
      expect(commandTokens[0]).toBe("sshpass");
      expect(commandTokens).toContain("-e");
      expect(commandTokens).not.toContain("top-secret");
      expect(capturedEnv?.["SSHPASS"]).toBe("top-secret");
    } finally {
      (Bun as unknown as { spawn: typeof Bun.spawn }).spawn = originalSpawn;
    }
  });
});
