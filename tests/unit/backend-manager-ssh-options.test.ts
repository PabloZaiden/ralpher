import { describe, expect, test } from "bun:test";

import { buildConnectionConfig } from "../../src/core/backend-manager";

describe("buildConnectionConfig SSH command options", () => {
  test("uses sshpass with non-interactive ssh options when password is set", () => {
    const config = buildConnectionConfig(
      {
        agent: {
          provider: "copilot",
          transport: "ssh",
          hostname: "remote.example.com",
          port: 2222,
          username: "alice",
          password: "secret",
        },
      },
      "/workspaces/project",
    );
    const args = config.args ?? [];

    expect(config.command).toBe("sshpass");
    expect(args).toContain("ssh");
    expect(args).toContain("NumberOfPasswordPrompts=1");
    expect(args).toContain("ConnectTimeout=10");
    expect(args).toContain("StrictHostKeyChecking=no");
    expect(args).toContain("UserKnownHostsFile=/dev/null");
    expect(args).toContain("alice@remote.example.com");
    expect(args[args.length - 1]).toContain("bash -lc");
    expect(args[args.length - 1]).toContain("copilot");
    expect(args[args.length - 1]).toContain("--acp");
  });

  test("uses batch mode with non-interactive ssh options when password is not set", () => {
    const config = buildConnectionConfig(
      {
        agent: {
          provider: "copilot",
          transport: "ssh",
          hostname: "remote.example.com",
          port: 22,
          username: "alice",
        },
      },
      "/workspaces/project",
    );
    const args = config.args ?? [];

    expect(config.command).toBe("ssh");
    expect(args).toContain("BatchMode=yes");
    expect(args).toContain("ConnectTimeout=10");
    expect(args).toContain("StrictHostKeyChecking=no");
    expect(args).toContain("UserKnownHostsFile=/dev/null");
    expect(args[args.length - 1]).toContain("bash -lc");
    expect(args[args.length - 1]).toContain("copilot");
    expect(args[args.length - 1]).toContain("--acp");
    expect(args[args.length - 1]).toContain("source ~/.profile");
  });
});
