/**
 * Loop comments routes.
 *
 * - GET /api/loops/:id/comments - Get all review comments for a loop
 */

import { loopManager } from "../../core/loop-manager";
import { errorResponse } from "../helpers";
import type { GetCommentsResponse } from "../../types/api";

export const loopsCommentsRoutes = {
  "/api/loops/:id/comments": {
    /**
     * GET /api/loops/:id/comments - Get all review comments for a loop.
     *
     * Returns all review comments submitted for a loop across all review cycles.
     * Comments include their status (pending/addressed) and timestamps.
     *
     * @returns GetCommentsResponse with array of ReviewComment objects
     */
    async GET(req: Request & { params: { id: string } }): Promise<Response> {
      try {
        // Check if loop exists
        const loop = await loopManager.getLoop(req.params.id);
        if (!loop) {
          return errorResponse("not_found", "Loop not found", 404);
        }

        // Get comments from database via LoopManager
        const comments = loopManager.getReviewComments(req.params.id);

        const responseBody: GetCommentsResponse = {
          success: true,
          comments,
        };
        return Response.json(responseBody);
      } catch (error) {
        return errorResponse("get_comments_failed", String(error), 500);
      }
    },
  },
};
