/**
 * Main server entry point for Ralph Loops Management System.
 * Uses Bun's native serve() with route-based API and WebSocket support.
 */

import { serve, type Server } from "bun";
import index from "./index.html";
import { apiRoutes } from "./api";
import { ensureDataDirectories } from "./persistence/paths";
import { backendManager } from "./core/backend-manager";
import { websocketHandlers, type WebSocketData } from "./api/websocket";
import { log, setLogLevel, isLogLevelFromEnv, type LogLevelName } from "./core/logger";
import { getLogLevelPreference } from "./persistence/preferences";

// Ensure data directories exist on startup
await ensureDataDirectories();

// Initialize log level from saved preference (unless environment variable is set)
if (!isLogLevelFromEnv()) {
  const savedLogLevel = await getLogLevelPreference();
  setLogLevel(savedLogLevel as LogLevelName);
  log.debug(`Log level set from saved preference: ${savedLogLevel}`);
} else {
  log.debug(`Log level set from RALPHER_LOG_LEVEL environment variable`);
}

// Initialize the global backend manager (loads settings from preferences)
await backendManager.initialize();

// Port can be configured via RALPHER_PORT environment variable
const port = parseInt(process.env["RALPHER_PORT"] ?? "3000", 10);

const server = serve<WebSocketData>({
  port,
  // Increase idle timeout from default 10s to 120s for long-running operations
  // like git push/pull/fetch that happen over the network
  idleTimeout: 120,
  routes: {
    // API routes
    ...apiRoutes,

    // WebSocket endpoint for real-time events
    "/api/ws": (req: Request, server: Server<WebSocketData>) => {
      const url = new URL(req.url);
      const loopId = url.searchParams.get("loopId") ?? undefined;

      const upgraded = server.upgrade(req, {
        data: { loopId } as WebSocketData,
      });

      if (upgraded) {
        // Return undefined to indicate successful upgrade (Bun handles the response)
        return undefined;
      }

      // Upgrade failed
      return new Response("WebSocket upgrade failed", { status: 400 });
    },

    // Serve index.html for all unmatched routes (SPA fallback)
    "/*": index,
  },

  // WebSocket handlers
  websocket: websocketHandlers,

  development: process.env.NODE_ENV !== "production" && {
    // Enable browser hot reloading in development
    hmr: true,

    // Echo console logs from the browser to the server
    console: true,
  },
});

log.info(`Ralpher server running at ${server.url}`);
