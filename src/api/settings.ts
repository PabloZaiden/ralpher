/**
 * Settings API endpoints for Ralph Loops Management System.
 * 
 * This module provides endpoints for:
 * - Getting application configuration
 * - Resetting backend connections and database
 * 
 * Note: Server settings are now per-workspace. Use the workspace API
 * to get/update server settings for a specific workspace.
 * 
 * @module api/settings
 */

import { backendManager } from "../core/backend-manager";
import { loopManager } from "../core/loop-manager";
import { getAppConfig } from "../core/config";
import { deleteAndReinitializeDatabase } from "../persistence/database";
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
 * Provides endpoints for application configuration and management:
 * - GET /api/config - Get application configuration
 * - POST /api/backend/reset - Force reset all backend connections
 * - POST /api/backend/reset-all - Reset all connections and stale loops
 * - POST /api/settings/reset-all - Delete and reinitialize database
 * 
 * Note: Global server settings endpoints have been removed.
 * Server settings are now configured per-workspace via the workspace API.
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

  "/api/backend/reset": {
    /**
     * POST /api/backend/reset - Force reset all backend connections.
     * 
     * Aborts all active subscriptions and clears connection state
     * for all workspaces. Useful for recovering from stale or hung
     * connections.
     * 
     * @returns Success response with message
     */
    async POST(): Promise<Response> {
      try {
        await backendManager.resetAllConnections();
        return Response.json({ 
          success: true, 
          message: "All backend connections reset successfully" 
        });
      } catch (error) {
        return errorResponse("reset_failed", String(error), 500);
      }
    },
  },

  "/api/backend/reset-all": {
    /**
     * POST /api/backend/reset-all - Force reset all connections and stale loops.
     * 
     * This is a comprehensive reset that:
     * 1. Stops all running loop engines
     * 2. Clears in-memory loop state
     * 3. Resets stale loops in the database to "stopped" status
     *    (except "planning" loops which can reconnect)
     * 4. Aborts all active subscriptions
     * 5. Disconnects from all backends
     * 
     * Does NOT delete the database or loop history.
     * 
     * Use this to recover from:
     * - Stale connections where loops appear stuck
     * - Hung loops that aren't responding
     * - State mismatches between memory and database
     * 
     * After reset:
     * - Stopped loops can be resumed by sending a new message
     * - Planning loops can continue by sending feedback
     * 
     * @returns Success response with reset statistics
     */
    async POST(): Promise<Response> {
      try {
        const result = await loopManager.forceResetAll();
        return Response.json({ 
          success: true, 
          message: "All connections and stale loops have been reset",
          enginesCleared: result.enginesCleared,
          loopsReset: result.loopsReset,
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
     * 1. Resets all backend connections
     * 2. Deletes the database file
     * 3. Recreates the database with all migrations applied
     * 
     * All loops, sessions, workspaces, and preferences will be permanently deleted.
     * 
     * @returns Success response with message
     */
    async POST(): Promise<Response> {
      try {
        // Reset all backend connections first
        await backendManager.resetAllConnections();
        
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
