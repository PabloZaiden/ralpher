/**
 * Tests for optional HTTP Basic auth wrappers.
 */

import { Buffer } from "node:buffer";
import { serve } from "bun";
import { afterAll, describe, expect, test } from "bun:test";
import {
  createAuthenticatedStaticRoute,
  isRequestAuthorized,
  wrapRouteHandler,
  wrapRouteMethods,
} from "../../src/api/basic-auth";
import {
  DEFAULT_SERVER_IDLE_TIMEOUT_SECONDS,
  type BasicAuthConfig,
} from "../../src/core/server-config";

const authConfig: BasicAuthConfig = {
  enabled: true,
  username: "ralpher",
  password: "secret",
  usernameSource: "default",
};

const startedServers: Array<ReturnType<typeof serve>> = [];

function getBasicAuthHeader(username: string, password: string): string {
  return `Basic ${Buffer.from(`${username}:${password}`).toString("base64")}`;
}

function startServer(routes: NonNullable<Parameters<typeof serve<undefined>>[0]["routes"]>): ReturnType<typeof serve> {
  const server = serve<undefined>({
    hostname: "127.0.0.1",
    port: 0,
    idleTimeout: DEFAULT_SERVER_IDLE_TIMEOUT_SECONDS,
    routes,
  });
  startedServers.push(server);
  return server;
}

afterAll(() => {
  for (const server of startedServers) {
    server.stop(true);
  }
});

describe("isRequestAuthorized", () => {
  test("returns false for missing or malformed headers", () => {
    expect(isRequestAuthorized(new Request("http://example.test"), authConfig)).toBe(false);
    expect(isRequestAuthorized(new Request("http://example.test", {
      headers: { authorization: "Basic !!!" },
    }), authConfig)).toBe(false);
    expect(isRequestAuthorized(new Request("http://example.test", {
      headers: { authorization: "Bearer token" },
    }), authConfig)).toBe(false);
  });

  test("accepts the configured username and password", () => {
    const request = new Request("http://example.test", {
      headers: { authorization: getBasicAuthHeader("ralpher", "secret") },
    });

    expect(isRequestAuthorized(request, authConfig)).toBe(true);
  });

  test("rejects incorrect credentials even when lengths differ", () => {
    const request = new Request("http://example.test", {
      headers: { authorization: getBasicAuthHeader("no", "much-longer-secret") },
    });

    expect(isRequestAuthorized(request, authConfig)).toBe(false);
  });
});

describe("wrapRouteMethods", () => {
  test("returns a challenge for unauthenticated requests", async () => {
    const wrappedRoute = wrapRouteMethods({
      GET: async (_req: Request) => Response.json({ ok: true }),
    }, authConfig);

    const response = await wrappedRoute.GET!(new Request("http://example.test/api/health"));

    expect(response.status).toBe(401);
    expect(response.headers.get("www-authenticate")).toContain("Basic");
  });

  test("allows authenticated requests through method handlers", async () => {
    const wrappedRoute = wrapRouteMethods({
      GET: async (_req: Request) => Response.json({ ok: true }),
    }, authConfig);

    const response = await wrappedRoute.GET!(new Request("http://example.test/api/health", {
      headers: { authorization: getBasicAuthHeader("ralpher", "secret") },
    }));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
  });
});

describe("wrapRouteHandler", () => {
  test("blocks websocket-style handlers before upgrade when auth fails", async () => {
    let upgradeCalled = false;
    const wrappedHandler = wrapRouteHandler(
      (_req: Request, server: { upgrade: () => boolean }) => {
        upgradeCalled = true;
        server.upgrade();
        return undefined;
      },
      authConfig,
    );

    const response = await wrappedHandler(
      new Request("http://example.test/api/ws"),
      { upgrade: () => true },
    );

    expect(response?.status).toBe(401);
    expect(upgradeCalled).toBe(false);
  });

  test("passes authenticated websocket-style handlers through", async () => {
    let upgradeCalled = false;
    const wrappedHandler = wrapRouteHandler(
      (_req: Request, server: { upgrade: () => boolean }) => {
        upgradeCalled = true;
        const upgraded = server.upgrade();
        return upgraded ? undefined : new Response("upgrade failed", { status: 400 });
      },
      authConfig,
    );

    const response = await wrappedHandler(
      new Request("http://example.test/api/ws", {
        headers: { authorization: getBasicAuthHeader("ralpher", "secret") },
      }),
      { upgrade: () => true },
    );

    expect(response).toBeUndefined();
    expect(upgradeCalled).toBe(true);
  });
});

describe("createAuthenticatedStaticRoute", () => {
  test("protects the SPA fallback and bundled assets", async () => {
    const staticAssetServer = startServer({
      "/*": async () => new Response("<!doctype html><div id=\"root\"></div>", {
        headers: {
          "content-type": "text/html; charset=utf-8",
        },
      }),
    });
    const server = startServer({
      "/*": createAuthenticatedStaticRoute(staticAssetServer, authConfig),
    });

    const unauthenticatedPage = await fetch(server.url.toString());
    expect(unauthenticatedPage.status).toBe(401);

    const authenticatedPage = await fetch(server.url.toString(), {
      headers: { authorization: getBasicAuthHeader("ralpher", "secret") },
    });
    expect(authenticatedPage.status).toBe(200);
    expect(authenticatedPage.headers.get("content-type")).toContain("text/html");
    expect(await authenticatedPage.text()).toContain("<div id=\"root\"></div>");

    const unauthenticatedFallback = await fetch(new URL("/app/dashboard", server.url).toString());
    expect(unauthenticatedFallback.status).toBe(401);

    const authenticatedFallback = await fetch(new URL("/app/dashboard", server.url).toString(), {
      headers: { authorization: getBasicAuthHeader("ralpher", "secret") },
    });
    expect(authenticatedFallback.status).toBe(200);
    expect(authenticatedFallback.headers.get("content-type")).toContain("text/html");
  });
});
