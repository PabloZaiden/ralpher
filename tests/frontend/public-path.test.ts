import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  appAbsoluteUrl,
  appFetch,
  appPath,
  appWebSocketUrl,
  setConfiguredPublicBasePath,
} from "../../src/lib/public-path";

describe("public path helpers", () => {
  beforeEach(() => {
    setConfiguredPublicBasePath(undefined);
    window.location.href = "https://example.com/";
  });

  afterEach(() => {
    setConfiguredPublicBasePath(undefined);
  });

  test("derives app-local URLs from the current pathname", () => {
    window.location.href = "https://example.com/ralpher/";

    expect(appPath("/api/loops")).toBe("/ralpher/api/loops");
    expect(appAbsoluteUrl("/loop/test-loop/port/test-forward/")).toBe(
      "https://example.com/ralpher/loop/test-loop/port/test-forward/",
    );
    expect(appWebSocketUrl("/api/ws?loopId=test-loop")).toBe(
      "wss://example.com/ralpher/api/ws?loopId=test-loop",
    );
  });

  test("appFetch prefixes local API requests", async () => {
    window.location.href = "https://example.com/ralpher/";

    const originalFetch = globalThis.fetch;
    const requestedUrls: string[] = [];
    globalThis.fetch = ((input: string | URL | Request) => {
      const url = typeof input === "string"
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url;
      requestedUrls.push(url);
      return Promise.resolve(
        new Response(JSON.stringify({ success: true }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      );
    }) as typeof fetch;

    try {
      await appFetch("/api/config");
    } finally {
      globalThis.fetch = originalFetch;
    }

    expect(requestedUrls).toEqual(["/ralpher/api/config"]);
  });

  test("prefers the configured server-provided base path when available", () => {
    window.location.href = "https://example.com/";
    setConfiguredPublicBasePath("/proxy/");

    expect(appPath("/api/loops")).toBe("/proxy/api/loops");
  });
});
