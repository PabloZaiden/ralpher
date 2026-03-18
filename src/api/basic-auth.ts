/**
 * Shared helpers for optional HTTP Basic authentication.
 */

import { Buffer } from "node:buffer";
import { createHash, timingSafeEqual } from "node:crypto";
import { serve, type Server } from "bun";
import type { BasicAuthConfig, BunDevelopmentConfig } from "../core/server-config";

type MaybePromise<T> = T | Promise<T>;

const BASIC_AUTH_REALM = "Ralpher";
const BASE64_PATTERN = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;

type RouteLikeHandler<TArgs extends unknown[] = never[]> = (
  ...args: TArgs
) => MaybePromise<Response | undefined>;

type RouteLikeMethods = Record<string, (...args: never[]) => MaybePromise<Response>>;
type RouteLikeValue = RouteLikeMethods | RouteLikeHandler;

function secureEquals(left: string, right: string): boolean {
  const leftDigest = createHash("sha256").update(left, "utf8").digest();
  const rightDigest = createHash("sha256").update(right, "utf8").digest();
  return timingSafeEqual(leftDigest, rightDigest);
}

function parseBasicAuthHeader(headerValue: string | null): { username: string; password: string } | null {
  if (!headerValue) {
    return null;
  }

  const separatorIndex = headerValue.indexOf(" ");
  if (separatorIndex === -1) {
    return null;
  }

  const scheme = headerValue.slice(0, separatorIndex);
  const encodedCredentials = headerValue.slice(separatorIndex + 1).trim();
  if (scheme.toLowerCase() !== "basic" || !encodedCredentials || !BASE64_PATTERN.test(encodedCredentials)) {
    return null;
  }

  const decodedCredentials = Buffer.from(encodedCredentials, "base64").toString("utf8");
  const credentialsSeparatorIndex = decodedCredentials.indexOf(":");
  if (credentialsSeparatorIndex === -1) {
    return null;
  }

  return {
    username: decodedCredentials.slice(0, credentialsSeparatorIndex),
    password: decodedCredentials.slice(credentialsSeparatorIndex + 1),
  };
}

export function createBasicAuthChallengeResponse(): Response {
  return new Response("Authentication required", {
    status: 401,
    headers: {
      "WWW-Authenticate": `Basic realm="${BASIC_AUTH_REALM}"`,
    },
  });
}

export function isRequestAuthorized(req: Request, config: BasicAuthConfig): boolean {
  if (!config.enabled) {
    return true;
  }

  const credentials = parseBasicAuthHeader(req.headers.get("authorization"));
  if (!credentials) {
    return false;
  }

  const usernameMatches = secureEquals(credentials.username, config.username);
  const passwordMatches = secureEquals(credentials.password, config.password);
  return usernameMatches && passwordMatches;
}

function authenticateRequest(req: Request, config: BasicAuthConfig): Response | undefined {
  if (isRequestAuthorized(req, config)) {
    return undefined;
  }
  return createBasicAuthChallengeResponse();
}

function getRequestFromArgs(args: unknown[]): Request {
  const req = args[0];
  if (!(req instanceof Request)) {
    throw new Error("Authenticated Bun route handlers must receive a Request as their first argument");
  }
  return req;
}

export function wrapRouteHandler<TArgs extends unknown[]>(
  handler: RouteLikeHandler<TArgs>,
  config: BasicAuthConfig,
): RouteLikeHandler<TArgs> {
  if (!config.enabled) {
    return handler;
  }

  return async (...args: TArgs): Promise<Response | undefined> => {
    const req = getRequestFromArgs(args);
    const challenge = authenticateRequest(req, config);
    if (challenge) {
      return challenge;
    }
    return await handler(...args);
  };
}

export function wrapRouteMethods<TRoute extends RouteLikeMethods>(
  route: TRoute,
  config: BasicAuthConfig,
): TRoute {
  if (!config.enabled) {
    return route;
  }

  const wrappedRoute = {} as TRoute;

  for (const [method, handler] of Object.entries(route) as [keyof TRoute, TRoute[keyof TRoute]][]) {
    wrappedRoute[method] = (async (
      ...args: Parameters<TRoute[keyof TRoute]>
    ): Promise<Response> => {
      const req = getRequestFromArgs(args);
      const challenge = authenticateRequest(req, config);
      if (challenge) {
        return challenge;
      }
      return await handler(...args);
    }) as TRoute[keyof TRoute];
  }

  return wrappedRoute;
}

export function wrapRoutesWithBasicAuth<TRoutes extends Record<string, RouteLikeValue>>(
  routes: TRoutes,
  config: BasicAuthConfig,
): TRoutes {
  if (!config.enabled) {
    return routes;
  }

  const wrappedRoutes = {} as TRoutes;

  for (const [path, route] of Object.entries(routes) as [keyof TRoutes, TRoutes[keyof TRoutes]][]) {
    wrappedRoutes[path] = typeof route === "function"
      ? wrapRouteHandler(route, config) as TRoutes[keyof TRoutes]
      : wrapRouteMethods(route, config) as TRoutes[keyof TRoutes];
  }

  return wrappedRoutes;
}

export function createStaticAssetServer(
  indexBundle: Bun.HTMLBundle,
  development: BunDevelopmentConfig = false,
): Server<undefined> {
  return serve({
    hostname: "127.0.0.1",
    port: 0,
    development,
    routes: {
      "/*": indexBundle,
    },
  });
}

export function createAuthenticatedStaticRoute(
  staticServer: Server<undefined>,
  config: BasicAuthConfig,
): RouteLikeHandler<[Request]> {
  if (!config.enabled) {
    return async () => new Response("Basic auth proxy should only be created when auth is enabled", {
      status: 500,
    });
  }

  return async (req: Request): Promise<Response> => {
    const challenge = authenticateRequest(req, config);
    if (challenge) {
      return challenge;
    }

    const url = new URL(req.url);
    const proxiedUrl = new URL(`${url.pathname}${url.search}`, staticServer.url);
    return await fetch(new Request(proxiedUrl, req));
  };
}
