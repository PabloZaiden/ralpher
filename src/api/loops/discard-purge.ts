/**
 * Loop discard and purge routes.
 *
 * - POST /api/loops/:id/discard - Discard loop and delete its git branch
 * - POST /api/loops/:id/purge   - Permanently delete a loop from storage
 */

import { loopManager } from "../../core/loop-manager";
import { createLogger } from "../../core/logger";
import { errorResponse, successResponse } from "../helpers";

const log = createLogger("api:loops");

export const loopsDiscardPurgeRoutes = {
  "/api/loops/:id/discard": {
    /**
     * POST /api/loops/:id/discard - Discard a loop and delete its git branch.
     *
     * Deletes the loop's working branch and marks the loop as deleted.
     * After discard, the loop can be purged to permanently remove it.
     *
     * @returns Success response
     */
    async POST(req: Request & { params: { id: string } }): Promise<Response> {
      log.debug("POST /api/loops/:id/discard", { loopId: req.params.id });
      const result = await loopManager.discardLoop(req.params.id);

      if (!result.success) {
        log.warn("POST /api/loops/:id/discard - Failed", { loopId: req.params.id, error: result.error });
        if (result.error?.includes("not found")) {
          return errorResponse("not_found", "Loop not found", 404);
        }
        return errorResponse("discard_failed", result.error ?? "Unknown error", 400);
      }

      log.info("POST /api/loops/:id/discard - Loop discarded", { loopId: req.params.id });
      return successResponse();
    },
  },

  "/api/loops/:id/purge": {
    /**
     * POST /api/loops/:id/purge - Permanently delete a loop from storage.
     *
     * Removes the loop from the database entirely. Drafts are removed immediately.
     * Other loops only work in final states (merged, pushed, deleted).
     *
     * @returns Success response
     */
    async POST(req: Request & { params: { id: string } }): Promise<Response> {
      log.debug("POST /api/loops/:id/purge", { loopId: req.params.id });
      const result = await loopManager.purgeLoop(req.params.id);

      if (!result.success) {
        log.warn("POST /api/loops/:id/purge - Failed", { loopId: req.params.id, error: result.error });
        if (result.error?.includes("not found")) {
          return errorResponse("not_found", "Loop not found", 404);
        }
        return errorResponse("purge_failed", result.error ?? "Unknown error", 400);
      }

      log.info("POST /api/loops/:id/purge - Loop purged", { loopId: req.params.id });
      return successResponse();
    },
  },
};
