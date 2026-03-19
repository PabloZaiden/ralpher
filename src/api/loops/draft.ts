/**
 * Draft loop start routes.
 *
 * - POST /api/loops/:id/draft/start - Transition a draft loop to planning or execution
 */

import { loopManager } from "../../core/loop-manager";
import { parseAndValidate } from "../validation";
import { errorResponse } from "../helpers";
import { StartDraftRequestSchema } from "../../types/schemas";
import { startErrorResponse } from "./helpers";

export const loopsDraftRoutes = {
  "/api/loops/:id/draft/start": {
    /**
     * POST /api/loops/:id/draft/start - Start a draft loop.
     *
     * Transitions a draft loop to either planning mode or immediate execution.
     * Each loop operates in its own worktree, so no uncommitted-changes checks are needed.
     *
     * Request Body:
     * - planMode (required): If true, start in plan mode; if false, start immediately
     *
     * Errors:
     * - 400: Loop is not in draft status or invalid body
     * - 404: Loop not found
     *
     * @returns Updated Loop object
     */
    async POST(req: Request & { params: { id: string } }): Promise<Response> {
      // Parse and validate request body using Zod schema
      const validation = await parseAndValidate(StartDraftRequestSchema, req);
      if (!validation.success) {
        return validation.response;
      }
      const body = validation.data;

      // Load the loop
      const loop = await loopManager.getLoop(req.params.id);
      if (!loop) {
        return errorResponse("not_found", "Loop not found", 404);
      }

      // Verify it's a draft
      if (loop.state.status !== "draft") {
        return errorResponse("not_draft", "Loop is not in draft status", 400);
      }

      // With worktrees, each loop operates in its own isolated directory.
      // No need to check for active loops or uncommitted changes.

      // Delegate the draft → start transition to LoopManager
      try {
        const updatedLoop = await loopManager.startDraft(req.params.id, {
          planMode: body.planMode,
        });
        return Response.json(updatedLoop);
      } catch (startError) {
        return startErrorResponse(
          startError,
          body.planMode ? "start_plan_failed" : "start_failed",
          body.planMode ? "Failed to start plan mode" : "Failed to start loop",
        );
      }
    },
  },
};
