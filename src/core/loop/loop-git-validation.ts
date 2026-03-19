import type { LoopCtx } from "./context";
import type { Loop } from "../../types/loop";
import { GitService } from "../git-service";
import { getActiveLoopByDirectory } from "../../persistence/loops";

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
