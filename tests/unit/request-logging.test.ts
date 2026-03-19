import { describe, expect, spyOn, test } from "bun:test";
import { createLogger } from "../../src/core/logger";
import {
  wrapRouteHandlerWithLogging,
  wrapRouteMethodsWithLogging,
} from "../../src/api/request-logging";

const requestLog = createLogger("api:request");

describe("request logging wrappers", () => {
  test("logs request start and successful completion at info", async () => {
    const infoSpy = spyOn(requestLog, "info").mockImplementation(() => undefined);
    const errorSpy = spyOn(requestLog, "error").mockImplementation(() => undefined);

    try {
      const wrappedRoute = wrapRouteMethodsWithLogging({
        GET: async (_req: Request) => Response.json({ ok: true }),
      }, "/api/test");

      const response = await wrappedRoute.GET!(new Request("http://example.test/api/test"));

      expect(response.status).toBe(200);
      expect(infoSpy).toHaveBeenCalledTimes(2);
      expect(errorSpy).not.toHaveBeenCalled();
      expect(infoSpy.mock.calls[0]?.[0]).toBe("Request started");
      expect(infoSpy.mock.calls[0]?.[1]).toEqual({
        method: "GET",
        path: "/api/test",
        routePath: "/api/test",
      });
      expect(infoSpy.mock.calls[1]?.[0]).toBe("Request completed");
      expect(infoSpy.mock.calls[1]?.[1]).toEqual(expect.objectContaining({
        method: "GET",
        path: "/api/test",
        routePath: "/api/test",
        status: 200,
      }));
    } finally {
      infoSpy.mockRestore();
      errorSpy.mockRestore();
    }
  });

  test("logs non-2xx responses at error", async () => {
    const infoSpy = spyOn(requestLog, "info").mockImplementation(() => undefined);
    const errorSpy = spyOn(requestLog, "error").mockImplementation(() => undefined);

    try {
      const wrappedRoute = wrapRouteMethodsWithLogging({
        GET: async (_req: Request) => new Response("missing", { status: 404 }),
      }, "/api/test");

      const response = await wrappedRoute.GET!(new Request("http://example.test/api/test"));

      expect(response.status).toBe(404);
      expect(infoSpy).toHaveBeenCalledTimes(1);
      expect(errorSpy).toHaveBeenCalledTimes(1);
      expect(errorSpy.mock.calls[0]?.[0]).toBe("Request completed with non-2xx status");
      expect(errorSpy.mock.calls[0]?.[1]).toEqual(expect.objectContaining({
        method: "GET",
        path: "/api/test",
        routePath: "/api/test",
        status: 404,
      }));
    } finally {
      infoSpy.mockRestore();
      errorSpy.mockRestore();
    }
  });

  test("logs successful websocket-style upgrades as completed info events", async () => {
    const infoSpy = spyOn(requestLog, "info").mockImplementation(() => undefined);
    const errorSpy = spyOn(requestLog, "error").mockImplementation(() => undefined);

    try {
      let upgradeCalled = false;
      const wrappedHandler = wrapRouteHandlerWithLogging(
        (_req: Request, server: { upgrade: () => boolean }) => {
          upgradeCalled = true;
          const upgraded = server.upgrade();
          return upgraded ? undefined : new Response("upgrade failed", { status: 400 });
        },
        "/api/ws",
      );

      const response = await wrappedHandler(
        new Request("http://example.test/api/ws"),
        { upgrade: () => true },
      );

      expect(response).toBeUndefined();
      expect(upgradeCalled).toBe(true);
      expect(infoSpy).toHaveBeenCalledTimes(2);
      expect(errorSpy).not.toHaveBeenCalled();
      expect(infoSpy.mock.calls[1]?.[0]).toBe("Request completed");
      expect(infoSpy.mock.calls[1]?.[1]).toEqual(expect.objectContaining({
        method: "GET",
        path: "/api/ws",
        routePath: "/api/ws",
        upgraded: true,
      }));
    } finally {
      infoSpy.mockRestore();
      errorSpy.mockRestore();
    }
  });
});
