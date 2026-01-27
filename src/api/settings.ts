/**
 * Server settings API endpoints for Ralph Loops Management System.
 * 
 * This module provides endpoints for:
 * - Getting/setting server connection mode (spawn or connect)
 * - Testing connections to opencode backends
 * - Resetting backend connections and database
 * - Getting application configuration
 * 
 * Ralpher supports two connection modes:
 * - spawn: Launch a local opencode server on demand
 * - connect: Connect to an existing remote opencode server
 * 
 * Both modes provide identical functionality via PTY+WebSocket execution.
 * 
 * @module api/settings
 */

import { backendManager } from "../core/backend-manager";
import { getAppConfig, isRemoteOnlyMode } from "../core/config";
import { deleteAndReinitializeDatabase } from "../persistence/database";
import type { ServerSettings } from "../types/settings";
import type { ErrorResponse } from "../types/api";

/**
 * Create a standardized error response.
 * 
 * @param error - Error code for programmatic handling
 * @param message - Human-readable error description
 * @param status - HTTP status code (default: 400)
 * @returns JSON Response with error details
 */
function errorResponse(error: string, message: string, status = 400): Response {
  const body: ErrorResponse = { error, message };
  return Response.json(body, { status });
}

/**
 * Settings API routes.
 * 
 * Provides endpoints for server configuration and management:
 * - GET /api/config - Get application configuration
 * - GET/PUT /api/settings/server - Get/set server settings
 * - GET /api/settings/server/status - Get connection status
 * - POST /api/settings/server/test - Test connection
 * - POST /api/backend/reset - Force reset backend connection
 * - POST /api/settings/reset-all - Delete and reinitialize database
 */
export const settingsRoutes = {
  "/api/config": {
    /**
     * GET /api/config - Get application configuration.
     * 
     * Returns settings that affect app behavior based on environment.
     * Currently includes:
     * - remoteOnly: Whether spawn mode is disabled (RALPHER_REMOTE_ONLY)
     * 
     * @returns AppConfig object
     */
    async GET(): Promise<Response> {
      return Response.json(getAppConfig());
    },
  },

  "/api/settings/server": {
    /**
     * GET /api/settings/server - Get current server settings.
     * 
     * Returns the current connection mode and settings.
     * Password is included in response for display purposes.
     * 
     * @returns ServerSettings object
     */
    async GET(): Promise<Response> {
      const settings = backendManager.getSettings();
      return Response.json(settings);
    },

    /**
     * PUT /api/settings/server - Update server settings.
     * 
     * Updates the connection mode and settings. Disconnects any current
     * connection so the next operation uses the new settings.
     * 
     * Request Body:
     * - mode (required): "spawn" or "connect"
     * - hostname: Required for connect mode
     * - port: Optional port for connect mode
     * - password: Optional password for Basic auth
     * 
     * Errors:
     * - 400: Invalid mode, missing hostname, or spawn disabled
     * 
     * @returns Success response with updated settings
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
     * GET /api/settings/server/status - Get connection status.
     * 
     * Returns the current connection state including whether connected,
     * the current mode, and the server URL when connected.
     * 
     * @returns ConnectionStatus object
     */
    async GET(): Promise<Response> {
      const status = backendManager.getStatus();
      return Response.json(status);
    },
  },

  "/api/settings/server/test": {
    /**
     * POST /api/settings/server/test - Test connection with provided settings.
     * 
     * Tests a connection without saving the settings. Useful for validating
     * settings before committing them.
     * 
     * Request Body:
     * - mode (required): "spawn" or "connect"
     * - hostname: Required for connect mode
     * - port: Optional port for connect mode
     * - password: Optional password for Basic auth
     * - directory: Optional directory to test with (defaults to cwd)
     * 
     * @returns Test result with success and message
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

  "/api/backend/reset": {
    /**
     * POST /api/backend/reset - Force reset the backend connection.
     * 
     * Aborts all active subscriptions and clears connection state.
     * Useful for recovering from stale or hung connections without
     * changing settings.
     * 
     * @returns Success response with message
     */
    async POST(): Promise<Response> {
      try {
        await backendManager.reset();
        return Response.json({ 
          success: true, 
          message: "Backend connection reset successfully" 
        });
      } catch (error) {
        return errorResponse("reset_failed", String(error), 500);
      }
    },
  },

  "/api/settings/reset-all": {
    /**
     * POST /api/settings/reset-all - Delete database and reinitialize.
     * 
     * This is a DESTRUCTIVE operation that:
     * 1. Resets the backend connection
     * 2. Deletes the database file
     * 3. Recreates the database with all migrations applied
     * 
     * All loops, sessions, and preferences will be permanently deleted.
     * 
     * @returns Success response with message
     */
    async POST(): Promise<Response> {
      try {
        // Reset backend manager first
        await backendManager.reset();
        
        // Delete and reinitialize the database
        await deleteAndReinitializeDatabase();
        
        return Response.json({ 
          success: true, 
          message: "All settings have been reset. Database recreated." 
        });
      } catch (error) {
        return errorResponse("reset_failed", String(error), 500);
      }
    },
  },
};
