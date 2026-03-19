import type { LoopCtx } from "./context";
import type { Loop, ModelConfig } from "../../types/loop";
import type { SendFollowUpResult } from "./loop-types";
import { LoopEngine } from "../loop-engine";
import { loadLoop, updateLoopState, saveLoop } from "../../persistence/loops";
import { insertReviewComment, getReviewComments as getReviewCommentsFromDb } from "../../persistence/review-comments";
import { backendManager } from "../backend-manager";
import { GitService } from "../git-service";
import { log } from "../logger";
import { assertValidTransition } from "../loop-state-machine";
import { buildReviewBranchName } from "../branch-name";
import { startStatePersistenceImpl } from "./loop-execution";

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

export async function getReviewHistoryImpl(
  _ctx: LoopCtx,
  loopId: string
): Promise<{ success: boolean; error?: string; history?: {
  addressable: boolean;
  completionAction: "push" | "merge";
  reviewCycles: number;
  reviewBranches: string[];
} }> {
  const loop = await loadLoop(loopId);
  if (!loop) {
    return { success: false, error: "Loop not found" };
  }

  if (!loop.state.reviewMode) {
    return {
      success: true,
      history: {
        addressable: false,
        completionAction: "push",
        reviewCycles: 0,
        reviewBranches: [],
      },
    };
  }

  return {
    success: true,
    history: {
      addressable: loop.state.reviewMode.addressable,
      completionAction: loop.state.reviewMode.completionAction,
      reviewCycles: loop.state.reviewMode.reviewCycles,
      reviewBranches: loop.state.reviewMode.reviewBranches,
    },
  };
}

export function getReviewCommentsImpl(
  _ctx: LoopCtx,
  loopId: string
): Array<{
  id: string;
  loopId: string;
  reviewCycle: number;
  commentText: string;
  createdAt: string;
  status: "pending" | "addressed";
  addressedAt?: string;
}> {
  const dbComments = getReviewCommentsFromDb(loopId);
  return dbComments.map((c) => ({
    id: c.id,
    loopId: c.loop_id,
    reviewCycle: c.review_cycle,
    commentText: c.comment_text,
    createdAt: c.created_at,
    status: c.status as "pending" | "addressed",
    addressedAt: c.addressed_at ?? undefined,
  }));
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

      return transitionToFeedbackCycleAndStart(
        ctx,
        loopId,
        loop,
        backend,
        git,
        {
          prompt: options.prompt,
          model: options.model,
          transitionLabel: "pushed",
          reviewComment,
          nextReviewCycle,
          resultBranch: loop.state.git.workingBranch,
        },
      );
    }

    if (!loop.state.git?.originalBranch) {
      return { success: false, error: "No original branch found for merged loop" };
    }

    loop.state.reviewMode.reviewCycles += 1;
    const reviewBranchName = await setupMergedReviewWorktree(loop, git);

    return transitionToFeedbackCycleAndStart(
      ctx,
      loopId,
      loop,
      backend,
      git,
      {
        prompt: options.prompt,
        model: options.model,
        transitionLabel: "merged",
        reviewComment,
        nextReviewCycle,
        resultBranch: reviewBranchName,
      },
    );
  } catch (error) {
    return { success: false, error: String(error) };
  }
}

async function setupMergedReviewWorktree(loop: Loop, git: GitService): Promise<string> {
  const baseBranchName = loop.state.reviewMode!.reviewBranches[0] ?? loop.state.git!.workingBranch;
  const reviewBranchName = buildReviewBranchName(
    baseBranchName,
    loop.state.reviewMode!.reviewCycles,
  );

  const worktreePath = `${loop.config.directory}/.ralph-worktrees/${loop.config.id}`;

  const oldWorktreeExists = await git.worktreeExists(loop.config.directory, worktreePath);
  if (oldWorktreeExists) {
    await git.removeWorktree(loop.config.directory, worktreePath, { force: true });
  }

  await git.createWorktree(
    loop.config.directory,
    worktreePath,
    reviewBranchName,
    loop.state.git!.originalBranch
  );

  loop.state.git!.workingBranch = reviewBranchName;
  loop.state.git!.worktreePath = worktreePath;
  loop.state.reviewMode!.reviewBranches.push(reviewBranchName);

  return reviewBranchName;
}

async function transitionToFeedbackCycleAndStart(
  ctx: LoopCtx,
  loopId: string,
  loop: Loop,
  backend: ReturnType<typeof backendManager.getLoopBackend>,
  git: GitService,
  options: {
    prompt: string;
    model?: ModelConfig;
    transitionLabel: string;
    reviewComment?: {
      id: string;
      text: string;
    };
    nextReviewCycle: number;
    resultBranch: string;
  },
): Promise<{ success: boolean; reviewCycle: number; branch: string; commentIds?: string[] }> {
  assertValidTransition(loop.state.status, "idle", `startFeedbackCycle:${options.transitionLabel}`);
  loop.state.status = "idle";
  loop.state.completedAt = undefined;
  loop.state.error = undefined;
  loop.state.syncState = undefined;
  loop.state.pendingPrompt = undefined;
  loop.state.pendingModel = undefined;
  if (options.model !== undefined) {
    loop.config.model = options.model;
  }

  await saveLoop(loop);

  if (options.reviewComment) {
    insertReviewComment({
      id: options.reviewComment.id,
      loopId,
      reviewCycle: options.nextReviewCycle,
      commentText: options.reviewComment.text,
      createdAt: new Date().toISOString(),
      status: "pending",
    });
  }

  startFeedbackEngine(ctx, loopId, loop, backend, git, {
    prompt: options.prompt,
    model: options.model,
    startFailureLabel: options.reviewComment ? "addressing comments" : "sending follow-up feedback",
  });

  return {
    success: true,
    reviewCycle: loop.state.reviewMode!.reviewCycles,
    branch: options.resultBranch,
    commentIds: options.reviewComment ? [options.reviewComment.id] : undefined,
  };
}

function startFeedbackEngine(
  ctx: LoopCtx,
  loopId: string,
  loop: Loop,
  backend: ReturnType<typeof backendManager.getLoopBackend>,
  git: GitService,
  options: {
    prompt: string;
    model?: ModelConfig;
    startFailureLabel: string;
  },
): void {
  const engine = new LoopEngine({
    loop: { config: loop.config, state: loop.state },
    backend,
    gitService: git,
    eventEmitter: ctx.emitter,
    onPersistState: async (state) => {
      await updateLoopState(loopId, state);
    },
    skipGitSetup: true,
  });
  ctx.engines.set(loopId, engine);

  if (options.model !== undefined) {
    engine.setPendingModel(options.model);
  }
  engine.setPendingPrompt(options.prompt);

  startStatePersistenceImpl(ctx, loopId);

  engine.start().catch((error) => {
    log.error(`Loop ${loopId} failed to start after ${options.startFailureLabel}:`, String(error));
  });
}

function constructReviewPrompt(comments: string): string {
  return `A reviewer has provided feedback on your previous work. Please address the following comments:

---
${comments}
---

Instructions:
- Read AGENTS.md and .planning/status.md to understand what was previously done
- **FIRST**: Immediately add each reviewer comment as a pending task in .planning/status.md before starting to address any of them. This ensures the feedback is tracked and preserved even if the conversation context is compacted.
- Make targeted changes to address each reviewer comment
- **IMPORTANT — Incremental progress tracking**: After addressing each individual reviewer comment, immediately update .planning/status.md to mark it as resolved and note what was changed. Do not batch updates — persist progress after each comment so it is preserved if the iteration is interrupted.
- Test your changes to ensure they work correctly
- When all comments are fully addressed, end your response with:

<promise>COMPLETE</promise>`;
}
