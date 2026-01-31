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
  getActiveLoopByDirectory,
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
  /** Workspace ID this loop belongs to (optional) */
  workspaceId?: string;
  /** Model provider ID */
  modelProviderID?: string;
  /** Model ID */
  modelID?: string;
  /** Maximum iterations (default: Infinity for unlimited) */
  maxIterations?: number;
  /** Maximum consecutive identical errors before failsafe exit (default: 10) */
  maxConsecutiveErrors?: number;
  /** Activity timeout in seconds - time without events before treating as error (default: 180 = 3 minutes) */
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
  /** Start in plan creation mode instead of immediate execution (default: false) */
  planMode?: boolean;
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
   * Validates that no other active loop exists for the given directory.
   * Throws an error with code "ACTIVE_LOOP_EXISTS" if a conflicting loop is found.
   * 
   * @param directory - The directory to check
   * @param excludeLoopId - The current loop's ID to exclude from the check
   */
  private async validateNoActiveLoopForDirectory(directory: string, excludeLoopId: string): Promise<void> {
    const existingActiveLoop = await getActiveLoopByDirectory(directory);
    if (existingActiveLoop && existingActiveLoop.config.id !== excludeLoopId) {
      const error = new Error(
        `Another loop is already active for this directory: "${existingActiveLoop.config.name}". ` +
        `Please stop or complete the existing loop before starting a new one.`
      ) as Error & {
        code: string;
        conflictingLoop: { id: string; name: string };
      };
      error.code = "ACTIVE_LOOP_EXISTS";
      error.conflictingLoop = {
        id: existingActiveLoop.config.id,
        name: existingActiveLoop.config.name,
      };
      throw error;
    }
  }

  /**
   * Create a new loop.
   * The loop name is automatically generated from the prompt using opencode.
   */
  async createLoop(options: CreateLoopOptions): Promise<Loop> {
    const id = crypto.randomUUID();
    const now = createTimestamp();

    // Generate loop name from prompt using opencode
    let generatedName: string;
    try {
      // Get backend from global manager
      const backend = backendManager.getBackend();
      
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
      // If name generation fails, use timestamp-based fallback
      log.warn(`Failed to generate loop name: ${String(error)}, using fallback`);
      const timestamp = new Date().toISOString()
        .replace(/[T:.]/g, "-")
        .replace(/Z$/, "")
        .slice(0, 19);
      generatedName = `loop-${timestamp}`;
    }

    const config: LoopConfig = {
      id,
      name: generatedName,
      directory: options.directory,
      prompt: options.prompt,
      createdAt: now,
      updatedAt: now,
      workspaceId: options.workspaceId,
      model:
        options.modelProviderID && options.modelID
          ? { providerID: options.modelProviderID, modelID: options.modelID }
          : undefined,
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
      planMode: options.planMode ?? DEFAULT_LOOP_CONFIG.planMode,
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
   * This creates the plan and sets up the planning session.
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

    // Check if another active loop exists for the same directory
    await this.validateNoActiveLoopForDirectory(loop.config.directory, loopId);

    // Get the appropriate command executor
    const executor = await backendManager.getCommandExecutorAsync(loop.config.directory);
    const git = GitService.withExecutor(executor);

    // Check for uncommitted changes
    const hasChanges = await git.hasUncommittedChanges(loop.config.directory);
    if (hasChanges) {
      const changedFiles = await git.getChangedFiles(loop.config.directory);
      
      // In plan mode, always allow uncommitted changes in .planning/ only
      const onlyPlanningChanges = changedFiles.every((file) => file.startsWith(".planning/") || file === ".planning");
      
      if (!onlyPlanningChanges) {
        const error = new Error("Directory has uncommitted changes. Please commit or stash your changes before starting a loop.") as Error & {
          code: string;
          changedFiles: string[];
        };
        error.code = "UNCOMMITTED_CHANGES";
        error.changedFiles = changedFiles;
        throw error;
      }
    }

    // Clear .planning folder BEFORE starting session (if requested)
    if (loop.config.clearPlanningFolder && !loop.state.planMode?.planningFolderCleared) {
      const planningDir = `${loop.config.directory}/.planning`;
      
      try {
        const exists = await executor.directoryExists(planningDir);
        if (exists) {
          const files = await executor.listDirectory(planningDir);
          const filesToDelete = files.filter((file) => file !== ".gitkeep");
          
          if (filesToDelete.length > 0) {
            const fileArgs = filesToDelete.map((file) => `${planningDir}/${file}`);
            await executor.exec("rm", ["-rf", ...fileArgs], {
              cwd: loop.config.directory,
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
    const planFilePath = `${loop.config.directory}/.planning/plan.md`;
    try {
      const planFileExists = await executor.fileExists(planFilePath);
      if (planFileExists) {
        await executor.exec("rm", ["-f", planFilePath], { cwd: loop.config.directory });
        log.debug("Cleared stale plan.md file before starting plan mode");
      }
    } catch (error) {
      log.warn(`Failed to clear plan.md: ${String(error)}`);
    }

    // Get backend from global manager
    const backend = backendManager.getBackend();

    // Create engine with plan mode prompt
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
      const executor = await backendManager.getCommandExecutorAsync(loop.config.directory);
      const git = GitService.withExecutor(executor);
      const backend = backendManager.getBackend();
      
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

    // Set up git branch now (was skipped during plan mode)
    try {
      await engine.setupGitBranchForPlanAcceptance();
    } catch (error) {
      throw new Error(`Failed to set up git branch: ${String(error)}`);
    }

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
- Update .planning/status.md with your progress
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

    // Check if another active loop exists for the same directory
    await this.validateNoActiveLoopForDirectory(loop.config.directory, loopId);

    // Get the appropriate command executor for the current mode
    // (local for spawn mode, remote for connect mode)
    // Use async version to ensure connection is established in connect mode
    const executor = await backendManager.getCommandExecutorAsync(loop.config.directory);
    const git = GitService.withExecutor(executor);

    // Check for uncommitted changes - fail immediately if found
    const hasChanges = await git.hasUncommittedChanges(loop.config.directory);

    if (hasChanges) {
      const changedFiles = await git.getChangedFiles(loop.config.directory);
      
      // If the loop has plan mode and folder was already cleared, or if clearPlanningFolder is enabled,
      // allow uncommitted changes in .planning/ only (since we're about to clear it or already cleared it)
      const shouldAllowPlanningChanges = 
        (loop.state.planMode?.planningFolderCleared || loop.config.clearPlanningFolder) &&
        changedFiles.every((file) => file.startsWith(".planning/") || file === ".planning");
      
      if (!shouldAllowPlanningChanges) {
        const error = new Error("Directory has uncommitted changes. Please commit or stash your changes before starting a loop.") as Error & {
          code: string;
          changedFiles: string[];
        };
        error.code = "UNCOMMITTED_CHANGES";
        error.changedFiles = changedFiles;
        throw error;
      }
    }

    // Get backend from global manager
    const backend = backendManager.getBackend();

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
      const executor = await backendManager.getCommandExecutorAsync(loop.config.directory);
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
      const executor = await backendManager.getCommandExecutorAsync(loop.config.directory);
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
   * Discard a completed loop (delete git branch without merging).
   * Resets the working directory to a clean state.
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
      // Get the appropriate command executor for the current mode
      const executor = await backendManager.getCommandExecutorAsync(loop.config.directory);
      const git = GitService.withExecutor(executor);

      // First, reset any uncommitted changes on the working branch
      await git.resetHard(loop.config.directory, {
        expectedBranch: loop.state.git.workingBranch,
      });

      // Checkout original branch
      await git.checkoutBranch(
        loop.config.directory,
        loop.state.git.originalBranch
      );

      // Reset original branch to clean state too (in case of any issues)
      await git.resetHard(loop.config.directory, {
        expectedBranch: loop.state.git.originalBranch,
      });

      // Delete the working branch
      await git.deleteBranch(loop.config.directory, loop.state.git.workingBranch);

      // Update status to 'deleted' (final state)
      const updatedState = {
        ...loop.state,
        status: "deleted" as const,
      };
      await updateLoopState(loopId, updatedState);

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
   * Cleans up review branches and marks as non-addressable before deletion.
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

    // Clean up review branches if review mode is active
    if (loop.state.reviewMode?.addressable && loop.state.reviewMode.reviewBranches.length > 0) {
      try {
        const executor = await backendManager.getCommandExecutorAsync(loop.config.directory);
        const git = GitService.withExecutor(executor);
        
        // Try to delete review branches (ignore errors - they might already be deleted)
        for (const branchName of loop.state.reviewMode.reviewBranches) {
          try {
            await git.deleteBranch(loop.config.directory, branchName);
            log.debug(`Cleaned up review branch: ${branchName}`);
          } catch (error) {
            log.debug(`Could not delete branch ${branchName}: ${String(error)}`);
          }
        }
      } catch (error) {
        log.warn(`Failed to clean up review branches: ${String(error)}`);
        // Continue with purge even if branch cleanup fails
      }
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
   * Switches back to the original branch, pulls latest changes, and deletes the working branch.
   * Used when the loop's branch was merged externally (e.g., via GitHub PR) and the user
   * wants to sync their local environment.
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
      // Get the appropriate command executor for the current mode
      const executor = await backendManager.getCommandExecutorAsync(loop.config.directory);
      const git = GitService.withExecutor(executor);

      // First, reset any uncommitted changes on the working branch
      await git.resetHard(loop.config.directory, {
        expectedBranch: gitState.workingBranch,
      });

      // Checkout original branch
      await git.checkoutBranch(
        loop.config.directory,
        gitState.originalBranch
      );

      // Pull latest changes from remote (this handles failures gracefully)
      const pullSucceeded = await git.pull(loop.config.directory, gitState.originalBranch);
      if (pullSucceeded) {
        log.info(`[LoopManager] markMerged: Pulled latest changes for loop ${loopId}`);
      } else {
        log.info(`[LoopManager] markMerged: Pull skipped or failed for loop ${loopId} (non-fatal)`);
      }

      // Delete the working branch
      try {
        await git.deleteBranch(loop.config.directory, gitState.workingBranch);
        log.debug(`[LoopManager] markMerged: Deleted working branch for loop ${loopId}`);
      } catch (error) {
        // Log but don't fail - branch might already be deleted
        log.warn(`[LoopManager] markMerged: Failed to delete branch: ${String(error)}`);
      }

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
      const jumpstartableStates = ["completed", "stopped", "failed", "max_iterations"];
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
    const jumpstartableStates = ["completed", "stopped", "failed", "max_iterations"];
    if (!jumpstartableStates.includes(loop.state.status)) {
      return { success: false, error: `Loop cannot be jumpstarted from status: ${loop.state.status}` };
    }

    // Check if another active loop exists for the same directory
    try {
      await this.validateNoActiveLoopForDirectory(loop.config.directory, loopId);
    } catch (validationError) {
      return { success: false, error: String(validationError) };
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

    // Reset the loop to a restartable state
    loop.state.status = "stopped"; // LoopEngine.start() accepts 'idle', 'stopped', or 'planning'
    loop.state.completedAt = undefined;
    
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
   */
  private async jumpstartOnExistingBranch(loopId: string, loop: Loop): Promise<{ success: boolean; error?: string }> {
    try {
      // Get the appropriate command executor for the current mode
      const executor = await backendManager.getCommandExecutorAsync(loop.config.directory);
      const git = GitService.withExecutor(executor);
      const backend = backendManager.getBackend();

      // Check out the existing working branch with retry logic for lock file issues
      const workingBranch = loop.state.git!.workingBranch;
      log.info(`Jumpstarting loop ${loopId} on existing branch: ${workingBranch}`);
      
      // Retry checkout up to 3 times to handle race conditions with in-flight git operations
      const maxRetries = 3;
      for (let attempt = 1; attempt <= maxRetries; attempt++) {
        // Clean up any stale git lock files from previously killed processes
        // This can happen when a loop is forcefully stopped mid-git-operation
        await GitService.cleanupStaleLockFiles(loop.config.directory, 1, 0);
        
        try {
          await git.checkoutBranch(loop.config.directory, workingBranch);
          break; // Success - exit retry loop
        } catch (checkoutError) {
          const errorStr = String(checkoutError);
          if (errorStr.includes("index.lock") && attempt < maxRetries) {
            log.warn(`[LoopManager] Checkout failed due to lock file, retrying (${attempt}/${maxRetries})...`);
            await new Promise(resolve => setTimeout(resolve, 100 * attempt)); // Exponential backoff
            continue;
          }
          throw checkoutError; // Not a lock issue or max retries exceeded
        }
      }

      // Create and start a new loop engine with skipGitSetup
      // (branch is already checked out, no need to create a new one)
      const engine = new LoopEngine({
        loop: { config: loop.config, state: loop.state },
        backend,
        gitService: git,
        eventEmitter: this.emitter,
        onPersistState: async (state) => {
          await updateLoopState(loopId, state);
        },
        skipGitSetup: true, // Don't create a new branch - continue on existing
      });
      this.engines.set(loopId, engine);

      // Start state persistence
      this.startStatePersistence(loopId);

      // Start execution (fire and forget - don't block the caller)
      engine.start().catch((error) => {
        log.error(`Loop ${loopId} failed to start after jumpstart:`, String(error));
      });

      log.info(`Jumpstarted loop ${loopId} with pending message on existing branch: ${workingBranch}`);
      return { success: true };
    } catch (error) {
      log.error(`Failed to jumpstart loop ${loopId} on existing branch: ${String(error)}`);
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
      const executor = await backendManager.getCommandExecutorAsync(loop.config.directory);
      const git = GitService.withExecutor(executor);

      // Get backend instance
      const backend = backendManager.getBackend();

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

        // Check out the existing working branch
        await git.checkoutBranch(loop.config.directory, loop.state.git.workingBranch);

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
        // MERGED LOOP: Create a new review branch
        if (!loop.state.git?.originalBranch) {
          return { success: false, error: "No original branch found for merged loop" };
        }

        // Increment review cycles
        loop.state.reviewMode.reviewCycles += 1;

        // Generate new review branch name
        const safeName = sanitizeBranchName(loop.config.name);
        const reviewBranchName = `${loop.config.git.branchPrefix}${safeName}-review-${loop.state.reviewMode.reviewCycles}`;

        // Check out original branch and create new review branch
        await git.checkoutBranch(loop.config.directory, loop.state.git.originalBranch);
        await git.createBranch(loop.config.directory, reviewBranchName);

        // Update git state
        loop.state.git.workingBranch = reviewBranchName;
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
- Make targeted changes to address each reviewer comment
- Update .planning/status.md with your progress addressing the feedback
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
    
    // Try to stop all running engines gracefully
    const stopPromises = Array.from(this.engines.entries()).map(async ([loopId, engine]) => {
      try {
        await engine.stop("Force reset by user");
        await updateLoopState(loopId, engine.state);
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
    
    // Reset the backend connection
    await backendManager.reset();
    
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
