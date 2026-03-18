/**
 * Main server entry point for Ralph Loops Management System.
 * Uses Bun's native serve() with route-based API and WebSocket support.
 */

import { serve, type Server } from "bun";
import index from "./index.html";
import { apiRoutes } from "./api";
import {
  createAuthenticatedStaticRoute,
  wrapRoutesWithBasicAuth,
  wrapRouteHandler,
} from "./api/basic-auth";
import { portForwardProxyRoutes } from "./api/port-forwards";
import { ensureDataDirectories } from "./persistence/database";
import { backendManager } from "./core/backend-manager";
import { websocketHandlers, type WebSocketData } from "./api/websocket";
import { getServerRuntimeConfig, getServerStartupMessages } from "./core/server-config";
import { log, setLogLevel, isLogLevelFromEnv } from "./core/logger";
import { getLogLevelPreference } from "./persistence/preferences";

try {
  // Ensure data directories exist on startup
  await ensureDataDirectories();

  // Initialize log level from saved preference (unless environment variable is set)
  if (!isLogLevelFromEnv()) {
    const savedLogLevel = await getLogLevelPreference();
    setLogLevel(savedLogLevel);
    log.debug(`Log level set from saved preference: ${savedLogLevel}`);
  } else {
    log.debug(`Log level set from RALPHER_LOG_LEVEL environment variable`);
  }

  // Initialize the global backend manager (loads settings from preferences)
  await backendManager.initialize();

  const runtimeConfig = getServerRuntimeConfig();
  const development = !runtimeConfig.basicAuth.enabled && process.env["NODE_ENV"] !== "production" && {
    // Enable browser hot reloading in development
    hmr: true,

    // Echo console logs from the browser to the server
    console: true,
  };
  const staticRoute = runtimeConfig.basicAuth.enabled
    ? createAuthenticatedStaticRoute(index, runtimeConfig.basicAuth)
    : index;
  const protectedApiRoutes = wrapRoutesWithBasicAuth(apiRoutes, runtimeConfig.basicAuth);
  const protectedPortForwardRoutes = wrapRoutesWithBasicAuth(
    portForwardProxyRoutes,
    runtimeConfig.basicAuth,
  );
  const websocketRoute = wrapRouteHandler(
    (req: Request, server: Server<WebSocketData>) => {
      const url = new URL(req.url);
      const loopId = url.searchParams.get("loopId") ?? undefined;
      const sshSessionId = url.searchParams.get("sshSessionId") ?? undefined;
      const sshServerSessionId = url.searchParams.get("sshServerSessionId") ?? undefined;
      const provisioningJobId = url.searchParams.get("provisioningJobId") ?? undefined;

      const upgraded = server.upgrade(req, {
        data: {
          loopId,
          sshSessionId,
          sshServerSessionId,
          provisioningJobId,
          terminalMode: false,
        } as WebSocketData,
      });

      if (upgraded) {
        // Return undefined to indicate successful upgrade (Bun handles the response)
        return undefined;
      }

      // Upgrade failed
      return new Response("WebSocket upgrade failed", { status: 400 });
    },
    runtimeConfig.basicAuth,
  );
  const sshTerminalRoute = wrapRouteHandler(
    (req: Request, server: Server<WebSocketData>) => {
      const url = new URL(req.url);
      const sshSessionId = url.searchParams.get("sshSessionId") ?? undefined;
      const sshServerSessionId = url.searchParams.get("sshServerSessionId") ?? undefined;

      if (!sshSessionId && !sshServerSessionId) {
        return new Response("sshSessionId or sshServerSessionId is required", { status: 400 });
      }

      const upgraded = server.upgrade(req, {
        data: { sshSessionId, sshServerSessionId, terminalMode: true } as WebSocketData,
      });

      if (upgraded) {
        // Return undefined to indicate successful upgrade (Bun handles the response)
        return undefined;
      }

      // Upgrade failed
      return new Response("WebSocket upgrade failed", { status: 400 });
    },
    runtimeConfig.basicAuth,
  );

  const server = serve<WebSocketData>({
    hostname: runtimeConfig.host,
    port: runtimeConfig.port,
    // Increase idle timeout from default 10s to 120s for long-running operations
    // like git push/pull/fetch that happen over the network
    idleTimeout: 120,
    routes: {
      // API routes
      ...protectedApiRoutes,
      ...protectedPortForwardRoutes,

      // WebSocket endpoint for real-time events
      "/api/ws": websocketRoute,

      "/api/ssh-terminal": sshTerminalRoute,

      // Serve index.html for all unmatched routes (SPA fallback)
      "/*": staticRoute,
    },

    // WebSocket handlers
    websocket: websocketHandlers,

    development,
  });

  for (const message of getServerStartupMessages(runtimeConfig)) {
    log.info(message);
  }
  log.info(`Ralpher server running at ${server.url}`);
} catch (error) {
  // Use console.error as a last resort since the logger may not be initialized
  console.error(`Fatal error during startup: ${String(error)}`);
  process.exit(1);
}
