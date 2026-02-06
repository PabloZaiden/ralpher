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
import { createLogger } from "../core/logger";

const log = createLogger("api:settings");

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
 * - POST /api/server/kill - Terminate the server process (for container restart)
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
      log.debug("GET /api/config");
      const config = getAppConfig();
      log.trace("Returning app config", { remoteOnly: config.remoteOnly });
      return Response.json(config);
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
      log.warn("POST /api/settings/reset-all - Resetting all settings");
      try {
        // Reset all backend connections first
        log.debug("Resetting all backend connections");
        await backendManager.resetAllConnections();
        
        // Delete and reinitialize the database
        log.debug("Deleting and reinitializing database");
        await deleteAndReinitializeDatabase();
        
        log.info("All settings have been reset successfully");
        return Response.json({ 
          success: true, 
          message: "All settings have been reset. Database recreated." 
        });
      } catch (error) {
        log.error("Failed to reset all settings", { error: String(error) });
        return errorResponse("reset_failed", String(error), 500);
      }
    },
  },

  "/api/server/kill": {
    /**
     * POST /api/server/kill - Terminate the server process.
     * 
     * This is a DESTRUCTIVE operation that terminates the Ralpher server process.
     * In containerized environments (e.g., Kubernetes), this will cause the container
     * to restart, potentially pulling an updated image.
     * 
     * The server sends a success response before scheduling the exit to ensure
     * the client receives confirmation that the kill was initiated.
     * 
     * @returns Success response with message, then server terminates
     */
    async POST(): Promise<Response> {
      log.warn("POST /api/server/kill - Server kill requested");
      
      // Schedule the server termination after a short delay to allow the response to be sent
      setTimeout(() => {
        log.info("Server is shutting down...");
        // Exit with code 0 to indicate intentional termination
        // In k8s, the container will restart based on the restart policy
        process.exit(0);
      }, 100);
      
      return Response.json({ 
        success: true, 
        message: "Server is shutting down. The connection will be lost." 
      });
    },
  },
};
