/**
 * Central export for API module.
 * Combines all API routes into a single object.
 */

import { healthRoutes } from "./health";
import { loopsRoutes } from "./loops";
import { modelsAndPreferencesRoutes } from "./models";
import { settingsRoutes } from "./settings";
import { gitRoutes } from "./git";

/**
 * All API routes combined.
 * Can be spread into Bun's serve() routes option.
 * Note: WebSocket endpoint is handled separately in src/index.ts
 */
export const apiRoutes = {
  ...healthRoutes,
  ...loopsRoutes,
  ...modelsAndPreferencesRoutes,
  ...settingsRoutes,
  ...gitRoutes,
};

// Re-export individual route modules
export * from "./health";
export * from "./loops";
export * from "./models";
export * from "./settings";
export * from "./git";
export * from "./websocket";
