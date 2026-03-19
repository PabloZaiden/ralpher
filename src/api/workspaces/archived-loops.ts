/**
 * Route handler for purging archived loops within a workspace.
 */

import { loopManager } from "../../core/loop-manager";
import { createLogger } from "../../core/logger";
import { isArchivedLoop } from "../../utils";
import {
  requireWorkspace,
  errorResponse,
  successResponse,
} from "../helpers";

const log = createLogger("api:workspaces");
const ARCHIVED_LOOP_PURGE_CONCURRENCY = 4;

type ArchivedLoopPurgeResult =
  | { success: true; loopId: string }
  | { success: false; loopId: string; error: string };

async function purgeArchivedLoopsWithConcurrency(
  archivedLoops: Awaited<ReturnType<typeof loopManager.getAllLoops>>,
): Promise<ArchivedLoopPurgeResult[]> {
  const results: ArchivedLoopPurgeResult[] = new Array(archivedLoops.length);
  let nextIndex = 0;

  const workerCount = Math.min(ARCHIVED_LOOP_PURGE_CONCURRENCY, archivedLoops.length);
  const workers = Array.from({ length: workerCount }, async () => {
    while (nextIndex < archivedLoops.length) {
      const currentIndex = nextIndex;
      nextIndex++;
      const loop = archivedLoops[currentIndex]!;

      try {
        const result = await loopManager.purgeLoop(loop.config.id);
        if (result.success) {
          results[currentIndex] = { success: true, loopId: loop.config.id };
          continue;
        }

        results[currentIndex] = {
          success: false,
          loopId: loop.config.id,
          error: result.error ?? "Unknown error",
        };
      } catch (error) {
        results[currentIndex] = {
          success: false,
          loopId: loop.config.id,
          error: String(error),
        };
      }
    }
  });

  await Promise.allSettled(workers);
  return results;
}

export const archivedLoopsRoutes = {
  /**
   * POST /api/workspaces/:id/archived-loops/purge - Purge all archived loops for a workspace.
   */
  "/api/workspaces/:id/archived-loops/purge": {
    async POST(req: Request & { params: { id: string } }) {
      const { id } = req.params;
      log.debug("POST /api/workspaces/:id/archived-loops/purge", { workspaceId: id });

      try {
        const workspace = await requireWorkspace(id);
        if (workspace instanceof Response) {
          return workspace;
        }

        const loops = await loopManager.getAllLoops();
        const archivedLoops = loops.filter(
          (loop) =>
            loop.config.workspaceId === id &&
            isArchivedLoop(loop.state.status, loop.state.reviewMode?.addressable),
        );

        const purgeResults = await purgeArchivedLoopsWithConcurrency(archivedLoops);
        const purgedLoopIds = purgeResults
          .filter((result): result is Extract<ArchivedLoopPurgeResult, { success: true }> => result.success)
          .map((result) => result.loopId);
        const failures = purgeResults
          .filter((result): result is Extract<ArchivedLoopPurgeResult, { success: false }> => !result.success)
          .map(({ loopId, error }) => ({ loopId, error }));

        log.info("POST /api/workspaces/:id/archived-loops/purge - Completed", {
          workspaceId: id,
          totalArchived: archivedLoops.length,
          purgedCount: purgedLoopIds.length,
          failureCount: failures.length,
        });

        return successResponse({
          workspaceId: id,
          totalArchived: archivedLoops.length,
          purgedCount: purgedLoopIds.length,
          purgedLoopIds,
          failures,
        });
      } catch (error) {
        log.error("Failed to purge archived workspace loops:", {
          workspaceId: id,
          error: String(error),
        });
        return errorResponse(
          "purge_archived_failed",
          `Failed to purge archived workspace loops: ${String(error)}`,
          500,
        );
      }
    },
  },
};
