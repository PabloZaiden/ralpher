/**
 * Settings API endpoints for Ralph Loops Management System.
 * 
 * This module provides endpoints for:
 * - Getting application configuration
 * - Resetting database
 * 
 * Note: Server settings and connection management are now per-workspace.
 * Use the workspace API to get/update server settings or reset connections
 * for a specific workspace.
 * 
 * @module api/settings
 */

import { backendManager } from "../core/backend-manager";
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
 * - POST /api/settings/reset-all - Delete and reinitialize database
 * 
 * Note: Global server settings and connection reset endpoints have been removed.
 * Server settings and connection management are now per-workspace via the workspace API.
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
