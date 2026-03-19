import type { LoopCtx } from "./context";
import type { Loop, ModelConfig } from "../../types/loop";
import type { MessageImageAttachment } from "../../types/message-attachments";
import { LoopEngine } from "../loop-engine";
import { createTimestamp } from "../../types/events";
import { loadLoop, updateLoopState, saveLoop } from "../../persistence/loops";
import { backendManager } from "../backend-manager";
import { GitService } from "../git-service";
import { log } from "../logger";
import { assertValidTransition } from "../loop-state-machine";
import { getLoopWorkingDirectory } from "./loop-types";
import { startStatePersistenceImpl } from "./loop-execution";

export async function jumpstartLoopImpl(
  ctx: LoopCtx,
  loopId: string,
  options: { message?: string; model?: ModelConfig; attachments?: MessageImageAttachment[] }
): Promise<{ success: boolean; error?: string }> {
  return jumpstartLoopFromEngine(ctx, loopId, options);
}

/** Internal helper used by pending-engine and follow-up modules. */
export async function jumpstartLoopFromEngine(
  ctx: LoopCtx,
  loopId: string,
  options: { message?: string; model?: ModelConfig; attachments?: MessageImageAttachment[] }
): Promise<{ success: boolean; error?: string }> {
  const loop = await loadLoop(loopId);
  if (!loop) {
    return { success: false, error: "Loop not found" };
  }

  const jumpstartableStates = ["completed", "stopped", "failed", "max_iterations", "planning", "deleted"];
  if (!jumpstartableStates.includes(loop.state.status)) {
    return { success: false, error: `Loop cannot be jumpstarted from status: ${loop.state.status}` };
  }

  if (options.message !== undefined) {
    loop.state.pendingPrompt = options.message;
  }
  if (options.model !== undefined) {
    loop.state.pendingModel = options.model;
    loop.config.model = options.model;
  }

  const wasInPlanningMode = loop.state.planMode?.active === true;

  if (wasInPlanningMode) {
    assertValidTransition(loop.state.status, "planning", "jumpstartLoop");
    loop.state.status = "planning";
    if (loop.state.planMode) {
      loop.state.planMode.isPlanReady = false;
    }
  } else {
    assertValidTransition(loop.state.status, "stopped", "jumpstartLoop");
    loop.state.status = "stopped";
  }
  loop.state.completedAt = undefined;
  loop.state.error = undefined;
  loop.state.syncState = undefined;

  await updateLoopState(loopId, loop.state);
  await saveLoop(loop);

  ctx.emitter.emit({
    type: "loop.pending.updated",
    loopId,
    pendingPrompt: options.message,
    pendingModel: options.model,
    timestamp: createTimestamp(),
  });

  const canReuse = await canReuseExistingBranch(loop);

  if (wasInPlanningMode) {
    if (canReuse) {
      return jumpstartOnExistingBranch(ctx, loopId, loop, true, options.attachments);
    } else {
      try {
        await ctx.startPlanMode(loopId, { attachments: options.attachments });
        log.info(`Jumpstarted planning loop ${loopId} with pending message`);
        return { success: true };
      } catch (startError) {
        log.error(`Failed to jumpstart planning loop ${loopId}: ${String(startError)}`);
        return { success: false, error: `Failed to jumpstart planning loop: ${String(startError)}` };
      }
    }
  }

  if (canReuse) {
    return jumpstartOnExistingBranch(ctx, loopId, loop, false, options.attachments);
  } else {
    try {
      await ctx.startLoop(loopId, { attachments: options.attachments });
      log.info(`Jumpstarted loop ${loopId} with pending message (new branch)`);
      return { success: true };
    } catch (startError) {
      log.error(`Failed to jumpstart loop ${loopId}: ${String(startError)}`);
      return { success: false, error: `Failed to jumpstart loop: ${String(startError)}` };
    }
  }
}

export async function canReuseExistingBranch(loop: Loop): Promise<boolean> {
  if (!loop.state.git?.workingBranch) {
    return false;
  }

  if (!loop.config.useWorktree) {
    return true;
  }

  const worktreePath = loop.state.git.worktreePath;
  if (!worktreePath) {
    return false;
  }

  const executor = await backendManager.getCommandExecutorAsync(loop.config.workspaceId, loop.config.directory);
  const git = GitService.withExecutor(executor);
  return git.worktreeExists(loop.config.directory, worktreePath);
}

export async function reviveDeletedLoop(loopId: string): Promise<{ success: boolean; error?: string }> {
  const loop = await loadLoop(loopId);
  if (!loop) {
    return { success: false, error: "Loop not found" };
  }
  if (loop.state.status !== "deleted") {
    return { success: false, error: `Loop is not deleted (status: ${loop.state.status})` };
  }

  const targetStatus = loop.state.planMode?.active ? "planning" as const : "stopped" as const;
  assertValidTransition(loop.state.status, targetStatus, "reviveDeletedLoop");
  loop.state.status = targetStatus;
  loop.state.completedAt = undefined;
  loop.state.error = undefined;
  loop.state.syncState = undefined;
  if (loop.state.planMode) {
    loop.state.planMode.isPlanReady = false;
  }

  await saveLoop(loop);
  return { success: true };
}

async function jumpstartOnExistingBranch(
  ctx: LoopCtx,
  loopId: string,
  loop: Loop,
  isPlanning = false,
  attachments: MessageImageAttachment[] = [],
): Promise<{ success: boolean; error?: string }> {
  try {
    const workingDirectory = getLoopWorkingDirectory(loop);
    if (!workingDirectory) {
      return { success: false, error: "Loop is configured to use a worktree, but no worktree path is available - cannot jumpstart" };
    }
    const executor = await backendManager.getCommandExecutorAsync(loop.config.workspaceId, workingDirectory);
    const git = GitService.withExecutor(executor);
    const backend = backendManager.getLoopBackend(loopId, loop.config.workspaceId);

    const workingBranch = loop.state.git!.workingBranch;
    const loopType = isPlanning ? "planning loop" : "loop";
    log.info(`Jumpstarting ${loopType} ${loopId} on existing branch: ${workingBranch}`);

    await ctx.ensureLoopBranchCheckedOut(loop, git, workingDirectory);

    const engine = new LoopEngine({
      loop: { config: loop.config, state: loop.state },
      backend,
      gitService: git,
      eventEmitter: ctx.emitter,
      onPersistState: async (state) => {
        await updateLoopState(loopId, state);
      },
      skipGitSetup: true,
      initialPromptAttachments: attachments,
    });
    ctx.engines.set(loopId, engine);

    startStatePersistenceImpl(ctx, loopId);

    engine.start().catch((error) => {
      log.error(`${isPlanning ? "Planning loop" : "Loop"} ${loopId} failed to start after jumpstart:`, String(error));
    });

    log.info(`Jumpstarted ${loopType} ${loopId} with pending message on existing branch: ${workingBranch}`);
    return { success: true };
  } catch (error) {
    log.error(`Failed to jumpstart ${isPlanning ? "planning loop" : "loop"} ${loopId} on existing branch: ${String(error)}`);
    return { success: false, error: `Failed to jumpstart loop: ${String(error)}` };
  }
}
