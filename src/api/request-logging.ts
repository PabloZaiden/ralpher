import { createLogger } from "../core/logger";

type MaybePromise<T> = T | Promise<T>;

type RouteLikeHandler<TArgs extends unknown[] = never[]> = (
  ...args: TArgs
) => MaybePromise<Response | undefined>;

type RouteLikeMethods = Record<string, (...args: never[]) => MaybePromise<Response>>;
type RouteLikeValue = RouteLikeMethods | RouteLikeHandler;

const log = createLogger("api:request");

function getRequestFromArgs(args: unknown[]): Request {
  const req = args[0];
  if (!(req instanceof Request)) {
    throw new Error("Logged Bun route handlers must receive a Request as their first argument");
  }
  return req;
}

function createRequestContext(
  req: Request,
  routePath?: string,
  methodOverride?: string,
): { method: string; path: string; routePath: string } {
  const url = new URL(req.url);
  return {
    method: methodOverride ?? req.method,
    path: url.pathname,
    routePath: routePath ?? url.pathname,
  };
}

function getDurationMs(startedAt: number): number {
  return Number((performance.now() - startedAt).toFixed(2));
}

export function wrapRouteHandlerWithLogging<TArgs extends unknown[]>(
  handler: RouteLikeHandler<TArgs>,
  routePath?: string,
  methodOverride?: string,
): RouteLikeHandler<TArgs> {
  return async (...args: TArgs): Promise<Response | undefined> => {
    const req = getRequestFromArgs(args);
    const startedAt = performance.now();
    const requestContext = createRequestContext(req, routePath, methodOverride);

    log.info("Request started", requestContext);

    try {
      const response = await handler(...args);
      const durationMs = getDurationMs(startedAt);

      if (response === undefined) {
        log.info("Request completed", {
          ...requestContext,
          upgraded: true,
          durationMs,
        });
        return response;
      }

      const responseContext = {
        ...requestContext,
        status: response.status,
        durationMs,
      };

      if (response.ok) {
        log.info("Request completed", responseContext);
      } else {
        log.error("Request completed with non-2xx status", responseContext);
      }

      return response;
    } catch (error) {
      log.error("Request failed with uncaught error", {
        ...requestContext,
        durationMs: getDurationMs(startedAt),
        error: String(error),
      });
      throw error;
    }
  };
}

export function wrapRouteMethodsWithLogging<TRoute extends RouteLikeMethods>(
  route: TRoute,
  routePath: string,
): TRoute {
  const wrappedRoute = {} as TRoute;

  for (const [method, handler] of Object.entries(route) as [keyof TRoute, TRoute[keyof TRoute]][]) {
    wrappedRoute[method] = wrapRouteHandlerWithLogging(
      handler as RouteLikeHandler<Parameters<TRoute[keyof TRoute]>>,
      routePath,
      String(method),
    ) as TRoute[keyof TRoute];
  }

  return wrappedRoute;
}

export function wrapRoutesWithLogging<TRoutes extends Record<string, RouteLikeValue>>(
  routes: TRoutes,
): TRoutes {
  const wrappedRoutes = {} as TRoutes;

  for (const [path, route] of Object.entries(routes) as [keyof TRoutes, TRoutes[keyof TRoutes]][]) {
    wrappedRoutes[path] = typeof route === "function"
      ? wrapRouteHandlerWithLogging(route as RouteLikeHandler, String(path)) as TRoutes[keyof TRoutes]
      : wrapRouteMethodsWithLogging(route as RouteLikeMethods, String(path)) as TRoutes[keyof TRoutes];
  }

  return wrappedRoutes;
}
