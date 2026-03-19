import type { LoopCtx } from "./context";
import type { ModelConfig } from "../../types/loop";
import type { AcceptPlanOptions, AcceptPlanResult } from "./loop-types";
import { createTimestamp } from "../../types/events";
import { updateLoopState } from "../../persistence/loops";
import { sshSessionManager } from "../ssh-session-manager";
import { log } from "../logger";
import { assertValidTransition } from "../loop-state-machine";
import type { LoopState } from "../../types/loop";
import type { MessageImageAttachment } from "../../types/message-attachments";

export async function sendPlanFeedbackImpl(
  ctx: LoopCtx,
  loopId: string,
  feedback: string,
  attachments: MessageImageAttachment[] = [],
): Promise<void> {
  const engine = ctx.engines.get(loopId) ?? await ctx.recoverPlanningEngine(loopId);

  if (engine.state.status !== "planning") {
    throw new Error(`Loop is not in planning status: ${engine.state.status}`);
  }

  if (engine.state.planMode) {
    engine.state.planMode.feedbackRounds += 1;
    engine.state.planMode.isPlanReady = false;
  }

  await updateLoopState(loopId, engine.state);

  ctx.emitter.emit({
    type: "loop.plan.feedback",
    loopId,
    round: engine.state.planMode?.feedbackRounds ?? 0,
    timestamp: createTimestamp(),
  });

  await engine.injectPlanFeedback(feedback, attachments);
}

export async function answerPendingPlanQuestionImpl(ctx: LoopCtx, loopId: string, answers: string[][]): Promise<void> {
  const engine = ctx.engines.get(loopId) ?? await ctx.recoverPlanningEngine(loopId);

  if (engine.state.status !== "planning") {
    throw new Error(`Loop is not in planning status: ${engine.state.status}`);
  }

  await engine.answerPendingPlanQuestion(answers);
}

export async function acceptPlanImpl(
  ctx: LoopCtx,
  loopId: string,
  options: AcceptPlanOptions = {}
): Promise<AcceptPlanResult> {
  const engine = ctx.engines.get(loopId) ?? await ctx.recoverPlanningEngine(loopId);
  const mode = options.mode ?? "start_loop";

  if (engine.state.status !== "planning") {
    throw new Error(`Loop is not in planning status: ${engine.state.status}`);
  }

  if (!engine.state.planMode?.isPlanReady) {
    throw new Error("Plan is not ready yet. Wait for the AI to finish generating the plan.");
  }

  await engine.waitForLoopIdle();

  const planSessionId = engine.state.session?.id;
  const planServerUrl = engine.state.session?.serverUrl;
  const now = createTimestamp();

  const targetStatus = mode === "open_ssh" ? "completed" : "running";
  assertValidTransition(engine.state.status, targetStatus, "acceptPlan");
  const updatedState: Partial<LoopState> = {
    status: targetStatus,
    startedAt: engine.state.startedAt ?? now,
    completedAt: mode === "open_ssh" ? now : engine.state.completedAt,
    pendingPrompt: mode === "open_ssh" ? undefined : engine.state.pendingPrompt,
    planMode: {
      ...engine.state.planMode,
      active: false,
      planSessionId,
      planServerUrl,
      feedbackRounds: engine.state.planMode?.feedbackRounds ?? 0,
      planningFolderCleared: engine.state.planMode?.planningFolderCleared ?? false,
    },
  };

  Object.assign(engine.state, updatedState);
  await updateLoopState(loopId, engine.state);

  const executionPrompt = `The plan has been accepted. Now execute all tasks in the plan.

Follow the standard loop execution flow:
- Read AGENTS.md and the plan in .planning/plan.md
- Pick up the most important task to continue with
- **IMPORTANT — Incremental progress tracking**: After completing each individual task, immediately update .planning/status.md to mark it as completed and note any relevant findings. Do not wait until the end — update after every task so progress is preserved if the iteration is interrupted.
- **IMPORTANT — Pre-compaction persistence**: Before ending your response, you MUST also update .planning/status.md with the current task and its state, updated status of all tasks, any new learnings or discoveries, and what the next steps should be. This ensures progress is preserved even if the conversation context is compacted or summarized between iterations.
- If you complete all tasks in the plan, end your response with:

<promise>COMPLETE</promise>`;

  ctx.emitter.emit({
    type: "loop.plan.accepted",
    loopId,
    timestamp: now,
  });

  if (mode === "open_ssh") {
    ctx.emitter.emit({
      type: "loop.ssh_handoff",
      loopId,
      totalIterations: engine.state.currentIteration,
      timestamp: now,
    });

    const sshSession = await sshSessionManager.getOrCreateLoopSession(loopId);
    return {
      mode,
      sshSession,
    };
  }

  ctx.emitter.emit({
    type: "loop.started",
    loopId,
    iteration: 0,
    timestamp: now,
  });

  engine.setPendingPrompt(executionPrompt);

  engine.continueExecution().catch((error) => {
    log.error(`Loop ${loopId} execution after plan acceptance failed:`, String(error));
  });

  return {
    mode,
  };
}

export async function discardPlanImpl(ctx: LoopCtx, loopId: string): Promise<boolean> {
  log.debug(`[LoopManager] discardPlan: Starting for loop ${loopId}, engine exists: ${ctx.engines.has(loopId)}`);

  if (ctx.engines.has(loopId)) {
    log.debug(`[LoopManager] discardPlan: Stopping engine for loop ${loopId}`);
    await ctx.stopLoop(loopId, "Plan discarded");
    log.debug(`[LoopManager] discardPlan: Engine stopped for loop ${loopId}`);
  }

  ctx.emitter.emit({
    type: "loop.plan.discarded",
    loopId,
    timestamp: createTimestamp(),
  });

  log.debug(`[LoopManager] discardPlan: Calling deleteLoop for ${loopId}`);
  const result = await ctx.deleteLoop(loopId);
  log.debug(`[LoopManager] discardPlan: deleteLoop returned ${result} for ${loopId}`);
  return result;
}

export async function sendChatMessageImpl(
  ctx: LoopCtx,
  loopId: string,
  message: string,
  model?: ModelConfig,
  attachments: MessageImageAttachment[] = [],
): Promise<void> {
  const engine = ctx.engines.get(loopId) ?? await ctx.recoverChatEngine(loopId);

  if (engine.config.mode !== "chat") {
    throw new Error(`Loop is not a chat (mode: ${engine.config.mode})`);
  }

  const validStates = ["completed", "running", "max_iterations", "stopped", "failed"];
  if (!validStates.includes(engine.state.status)) {
    throw new Error(`Cannot send chat message in status: ${engine.state.status}`);
  }

  await engine.injectChatMessage(message, model, attachments);
}
