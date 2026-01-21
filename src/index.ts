/**
 * Main server entry point for Ralph Loops Management System.
 * Uses Bun's native serve() with route-based API.
 */

import { serve } from "bun";
import index from "./index.html";
import { apiRoutes } from "./api";
import { ensureDataDirectories } from "./persistence/paths";
import { backendManager } from "./core/backend-manager";
import "./backends/register"; // Auto-register backends

// Ensure data directories exist on startup
await ensureDataDirectories();

// Initialize the global backend manager (loads settings from preferences)
await backendManager.initialize();

// Port can be configured via RALPHER_PORT environment variable
const port = parseInt(process.env["RALPHER_PORT"] ?? "3000", 10);

const server = serve({
  port,
  routes: {
    // API routes
    ...apiRoutes,

    // Serve index.html for all unmatched routes (SPA fallback)
    "/*": index,
  },

  development: process.env.NODE_ENV !== "production" && {
    // Enable browser hot reloading in development
    hmr: true,

    // Echo console logs from the browser to the server
    console: true,
  },
});

console.log(`🚀 Ralpher server running at ${server.url}`);
