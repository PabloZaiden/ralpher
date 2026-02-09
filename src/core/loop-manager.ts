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
import { insertReviewComment } from "../persistence/database";
import { backendManager } from "./backend-manager";
import { GitService } from "./git-service";
import { LoopEngine } from "./loop-engine";
import { loopEventEmitter, SimpleEventEmitter } from "./event-emitter";
import { log } from "./logger";
import { sanitizeBranchName } from "../utils";
import { generateLoopName } from "../utils/name-generator";

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
}

/**
 * Options for starting a loop.
 * Note: Previously supported handleUncommitted option has been removed.
 * Loops now fail to start if there are uncommitted changes.
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
    let generatedName: string;
    
    // For drafts, skip AI title generation and use prompt-based fallback
    // This avoids backend interference issues and makes draft creation faster
    if (options.draft) {
      const fallbackName = options.prompt.slice(0, 50).trim();
      generatedName = fallbackName || `Draft ${now.slice(0, 10)}`;
      log.debug("createLoop - Using prompt-based name for draft", { generatedName });
    } else {
      // For non-drafts, use AI-based title generation
      try {
        // Get backend from global manager for this workspace
        const backend = backendManager.getBackend(options.workspaceId);
        
        // Create a temporary session for name generation
        const tempSession = await backend.createSession({
          title: "Loop Name Generation",
          directory: options.directory,
        });
        
        try {
          // Generate the name
          generatedName = await generateLoopName({
            prompt: options.prompt,
            backend,
            sessionId: tempSession.id,
            timeoutMs: 10000,
          });
          
          log.info(`Generated loop name: ${generatedName}`);
        } finally {
          // Clean up temporary session
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
          generatedName = fallbackName;
        } else {
          // Ultimate fallback if prompt is empty
          const timestamp = new Date().toISOString()
            .replace(/[T:.]/g, "-")
            .replace(/Z$/, "")
            .slice(0, 19);
          generatedName = `loop-${timestamp}`;
        }
      }
    }

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
    };

    const state = createInitialState(id);
    
    // If draft mode is enabled, set status to draft (no session or git setup)
    if (options.draft) {
      state.status = "draft";
    }
    // Else if plan mode is enabled, initialize plan mode state
    else if (options.planMode) {
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
      throw new Error(`Failed to set up git branch for plan mode: ${String(error)}`);
    }

    // Now that the worktree exists, use the worktree path for .planning operations
    const worktreePath = engine.workingDirectory;

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
   * Send feedback on a plan to refine it.
   */
  async sendPlanFeedback(loopId: string, feedback: string): Promise<void> {
    let engine = this.engines.get(loopId);
    
    // If engine doesn't exist but loop is in planning status, recreate the engine
    // This handles the case where the server was restarted while a loop was in planning mode
    if (!engine) {
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
        throw new Error("Loop has no worktree path - cannot recreate engine for plan feedback");
      }
      const executor = await backendManager.getCommandExecutorAsync(loop.config.workspaceId, worktreeDir);
      const git = GitService.withExecutor(executor);
      const backend = backendManager.getLoopBackend(loopId, loop.config.workspaceId);
      
      engine = new LoopEngine({
        loop,
        backend,
        gitService: git,
        eventEmitter: this.emitter,
        onPersistState: async (state) => {
          await updateLoopState(loopId, state);
        },
      });
      
      this.engines.set(loopId, engine);
      
      // Need to set up the session for the engine
      // The engine will reconnect to the existing session if possible
      try {
        await engine.reconnectSession();
      } catch (error) {
        log.warn(`Failed to reconnect session for plan feedback: ${String(error)}`);
        // Continue anyway - we'll create a new session
      }
      
      // Start state persistence
      this.startStatePersistence(loopId);
    }

    // Verify loop is in planning status
    if (engine.state.status !== "planning") {
      throw new Error(`Loop is not in planning status: ${engine.state.status}`);
    }

    // Wait for any ongoing iteration to complete before modifying state
    // This prevents race conditions where feedback resets isPlanReady while
    // an iteration is still in progress (e.g., during git commit)
    await engine.waitForLoopIdle();

    // Increment feedback rounds and reset isPlanReady
    if (engine.state.planMode) {
      engine.state.planMode.feedbackRounds += 1;
      engine.state.planMode.isPlanReady = false;
    }

    // Persist state update
    await updateLoopState(loopId, engine.state);

    // Set the feedback as a pending prompt
    engine.setPendingPrompt(feedback);

    // Emit feedback event
    this.emitter.emit({
      type: "loop.plan.feedback",
      loopId,
      round: engine.state.planMode?.feedbackRounds ?? 0,
      timestamp: createTimestamp(),
    });

    // Run another plan iteration to process the feedback
    try {
      await engine.runPlanIteration();
    } catch (error) {
      log.error(`Loop ${loopId} plan feedback iteration failed:`, String(error));
      throw error;
    }
  }

  /**
   * Accept a plan and transition to execution mode.
   * Reuses the same session from plan creation.
   */
  async acceptPlan(loopId: string): Promise<void> {
    const engine = this.engines.get(loopId);
    if (!engine) {
      throw new Error("Loop plan mode is not running");
    }

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

    // Start the execution loop
    try {
      await engine.continueExecution();
    } catch (error) {
      log.error(`Loop ${loopId} execution after plan acceptance failed:`, String(error));
      throw error;
    }
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
   * Fails with UNCOMMITTED_CHANGES error if the directory has uncommitted changes.
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

      // Push the working branch to remote
      const remoteBranch = await git.pushBranch(
        loop.config.directory,
        loop.state.git.workingBranch
      );

      // DON'T switch back to the original branch - stay on working branch for potential review cycles

      // Initialize or preserve review mode state
      const reviewMode = loop.state.reviewMode
        ? {
            // Preserve existing review mode, just update addressable and completionAction
            ...loop.state.reviewMode,
            addressable: true,
            completionAction: "push" as const,
          }
        : {
            // First time pushing - initialize review mode
            addressable: true,
            completionAction: "push" as const,
            reviewCycles: 0,
            reviewBranches: [loop.state.git.workingBranch],
          };

      // Update status to 'pushed' with review mode enabled
      const updatedState = {
        ...loop.state,
        status: "pushed" as const,
        reviewMode,
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

      return { success: true, remoteBranch };
    } catch (error) {
      return { success: false, error: String(error) };
    } finally {
      // Always clear the guard
      this.loopsBeingAccepted.delete(loopId);
      log.debug(`[LoopManager] pushLoop: Finished push for loop ${loopId}`);
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
   * Mark a loop as merged (externally merged via PR).
   * With worktrees, no checkout/reset operations are needed on the main repo.
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
      loop.state.status = "planning";
      // Reset isPlanReady to false so it will generate a plan again
      if (loop.state.planMode) {
        loop.state.planMode.isPlanReady = false;
      }
    } else {
      loop.state.status = "stopped"; // LoopEngine.start() accepts 'idle', 'stopped', or 'planning'
    }
    loop.state.completedAt = undefined;
    loop.state.error = undefined; // Clear any previous error
    
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
      const createdAt = new Date().toISOString();

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
        
        // Set status to idle so engine.start() can run (it will set to running)
        loop.state.status = "idle";
        loop.state.completedAt = undefined;

        await updateLoopState(loopId, loop.state);
        
        // Store the comment in the database AFTER state is successfully updated
        insertReviewComment({
          id: commentId,
          loopId,
          reviewCycle: nextReviewCycle,
          commentText: comments,
          createdAt,
          status: "pending",
        });

        // Construct specialized prompt for addressing comments
        const reviewPrompt = this.constructReviewPrompt(comments);

        // Create and start a new loop engine with the review prompt
        // skipGitSetup: true because we've already checked out the branch for review
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

        return {
          success: true,
          reviewCycle: loop.state.reviewMode.reviewCycles,
          branch: loop.state.git.workingBranch,
          commentIds: [commentId],
        };

      } else {
        // MERGED LOOP: Create a new review branch with its own worktree
        if (!loop.state.git?.originalBranch) {
          return { success: false, error: "No original branch found for merged loop" };
        }

        // Increment review cycles
        loop.state.reviewMode.reviewCycles += 1;

        // Generate new review branch name
        const safeName = sanitizeBranchName(loop.config.name);
        const reviewBranchName = `${loop.config.git.branchPrefix}${safeName}-review-${loop.state.reviewMode.reviewCycles}`;

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
          loop.state.git.originalBranch
        );

        // Update git state
        loop.state.git.workingBranch = reviewBranchName;
        loop.state.git.worktreePath = worktreePath;
        loop.state.reviewMode.reviewBranches.push(reviewBranchName);

        // Set status to idle so engine.start() can run (it will set to running)
        loop.state.status = "idle";
        loop.state.completedAt = undefined;

        await updateLoopState(loopId, loop.state);
        
        // Store the comment in the database AFTER state is successfully updated
        insertReviewComment({
          id: commentId,
          loopId,
          reviewCycle: nextReviewCycle,
          commentText: comments,
          createdAt,
          status: "pending",
        });

        // Construct specialized prompt for addressing comments
        const reviewPrompt = this.constructReviewPrompt(comments);

        // Create and start a new loop engine with the review prompt
        // skipGitSetup: true because we've already created the review branch
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

        return {
          success: true,
          reviewCycle: loop.state.reviewMode.reviewCycles,
          branch: reviewBranchName,
          commentIds: [commentId],
        };
      }
    } catch (error) {
      return { success: false, error: String(error) };
    }
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
        // Clean up the dedicated backend connection for this loop
        backendManager.disconnectLoop(loopId).catch((error) => {
          log.error(`Failed to disconnect loop backend during cleanup: ${String(error)}`);
        });
        this.engines.delete(loopId);
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
