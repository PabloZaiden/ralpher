/**
 * Health check API endpoint for Ralph Loops Management System.
 */

import type { HealthResponse } from "../types/api";

/**
 * Package version (could be read from package.json in production).
 */
const VERSION = "1.0.0";

/**
 * Health check route handler.
 */
export const healthRoutes = {
  "/api/health": {
    async GET(): Promise<Response> {
      const response: HealthResponse = {
        healthy: true,
        version: VERSION,
      };
      return Response.json(response);
    },
  },
};
