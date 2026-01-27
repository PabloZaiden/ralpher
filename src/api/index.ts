/**
 * Central export for the API module.
 * 
 * Combines all API routes from individual modules into a single object
 * that can be spread into Bun's serve() routes option.
 * 
 * Route Modules:
 * - health: Server health check endpoint
 * - loops: Loop CRUD, control, data, and review operations
 * - models: AI model listing and user preferences
 * - settings: Server configuration and connection management
 * - git: Git repository information
 * - websocket: Real-time event streaming (handled separately)
 * 
 * @module api
 */

import { healthRoutes } from "./health";
import { loopsRoutes } from "./loops";
import { modelsAndPreferencesRoutes } from "./models";
import { settingsRoutes } from "./settings";
import { gitRoutes } from "./git";

/**
 * All API routes combined.
 * 
 * Spread this object into Bun's serve() routes option to register all endpoints.
 * The WebSocket endpoint is handled separately in src/index.ts.
 * 
 * @example
 * ```typescript
 * Bun.serve({
 *   routes: {
 *     ...apiRoutes,
 *     // ... other routes
 *   },
 * });
 * ```
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
