/**
 * Loop manager for Ralph Loops Management System.
 * Manages the lifecycle of Ralph Loops: CRUD, start/stop, accept/discard.
 * This is the main entry point for loop operations.
 */

import type {
  Loop,
  LoopConfig,
  LoopState,
  ModelConfig,
} from "../types/loop";
import type { LoopEvent } from "../types/events";
import { createTimestamp } from "../types/events";
import { createInitialState, DEFAULT_LOOP_CONFIG } from "../types/loop";
import {
  saveLoop,
  loadLoop,
  deleteLoop as deleteLoopFile,
  listLoops,
  updateLoopState,
  resetStaleLoops,
} from "../persistence/loops";
import { insertReviewComment, getReviewComments as getReviewCommentsFromDb } from "../persistence/review-comments";
import { setLastModel } from "../persistence/preferences";
import { backendManager } from "./backend-manager";
import type { CommandExecutor } from "./command-executor";
import { GitService } from "./git-service";
import { LoopEngine } from "./loop-engine";
import { loopEventEmitter, SimpleEventEmitter } from "./event-emitter";
import { log } from "./logger";
import { sanitizeBranchName } from "../utils";
import { generateLoopName } from "../utils/name-generator";
import { assertValidTransition } from "./loop-state-machine";

/**
 * Options for creating a new loop.
 */
export interface CreateLoopOptions {
  /** Absolute path to working directory */
  directory: string;
  /** The task prompt/PRD */
  prompt: string;
  /** Workspace ID this loop belongs to */
  workspaceId: string;
  /** Model provider ID (required) */
  modelProviderID: string;
  /** Model ID (required) */
  modelID: string;
  /** Model variant (e.g., "thinking"). Empty string for default variant. */
  modelVariant?: string;
  /** Maximum iterations (default: Infinity for unlimited) */
  maxIterations?: number;
  /** Maximum consecutive identical errors before failsafe exit (default: 10) */
  maxConsecutiveErrors?: number;
  /** Activity timeout in seconds - time without events before treating as error (default: 900 = 15 minutes) */
  activityTimeoutSeconds?: number;
  /** Custom stop pattern (default: "<promise>COMPLETE</promise>$") */
  stopPattern?: string;
  /** Git branch prefix (default: "ralph/") */
  gitBranchPrefix?: string;
  /** Git commit prefix (default: "[Ralph]") */
  gitCommitPrefix?: string;
  /** Base branch to create the loop from (default: current branch) */
  baseBranch?: string;
  /** Clear the .planning folder contents before starting (default: false) */
  clearPlanningFolder?: boolean;
  /** Start in plan creation mode instead of immediate execution (required) */
  planMode: boolean;
  /** Save as draft without starting (no git branch or session created) */
  draft?: boolean;
  /** Mode of operation: "loop" for autonomous loops, "chat" for interactive chat (default: "loop") */
  mode?: "loop" | "chat";
}

/**
 * Options for starting a loop.
 * Loops use git worktrees for isolation, so uncommitted changes
 * in the main repository do not affect loop execution.
 */
export interface StartLoopOptions {
  // Reserved for future options
}

/**
 * Result of accepting a loop.
 */
export interface AcceptLoopResult {
  success: boolean;
  mergeCommit?: string;
  error?: string;
}

/**
 * Result of pushing a loop branch.
 */
export interface PushLoopResult {
  success: boolean;
  remoteBranch?: string;
  /** Sync status with base branch */
  syncStatus?: "already_up_to_date" | "clean" | "conflicts_being_resolved";
  error?: string;
}

/**
 * LoopManager handles the lifecycle of Ralph Loops.
 */
export class LoopManager {
  private engines = new Map<string, LoopEngine>();
  private emitter: SimpleEventEmitter<LoopEvent>;
  /** Guard to prevent concurrent accept/push operations on the same loop */
  private loopsBeingAccepted = new Set<string>();

  constructor(options?: {
    eventEmitter?: SimpleEventEmitter<LoopEvent>;
  }) {
    this.emitter = options?.eventEmitter ?? loopEventEmitter;
  }


  /**
   * Generate a name for a new loop.
   * For drafts: uses prompt-based fallback (no AI call).
   * For non-drafts: calls AI-based title generation with fallback on failure.
   */
  private async generateName(
    options: Pick<CreateLoopOptions, "draft" | "prompt" | "directory" | "workspaceId">,
    timestamp: string
  ): Promise<string> {
    // For drafts, skip AI title generation and use prompt-based fallback
    // This avoids backend interference issues and makes draft creation faster
    if (options.draft) {
      const fallbackName = options.prompt.slice(0, 50).trim();
      const name = fallbackName || `Draft ${timestamp.slice(0, 10)}`;
      log.debug("createLoop - Using prompt-based name for draft", { generatedName: name });
      return name;
    }

    // For non-drafts, use AI-based title generation
    try {
      const backend = backendManager.getBackend(options.workspaceId);
      const tempSession = await backend.createSession({
        title: "Loop Name Generation",
        directory: options.directory,
      });

      try {
        const name = await generateLoopName({
          prompt: options.prompt,
          backend,
          sessionId: tempSession.id,
          timeoutMs: 10000,
        });
        log.info(`Generated loop name: ${name}`);
        return name;
      } finally {
        try {
          await backend.abortSession(tempSession.id);
        } catch (cleanupError) {
          log.warn(`Failed to clean up temporary session: ${String(cleanupError)}`);
        }
      }
    } catch (error) {
      // If name generation fails, use prompt-based fallback
      log.warn(`Failed to generate loop name: ${String(error)}, using fallback`);
      const fallbackName = options.prompt.slice(0, 50).trim();
      if (fallbackName) {
        return fallbackName;
      }
      // Ultimate fallback if prompt is empty
      const ts = new Date().toISOString()
        .replace(/[T:.]/g, "-")
        .replace(/Z$/, "")
        .slice(0, 19);
      return `loop-${ts}`;
    }
  }


  /**
   * Create a new loop.
   * The loop name is automatically generated from the prompt using opencode.
   */
  async createLoop(options: CreateLoopOptions): Promise<Loop> {
    const id = crypto.randomUUID();
    const now = createTimestamp();

    // Debug logging for loop creation
    log.debug("createLoop - Input", {
      id,
      draft: options.draft,
      promptLength: options.prompt.length,
      promptPreview: options.prompt.slice(0, 50),
      workspaceId: options.workspaceId,
    });

    // Generate loop name
    const generatedName = await this.generateName(options, now);

    const config: LoopConfig = {
      id,
      name: generatedName,
      directory: options.directory,
      prompt: options.prompt,
      createdAt: now,
      updatedAt: now,
      workspaceId: options.workspaceId,
      model: {
        providerID: options.modelProviderID,
        modelID: options.modelID,
        variant: options.modelVariant,
      },
      maxIterations: options.maxIterations ?? DEFAULT_LOOP_CONFIG.maxIterations,
      maxConsecutiveErrors: options.maxConsecutiveErrors ?? DEFAULT_LOOP_CONFIG.maxConsecutiveErrors,
      activityTimeoutSeconds: options.activityTimeoutSeconds ?? DEFAULT_LOOP_CONFIG.activityTimeoutSeconds,
      stopPattern: options.stopPattern ?? DEFAULT_LOOP_CONFIG.stopPattern,
      git: {
        branchPrefix: options.gitBranchPrefix ?? DEFAULT_LOOP_CONFIG.git.branchPrefix,
        commitPrefix: options.gitCommitPrefix ?? DEFAULT_LOOP_CONFIG.git.commitPrefix,
      },
      baseBranch: options.baseBranch,
      clearPlanningFolder: options.clearPlanningFolder ?? DEFAULT_LOOP_CONFIG.clearPlanningFolder,
      planMode: options.planMode,
      mode: options.mode ?? DEFAULT_LOOP_CONFIG.mode,
    };

    const state = createInitialState(id);
    
    // If draft mode is enabled, set status to draft (no session or git setup)
    if (options.draft) {
      assertValidTransition(state.status, "draft", "createLoop");
      state.status = "draft";
    }
    // Else if plan mode is enabled, initialize plan mode state
    else if (options.planMode) {
      assertValidTransition(state.status, "planning", "createLoop");
      state.status = "planning";
      state.planMode = {
        active: true,
        feedbackRounds: 0,
        planningFolderCleared: false,
        isPlanReady: false,
      };
    }
    
    const loop: Loop = { config, state };

    // Save to persistence
    await saveLoop(loop);

    // Emit event
    this.emitter.emit({
      type: "loop.created",
      loopId: id,
      config,
      timestamp: now,
    });

    return loop;
  }

  /**
   * Create a new interactive chat.
   *
   * A chat is a loop with `mode: "chat"` — it reuses the loop infrastructure
   * (git worktree, backend session, persistence, events) but runs single-turn
   * iterations without planning prompts or stop-pattern detection.
   *
   * The chat is started immediately (worktree + session created) and,
   * if an initial message is provided in the prompt, the first turn runs
   * automatically.
   *
   * @param options - Same options as createLoop, with chat-specific overrides applied
   * @returns The created chat (as a Loop with mode: "chat")
   */
  async createChat(options: Omit<CreateLoopOptions, "planMode" | "mode">): Promise<Loop> {
    // Create the loop with chat-specific config overrides
    const loop = await this.createLoop({
      ...options,
      mode: "chat",
      planMode: false,
      maxIterations: 1,           // Single turn per iteration
      clearPlanningFolder: false,  // No planning folder semantics for chat
    });

    // Start immediately (creates worktree + backend session)
    await this.startLoop(loop.config.id);

    // Return the updated loop (with git/session state from startLoop)
    const updatedLoop = await this.getLoop(loop.config.id);
    return updatedLoop ?? loop;
  }

  /**
   * Send a message to an interactive chat.
   *
   * Uses the injection pattern: if the AI is currently responding, the session
   * is aborted and the message is picked up in the next iteration immediately.
   * If the AI is idle (previous turn completed), a new single-turn iteration
   * is started.
   *
   * This method returns quickly without waiting for the iteration to complete,
   * same as sendPlanFeedback().
   *
   * @param loopId - The chat's loop ID
   * @param message - The user's message
   * @param model - Optional model override for this turn
   */
  async sendChatMessage(loopId: string, message: string, model?: ModelConfig): Promise<void> {
    // If engine doesn't exist, attempt to recover it from persisted state.
    // This handles the case where the server was restarted while a chat was idle.
    const engine = this.engines.get(loopId) ?? await this.recoverChatEngine(loopId);

    // Verify loop is a chat
    if (engine.config.mode !== "chat") {
      throw new Error(`Loop is not a chat (mode: ${engine.config.mode})`);
    }

    // Verify chat is in a state where messages can be sent
    const validStates = ["completed", "running", "max_iterations"];
    if (!validStates.includes(engine.state.status)) {
      throw new Error(`Cannot send chat message in status: ${engine.state.status}`);
    }

    // Inject the message (handles both running and idle cases internally).
    // This returns quickly — the iteration runs asynchronously.
    await engine.injectChatMessage(message, model);
  }

  /**
   * Start a loop in plan mode (plan creation phase).
   * Creates a worktree+branch first, then clears .planning in the worktree,
   * and starts the AI session inside the worktree.
   */
  async startPlanMode(loopId: string): Promise<void> {
    const loop = await loadLoop(loopId);
    if (!loop) {
      throw new Error(`Loop not found: ${loopId}`);
    }

    // Check if loop is in planning status
    if (loop.state.status !== "planning") {
      throw new Error(`Loop is not in planning status: ${loop.state.status}`);
    }

    // Check if already has an engine running
    if (this.engines.has(loopId)) {
      throw new Error("Loop plan mode is already running");
    }

    // No directory conflict check needed — each loop operates in its own worktree

    // Get the appropriate command executor
    const executor = await backendManager.getCommandExecutorAsync(loop.config.workspaceId, loop.config.directory);
    const git = GitService.withExecutor(executor);

    // No uncommitted-changes check needed — worktrees are isolated from the main checkout

    // Only set startedAt if not already present (e.g., during a jumpstart retry,
    // the original startedAt is preserved so branch naming remains stable/idempotent).
    if (!loop.state.startedAt) {
      loop.state.startedAt = createTimestamp();
    }
    await updateLoopState(loopId, loop.state);

    // Get a dedicated backend for this loop (each loop gets its own connection).
    // The worktree doesn't exist yet - it's created below by setupGitBranchForPlanAcceptance().
    // The backend won't connect until engine.start() -> setupSession(), by which time
    // the worktree will exist and engine.workingDirectory will return the worktree path.
    const backend = backendManager.getLoopBackend(loopId, loop.config.workspaceId);

    // Create engine first, then set up git branch before starting the engine.
    // This ensures the worktree exists before the AI session runs, so the AI
    // operates in an isolated worktree rather than the main checkout directory.
    const engine = new LoopEngine({
      loop,
      backend,
      gitService: git,
      eventEmitter: this.emitter,
      onPersistState: async (state) => {
        await updateLoopState(loopId, state);
      },
    });

    // Create worktree+branch before starting the engine.
    // This is the key change: plan mode now gets its own worktree from the start,
    // so multiple loops can be in plan mode simultaneously without conflicts.
    try {
      await engine.setupGitBranchForPlanAcceptance();
    } catch (error) {
      throw new Error(`Failed to set up git branch for plan mode: ${String(error)}`, { cause: error });
    }

    // Now that the worktree exists, use the worktree path for .planning operations
    const worktreePath = engine.workingDirectory;

    // Clear planning files in the worktree before starting
    await this.clearPlanningFiles(loopId, loop, executor, worktreePath);

    this.engines.set(loopId, engine);

    // Persist state changes periodically
    this.startStatePersistence(loopId);

    // Start the plan creation (fire and forget - don't block the caller)
    // The loop runs asynchronously and updates state via events/persistence
    engine.start().catch((error) => {
      log.error(`Loop ${loopId} plan mode failed:`, String(error));
    });
  }

  /**
   * Start a draft loop — transitions from draft to either plan mode or immediate execution.
   *
   * Handles the draft → planning and draft → idle → starting transitions internally,
   * including state mutation and persistence, so the API layer doesn't need to
   * interact with the persistence layer directly.
   *
   * @param loopId - The ID of the draft loop to start
   * @param options - Start options
   * @param options.planMode - If true, start in plan mode; if false, start immediately
   * @returns The updated loop
   */
  async startDraft(loopId: string, options: { planMode: boolean }): Promise<Loop> {
    const loop = await loadLoop(loopId);
    if (!loop) {
      throw new Error(`Loop not found: ${loopId}`);
    }

    if (loop.state.status !== "draft") {
      throw new Error(`Loop is not in draft status: ${loop.state.status}`);
    }

    if (options.planMode) {
      // draft → planning
      assertValidTransition(loop.state.status, "planning", "startDraft");
      loop.state.status = "planning";
      loop.state.planMode = {
        active: true,
        feedbackRounds: 0,
        planningFolderCleared: false,
        isPlanReady: false,
      };
      await updateLoopState(loopId, loop.state);

      // Start plan mode — handles git setup and further state updates
      await this.startPlanMode(loopId);
    } else {
      // draft → idle (engine will then transition idle → starting → running)
      assertValidTransition(loop.state.status, "idle", "startDraft");
      loop.state.status = "idle";
      await updateLoopState(loopId, loop.state);

      // Start the loop immediately
      await this.startLoop(loopId);
    }

    // Return updated loop
    const updatedLoop = await this.getLoop(loopId);
    return updatedLoop ?? loop;
  }

  /**
   * Send feedback on a plan to refine it.
   * 
   * Uses the injection pattern: if the AI is currently generating, the session
   * is aborted and the feedback is picked up in the next iteration immediately.
   * If the AI is idle (plan was ready), a new plan iteration is started.
   * 
   * This method returns quickly without waiting for the iteration to complete,
   * similar to how injectPending() works for execution mode.
   */
  async sendPlanFeedback(loopId: string, feedback: string): Promise<void> {
    // If engine doesn't exist, attempt to recover it from persisted state.
    // This handles the case where the server was restarted while a loop was in planning mode.
    const engine = this.engines.get(loopId) ?? await this.recoverPlanningEngine(loopId);

    // Verify loop is in planning status
    if (engine.state.status !== "planning") {
      throw new Error(`Loop is not in planning status: ${engine.state.status}`);
    }

    // Increment feedback rounds and reset isPlanReady
    if (engine.state.planMode) {
      engine.state.planMode.feedbackRounds += 1;
      engine.state.planMode.isPlanReady = false;
    }

    // Persist state update
    await updateLoopState(loopId, engine.state);

    // Emit feedback event
    this.emitter.emit({
      type: "loop.plan.feedback",
      loopId,
      round: engine.state.planMode?.feedbackRounds ?? 0,
      timestamp: createTimestamp(),
    });

    // Inject feedback: abort current processing or start new iteration.
    // This returns quickly — the iteration runs asynchronously.
    await engine.injectPlanFeedback(feedback);
  }

  /**
   * Accept a plan and transition to execution mode.
   * Reuses the same session from plan creation.
   */
  async acceptPlan(loopId: string): Promise<void> {
    // If engine doesn't exist, attempt to recover it from persisted state.
    // This handles the case where the server was restarted while a loop was in planning mode.
    const engine = this.engines.get(loopId) ?? await this.recoverPlanningEngine(loopId);

    // Verify loop is in planning status
    if (engine.state.status !== "planning") {
      throw new Error(`Loop is not in planning status: ${engine.state.status}`);
    }

    // Verify plan is ready
    if (!engine.state.planMode?.isPlanReady) {
      throw new Error("Plan is not ready yet. Wait for the AI to finish generating the plan.");
    }

    // Wait for any ongoing planning iteration to complete before proceeding.
    // This prevents race conditions where we modify state while the iteration is still running.
    await engine.waitForLoopIdle();

    // Store the plan session info before transitioning
    const planSessionId = engine.state.session?.id;
    const planServerUrl = engine.state.session?.serverUrl;

    // Git branch and worktree already exist from startPlanMode() — no setup needed here.

    // Update state to transition from planning to running
    // Mark plan mode as no longer active but preserve all existing planMode fields
    // (especially isPlanReady and planContent which may have been set by the planning iteration)
    assertValidTransition(engine.state.status, "running", "acceptPlan");
    const updatedState: Partial<LoopState> = {
      status: "running",
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

    // Send the "start execution" prompt to the existing session
    const executionPrompt = `The plan has been accepted. Now execute all tasks in the plan.

Follow the standard loop execution flow:
- Read AGENTS.md and the plan in .planning/plan.md
- Pick up the most important task to continue with
- **IMPORTANT — Incremental progress tracking**: After completing each individual task, immediately update .planning/status.md to mark it as completed and note any relevant findings. Do not wait until the end — update after every task so progress is preserved if the iteration is interrupted.
- **IMPORTANT — Pre-compaction persistence**: Before ending your response, you MUST also update .planning/status.md with the current task and its state, updated status of all tasks, any new learnings or discoveries, and what the next steps should be. This ensures progress is preserved even if the conversation context is compacted or summarized between iterations.
- If you complete all tasks in the plan, end your response with:

<promise>COMPLETE</promise>`;

    engine.setPendingPrompt(executionPrompt);

    // Emit plan accepted event
    this.emitter.emit({
      type: "loop.plan.accepted",
      loopId,
      timestamp: createTimestamp(),
    });

    // Emit loop started event
    this.emitter.emit({
      type: "loop.started",
      loopId,
      iteration: 0,
      timestamp: createTimestamp(),
    });

    // Start the execution loop (fire-and-forget, same pattern as engine.start()).
    // This is a long-running process that runs AI iterations for minutes to hours.
    // The engine has its own error handling via handleError() and emits error events.
    // We must not await here — doing so would block the API response indefinitely,
    // preventing the frontend from transitioning to the execution view.
    engine.continueExecution().catch((error) => {
      log.error(`Loop ${loopId} execution after plan acceptance failed:`, String(error));
    });
  }

  /**
   * Discard a plan and delete the loop.
   */
  async discardPlan(loopId: string): Promise<boolean> {
    log.debug(`[LoopManager] discardPlan: Starting for loop ${loopId}, engine exists: ${this.engines.has(loopId)}`);
    
    // Stop the engine if running
    if (this.engines.has(loopId)) {
      log.debug(`[LoopManager] discardPlan: Stopping engine for loop ${loopId}`);
      await this.stopLoop(loopId, "Plan discarded");
      log.debug(`[LoopManager] discardPlan: Engine stopped for loop ${loopId}`);
    }

    // Emit plan discarded event
    this.emitter.emit({
      type: "loop.plan.discarded",
      loopId,
      timestamp: createTimestamp(),
    });

    // Delete the loop (explicit await to ensure completion before returning)
    log.debug(`[LoopManager] discardPlan: Calling deleteLoop for ${loopId}`);
    const result = await this.deleteLoop(loopId);
    log.debug(`[LoopManager] discardPlan: deleteLoop returned ${result} for ${loopId}`);
    return result;
  }

  /**
   * Get a loop by ID.
   */
  async getLoop(loopId: string): Promise<Loop | null> {
    // Check if engine exists (running loop)
    const engine = this.engines.get(loopId);
    if (engine) {
      return { config: engine.config, state: engine.state };
    }

    // Load from persistence
    return loadLoop(loopId);
  }

  /**
   * List all loops.
   */
  async getAllLoops(): Promise<Loop[]> {
    const loops = await listLoops();

    // Update with in-memory state for running loops
    return loops.map((loop) => {
      const engine = this.engines.get(loop.config.id);
      if (engine) {
        return { config: engine.config, state: engine.state };
      }
      return loop;
    });
  }

  /**
   * Update a loop's configuration.
   */
  async updateLoop(
    loopId: string,
    updates: Partial<Omit<LoopConfig, "id" | "createdAt">>
  ): Promise<Loop | null> {
    // Debug logging for loop updates
    log.debug("updateLoop - Input", {
      loopId,
      hasPromptUpdate: updates.prompt !== undefined,
      promptLength: updates.prompt?.length,
      promptPreview: updates.prompt?.slice(0, 50),
    });

    const loop = await loadLoop(loopId);
    if (!loop) {
      return null;
    }

    // Don't allow updates to running loops
    // Check actual engine status, not just existence in map (engine may still be in map after completion)
    const engine = this.engines.get(loopId);
    if (engine) {
      const status = engine.state.status;
      if (status === "running" || status === "starting") {
        throw new Error("Cannot update a running loop. Stop it first.");
      }
    }

    const pendingGitState = this.engines.get(loopId)?.state.git;
    if (updates.baseBranch !== undefined && (loop.state.git?.originalBranch || pendingGitState?.originalBranch)) {
      log.warn(`Rejected baseBranch update for loop ${loopId} after git setup`);
      const error = new Error("Base branch cannot be updated after git setup.") as Error & {
        code: string;
        status: number;
      };
      error.code = "BASE_BRANCH_IMMUTABLE";
      error.status = 409;
      throw error;
    }

    if (updates.baseBranch !== undefined && loop.state.status === "draft") {
      log.info(`Updating baseBranch for draft loop ${loopId}`);
    }

    // Apply updates
    const updatedConfig: LoopConfig = {
      ...loop.config,
      ...updates,
      updatedAt: createTimestamp(),
    };

    const updatedLoop: Loop = { config: updatedConfig, state: loop.state };
    await saveLoop(updatedLoop);

    return updatedLoop;
  }

  /**
   * Delete a loop (soft delete - marks as deleted, doesn't remove files).
   * If git is enabled and there's a working branch, discards it first.
   * Use purgeLoop() to actually delete the files.
   */
  async deleteLoop(loopId: string): Promise<boolean> {
    log.debug(`[LoopManager] deleteLoop: Starting for loop ${loopId}, engine exists: ${this.engines.has(loopId)}`);
    
    // Stop if running
    if (this.engines.has(loopId)) {
      log.debug(`[LoopManager] deleteLoop: Stopping engine for loop ${loopId}`);
      await this.stopLoop(loopId, "Loop deleted");
    }

    // Get loop to check for git branch
    const loop = await loadLoop(loopId);
    if (!loop) {
      log.debug(`[LoopManager] deleteLoop: Loop ${loopId} not found`);
      return false;
    }
    log.debug(`[LoopManager] deleteLoop: Loaded loop ${loopId}, status: ${loop.state.status}, hasGitBranch: ${!!loop.state.git?.workingBranch}`);
    
    // If there's a working branch, discard it first
    if (loop.state.git?.workingBranch) {
      log.debug(`[LoopManager] deleteLoop: Discarding git branch for loop ${loopId}`);
      const discardResult = await this.discardLoop(loopId);
      if (!discardResult.success) {
        // Log but don't fail the delete - user explicitly wants to delete
        log.warn(`Failed to discard git branch during delete: ${discardResult.error}`);
      }
    }

    // Update status to 'deleted' (soft delete - final state)
    // Also clear reviewMode.addressable so the loop cannot be addressed again
    log.debug(`[LoopManager] deleteLoop: Updating status to deleted for loop ${loopId}`);
    assertValidTransition(loop.state.status, "deleted", "deleteLoop");
    const updatedState = {
      ...loop.state,
      status: "deleted" as const,
      reviewMode: loop.state.reviewMode
        ? { ...loop.state.reviewMode, addressable: false }
        : undefined,
    };
    await updateLoopState(loopId, updatedState);
    log.debug(`[LoopManager] deleteLoop: Status updated to deleted for loop ${loopId}`);

    this.emitter.emit({
      type: "loop.deleted",
      loopId,
      timestamp: createTimestamp(),
    });

    return true;
  }

  /**
   * Start a loop.
   * Each loop operates in its own git worktree, so no uncommitted-changes
   * checks are needed on the main repository checkout.
   */
  async startLoop(loopId: string, _options?: StartLoopOptions): Promise<void> {
    const loop = await loadLoop(loopId);
    if (!loop) {
      throw new Error(`Loop not found: ${loopId}`);
    }

    // Check if already running
    if (this.engines.has(loopId)) {
      throw new Error("Loop is already running");
    }

    // No directory conflict check needed — each loop operates in its own worktree

    // Get the appropriate command executor for the current mode
    // (local for spawn mode, remote for connect mode)
    // Use async version to ensure connection is established in connect mode
    const executor = await backendManager.getCommandExecutorAsync(loop.config.workspaceId, loop.config.directory);
    const git = GitService.withExecutor(executor);

    // No uncommitted-changes check needed — worktrees are isolated from the main checkout

    // Get a dedicated backend for this loop (each loop gets its own connection).
    // The worktree doesn't exist yet - it's created by engine.start() -> setupGitBranch().
    // The backend connects after the worktree is set up, using engine.workingDirectory.
    const backend = backendManager.getLoopBackend(loopId, loop.config.workspaceId);

    // Create engine with persistence callback
    // Pass the git service with the appropriate executor
    const engine = new LoopEngine({
      loop,
      backend,
      gitService: git,
      eventEmitter: this.emitter,
      onPersistState: async (state) => {
        await updateLoopState(loopId, state);
      },
    });

    this.engines.set(loopId, engine);

    // Persist state changes periodically
    this.startStatePersistence(loopId);

    // Start the loop (fire and forget - don't block the caller)
    // The loop runs asynchronously and updates state via events/persistence
    engine.start().catch((error) => {
      log.error(`Loop ${loopId} failed to start:`, String(error));
      // Engine handles its own error state via handleError()
    });
  }

  /**
   * Stop a running loop.
   */
  async stopLoop(loopId: string, reason = "User requested stop"): Promise<void> {
    const engine = this.engines.get(loopId);
    if (!engine) {
      throw new Error("Loop is not running");
    }

    await engine.stop(reason);
    this.engines.delete(loopId);

    // Clean up the dedicated backend connection for this loop
    await backendManager.disconnectLoop(loopId);

    // Clear sync state if the loop was resolving conflicts
    if (engine.state.syncState?.autoPushOnComplete) {
      engine.state.syncState.autoPushOnComplete = false;
    }

    // Persist final state
    await updateLoopState(loopId, engine.state);
  }

  /**
   * Accept a completed loop (merge git branch).
   * After merging, the loop status is set to 'merged' (final state).
   */
  async acceptLoop(loopId: string): Promise<AcceptLoopResult> {
    // Guard against concurrent accept operations on the same loop
    if (this.loopsBeingAccepted.has(loopId)) {
      log.warn(`[LoopManager] acceptLoop: Already accepting loop ${loopId}, ignoring duplicate call`);
      return { success: false, error: "Accept operation already in progress" };
    }

    // Use getLoop to check engine state first
    const loop = await this.getLoop(loopId);
    if (!loop) {
      return { success: false, error: "Loop not found" };
    }

    // Must be completed or max_iterations - failed loops should be reviewed manually
    if (loop.state.status !== "completed" && loop.state.status !== "max_iterations") {
      return { success: false, error: `Cannot accept loop in status: ${loop.state.status}` };
    }

    // Must have git state (branch was created)
    if (!loop.state.git) {
      return { success: false, error: "No git branch was created for this loop" };
    }

    // Prevent switching completion action on review cycles
    // If the loop was originally pushed, it must continue to be pushed
    if (loop.state.reviewMode?.completionAction && 
        loop.state.reviewMode.completionAction !== "merge") {
      return { 
        success: false, 
        error: "This loop was originally pushed. Use push to finalize review cycles." 
      };
    }

    // Mark as being accepted
    this.loopsBeingAccepted.add(loopId);
    log.debug(`[LoopManager] acceptLoop: Starting accept for loop ${loopId}`);

    try {
      // Get the appropriate command executor for the current mode
      const executor = await backendManager.getCommandExecutorAsync(loop.config.workspaceId, loop.config.directory);
      const git = GitService.withExecutor(executor);

      // Merge working branch into original branch
      const mergeCommit = await git.mergeBranch(
        loop.config.directory,
        loop.state.git.workingBranch,
        loop.state.git.originalBranch
      );

      // DON'T delete the working branch - keep it for potential review cycles
      // The branch will be cleaned up when purging or when creating new review branches

      // Initialize or preserve review mode state
      const reviewMode = loop.state.reviewMode
        ? {
            // Preserve existing review mode, just update addressable and completionAction
            ...loop.state.reviewMode,
            addressable: true,
            completionAction: "merge" as const,
          }
        : {
            // First time accepting - initialize review mode
            addressable: true,
            completionAction: "merge" as const,
            reviewCycles: 0,
            reviewBranches: [loop.state.git.workingBranch],
          };

      // Update status to 'merged' with review mode enabled
      assertValidTransition(loop.state.status, "merged", "acceptLoop");
      const updatedState = {
        ...loop.state,
        status: "merged" as const,
        reviewMode,
      };
      await updateLoopState(loopId, updatedState);

      // Clean up the dedicated backend connection for this loop
      await backendManager.disconnectLoop(loopId);

      // Remove engine from in-memory map so getLoop returns persisted state
      this.engines.delete(loopId);

      // Emit event
      this.emitter.emit({
        type: "loop.accepted",
        loopId,
        mergeCommit,
        timestamp: createTimestamp(),
      });

      return { success: true, mergeCommit };
    } catch (error) {
      return { success: false, error: String(error) };
    } finally {
      // Always clear the guard
      this.loopsBeingAccepted.delete(loopId);
      log.debug(`[LoopManager] acceptLoop: Finished accept for loop ${loopId}`);
    }
  }

  /**
   * Push a completed loop's branch to the remote.
   * Before pushing, syncs with the base branch by fetching and merging.
   * If the merge is clean, pushes immediately.
   * If there are conflicts, restarts the loop engine to resolve them, then auto-pushes on completion.
   * After pushing, the loop status is set to 'pushed' (final state).
   * The branch is NOT merged locally - it's pushed as-is for PR creation.
   */
  async pushLoop(loopId: string): Promise<PushLoopResult> {
    // Guard against concurrent accept/push operations on the same loop
    if (this.loopsBeingAccepted.has(loopId)) {
      log.warn(`[LoopManager] pushLoop: Already processing loop ${loopId}, ignoring duplicate call`);
      return { success: false, error: "Operation already in progress" };
    }

    // Use getLoop to check engine state first
    const loop = await this.getLoop(loopId);
    if (!loop) {
      return { success: false, error: "Loop not found" };
    }

    // Must be completed or similar terminal states
    if (loop.state.status !== "completed" && loop.state.status !== "max_iterations") {
      return { success: false, error: `Cannot push loop in status: ${loop.state.status}` };
    }

    // Must have git state (branch was created)
    if (!loop.state.git) {
      return { success: false, error: "No git branch was created for this loop" };
    }

    // Prevent switching completion action on review cycles
    // If the loop was originally merged, it must continue to be merged
    if (loop.state.reviewMode?.completionAction && 
        loop.state.reviewMode.completionAction !== "push") {
      return { 
        success: false, 
        error: "This loop was originally merged. Use merge to finalize review cycles." 
      };
    }

    // Mark as being processed
    this.loopsBeingAccepted.add(loopId);
    log.debug(`[LoopManager] pushLoop: Starting push for loop ${loopId}`);

    try {
      // Get the appropriate command executor for the current mode
      const executor = await backendManager.getCommandExecutorAsync(loop.config.workspaceId, loop.config.directory);
      const git = GitService.withExecutor(executor);

      // Determine the base branch to sync with
      const baseBranch = loop.config.baseBranch ?? loop.state.git.originalBranch;
      const worktreePath = loop.state.git.worktreePath ?? loop.config.directory;
      const workingBranch = loop.state.git.workingBranch;

      // --- Ensure merge strategy is configured ---
      await git.ensureMergeStrategy(worktreePath);

      // --- Working branch sync ---
      const workingBranchConflictResult = await this.syncWorkingBranch(
        loopId, loop, git, baseBranch, worktreePath, workingBranch, "pushLoop"
      );
      if (workingBranchConflictResult) {
        return workingBranchConflictResult;
      }

      // --- Base branch sync + push ---
      return await this.syncBaseBranchAndPush(loopId, loop, git);
    } catch (error) {
      return { success: false, error: String(error) };
    } finally {
      // Always clear the guard
      this.loopsBeingAccepted.delete(loopId);
      log.debug(`[LoopManager] pushLoop: Finished push for loop ${loopId}`);
    }
  }

  /**
   * Update a pushed loop's branch by syncing with the base branch and re-pushing.
   * This pulls and merges from the base branch into the working branch (same logic
   * used before pushing), pushes if clean, or triggers conflict resolution if needed.
   * After a successful update, the loop remains in 'pushed' status.
   *
   * Reuses the same sync infrastructure as pushLoop():
   * - syncWorkingBranch() to pull remote changes on the working branch
   * - syncBaseBranchAndPush() to merge base branch changes and push
   * - startConflictResolutionEngine() for conflict resolution (if needed)
   */
  async updateBranch(loopId: string): Promise<PushLoopResult> {
    // Guard against concurrent accept/push operations on the same loop.
    // Must be set synchronously (before any await) to prevent race conditions.
    if (this.loopsBeingAccepted.has(loopId)) {
      log.warn(`[LoopManager] updateBranch: Already processing loop ${loopId}, ignoring duplicate call`);
      return { success: false, error: "Operation already in progress" };
    }
    this.loopsBeingAccepted.add(loopId);
    log.debug(`[LoopManager] updateBranch: Starting branch update for loop ${loopId}`);

    try {
      const loop = await this.getLoop(loopId);
      if (!loop) {
        return { success: false, error: "Loop not found" };
      }

      // Must be in pushed status
      if (loop.state.status !== "pushed") {
        return { success: false, error: `Cannot update branch for loop in status: ${loop.state.status}` };
      }

      // Must have git state (branch was created and pushed)
      if (!loop.state.git) {
        return { success: false, error: "No git branch was created for this loop" };
      }

      // Prevent update while an engine is already running (e.g., conflict resolution)
      if (this.engines.has(loopId)) {
        return { success: false, error: "Loop already has an active engine running" };
      }

      // Get the appropriate command executor for the current mode
      const executor = await backendManager.getCommandExecutorAsync(loop.config.workspaceId, loop.config.directory);
      const git = GitService.withExecutor(executor);

      // Determine the base branch to sync with
      const baseBranch = loop.config.baseBranch ?? loop.state.git.originalBranch;
      const worktreePath = loop.state.git.worktreePath ?? loop.config.directory;
      const workingBranch = loop.state.git.workingBranch;

      // --- Ensure merge strategy is configured ---
      await git.ensureMergeStrategy(worktreePath);

      // --- Working branch sync ---
      const workingBranchConflictResult = await this.syncWorkingBranch(
        loopId, loop, git, baseBranch, worktreePath, workingBranch, "updateBranch"
      );
      if (workingBranchConflictResult) {
        return workingBranchConflictResult;
      }

      // --- Base branch sync + push ---
      return await this.syncBaseBranchAndPush(loopId, loop, git);
    } catch (error) {
      return { success: false, error: String(error) };
    } finally {
      // Always clear the guard
      this.loopsBeingAccepted.delete(loopId);
      log.debug(`[LoopManager] updateBranch: Finished branch update for loop ${loopId}`);
    }
  }

  /**
   * Sync the working branch with its remote counterpart.
   * Before syncing with the base branch, pulls any remote changes on the
   * working branch itself. This handles scenarios where the working branch
   * was previously pushed and someone (or another process) added commits to it.
   *
   * @returns PushLoopResult if conflicts/error occurred (caller should return it),
   *          or null if sync succeeded and caller should proceed to base branch sync.
   */
  private async syncWorkingBranch(
    loopId: string,
    loop: { config: LoopConfig; state: LoopState },
    git: GitService,
    baseBranch: string,
    worktreePath: string,
    workingBranch: string,
    caller: string
  ): Promise<PushLoopResult | null> {
    log.debug(`[LoopManager] ${caller}: Fetching origin/${workingBranch} for loop ${loopId}`);
    const fetchSuccess = await git.fetchBranch(loop.config.directory, workingBranch);

    if (!fetchSuccess) {
      // Fetch failed (branch doesn't exist on remote yet) — skip, this is a first push
      return null;
    }

    // Check if the working branch on remote has new commits
    const upToDate = await git.isAncestor(
      worktreePath,
      `origin/${workingBranch}`,
      "HEAD"
    );

    if (upToDate) {
      return null;
    }

    // Remote working branch has diverged — attempt to merge
    log.debug(`[LoopManager] ${caller}: Merging origin/${workingBranch} into local working branch for loop ${loopId}`);
    const mergeResult = await git.mergeWithConflictDetection(
      worktreePath,
      `origin/${workingBranch}`,
      `Merge origin/${workingBranch} into ${workingBranch}`
    );

    if (mergeResult.success) {
      log.debug(`[LoopManager] ${caller}: Clean merge with origin/${workingBranch}`);
      return null;
    }

    if (mergeResult.hasConflicts) {
      // Conflicts on working branch — start conflict resolution
      const conflictedFiles = mergeResult.conflictedFiles ?? [];
      log.debug(`[LoopManager] ${caller}: Working branch merge conflicts detected: ${conflictedFiles.join(", ")}`);

      await git.abortMerge(worktreePath);

      this.emitter.emit({
        type: "loop.sync.conflicts",
        loopId,
        baseBranch,
        conflictedFiles,
        timestamp: createTimestamp(),
      });

      // Set sync state with syncPhase "working_branch" so that after resolution,
      // we continue with base branch sync before pushing
      loop.state.syncState = {
        status: "conflicts",
        baseBranch,
        autoPushOnComplete: true,
        syncPhase: "working_branch",
      };
      assertValidTransition(loop.state.status, "resolving_conflicts", caller);
      loop.state.status = "resolving_conflicts";
      loop.state.completedAt = undefined;
      await updateLoopState(loopId, loop.state);

      return this.startConflictResolutionEngine(
        loopId, loop, git, `origin/${workingBranch}`, conflictedFiles
      );
    }

    // Non-conflict merge failure
    const errorMsg = mergeResult.stderr || "Unknown merge error";
    log.error(`[LoopManager] ${caller}: Working branch merge failed for loop ${loopId}: ${errorMsg}`);
    return {
      success: false,
      error: `Failed to merge origin/${workingBranch}: ${errorMsg}`,
    };
  }

  /**
   * Sync with the base branch and push the working branch.
   * Extracted as a separate method so it can be called both from pushLoop()
   * and from handleConflictResolutionComplete() after working branch conflicts are resolved.
   */
  private async syncBaseBranchAndPush(
    loopId: string,
    loop: { config: LoopConfig; state: LoopState },
    git: GitService
  ): Promise<PushLoopResult> {
    const baseBranch = loop.config.baseBranch ?? loop.state.git!.originalBranch;
    const worktreePath = loop.state.git!.worktreePath ?? loop.config.directory;

    // Emit sync started event
    this.emitter.emit({
      type: "loop.sync.started",
      loopId,
      baseBranch,
      timestamp: createTimestamp(),
    });

    // Fetch the latest base branch from origin (fetch from main repo dir,
    // since worktrees share the same .git object store)
    log.debug(`[LoopManager] syncBaseBranchAndPush: Fetching origin/${baseBranch} for loop ${loopId}`);
    const fetchSuccess = await git.fetchBranch(loop.config.directory, baseBranch);

    // If fetch failed (no remote, or branch doesn't exist on remote),
    // skip sync — there's nothing to merge with. Treat as "already up to date".
    let alreadyUpToDate: boolean;
    if (!fetchSuccess) {
      log.debug(`[LoopManager] syncBaseBranchAndPush: Could not fetch origin/${baseBranch}, skipping sync`);
      alreadyUpToDate = true;
    } else {
      // Check if sync is needed: is origin/<baseBranch> already an ancestor of HEAD?
      alreadyUpToDate = await git.isAncestor(
        worktreePath,
        `origin/${baseBranch}`,
        "HEAD"
      );
    }

    let syncStatus: "already_up_to_date" | "clean" | "conflicts_being_resolved";

    if (alreadyUpToDate) {
      // No merge needed — base branch hasn't diverged
      log.debug(`[LoopManager] syncBaseBranchAndPush: Already up to date with origin/${baseBranch}`);
      syncStatus = "already_up_to_date";

      this.emitter.emit({
        type: "loop.sync.clean",
        loopId,
        baseBranch,
        timestamp: createTimestamp(),
      });
    } else {
      // Attempt to merge origin/<baseBranch> into the working branch (in worktree)
      log.debug(`[LoopManager] syncBaseBranchAndPush: Merging origin/${baseBranch} into working branch for loop ${loopId}`);
      const mergeResult = await git.mergeWithConflictDetection(
        worktreePath,
        `origin/${baseBranch}`,
        `Merge origin/${baseBranch} into ${loop.state.git!.workingBranch}`
      );

      if (mergeResult.success) {
        // Clean merge — proceed to push
        log.debug(`[LoopManager] syncBaseBranchAndPush: Clean merge with origin/${baseBranch}`);
        syncStatus = "clean";

        this.emitter.emit({
          type: "loop.sync.clean",
          loopId,
          baseBranch,
          timestamp: createTimestamp(),
        });
      } else if (mergeResult.hasConflicts) {
        // Conflicts detected — abort merge, restart engine to resolve
        const conflictedFiles = mergeResult.conflictedFiles ?? [];
        log.debug(`[LoopManager] syncBaseBranchAndPush: Merge conflicts detected with origin/${baseBranch}: ${conflictedFiles.join(", ")}`);

        // Abort the failed merge attempt
        await git.abortMerge(worktreePath);

        // Emit conflicts event
        this.emitter.emit({
          type: "loop.sync.conflicts",
          loopId,
          baseBranch,
          conflictedFiles,
          timestamp: createTimestamp(),
        });

        // Set sync state and update loop status to "resolving_conflicts"
        loop.state.syncState = {
          status: "conflicts",
          baseBranch,
          autoPushOnComplete: true,
          syncPhase: "base_branch",
        };
        assertValidTransition(loop.state.status, "resolving_conflicts", "syncBaseBranchAndPush");
        loop.state.status = "resolving_conflicts";
        loop.state.completedAt = undefined;
        await updateLoopState(loopId, loop.state);

        return this.startConflictResolutionEngine(
          loopId, loop, git, `origin/${baseBranch}`, conflictedFiles
        );
      } else {
        // Non-conflict merge failure (e.g., missing ref, invalid branch)
        // Don't try to abort merge or start conflict resolution
        const errorMsg = mergeResult.stderr || "Unknown merge error";
        log.error(`[LoopManager] syncBaseBranchAndPush: Merge failed (not conflicts) for loop ${loopId}: ${errorMsg}`);
        return {
          success: false,
          error: `Failed to merge origin/${baseBranch}: ${errorMsg}`,
        };
      }
    }

    // --- Push (clean merge or already up to date) ---
    const remoteBranch = await this.pushAndFinalize(
      loopId, loop, git, "syncBaseBranchAndPush"
    );

    return { success: true, remoteBranch, syncStatus };
  }

  /**
   * Push the working branch to remote and finalize the loop as "pushed".
   * Shared by syncBaseBranchAndPush (after clean merge) and
   * handleConflictResolutionComplete (after conflict resolution).
   *
   * @param loopId - The loop ID
   * @param loop - The loop config and state
   * @param git - The GitService instance
   * @param caller - Name of the calling method (for assertValidTransition context)
   * @returns The remote branch name
   */
  private async pushAndFinalize(
    loopId: string,
    loop: { config: LoopConfig; state: LoopState },
    git: GitService,
    caller: string
  ): Promise<string> {
    // Push the working branch to remote
    const remoteBranch = await git.pushBranch(
      loop.config.directory,
      loop.state.git!.workingBranch
    );

    // Initialize or preserve review mode state
    const reviewMode = loop.state.reviewMode
      ? {
          ...loop.state.reviewMode,
          addressable: true,
          completionAction: "push" as const,
        }
      : {
          addressable: true,
          completionAction: "push" as const,
          reviewCycles: 0,
          reviewBranches: [loop.state.git!.workingBranch],
        };

    // Update status to 'pushed', clear syncState
    assertValidTransition(loop.state.status, "pushed", caller);
    const updatedState = {
      ...loop.state,
      status: "pushed" as const,
      reviewMode,
      syncState: undefined,
    };
    await updateLoopState(loopId, updatedState);

    // Clean up the dedicated backend connection for this loop
    await backendManager.disconnectLoop(loopId);

    // Remove engine from in-memory map so getLoop returns persisted state
    this.engines.delete(loopId);

    // Emit event
    this.emitter.emit({
      type: "loop.pushed",
      loopId,
      remoteBranch,
      timestamp: createTimestamp(),
    });

    return remoteBranch;
  }

  /**
   * Start a conflict resolution engine for resolving merge conflicts.
   * Used by both working branch sync and base branch sync.
   * 
   * @param loopId - The loop ID
   * @param loop - The loop config and state
   * @param git - The GitService instance
   * @param sourceBranch - The full ref being merged (e.g., "origin/main" or "origin/ralph/loop-id")
   * @param conflictedFiles - List of files with conflicts
   * @returns PushLoopResult indicating conflicts are being resolved
   */
  private startConflictResolutionEngine(
    loopId: string,
    loop: { config: LoopConfig; state: LoopState },
    git: GitService,
    sourceBranch: string,
    conflictedFiles: string[]
  ): PushLoopResult {
    // Get a dedicated backend for this loop's conflict resolution
    const backend = backendManager.getLoopBackend(loopId, loop.config.workspaceId);

    // Construct the conflict resolution prompt
    const conflictPrompt = this.constructConflictResolutionPrompt(
      sourceBranch,
      conflictedFiles
    );

    // Create and start a new loop engine with the conflict resolution prompt
    // skipGitSetup: true because the worktree already exists
    const engine = new LoopEngine({
      loop: { config: loop.config, state: loop.state },
      backend,
      gitService: git,
      eventEmitter: this.emitter,
      onPersistState: async (state) => {
        await updateLoopState(loopId, state);
        // Auto-push when conflict resolution completes successfully
        if (state.status === "completed" && state.syncState?.autoPushOnComplete) {
          this.handleConflictResolutionComplete(loopId).catch((error) => {
            log.error(`[LoopManager] Auto-push after conflict resolution failed for loop ${loopId}:`, String(error));
          });
        }
        // Clear autoPushOnComplete on failure so we don't retry
        if ((state.status === "failed" || state.status === "max_iterations") && state.syncState?.autoPushOnComplete) {
          state.syncState.autoPushOnComplete = false;
          await updateLoopState(loopId, state);
        }
      },
      skipGitSetup: true,
    });
    this.engines.set(loopId, engine);

    // Set the conflict resolution prompt as pending
    engine.setPendingPrompt(conflictPrompt);

    // Start state persistence
    this.startStatePersistence(loopId);

    // Start execution (fire and forget — the loop runs asynchronously)
    // This is acceptable as a fire-and-forget because the conflict resolution engine
    // is a long-running process that reports progress through events and state persistence.
    // Error handling is self-contained via onPersistState callbacks.
    engine.start().catch((error) => {
      log.error(`Loop ${loopId} failed to start for conflict resolution:`, String(error));
    });

    return {
      success: true,
      syncStatus: "conflicts_being_resolved",
    };
  }

  /**
   * Handle auto-push after conflict resolution completes successfully.
   * Called from the onPersistState callback when the conflict resolution engine
   * reaches "completed" status with autoPushOnComplete set.
   * 
   * If the resolved conflicts were from the working branch (syncPhase === "working_branch"),
   * continues with base branch sync before pushing. If from the base branch, pushes directly.
   */
  private async handleConflictResolutionComplete(loopId: string): Promise<void> {
    log.debug(`[LoopManager] handleConflictResolutionComplete: Processing loop ${loopId}`);

    // Remove engine from in-memory map FIRST to prevent the periodic
    // startStatePersistence interval from overwriting our "pushed" state
    // with the engine's "completed" state (race condition).
    this.engines.delete(loopId);

    const loop = await this.getLoop(loopId);
    if (!loop) {
      log.error(`[LoopManager] handleConflictResolutionComplete: Loop ${loopId} not found`);
      return;
    }

    if (!loop.state.git) {
      log.error(`[LoopManager] handleConflictResolutionComplete: No git state for loop ${loopId}`);
      return;
    }

    try {
      const executor = await backendManager.getCommandExecutorAsync(loop.config.workspaceId, loop.config.directory);
      const git = GitService.withExecutor(executor);

      // Check if we just resolved working branch conflicts — if so, continue with base branch sync
      if (loop.state.syncState?.syncPhase === "working_branch") {
        log.debug(`[LoopManager] handleConflictResolutionComplete: Working branch conflicts resolved, continuing with base branch sync for loop ${loopId}`);

        // Transition syncPhase to "base_branch" instead of clearing syncState.
        // This ensures the catch block can still access syncState if syncBaseBranchAndPush() throws
        // (e.g., pushBranch() failure). syncState is cleared on success paths below.
        loop.state.syncState.syncPhase = "base_branch";
        await updateLoopState(loopId, loop.state);

        // Continue with base branch sync + push
        const result = await this.syncBaseBranchAndPush(loopId, loop, git);
        if (!result.success && result.error) {
          log.error(`[LoopManager] handleConflictResolutionComplete: Base branch sync failed for loop ${loopId}: ${result.error}`);
        } else if (result.syncStatus === "conflicts_being_resolved") {
          // Base branch also has conflicts — a new conflict resolution engine has been started
          log.debug(`[LoopManager] handleConflictResolutionComplete: Base branch also has conflicts for loop ${loopId}, new resolution started`);
        } else {
          log.info(`[LoopManager] handleConflictResolutionComplete: Successfully synced and pushed loop ${loopId} to ${result.remoteBranch}`);
        }
        return;
      }

      // Base branch conflicts resolved (or no syncPhase set) — push directly
      log.debug(`[LoopManager] handleConflictResolutionComplete: Auto-pushing loop ${loopId}`);

      const remoteBranch = await this.pushAndFinalize(
        loopId, loop, git, "handleConflictResolutionComplete"
      );

      log.info(`[LoopManager] handleConflictResolutionComplete: Successfully auto-pushed loop ${loopId} to ${remoteBranch}`);
    } catch (error) {
      log.error(`[LoopManager] handleConflictResolutionComplete: Failed to auto-push loop ${loopId}:`, String(error));
      // Update state to reflect the failure — loop stays completed but syncState records the failure
      if (loop.state.syncState) {
        loop.state.syncState.autoPushOnComplete = false;
      }
      await updateLoopState(loopId, loop.state);
    }
  }

  /**
   * Discard a completed loop (mark as deleted without merging).
   * The worktree and branch are preserved until purgeLoop() is called.
   */
  async discardLoop(loopId: string): Promise<{ success: boolean; error?: string }> {
    // Use getLoop to check engine state first
    const loop = await this.getLoop(loopId);
    if (!loop) {
      return { success: false, error: "Loop not found" };
    }

    // Must have git state (branch was created)
    if (!loop.state.git) {
      return { success: false, error: "No git branch was created for this loop" };
    }

    try {
      // With worktrees, discard just marks the loop as deleted.
      // The worktree and branch are preserved until purgeLoop() handles cleanup.
      // No need to reset or checkout - the main working directory is not affected.

      // Update status to 'deleted' (final state)
      assertValidTransition(loop.state.status, "deleted", "discardLoop");
      const updatedState = {
        ...loop.state,
        status: "deleted" as const,
      };
      await updateLoopState(loopId, updatedState);

      // Clean up the dedicated backend connection for this loop
      await backendManager.disconnectLoop(loopId);

      // Remove engine from in-memory map so getLoop returns persisted state
      this.engines.delete(loopId);

      // Emit event
      this.emitter.emit({
        type: "loop.discarded",
        loopId,
        timestamp: createTimestamp(),
      });

      return { success: true };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  }

  /**
   * Purge a loop (permanently delete files).
   * Only allowed for loops in 'merged', 'pushed', or 'deleted' states.
   * Cleans up worktree, working branch, review branches, and marks as non-addressable before deletion.
   * This is the ONLY place worktrees are removed.
   */
  async purgeLoop(loopId: string): Promise<{ success: boolean; error?: string }> {
    const loop = await loadLoop(loopId);
    if (!loop) {
      return { success: false, error: "Loop not found" };
    }

    // Only allow purge for final states
    if (loop.state.status !== "merged" && loop.state.status !== "pushed" && loop.state.status !== "deleted") {
      return { success: false, error: `Cannot purge loop in status: ${loop.state.status}. Only merged, pushed, or deleted loops can be purged.` };
    }

    try {
      const executor = await backendManager.getCommandExecutorAsync(loop.config.workspaceId, loop.config.directory);
      const git = GitService.withExecutor(executor);

      // Step 1: Remove the worktree (if it exists)
      const worktreePath = loop.state.git?.worktreePath;
      if (worktreePath) {
        try {
          const exists = await git.worktreeExists(loop.config.directory, worktreePath);
          if (exists) {
            await git.removeWorktree(loop.config.directory, worktreePath, { force: true });
            log.debug(`[LoopManager] purgeLoop: Removed worktree for loop ${loopId}: ${worktreePath}`);
          }
        } catch (error) {
          log.warn(`[LoopManager] purgeLoop: Failed to remove worktree: ${String(error)}`);
          // Continue with purge even if worktree removal fails
        }
      }

      // Step 2: Delete the working branch (now safe since worktree is removed)
      if (loop.state.git?.workingBranch) {
        try {
          await git.deleteBranch(loop.config.directory, loop.state.git.workingBranch);
          log.debug(`[LoopManager] purgeLoop: Deleted working branch for loop ${loopId}`);
        } catch (error) {
          log.debug(`[LoopManager] purgeLoop: Could not delete working branch: ${String(error)}`);
        }
      }

      // Step 3: Clean up review branches if review mode was active
      if (loop.state.reviewMode?.reviewBranches && loop.state.reviewMode.reviewBranches.length > 0) {
        for (const branchName of loop.state.reviewMode.reviewBranches) {
          // Skip the working branch if it was already deleted above
          if (branchName === loop.state.git?.workingBranch) continue;
          try {
            await git.deleteBranch(loop.config.directory, branchName);
            log.debug(`[LoopManager] purgeLoop: Cleaned up review branch: ${branchName}`);
          } catch (error) {
            log.debug(`[LoopManager] purgeLoop: Could not delete branch ${branchName}: ${String(error)}`);
          }
        }
      }

      // Step 4: Prune stale worktree references
      try {
        await git.pruneWorktrees(loop.config.directory);
      } catch (error) {
        log.debug(`[LoopManager] purgeLoop: Worktree prune failed: ${String(error)}`);
      }
    } catch (error) {
      log.warn(`[LoopManager] purgeLoop: Git cleanup failed: ${String(error)}`);
      // Continue with purge even if git cleanup fails
    }

    // Mark as non-addressable before deletion
    if (loop.state.reviewMode) {
      loop.state.reviewMode.addressable = false;
      await updateLoopState(loopId, loop.state);
    }

    // Actually delete the loop file
    const deleted = await deleteLoopFile(loopId);
    if (!deleted) {
      return { success: false, error: "Failed to delete loop file" };
    }

    return { success: true };
  }

  /**
   * Handle an externally merged loop (e.g., merged via PR on GitHub).
   * Transitions the loop to `deleted` status, clears reviewMode.addressable,
   * and disconnects the backend. Despite the name, this does NOT set status
   * to "merged" — it performs final cleanup by marking the loop as deleted.
   * The worktree and branch are preserved until purgeLoop() is called.
   *
   * Only works for loops in final states: pushed, merged, completed, max_iterations, deleted.
   */
  async markMerged(loopId: string): Promise<{ success: boolean; error?: string }> {
    // Use getLoop to get the most up-to-date status (in-memory or from persistence)
    const loop = await this.getLoop(loopId);
    if (!loop) {
      return { success: false, error: "Loop not found" };
    }

    // Only allow for loops in final states
    const allowedStatuses = ["pushed", "merged", "completed", "max_iterations", "deleted"];
    if (!allowedStatuses.includes(loop.state.status)) {
      return { 
        success: false, 
        error: `Cannot mark loop as merged in status: ${loop.state.status}. Only finished loops can be marked as merged.` 
      };
    }

    // Load from persistence to get the canonical git state
    // (in-memory state may have stale or different data)
    // Note: We check persistedLoop first, and only fall back to in-memory state
    // if persistence load failed completely (loop not in DB yet)
    const persistedLoop = await loadLoop(loopId);
    const gitState = persistedLoop ? persistedLoop.state.git : loop.state.git;
    
    // Must have git state (branch was created)
    if (!gitState) {
      return { success: false, error: "No git branch was created for this loop" };
    }

    try {
      // With worktrees, markMerged just updates the loop status.
      // No need to reset, checkout, or delete branches - the worktree isolates everything.
      // Branch and worktree cleanup happens in purgeLoop().

      // Update status to 'deleted' (final cleanup state)
      // Also clear reviewMode.addressable so the loop cannot be addressed again
      assertValidTransition(loop.state.status, "deleted", "markMerged");
      const updatedState = {
        ...loop.state,
        status: "deleted" as const,
        reviewMode: loop.state.reviewMode
          ? { ...loop.state.reviewMode, addressable: false }
          : undefined,
      };
      await updateLoopState(loopId, updatedState);

      // Clean up the dedicated backend connection for this loop
      await backendManager.disconnectLoop(loopId);

      // Remove engine from in-memory map if present
      this.engines.delete(loopId);

      // Emit deleted event for consistency
      this.emitter.emit({
        type: "loop.deleted",
        loopId,
        timestamp: createTimestamp(),
      });

      return { success: true };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  }

  /**
   * Set the pending prompt for the next iteration.
   * This will override config.prompt for the next iteration only.
   * Only works when the loop is running/starting.
   */
  async setPendingPrompt(loopId: string, prompt: string): Promise<{ success: boolean; error?: string }> {
    const engine = this.engines.get(loopId);
    if (!engine) {
      // Check if loop exists but isn't running
      const loop = await loadLoop(loopId);
      if (!loop) {
        return { success: false, error: "Loop not found" };
      }
      return { success: false, error: "Loop is not running. Pending prompts can only be set for running loops." };
    }

    // Check if the loop is actually in a running state
    const status = engine.state.status;
    if (status !== "running" && status !== "starting") {
      return { success: false, error: `Loop is not running (status: ${status}). Pending prompts can only be set for running loops.` };
    }

    // Update the state with the pending prompt
    engine.setPendingPrompt(prompt);

    return { success: true };
  }

  /**
   * Clear the pending prompt for a loop.
   * Only works when the loop is running/starting.
   */
  async clearPendingPrompt(loopId: string): Promise<{ success: boolean; error?: string }> {
    const engine = this.engines.get(loopId);
    if (!engine) {
      const loop = await loadLoop(loopId);
      if (!loop) {
        return { success: false, error: "Loop not found" };
      }
      return { success: false, error: "Loop is not running. Pending prompts can only be cleared for running loops." };
    }

    // Check if the loop is actually in a running state
    const status = engine.state.status;
    if (status !== "running" && status !== "starting") {
      return { success: false, error: `Loop is not running (status: ${status}). Pending prompts can only be cleared for running loops.` };
    }

    engine.clearPendingPrompt();

    return { success: true };
  }

  /**
   * Set the pending model for the next iteration.
   * This will override config.model and become the new default after use.
   * Only works when the loop is in an active state (running, waiting, planning).
   */
  async setPendingModel(loopId: string, model: ModelConfig): Promise<{ success: boolean; error?: string }> {
    const engine = this.engines.get(loopId);
    if (!engine) {
      // Check if loop exists but isn't running
      const loop = await loadLoop(loopId);
      if (!loop) {
        return { success: false, error: "Loop not found" };
      }
      return { success: false, error: "Loop is not running. Pending model can only be set for running loops." };
    }

    // Check if the loop is in an active state
    const status = engine.state.status;
    if (!["running", "waiting", "planning", "starting"].includes(status)) {
      return { success: false, error: `Loop is not in an active state (status: ${status}). Pending model can only be set for active loops.` };
    }

    // Validate model config
    if (!model.providerID || !model.modelID) {
      return { success: false, error: "Invalid model config: providerID and modelID are required" };
    }

    // Update the state with the pending model
    engine.setPendingModel(model);

    return { success: true };
  }

  /**
   * Clear the pending model for a loop.
   * Only works when the loop is in an active state.
   */
  async clearPendingModel(loopId: string): Promise<{ success: boolean; error?: string }> {
    const engine = this.engines.get(loopId);
    if (!engine) {
      const loop = await loadLoop(loopId);
      if (!loop) {
        return { success: false, error: "Loop not found" };
      }
      return { success: false, error: "Loop is not running. Pending model can only be cleared for running loops." };
    }

    // Check if the loop is in an active state
    const status = engine.state.status;
    if (!["running", "waiting", "planning", "starting"].includes(status)) {
      return { success: false, error: `Loop is not in an active state (status: ${status}). Pending model can only be cleared for active loops.` };
    }

    engine.clearPendingModel();

    return { success: true };
  }

  /**
   * Clear all pending values (prompt and model) for a loop.
   * Only works when the loop is in an active state.
   */
  async clearPending(loopId: string): Promise<{ success: boolean; error?: string }> {
    const engine = this.engines.get(loopId);
    if (!engine) {
      const loop = await loadLoop(loopId);
      if (!loop) {
        return { success: false, error: "Loop not found" };
      }
      return { success: false, error: "Loop is not running. Pending values can only be cleared for running loops." };
    }

    // Check if the loop is in an active state
    const status = engine.state.status;
    if (!["running", "waiting", "planning", "starting"].includes(status)) {
      return { success: false, error: `Loop is not in an active state (status: ${status}). Pending values can only be cleared for active loops.` };
    }

    engine.clearPending();

    return { success: true };
  }

  /**
   * Set pending message and/or model for the next iteration.
   * Convenience method to set both values at once.
   * Only works when the loop is in an active state (running, waiting, planning).
   */
  async setPending(loopId: string, options: { message?: string; model?: ModelConfig }): Promise<{ success: boolean; error?: string }> {
    const engine = this.engines.get(loopId);
    if (!engine) {
      const loop = await loadLoop(loopId);
      if (!loop) {
        return { success: false, error: "Loop not found" };
      }
      return { success: false, error: "Loop is not running. Pending values can only be set for running loops." };
    }

    // Check if the loop is in an active state
    const status = engine.state.status;
    if (!["running", "waiting", "planning", "starting"].includes(status)) {
      return { success: false, error: `Loop is not in an active state (status: ${status}). Pending values can only be set for active loops.` };
    }

    // Validate model config if provided
    if (options.model && (!options.model.providerID || !options.model.modelID)) {
      return { success: false, error: "Invalid model config: providerID and modelID are required" };
    }

    // Set pending values
    if (options.message !== undefined) {
      engine.setPendingPrompt(options.message);
    }
    if (options.model !== undefined) {
      engine.setPendingModel(options.model);
    }

    return { success: true };
  }

  /**
   * Inject pending message and/or model immediately by aborting the current iteration.
   * Unlike setPending which waits for the current iteration to complete naturally,
   * this method interrupts the AI and starts a new iteration immediately with the
   * injected values.
   * 
   * The session is preserved (conversation history maintained), only the current
   * AI processing is interrupted.
   * 
   * If the loop is in a "jumpstartable" state (completed, stopped, failed, max_iterations),
   * the loop will be restarted with the pending message.
   * 
   * Only works when the loop is in an active state OR a jumpstartable state.
   */
  async injectPending(loopId: string, options: { message?: string; model?: ModelConfig }): Promise<{ success: boolean; error?: string }> {
    const engine = this.engines.get(loopId);
    
    // Validate model config if provided
    if (options.model && (!options.model.providerID || !options.model.modelID)) {
      return { success: false, error: "Invalid model config: providerID and modelID are required" };
    }

    if (!engine) {
      const loop = await loadLoop(loopId);
      if (!loop) {
        return { success: false, error: "Loop not found" };
      }
      
      // Check if loop can be jumpstarted from a stopped state
      const jumpstartableStates = ["completed", "stopped", "failed", "max_iterations", "planning"];
      if (jumpstartableStates.includes(loop.state.status)) {
        // Jumpstart the loop with the pending message
        return this.jumpstartLoop(loopId, options);
      }
      
      return { success: false, error: "Loop is not running. Pending values can only be injected for running loops." };
    }

    // Check if the loop is in an active state
    const status = engine.state.status;
    if (!["running", "waiting", "planning", "starting"].includes(status)) {
      // Check if we can jumpstart from a stopped state
      const jumpstartableStates = ["completed", "stopped", "failed", "max_iterations"];
      if (jumpstartableStates.includes(status)) {
        return this.jumpstartLoop(loopId, options);
      }
      return { success: false, error: `Loop is not in an active state (status: ${status}). Pending values can only be injected for active loops.` };
    }

    // Call the engine's injectPendingNow method
    await engine.injectPendingNow(options);

    return { success: true };
  }

  /**
   * Jumpstart a loop that has stopped running.
   * Sets the pending prompt/model and restarts the loop.
   * 
   * Works for loops in: completed, stopped, failed, max_iterations states.
   * 
   * Branch handling:
   * - If the loop was NOT merged/accepted: continues on the existing working branch
   * - If the loop was merged/accepted (no working branch): creates new branch from original
   */
  private async jumpstartLoop(loopId: string, options: { message?: string; model?: ModelConfig }): Promise<{ success: boolean; error?: string }> {
    const loop = await loadLoop(loopId);
    if (!loop) {
      return { success: false, error: "Loop not found" };
    }

    // Check if loop can be jumpstarted
    const jumpstartableStates = ["completed", "stopped", "failed", "max_iterations", "planning"];
    if (!jumpstartableStates.includes(loop.state.status)) {
      return { success: false, error: `Loop cannot be jumpstarted from status: ${loop.state.status}` };
    }

    // Set pending values in the state
    if (options.message !== undefined) {
      loop.state.pendingPrompt = options.message;
    }
    if (options.model !== undefined) {
      loop.state.pendingModel = options.model;
      // Also update the config model so it persists after the pending model is consumed
      loop.config.model = options.model;
    }

    // Check if this was a planning loop
    const wasInPlanningMode = loop.state.planMode?.active === true;
    
    // Reset the loop to a restartable state
    // If it was in planning mode, keep it in planning mode; otherwise reset to stopped
    if (wasInPlanningMode) {
      assertValidTransition(loop.state.status, "planning", "jumpstartLoop");
      loop.state.status = "planning";
      // Reset isPlanReady to false so it will generate a plan again
      if (loop.state.planMode) {
        loop.state.planMode.isPlanReady = false;
      }
    } else {
      assertValidTransition(loop.state.status, "stopped", "jumpstartLoop");
      loop.state.status = "stopped"; // LoopEngine.start() accepts 'idle', 'stopped', or 'planning'
    }
    loop.state.completedAt = undefined;
    loop.state.error = undefined; // Clear any previous error
    loop.state.syncState = undefined; // Clear any sync state from conflict resolution
    
    // Save the updated state
    await updateLoopState(loopId, loop.state);
    await saveLoop(loop);

    // Emit event for UI update
    this.emitter.emit({
      type: "loop.pending.updated",
      loopId,
      pendingPrompt: options.message,
      pendingModel: options.model,
      timestamp: createTimestamp(),
    });

    // Determine if we should continue on existing branch or create new one
    // If the loop has an existing working branch, continue on it (don't create a new branch)
    const hasExistingBranch = !!loop.state.git?.workingBranch;
    
    // For planning mode loops, we need to use startPlanMode, not startLoop
    if (wasInPlanningMode) {
      if (hasExistingBranch) {
        // Continue on existing branch for planning loop
        return this.jumpstartOnExistingBranch(loopId, loop, true);
      } else {
        // Start fresh planning session
        try {
          await this.startPlanMode(loopId);
          log.info(`Jumpstarted planning loop ${loopId} with pending message`);
          return { success: true };
        } catch (startError) {
          log.error(`Failed to jumpstart planning loop ${loopId}: ${String(startError)}`);
          return { success: false, error: `Failed to jumpstart planning loop: ${String(startError)}` };
        }
      }
    }
    
    if (hasExistingBranch) {
      // Continue on the existing working branch (similar to addressReviewComments for pushed loops)
      return this.jumpstartOnExistingBranch(loopId, loop);
    } else {
      // No existing working branch (merged loop or never ran) - use normal startLoop which creates new branch
      try {
        await this.startLoop(loopId);
        log.info(`Jumpstarted loop ${loopId} with pending message (new branch)`);
        return { success: true };
      } catch (startError) {
        log.error(`Failed to jumpstart loop ${loopId}: ${String(startError)}`);
        return { success: false, error: `Failed to jumpstart loop: ${String(startError)}` };
      }
    }
  }

  /**
   * Jumpstart a loop on its existing working branch.
   * Used when the loop was NOT merged/accepted and should continue its previous work.
   * With worktrees, no checkout is needed - the branch is already checked out in the worktree.
   * @param isPlanning - Whether this is a planning loop (affects log messages only)
   */
  private async jumpstartOnExistingBranch(loopId: string, loop: Loop, isPlanning = false): Promise<{ success: boolean; error?: string }> {
    try {
      // Get the appropriate command executor for the current mode
      const worktreeDir = loop.state.git?.worktreePath;
      if (!worktreeDir) {
        return { success: false, error: "Loop has no worktree path - cannot jumpstart" };
      }
      const executor = await backendManager.getCommandExecutorAsync(loop.config.workspaceId, worktreeDir);
      const git = GitService.withExecutor(executor);
      const backend = backendManager.getLoopBackend(loopId, loop.config.workspaceId);

      const workingBranch = loop.state.git!.workingBranch;
      const loopType = isPlanning ? "planning loop" : "loop";
      log.info(`Jumpstarting ${loopType} ${loopId} on existing branch: ${workingBranch}`);

      // With worktrees, the branch is already checked out in the worktree.
      // No checkout or lock file cleanup needed - just create a new engine.

      // Create and start a new loop engine with skipGitSetup
      // (worktree already has the branch checked out, no need to create a new one)
      const engine = new LoopEngine({
        loop: { config: loop.config, state: loop.state },
        backend,
        gitService: git,
        eventEmitter: this.emitter,
        onPersistState: async (state) => {
          await updateLoopState(loopId, state);
        },
        skipGitSetup: true, // Don't create a new branch - continue on existing worktree
      });
      this.engines.set(loopId, engine);

      // Start state persistence
      this.startStatePersistence(loopId);

      // Start execution (fire and forget - don't block the caller)
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

  /**
   * Address reviewer comments on a pushed/merged loop.
   * For pushed loops: resumes on the same branch.
   * For merged loops: creates a new review branch.
   * Comments are stored in the database for tracking.
   */
  async addressReviewComments(
    loopId: string,
    comments: string
  ): Promise<{ success: boolean; error?: string; reviewCycle?: number; branch?: string; commentIds?: string[] }> {
    const loop = await loadLoop(loopId);
    if (!loop) {
      return { success: false, error: "Loop not found" };
    }

    // Check if loop is addressable
    if (!loop.state.reviewMode?.addressable) {
      return { success: false, error: "Loop is not addressable. Only pushed or merged loops can receive reviewer comments." };
    }

    // Check if loop is in pushed or merged status
    if (loop.state.status !== "pushed" && loop.state.status !== "merged") {
      return { success: false, error: `Cannot address comments on loop with status: ${loop.state.status}` };
    }

    // Check if loop is already running
    if (this.engines.has(loopId)) {
      return { success: false, error: "Loop is already running" };
    }

    // Validate comments
    if (!comments || comments.trim() === "") {
      return { success: false, error: "Comments cannot be empty" };
    }

    try {
      const executor = await backendManager.getCommandExecutorAsync(loop.config.workspaceId, loop.config.directory);
      const git = GitService.withExecutor(executor);

      // Get a dedicated backend for this loop's review cycle.
      // For pushed loops, the worktree already exists.
      // For merged loops, a new worktree is created below before the engine starts.
      const backend = backendManager.getLoopBackend(loopId, loop.config.workspaceId);

      // Calculate the next review cycle number
      const nextReviewCycle = loop.state.reviewMode.reviewCycles + 1;
      
      // Prepare comment data for later insertion (after validation and state updates)
      const commentId = crypto.randomUUID();

      // Handle based on completion action
      if (loop.state.reviewMode.completionAction === "push") {
        // PUSHED LOOP: Resume on the same branch
        if (!loop.state.git?.workingBranch) {
          return { success: false, error: "No working branch found for pushed loop" };
        }

        // With worktrees, the branch is already checked out in the worktree.
        // No checkout needed.

        // Increment review cycles
        loop.state.reviewMode.reviewCycles += 1;

        return this.transitionToReviewAndStart(
          loopId, loop, backend, git, comments, "pushed",
          commentId, nextReviewCycle, loop.state.git.workingBranch
        );

      } else {
        // MERGED LOOP: Create a new review branch with its own worktree
        if (!loop.state.git?.originalBranch) {
          return { success: false, error: "No original branch found for merged loop" };
        }

        // Increment review cycles
        loop.state.reviewMode.reviewCycles += 1;

        // Create the review branch and worktree
        const reviewBranchName = await this.setupMergedReviewWorktree(loop, git);

        return this.transitionToReviewAndStart(
          loopId, loop, backend, git, comments, "merged",
          commentId, nextReviewCycle, reviewBranchName
        );
      }
    } catch (error) {
      return { success: false, error: String(error) };
    }
  }

  /**
   * Set up a new worktree for a merged loop's review cycle.
   * Creates a new review branch from the original branch, replacing any existing worktree.
   *
   * @param loop - The loop config and state
   * @param git - The GitService instance
   * @returns The new review branch name
   */
  private async setupMergedReviewWorktree(
    loop: Loop,
    git: GitService
  ): Promise<string> {
    // Generate new review branch name
    const safeName = sanitizeBranchName(loop.config.name);
    const reviewBranchName = `${loop.config.git.branchPrefix}${safeName}-review-${loop.state.reviewMode!.reviewCycles}`;

    // Create a new worktree for the review branch (branched from original)
    const worktreePath = `${loop.config.directory}/.ralph-worktrees/${loop.config.id}`;

    // Remove old worktree first if it exists (from previous iteration)
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

    // Update git state
    loop.state.git!.workingBranch = reviewBranchName;
    loop.state.git!.worktreePath = worktreePath;
    loop.state.reviewMode!.reviewBranches.push(reviewBranchName);

    return reviewBranchName;
  }

  /**
   * Transition a loop to idle for review, persist state, insert the review comment,
   * and start the review engine. Shared tail logic for both pushed and merged paths
   * of addressReviewComments().
   *
   * @param loopId - The loop ID
   * @param loop - The loop config and state
   * @param backend - The backend connection for this loop
   * @param git - The GitService instance
   * @param comments - The reviewer comments to address
   * @param transitionLabel - Label for assertValidTransition (e.g., "pushed" or "merged")
   * @param commentId - Pre-generated UUID for the comment
   * @param nextReviewCycle - The review cycle number for this comment
   * @param resultBranch - The branch name to include in the return value
   */
  private async transitionToReviewAndStart(
    loopId: string,
    loop: Loop,
    backend: ReturnType<typeof backendManager.getLoopBackend>,
    git: GitService,
    comments: string,
    transitionLabel: string,
    commentId: string,
    nextReviewCycle: number,
    resultBranch: string
  ): Promise<{ success: boolean; reviewCycle: number; branch: string; commentIds: string[] }> {
    // Set status to idle so engine.start() can run (it will set to running)
    assertValidTransition(loop.state.status, "idle", `addressReviewComments:${transitionLabel}`);
    loop.state.status = "idle";
    loop.state.completedAt = undefined;

    await updateLoopState(loopId, loop.state);

    // Store the comment in the database AFTER state is successfully updated
    insertReviewComment({
      id: commentId,
      loopId,
      reviewCycle: nextReviewCycle,
      commentText: comments,
      createdAt: new Date().toISOString(),
      status: "pending",
    });

    // Create and start the review engine (shared helper)
    this.startReviewEngine(loopId, loop, backend, git, comments);

    return {
      success: true,
      reviewCycle: loop.state.reviewMode!.reviewCycles,
      branch: resultBranch,
      commentIds: [commentId],
    };
  }

  /**
   * Create, configure, and start a review engine for addressing reviewer comments.
   * Shared by both the pushed and merged paths of addressReviewComments().
   *
   * @param loopId - The loop ID
   * @param loop - The loop config and state
   * @param backend - The backend connection for this loop
   * @param git - The GitService instance
   * @param comments - The reviewer comments to address
   */
  private startReviewEngine(
    loopId: string,
    loop: Loop,
    backend: ReturnType<typeof backendManager.getLoopBackend>,
    git: GitService,
    comments: string
  ): void {
    // Construct specialized prompt for addressing comments
    const reviewPrompt = this.constructReviewPrompt(comments);

    // Create a new loop engine with skipGitSetup (branch/worktree already exists)
    const engine = new LoopEngine({
      loop: { config: loop.config, state: loop.state },
      backend,
      gitService: git,
      eventEmitter: this.emitter,
      onPersistState: async (state) => {
        await updateLoopState(loopId, state);
      },
      skipGitSetup: true,
    });
    this.engines.set(loopId, engine);

    // Set the review prompt as pending
    engine.setPendingPrompt(reviewPrompt);

    // Start state persistence
    this.startStatePersistence(loopId);

    // Start execution (fire and forget - don't block the caller)
    // The loop runs asynchronously and updates state via events/persistence
    engine.start().catch((error) => {
      log.error(`Loop ${loopId} failed to start after addressing comments:`, String(error));
    });
  }

  /**
   * Construct a specialized prompt for addressing reviewer comments.
   */
  private constructReviewPrompt(comments: string): string {
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

  /**
   * Construct a specialized prompt for resolving merge conflicts.
   * Used when pushing a loop and there are conflicting changes that need resolution.
   * 
   * @param sourceBranch - The branch or ref being merged (e.g., "origin/main" or "origin/ralph/loop-id")
   * @param conflictedFiles - List of files with conflicts
   */
  private constructConflictResolutionPrompt(
    sourceBranch: string,
    conflictedFiles: string[]
  ): string {
    const fileList = conflictedFiles.map(f => `- ${f}`).join("\n");
    return `The branch (${sourceBranch}) has diverged from your working branch and there are merge conflicts that need to be resolved before pushing.

Merge the branch and resolve all conflicts:

1. Run: git merge ${sourceBranch}
2. The following files have conflicts:
${fileList}
3. For each conflicted file:
   - Open the file and examine the conflict markers (<<<<<<<, =======, >>>>>>>)
   - Resolve each conflict by keeping the correct code (merge both sides appropriately)
   - Remove all conflict markers
   - Stage the resolved file with: git add <file>
4. After ALL conflicts are resolved and staged, complete the merge: git commit --no-edit
5. Verify the code still compiles/works correctly after the merge
6. When all conflicts are resolved and the merge is complete, end your response with:

<promise>COMPLETE</promise>`;
  }

  /**
   * Get review history for a loop.
   */
  async getReviewHistory(
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

    // Return review mode if it exists, otherwise return null history
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

  /**
   * Get review comments for a loop.
   * Returns comments in API-friendly format (camelCase keys).
   */
  getReviewComments(loopId: string): Array<{
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

  /**
   * Save the last used model as a user preference.
   * Called after loop creation to remember the user's model selection.
   */
  async saveLastUsedModel(model: {
    providerID: string;
    modelID: string;
    variant?: string;
  }): Promise<void> {
    try {
      await setLastModel(model);
    } catch (error) {
      log.warn(`Failed to save last model: ${String(error)}`);
    }
  }

  /**
   * Check if a loop is currently running.
   */
  isRunning(loopId: string): boolean {
    return this.engines.has(loopId);
  }

  /**
   * Get the current state of a running loop.
   */
  getRunningLoopState(loopId: string): LoopState | null {
    const engine = this.engines.get(loopId);
    return engine?.state ?? null;
  }

  /**
   * Clear planning files in the worktree before starting plan mode.
   * Handles two operations:
   * 1. Clear .planning folder contents (if clearPlanningFolder config is set)
   * 2. Always clear plan.md to prevent stale content display
   */
  private async clearPlanningFiles(
    loopId: string,
    loop: Loop,
    executor: CommandExecutor,
    worktreePath: string
  ): Promise<void> {
    // Clear .planning folder in the worktree (if requested)
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

        // Mark as cleared
        if (loop.state.planMode) {
          loop.state.planMode.planningFolderCleared = true;
          await updateLoopState(loopId, loop.state);
        }
      } catch (error) {
        log.warn(`Failed to clear .planning folder: ${String(error)}`);
      }
    }

    // Always clear plan.md when starting plan mode, regardless of clearPlanningFolder setting.
    // This ensures the UI doesn't display stale plan content from a previous session while
    // the AI is generating a new plan. The old plan is always irrelevant in a fresh plan session.
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

  /**
   * Recover a planning engine that was lost due to server restart.
   * Loads the loop from persistence, recreates the LoopEngine, reconnects the session,
   * and starts state persistence. This is used by acceptPlan() and sendPlanFeedback()
   * when the in-memory engine is missing but the loop is persisted in planning status.
   */
  private async recoverPlanningEngine(loopId: string): Promise<LoopEngine> {
    const loop = await loadLoop(loopId);
    if (!loop) {
      throw new Error(`Loop not found: ${loopId}`);
    }

    if (loop.state.status !== "planning") {
      throw new Error("Loop plan mode is not running");
    }

    // Recreate the engine for this planning loop
    const worktreeDir = loop.state.git?.worktreePath;
    if (!worktreeDir) {
      throw new Error("Loop has no worktree path - cannot recreate engine for planning recovery");
    }
    const executor = await backendManager.getCommandExecutorAsync(loop.config.workspaceId, worktreeDir);
    const git = GitService.withExecutor(executor);
    const backend = backendManager.getLoopBackend(loopId, loop.config.workspaceId);

    const engine = new LoopEngine({
      loop,
      backend,
      gitService: git,
      eventEmitter: this.emitter,
      onPersistState: async (state) => {
        await updateLoopState(loopId, state);
      },
    });

    this.engines.set(loopId, engine);

    // Reconnect to the existing session (or create a new one if none exists).
    // If this fails, remove the partially-initialized engine to avoid leaving
    // a broken engine (with no sessionId) cached in the map.
    try {
      await engine.reconnectSession();
    } catch (error) {
      this.engines.delete(loopId);
      throw new Error(
        `Failed to recover planning engine session for loop ${loopId}: ${String(error)}`,
        { cause: error },
      );
    }

    // Start state persistence
    this.startStatePersistence(loopId);

    return engine;
  }

  /**
   * Recover a chat engine that was lost due to server restart.
   * Loads the loop from persistence, recreates the LoopEngine, reconnects the session,
   * and starts state persistence. This is used by sendChatMessage() when the in-memory
   * engine is missing but the loop is persisted in a chat-compatible state.
   *
   * Similar to recoverPlanningEngine() but for chat mode loops in completed/max_iterations status.
   */
  private async recoverChatEngine(loopId: string): Promise<LoopEngine> {
    const loop = await loadLoop(loopId);
    if (!loop) {
      throw new Error(`Loop not found: ${loopId}`);
    }

    if (loop.config.mode !== "chat") {
      throw new Error(`Loop is not a chat (mode: ${loop.config.mode})`);
    }

    const recoverableStatuses = ["completed", "max_iterations"];
    if (!recoverableStatuses.includes(loop.state.status)) {
      throw new Error(`Cannot recover chat engine in status: ${loop.state.status}`);
    }

    // Recreate the engine — requires an existing worktree
    const worktreeDir = loop.state.git?.worktreePath;
    if (!worktreeDir) {
      throw new Error("Chat has no worktree path — cannot recreate engine for recovery");
    }
    const executor = await backendManager.getCommandExecutorAsync(loop.config.workspaceId, worktreeDir);
    const git = GitService.withExecutor(executor);
    const backend = backendManager.getLoopBackend(loopId, loop.config.workspaceId);

    const engine = new LoopEngine({
      loop,
      backend,
      gitService: git,
      eventEmitter: this.emitter,
      onPersistState: async (state) => {
        await updateLoopState(loopId, state);
      },
    });

    this.engines.set(loopId, engine);

    // Reconnect to the existing session (or create a new one if none exists).
    // If this fails, remove the partially-initialized engine to avoid leaving
    // a broken engine (with no sessionId) cached in the map.
    try {
      await engine.reconnectSession();
    } catch (error) {
      this.engines.delete(loopId);
      throw new Error(
        `Failed to recover chat engine session for loop ${loopId}: ${String(error)}`,
        { cause: error },
      );
    }

    // Start state persistence (chat-aware — won't clean up on completed)
    this.startStatePersistence(loopId);

    return engine;
  }

  /**
   * Start periodic state persistence for a running loop.
   */
  private startStatePersistence(loopId: string): void {
    const interval = setInterval(async () => {
      const engine = this.engines.get(loopId);
      if (!engine) {
        clearInterval(interval);
        return;
      }

      try {
        await updateLoopState(loopId, engine.state);
      } catch (error) {
        log.error(`Failed to persist loop state: ${String(error)}`);
      }

      // Stop if loop has finished
      if (
        engine.state.status === "completed" ||
        engine.state.status === "stopped" ||
        engine.state.status === "failed" ||
        engine.state.status === "max_iterations"
      ) {
        clearInterval(interval);

        // For chat mode, keep the engine and backend alive when status is
        // "completed" or "max_iterations" — the user may send another message.
        // Only fully clean up on terminal states (stopped, failed).
        const isChatIdle = engine.config.mode === "chat" &&
          (engine.state.status === "completed" || engine.state.status === "max_iterations");

        if (!isChatIdle) {
          // Clean up the dedicated backend connection for this loop
          backendManager.disconnectLoop(loopId).catch((error) => {
            log.error(`Failed to disconnect loop backend during cleanup: ${String(error)}`);
          });
          this.engines.delete(loopId);
        }
      }
    }, 5000); // Persist every 5 seconds
  }

  /**
   * Shutdown all running loops.
   */
  async shutdown(): Promise<void> {
    const promises = Array.from(this.engines.keys()).map((loopId) =>
      this.stopLoop(loopId, "Server shutdown")
    );
    await Promise.allSettled(promises);
  }

  /**
   * Force reset all connections and stale loop states.
   * 
   * This method:
   * 1. Stops all running loop engines gracefully (if possible)
   * 2. Clears the in-memory engines map
   * 3. Clears the loopsBeingAccepted set
   * 4. Resets stale loops in the database to "stopped" status
   *    (except "planning" loops which can reconnect to their sessions)
   * 5. Resets the backend connection (aborts subscriptions, disconnects)
   * 
   * Use this to recover from stale connections or stuck loops without
   * restarting the server.
   * 
   * @returns Statistics about what was reset
   */
  async forceResetAll(): Promise<{
    enginesCleared: number;
    loopsReset: number;
  }> {
    const engineCount = this.engines.size;
    
    // Try to stop all running engines gracefully, except planning loops
    // Planning loops should preserve their status so users can continue the planning workflow
    const stopPromises = Array.from(this.engines.entries()).map(async ([loopId, engine]) => {
      try {
        if (engine.state.status === "planning") {
          // For planning loops, persist the current state and abort the session without changing status
          // This allows the user to continue planning after the reset
          // The engine will be recreated when sendPlanFeedback() is called
          log.info(`Preserving planning loop ${loopId} status during force reset`);
          // Persist current in-memory state to database before clearing the engine
          // This ensures isPlanReady and other state is saved
          await updateLoopState(loopId, engine.state);
          await engine.abortSessionOnly();
        } else {
          // For non-planning loops, stop completely (sets status to "stopped")
          await engine.stop("Force reset by user");
          await updateLoopState(loopId, engine.state);
        }
      } catch (error) {
        log.warn(`Failed to stop engine ${loopId} during force reset: ${String(error)}`);
        // Continue anyway - we'll clear the engine
      }
    });
    
    await Promise.allSettled(stopPromises);
    
    // Clear all in-memory state
    this.engines.clear();
    this.loopsBeingAccepted.clear();
    
    // Reset stale loops in database (excludes "planning" which can reconnect)
    const loopsReset = await resetStaleLoops();
    
    // Reset all backend connections
    await backendManager.resetAllConnections();
    
    log.info(`Force reset completed: ${engineCount} engines cleared, ${loopsReset} loops reset in database`);
    
    return {
      enginesCleared: engineCount,
      loopsReset,
    };
  }

  /**
   * Reset the loop manager for testing purposes.
   * Clears all engines without persisting state.
   */
  resetForTesting(): void {
    this.engines.clear();
    this.loopsBeingAccepted.clear();
  }
}

/**
 * Singleton instance of LoopManager.
 */
export const loopManager = new LoopManager();
