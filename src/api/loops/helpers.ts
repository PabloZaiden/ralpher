/**
 * Shared helper functions used across multiple loops API route modules.
 */

import { loopManager } from "../../core/loop-manager";
import { isModelEnabled } from "../models";
import { errorResponse } from "../helpers";

/**
 * Validate that the given model is enabled for the loop's workspace.
 * Returns a Response if validation fails, or null if the model is valid.
 */
export async function validateEnabledModelForLoop(
  loopId: string,
  model: { providerID: string; modelID: string } | undefined,
): Promise<Response | null> {
  if (!model?.providerID || !model?.modelID) {
    return null;
  }

  const loop = await loopManager.getLoop(loopId);
  if (!loop) {
    return errorResponse("not_found", "Loop not found", 404);
  }

  const modelValidation = await isModelEnabled(
    loop.config.workspaceId,
    loop.config.directory,
    model.providerID,
    model.modelID,
  );
  if (!modelValidation.enabled) {
    return errorResponse(
      modelValidation.errorCode ?? "model_not_enabled",
      modelValidation.error ?? "The selected model is not available",
    );
  }

  return null;
}

/**
 * Map a loop start error to an appropriate HTTP response.
 */
export function startErrorResponse(
  error: unknown,
  fallbackCode: string,
  fallbackMessage: string,
): Response {
  if (error instanceof Error) {
    const code = (error as Error & { code?: string }).code;
    const status = (error as Error & { status?: number }).status;
    const changedFiles = (error as Error & { changedFiles?: string[] }).changedFiles;

    if (code === "uncommitted_changes") {
      return Response.json(
        {
          error: "uncommitted_changes",
          message: error.message,
          changedFiles: changedFiles ?? [],
        },
        { status: status ?? 409 },
      );
    }

    if (code === "directory_in_use") {
      return errorResponse("directory_in_use", error.message, status ?? 409);
    }
  }

  return errorResponse(fallbackCode, `${fallbackMessage}: ${String(error)}`, 500);
}
