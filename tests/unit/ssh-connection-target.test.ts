import { describe, expect, test } from "bun:test";

import {
  buildSshAuthority,
  buildSshProcessConfig,
  getSshConnectionTargetFromSettings,
} from "../../src/core/ssh-connection-target";

describe("getSshConnectionTargetFromSettings", () => {
  test("derives an SSH connection target from ssh transport settings", () => {
    const target = getSshConnectionTargetFromSettings({
      agent: {
        provider: "copilot",
        transport: "ssh",
        hostname: "  remote.example.com  ",
        port: 2222,
        username: " alice ",
        password: " secret ",
        identityFile: " /tmp/id_rsa ",
      },
    });

    expect(target).toEqual({
      host: "remote.example.com",
      port: 2222,
      username: "alice",
      password: "secret",
      identityFile: "/tmp/id_rsa",
    });
  });

  test("returns null for stdio transport", () => {
    expect(getSshConnectionTargetFromSettings({
      agent: {
        provider: "copilot",
        transport: "stdio",
      },
    })).toBeNull();
  });
});

describe("buildSshAuthority", () => {
  test("includes the username when provided", () => {
    expect(buildSshAuthority({
      host: "remote.example.com",
      port: 22,
      username: "alice",
    })).toBe("alice@remote.example.com");
  });
});

describe("buildSshProcessConfig", () => {
  test("uses sshpass environment mode for interactive runtime helpers", () => {
    const config = buildSshProcessConfig({
      target: {
        host: "remote.example.com",
        port: 22,
        username: "alice",
        password: "secret",
      },
      extraArgs: ["-tt"],
      passwordHandling: "environment",
      baseEnv: {},
    });

    expect(config.command).toBe("sshpass");
    expect(config.args.slice(0, 3)).toEqual(["-e", "ssh", "-tt"]);
    expect(config.env["SSHPASS"]).toBe("secret");
  });

  test("uses sshpass argument mode for ACP runtime command construction", () => {
    const config = buildSshProcessConfig({
      target: {
        host: "remote.example.com",
        port: 22,
        username: "alice",
        password: "secret",
      },
      remoteCommand: "bash -lc 'copilot --yolo --acp'",
      passwordHandling: "argument",
      baseEnv: {},
    });

    expect(config.command).toBe("sshpass");
    expect(config.args[0]).toBe("-p");
    expect(config.args[1]).toBe("secret");
    expect(config.args[2]).toBe("ssh");
  });
});
