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
      expect(scriptArg ?? "").toContain("&&");
      expect(result.stderr).toContain("mock spawn failure");
    } finally {
      (Bun as unknown as { spawn: typeof Bun.spawn }).spawn = originalSpawn;
    }
  });
});
