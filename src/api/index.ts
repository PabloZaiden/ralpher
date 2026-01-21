/**
 * Central export for API module.
 * Combines all API routes into a single object.
 */

import { healthRoutes } from "./health";
import { loopsRoutes } from "./loops";
import { eventsRoutes } from "./events";
import { modelsAndPreferencesRoutes } from "./models";
import { settingsRoutes } from "./settings";

/**
 * All API routes combined.
 * Can be spread into Bun's serve() routes option.
 */
export const apiRoutes = {
  ...healthRoutes,
  ...loopsRoutes,
  ...eventsRoutes,
  ...modelsAndPreferencesRoutes,
  ...settingsRoutes,
};

// Re-export individual route modules
export * from "./health";
export * from "./loops";
export * from "./events";
export * from "./models";
export * from "./settings";
