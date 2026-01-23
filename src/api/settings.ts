/**
 * Server settings API endpoints for Ralph Loops Management System.
 * Handles global server configuration.
 */

import { backendManager } from "../core/backend-manager";
import { getAppConfig, isRemoteOnlyMode } from "../core/config";
import type { ServerSettings } from "../types/settings";
import type { ErrorResponse } from "../types/api";

/**
 * Helper to create error response.
 */
function errorResponse(error: string, message: string, status = 400): Response {
  const body: ErrorResponse = { error, message };
  return Response.json(body, { status });
}

/**
 * Settings API routes.
 */
export const settingsRoutes = {
  "/api/config": {
    /**
     * GET /api/config - Get application configuration
     * Returns settings that affect app behavior based on environment.
     */
    async GET(): Promise<Response> {
      return Response.json(getAppConfig());
    },
  },

  "/api/settings/server": {
    /**
     * GET /api/settings/server - Get current server settings
     */
    async GET(): Promise<Response> {
      const settings = backendManager.getSettings();
      return Response.json(settings);
    },

    /**
     * PUT /api/settings/server - Update server settings
     */
    async PUT(req: Request): Promise<Response> {
      try {
        const body = (await req.json()) as Partial<ServerSettings>;

        if (!body.mode || (body.mode !== "spawn" && body.mode !== "connect")) {
          return errorResponse(
            "invalid_mode",
            'mode must be "spawn" or "connect"'
          );
        }

        // Block spawn mode when RALPHER_REMOTE_ONLY is set
        if (body.mode === "spawn" && isRemoteOnlyMode()) {
          return errorResponse(
            "spawn_disabled",
            "Spawn mode is disabled. RALPHER_REMOTE_ONLY environment variable is set."
          );
        }

        if (body.mode === "connect") {
          if (!body.hostname) {
            return errorResponse(
              "missing_hostname",
              "hostname is required for connect mode"
            );
          }
        }

        const settings: ServerSettings = {
          mode: body.mode,
          hostname: body.hostname,
          port: body.port,
          password: body.password,
        };

        await backendManager.updateSettings(settings);

        // Disconnect current connection so next operation uses new settings
        await backendManager.disconnect();

        return Response.json({ success: true, settings });
      } catch (error) {
        return errorResponse("save_failed", String(error), 500);
      }
    },
  },

  "/api/settings/server/status": {
    /**
     * GET /api/settings/server/status - Get connection status
     */
    async GET(): Promise<Response> {
      const status = backendManager.getStatus();
      return Response.json(status);
    },
  },

  "/api/settings/server/test": {
    /**
     * POST /api/settings/server/test - Test connection with provided settings
     * Body: { mode, hostname?, port?, directory }
     */
    async POST(req: Request): Promise<Response> {
      try {
        const body = (await req.json()) as ServerSettings & {
          directory?: string;
        };

        if (!body.mode || (body.mode !== "spawn" && body.mode !== "connect")) {
          return errorResponse(
            "invalid_mode",
            'mode must be "spawn" or "connect"'
          );
        }

        // Block spawn mode when RALPHER_REMOTE_ONLY is set
        if (body.mode === "spawn" && isRemoteOnlyMode()) {
          return errorResponse(
            "spawn_disabled",
            "Spawn mode is disabled. RALPHER_REMOTE_ONLY environment variable is set."
          );
        }

        if (body.mode === "connect" && !body.hostname) {
          return errorResponse(
            "missing_hostname",
            "hostname is required for connect mode"
          );
        }

        // For testing, we need a directory. Use a default if not provided.
        const directory = body.directory || process.cwd();

        const result = await backendManager.testConnection(
          {
            mode: body.mode,
            hostname: body.hostname,
            port: body.port,
            password: body.password,
          },
          directory
        );

        return Response.json(result);
      } catch (error) {
        return errorResponse("test_failed", String(error), 500);
      }
    },
  },
};
