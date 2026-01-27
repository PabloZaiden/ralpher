/**
 * Health check API endpoint for Ralph Loops Management System.
 * 
 * Provides a simple health check endpoint to verify the server is running.
 * Used by load balancers, monitoring tools, and the UI to check connectivity.
 * 
 * Endpoint:
 * - GET /api/health - Returns health status and version
 * 
 * @module api/health
 */

import type { HealthResponse } from "../types/api";

/**
 * Application version string.
 * TODO: Read from package.json in production.
 */
const VERSION = "1.0.0";

/**
 * Health check route handler.
 * 
 * Provides a single endpoint for health checks:
 * - GET /api/health - Returns { healthy: true, version: "x.x.x" }
 */
export const healthRoutes = {
  "/api/health": {
    /**
     * GET /api/health - Check if the server is running.
     * 
     * Returns a simple health response with the current version.
     * Always returns healthy: true when the server is responding.
     * 
     * @returns HealthResponse with healthy flag and version
     */
    async GET(): Promise<Response> {
      const response: HealthResponse = {
        healthy: true,
        version: VERSION,
      };
      return Response.json(response);
    },
  },
};
