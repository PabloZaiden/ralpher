import type { LoopCtx } from "./context";
import type { Loop } from "../../types/loop";
import type { StartLoopOptions } from "./loop-types";
import type { CommandExecutor } from "../command-executor";
import { LoopEngine } from "../loop-engine";
import { createTimestamp } from "../../types/events";
import { loadLoop, updateLoopState, getActiveLoopByDirectory } from "../../persistence/loops";
import { backendManager } from "../backend-manager";
import { GitService } from "../git-service";
import { log } from "../logger";
import { assertValidTransition } from "../loop-state-machine";
import { getLoopWorkingDirectory } from "./loop-types";

export async function startLoopImpl(ctx: LoopCtx, loopId: string, _options?: StartLoopOptions): Promise<void> {
  const loop = await loadLoop(loopId);
  if (!loop) {
    throw new Error(`Loop not found: ${loopId}`);
  }

  if (ctx.engines.has(loopId)) {
    throw new Error("Loop is already running");
  }

  const executor = await backendManager.getCommandExecutorAsync(loop.config.workspaceId, loop.config.directory);
  const git = GitService.withExecutor(executor);

  await validateMainCheckoutStartImpl(ctx, loop, git);

  const backend = backendManager.getLoopBackend(loopId, loop.config.workspaceId);

  const engine = new LoopEngine({
    loop,
    backend,
    gitService: git,
    eventEmitter: ctx.emitter,
    onPersistState: async (state) => {
      await updateLoopState(loopId, state);
    },
  });

  ctx.engines.set(loopId, engine);

  startStatePersistenceImpl(ctx, loopId);

  engine.start().catch((error) => {
    log.error(`Loop ${loopId} failed to start:`, String(error));
  });
}

export async function stopLoopImpl(ctx: LoopCtx, loopId: string, reason = "User requested stop"): Promise<void> {
  const engine = ctx.engines.get(loopId);
  if (!engine) {
    throw new Error("Loop is not running");
  }

  await engine.stop(reason);
  ctx.engines.delete(loopId);

  await backendManager.disconnectLoop(loopId);

  if (engine.state.syncState?.autoPushOnComplete) {
    engine.state.syncState.autoPushOnComplete = false;
  }

  await updateLoopState(loopId, engine.state);
}

export async function startPlanModeImpl(ctx: LoopCtx, loopId: string): Promise<void> {
  const loop = await loadLoop(loopId);
  if (!loop) {
    throw new Error(`Loop not found: ${loopId}`);
  }

  if (loop.state.status !== "planning") {
    throw new Error(`Loop is not in planning status: ${loop.state.status}`);
  }

  if (ctx.engines.has(loopId)) {
    throw new Error("Loop plan mode is already running");
  }

  const executor = await backendManager.getCommandExecutorAsync(loop.config.workspaceId, loop.config.directory);
  const git = GitService.withExecutor(executor);

  await validateMainCheckoutStartImpl(ctx, loop, git);

  if (!loop.state.startedAt) {
    loop.state.startedAt = createTimestamp();
  }
  await updateLoopState(loopId, loop.state);

  const backend = backendManager.getLoopBackend(loopId, loop.config.workspaceId);

  const engine = new LoopEngine({
    loop,
    backend,
    gitService: git,
    eventEmitter: ctx.emitter,
    onPersistState: async (state) => {
      await updateLoopState(loopId, state);
    },
  });

  try {
    await engine.setupGitBranchForPlanAcceptance();
  } catch (error) {
    throw new Error(`Failed to set up git branch for plan mode: ${String(error)}`, { cause: error });
  }

  const workingDirectory = engine.workingDirectory;

  await clearPlanningFilesImpl(ctx, loopId, loop, executor, workingDirectory);

  ctx.engines.set(loopId, engine);

  startStatePersistenceImpl(ctx, loopId);

  engine.start().catch((error) => {
    log.error(`Loop ${loopId} plan mode failed:`, String(error));
  });
}

export async function startDraftImpl(
  ctx: LoopCtx,
  loopId: string,
  options: { planMode: boolean }
): Promise<Loop> {
  const loop = await loadLoop(loopId);
  if (!loop) {
    throw new Error(`Loop not found: ${loopId}`);
  }

  if (loop.state.status !== "draft") {
    throw new Error(`Loop is not in draft status: ${loop.state.status}`);
  }

  if (options.planMode) {
    assertValidTransition(loop.state.status, "planning", "startDraft");
    loop.state.status = "planning";
    loop.state.planMode = {
      active: true,
      feedbackRounds: 0,
      planningFolderCleared: false,
      isPlanReady: false,
    };
    await updateLoopState(loopId, loop.state);

    await startPlanModeImpl(ctx, loopId);
  } else {
    assertValidTransition(loop.state.status, "idle", "startDraft");
    loop.state.status = "idle";
    await updateLoopState(loopId, loop.state);

    await startLoopImpl(ctx, loopId);
  }

  const updatedLoop = await ctx.getLoop(loopId);
  return updatedLoop ?? loop;
}

export async function recoverPlanningEngineImpl(ctx: LoopCtx, loopId: string): Promise<LoopEngine> {
  const loop = await loadLoop(loopId);
  if (!loop) {
    throw new Error(`Loop not found: ${loopId}`);
  }

  if (loop.state.status !== "planning") {
    throw new Error("Loop plan mode is not running");
  }

  const workingDirectory = getLoopWorkingDirectory(loop);
  if (!workingDirectory) {
    throw new Error("Loop is configured to use a worktree, but no worktree path is available - cannot recreate engine for planning recovery");
  }
  const executor = await backendManager.getCommandExecutorAsync(loop.config.workspaceId, workingDirectory);
  const git = GitService.withExecutor(executor);
  await ensureLoopBranchCheckedOutImpl(ctx, loop, git, workingDirectory);
  const backend = backendManager.getLoopBackend(loopId, loop.config.workspaceId);

  const engine = new LoopEngine({
    loop,
    backend,
    gitService: git,
    eventEmitter: ctx.emitter,
    onPersistState: async (state) => {
      await updateLoopState(loopId, state);
    },
  });

  ctx.engines.set(loopId, engine);

  try {
    await engine.reconnectSession();
  } catch (error) {
    ctx.engines.delete(loopId);
    throw new Error(
      `Failed to recover planning engine session for loop ${loopId}: ${String(error)}`,
      { cause: error },
    );
  }

  startStatePersistenceImpl(ctx, loopId);

  return engine;
}

export async function recoverChatEngineImpl(ctx: LoopCtx, loopId: string): Promise<LoopEngine> {
  const loop = await loadLoop(loopId);
  if (!loop) {
    throw new Error(`Loop not found: ${loopId}`);
  }

  if (loop.config.mode !== "chat") {
    throw new Error(`Loop is not a chat (mode: ${loop.config.mode})`);
  }

  const recoverableStatuses = ["completed", "max_iterations", "stopped", "failed"];
  if (!recoverableStatuses.includes(loop.state.status)) {
    throw new Error(`Cannot recover chat engine in status: ${loop.state.status}`);
  }

  const workingDirectory = getLoopWorkingDirectory(loop);
  if (!workingDirectory) {
    throw new Error("Chat is configured to use a worktree, but no worktree path is available — cannot recreate engine for recovery");
  }
  const executor = await backendManager.getCommandExecutorAsync(loop.config.workspaceId, workingDirectory);
  const git = GitService.withExecutor(executor);
  await ensureLoopBranchCheckedOutImpl(ctx, loop, git, workingDirectory);
  const backend = backendManager.getLoopBackend(loopId, loop.config.workspaceId);

  const engine = new LoopEngine({
    loop,
    backend,
    gitService: git,
    eventEmitter: ctx.emitter,
    onPersistState: async (state) => {
      await updateLoopState(loopId, state);
    },
  });

  ctx.engines.set(loopId, engine);

  try {
    await engine.reconnectSession();
  } catch (error) {
    ctx.engines.delete(loopId);
    throw new Error(
      `Failed to recover chat engine session for loop ${loopId}: ${String(error)}`,
      { cause: error },
    );
  }

  startStatePersistenceImpl(ctx, loopId);

  return engine;
}

export function startStatePersistenceImpl(ctx: LoopCtx, loopId: string): void {
  const interval = setInterval(async () => {
    const engine = ctx.engines.get(loopId);
    if (!engine) {
      clearInterval(interval);
      return;
    }

    try {
      await updateLoopState(loopId, engine.state);
    } catch (error) {
      log.error(`Failed to persist loop state: ${String(error)}`);
    }

    if (
      engine.state.status === "completed" ||
      engine.state.status === "stopped" ||
      engine.state.status === "failed" ||
      engine.state.status === "max_iterations"
    ) {
      clearInterval(interval);

      const isChatIdle = engine.config.mode === "chat" &&
        (engine.state.status === "completed" || engine.state.status === "max_iterations");

      if (!isChatIdle) {
        backendManager.disconnectLoop(loopId).catch((error) => {
          log.error(`Failed to disconnect loop backend during cleanup: ${String(error)}`);
        });
        ctx.engines.delete(loopId);
      }
    }
  }, 5000);
}

export async function validateMainCheckoutStartImpl(_ctx: LoopCtx, loop: Loop, git: GitService): Promise<void> {
  if (loop.config.useWorktree) {
    return;
  }

  const activeLoop = await getActiveLoopByDirectory(loop.config.directory);
  if (activeLoop && activeLoop.config.id !== loop.config.id) {
    const error = new Error(
      `Cannot start without a worktree while loop "${activeLoop.config.name}" is already active in this workspace.`,
    ) as Error & { code: string; status: number };
    error.code = "directory_in_use";
    error.status = 409;
    throw error;
  }

  const hasChanges = await git.hasUncommittedChanges(loop.config.directory);
  if (!hasChanges) {
    return;
  }

  const changedFiles = await git.getChangedFiles(loop.config.directory);
  const error = new Error(
    "Cannot start without a worktree because the repository has uncommitted changes.",
  ) as Error & { code: string; status: number; changedFiles: string[] };
  error.code = "uncommitted_changes";
  error.status = 409;
  error.changedFiles = changedFiles;
  throw error;
}

export async function clearPlanningFilesImpl(
  _ctx: LoopCtx,
  loopId: string,
  loop: Loop,
  executor: CommandExecutor,
  worktreePath: string
): Promise<void> {
  if (loop.config.clearPlanningFolder && !loop.state.planMode?.planningFolderCleared) {
    const planningDir = `${worktreePath}/.planning`;

    try {
      const exists = await executor.directoryExists(planningDir);
      if (exists) {
        const files = await executor.listDirectory(planningDir);
        const filesToDelete = files.filter((file: string) => file !== ".gitkeep");

        if (filesToDelete.length > 0) {
          const fileArgs = filesToDelete.map((file: string) => `${planningDir}/${file}`);
          await executor.exec("rm", ["-rf", ...fileArgs], {
            cwd: worktreePath,
          });
        }
      }

      if (loop.state.planMode) {
        loop.state.planMode.planningFolderCleared = true;
        await updateLoopState(loopId, loop.state);
      }
    } catch (error) {
      log.warn(`Failed to clear .planning folder: ${String(error)}`);
    }
  }

  const planFilePath = `${worktreePath}/.planning/plan.md`;
  try {
    const planFileExists = await executor.fileExists(planFilePath);
    if (planFileExists) {
      await executor.exec("rm", ["-f", planFilePath], { cwd: worktreePath });
      log.debug("Cleared stale plan.md file before starting plan mode");
    }
  } catch (error) {
    log.warn(`Failed to clear plan.md: ${String(error)}`);
  }
}

export async function ensureLoopBranchCheckedOutImpl(
  _ctx: LoopCtx,
  loop: Loop,
  git: GitService,
  workingDirectory: string
): Promise<void> {
  if (loop.config.useWorktree) {
    return;
  }

  const workingBranch = loop.state.git?.workingBranch;
  if (!workingBranch) {
    return;
  }

  const currentBranch = await git.getCurrentBranch(workingDirectory);
  if (currentBranch !== workingBranch) {
    await git.checkoutBranch(workingDirectory, workingBranch);
  }
}
