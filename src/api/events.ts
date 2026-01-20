/**
 * SSE (Server-Sent Events) API endpoints for Ralph Loops Management System.
 * Provides real-time event streaming for loop updates.
 */

import { createSSEStream, loopEventEmitter } from "../core/event-emitter";
import { loopManager } from "../core/loop-manager";

/**
 * SSE headers for proper streaming.
 */
const SSE_HEADERS = {
  "Content-Type": "text/event-stream",
  "Cache-Control": "no-cache",
  "Connection": "keep-alive",
};

/**
 * Events routes for SSE streaming.
 */
export const eventsRoutes = {
  "/api/events": {
    /**
     * GET /api/events - Global SSE stream for all loop events
     */
    async GET(): Promise<Response> {
      const stream = createSSEStream(loopEventEmitter);
      return new Response(stream, { headers: SSE_HEADERS });
    },
  },

  "/api/loops/:id/events": {
    /**
     * GET /api/loops/:id/events - SSE stream for a specific loop
     */
    async GET(req: Request & { params: { id: string } }): Promise<Response> {
      const loopId = req.params.id;

      // Verify loop exists
      const loop = await loopManager.getLoop(loopId);
      if (!loop) {
        return Response.json(
          { error: "not_found", message: "Loop not found" },
          { status: 404 }
        );
      }

      // Create filtered SSE stream for this loop
      const stream = createSSEStream(loopEventEmitter, loopId);
      return new Response(stream, { headers: SSE_HEADERS });
    },
  },
};
