import type { LoopCtx } from "./context";
import type { ModelConfig } from "../../types/loop";
import type { SendFollowUpResult } from "./loop-types";
import { loadLoop } from "../../persistence/loops";
import { canReuseExistingBranch, jumpstartLoopFromEngine, reviveDeletedLoop } from "./loop-jumpstart";

export async function sendFollowUpImpl(
  ctx: LoopCtx,
  loopId: string,
  options: { message: string; model?: ModelConfig }
): Promise<SendFollowUpResult> {
  const message = options.message.trim();
  if (message === "") {
    return { success: false, error: "Follow-up message cannot be empty" };
  }
  if (options.model && (!options.model.providerID || !options.model.modelID)) {
    return { success: false, error: "Invalid model config: providerID and modelID are required" };
  }

  const loop = await loadLoop(loopId);
  if (!loop) {
    return { success: false, error: "Loop not found" };
  }

  if (loop.state.status === "pushed" || loop.state.status === "merged") {
    return ctx.startFeedbackCycle(loopId, {
      prompt: message,
      model: options.model,
    });
  }

  if (loop.state.status === "deleted") {
    if (loop.config.mode === "chat") {
      const canRecoverChatContext = await canReuseExistingBranch(loop);
      if (!canRecoverChatContext) {
        return jumpstartLoopFromEngine(ctx, loopId, {
          message,
          model: options.model,
        });
      }

      const reviveResult = await reviveDeletedLoop(loopId);
      if (!reviveResult.success) {
        return reviveResult;
      }

      try {
        await ctx.sendChatMessage(loopId, message, options.model);
        return { success: true };
      } catch (error) {
        return { success: false, error: String(error) };
      }
    }

    return jumpstartLoopFromEngine(ctx, loopId, {
      message,
      model: options.model,
    });
  }

  if (loop.config.mode === "chat") {
    try {
      await ctx.sendChatMessage(loopId, message, options.model);
      return { success: true };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  }

  return jumpstartLoopFromEngine(ctx, loopId, {
    message,
    model: options.model,
  });
}
