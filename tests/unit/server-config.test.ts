/**
 * Tests for server runtime configuration helpers.
 */

import { afterEach, describe, expect, test } from "bun:test";
import { getServerRuntimeConfig, getServerStartupMessages } from "../../src/core/server-config";

const originalHost = process.env["RALPHER_HOST"];
const originalPort = process.env["RALPHER_PORT"];
const originalUsername = process.env["RALPHER_USERNAME"];
const originalPassword = process.env["RALPHER_PASSWORD"];

function restoreEnv(name: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[name];
    return;
  }
  process.env[name] = value;
}

afterEach(() => {
  restoreEnv("RALPHER_HOST", originalHost);
  restoreEnv("RALPHER_PORT", originalPort);
  restoreEnv("RALPHER_USERNAME", originalUsername);
  restoreEnv("RALPHER_PASSWORD", originalPassword);
});

describe("getServerRuntimeConfig", () => {
  test("returns defaults when server auth and host env vars are unset", () => {
    delete process.env["RALPHER_HOST"];
    delete process.env["RALPHER_PORT"];
    delete process.env["RALPHER_USERNAME"];
    delete process.env["RALPHER_PASSWORD"];

    expect(getServerRuntimeConfig()).toEqual({
      host: "0.0.0.0",
      port: 3000,
      hostSource: "default",
      basicAuth: {
        enabled: false,
        username: "ralpher",
        password: "",
        usernameSource: "default",
      },
    });
  });

  test("uses trimmed env values for host, username, and password", () => {
    process.env["RALPHER_HOST"] = " 127.0.0.1 ";
    process.env["RALPHER_PORT"] = "8123";
    process.env["RALPHER_USERNAME"] = " admin ";
    process.env["RALPHER_PASSWORD"] = " secret ";

    expect(getServerRuntimeConfig()).toEqual({
      host: "127.0.0.1",
      port: 8123,
      hostSource: "RALPHER_HOST",
      basicAuth: {
        enabled: true,
        username: "admin",
        password: "secret",
        usernameSource: "RALPHER_USERNAME",
      },
    });
  });

  test("disables auth when password becomes empty after trimming", () => {
    process.env["RALPHER_PASSWORD"] = "   ";
    process.env["RALPHER_USERNAME"] = " custom ";

    expect(getServerRuntimeConfig().basicAuth).toEqual({
      enabled: false,
      username: "custom",
      password: "",
      usernameSource: "RALPHER_USERNAME",
    });
  });
});

describe("getServerStartupMessages", () => {
  test("describes default host binding and disabled auth", () => {
    delete process.env["RALPHER_HOST"];
    delete process.env["RALPHER_USERNAME"];
    delete process.env["RALPHER_PASSWORD"];

    const messages = getServerStartupMessages(getServerRuntimeConfig());

    expect(messages).toHaveLength(2);
    expect(messages[0]).toContain("RALPHER_HOST");
    expect(messages[0]).toContain("0.0.0.0");
    expect(messages[1]).toContain("RALPHER_PASSWORD");
    expect(messages[1]).toContain("RALPHER_USERNAME");
    expect(messages[1]).toContain("disabled");
  });

  test("describes enabled auth and overridden username", () => {
    process.env["RALPHER_HOST"] = "127.0.0.1";
    process.env["RALPHER_PASSWORD"] = "secret";
    process.env["RALPHER_USERNAME"] = "admin";

    const messages = getServerStartupMessages(getServerRuntimeConfig());

    expect(messages).toHaveLength(2);
    expect(messages[0]).toContain("127.0.0.1");
    expect(messages[0]).toContain("RALPHER_HOST");
    expect(messages[1]).toContain("enabled");
    expect(messages[1]).toContain("RALPHER_PASSWORD");
    expect(messages[1]).toContain("RALPHER_USERNAME");
    expect(messages[1]).toContain("\"admin\"");
  });
});

