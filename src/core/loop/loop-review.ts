import type { LoopCtx } from "./context";
import type { ModelConfig } from "../../types/loop";
import type { SendFollowUpResult } from "./loop-types";
import { loadLoop } from "../../persistence/loops";
import { backendManager } from "../backend-manager";
import { GitService } from "../git-service";
import { constructReviewPrompt, setupMergedReviewWorktree, transitionToFeedbackCycleAndStart } from "./review-engine";
export { getReviewHistoryImpl } from "./review-history";
export { getReviewCommentsImpl } from "./review-history";

export async function addressReviewCommentsImpl(
  ctx: LoopCtx,
  loopId: string,
  comments: string
): Promise<{ success: boolean; error?: string; reviewCycle?: number; branch?: string; commentIds?: string[] }> {
  if (!comments || comments.trim() === "") {
    return { success: false, error: "Comments cannot be empty" };
  }

  return startFeedbackCycleImpl(ctx, loopId, {
    prompt: constructReviewPrompt(comments.trim()),
    reviewCommentText: comments.trim(),
  });
}

export async function startFeedbackCycleImpl(
  ctx: LoopCtx,
  loopId: string,
  options: {
    prompt: string;
    model?: ModelConfig;
    reviewCommentText?: string;
  }
): Promise<SendFollowUpResult> {
  const loop = await loadLoop(loopId);
  if (!loop) {
    return { success: false, error: "Loop not found" };
  }

  if (!loop.state.reviewMode?.addressable) {
    return { success: false, error: "Loop is not addressable. Only pushed or merged loops can receive follow-up feedback." };
  }

  if (loop.state.status !== "pushed" && loop.state.status !== "merged") {
    return { success: false, error: `Cannot send follow-up on loop with status: ${loop.state.status}` };
  }

  if (ctx.engines.has(loopId)) {
    return { success: false, error: "Loop is already running" };
  }

  try {
    const executor = await backendManager.getCommandExecutorAsync(loop.config.workspaceId, loop.config.directory);
    const git = GitService.withExecutor(executor);
    const backend = backendManager.getLoopBackend(loopId, loop.config.workspaceId);
    const nextReviewCycle = loop.state.reviewMode.reviewCycles + 1;
    const reviewComment = options.reviewCommentText
      ? {
          id: crypto.randomUUID(),
          text: options.reviewCommentText,
        }
      : undefined;

    if (loop.state.reviewMode.completionAction === "push") {
      if (!loop.state.git?.workingBranch) {
        return { success: false, error: "No working branch found for pushed loop" };
      }

      loop.state.reviewMode.reviewCycles += 1;

      return transitionToFeedbackCycleAndStart(ctx, loopId, loop, backend, git, {
        prompt: options.prompt,
        model: options.model,
        transitionLabel: "pushed",
        reviewComment,
        nextReviewCycle,
        resultBranch: loop.state.git.workingBranch,
      });
    }

    if (!loop.state.git?.originalBranch) {
      return { success: false, error: "No original branch found for merged loop" };
    }

    loop.state.reviewMode.reviewCycles += 1;
    const reviewBranchName = await setupMergedReviewWorktree(loop, git);

    return transitionToFeedbackCycleAndStart(ctx, loopId, loop, backend, git, {
      prompt: options.prompt,
      model: options.model,
      transitionLabel: "merged",
      reviewComment,
      nextReviewCycle,
      resultBranch: reviewBranchName,
    });
  } catch (error) {
    return { success: false, error: String(error) };
  }
}
