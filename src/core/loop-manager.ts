/**
 * Loop manager for Ralph Loops Management System.
 * Manages the lifecycle of Ralph Loops: CRUD, start/stop, accept/discard.
 * This is the main entry point for loop operations.
 */

import type {
  Loop,
  LoopConfig,
  LoopState,
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
} from "../persistence/loops";
import { backendManager } from "./backend-manager";
import { GitService } from "./git-service";
import { LoopEngine } from "./loop-engine";
import { loopEventEmitter, SimpleEventEmitter } from "./event-emitter";
import { log } from "./logger";

/**
 * Options for creating a new loop.
 */
export interface CreateLoopOptions {
  /** Human-readable name */
  name: string;
  /** Absolute path to working directory */
  directory: string;
  /** The task prompt/PRD */
  prompt: string;
  /** Model provider ID */
  modelProviderID?: string;
  /** Model ID */
  modelID?: string;
  /** Maximum iterations (optional) */
  maxIterations?: number;
  /** Maximum consecutive identical errors before failsafe exit (default: 5) */
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
  /** Start in plan creation mode instead of immediate execution */
  planMode?: boolean;
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
   */
  async createLoop(options: CreateLoopOptions): Promise<Loop> {
    const id = crypto.randomUUID();
    const now = createTimestamp();

    const config: LoopConfig = {
      id,
      name: options.name,
      directory: options.directory,
      prompt: options.prompt,
      createdAt: now,
      updatedAt: now,
      model:
        options.modelProviderID && options.modelID
          ? { providerID: options.modelProviderID, modelID: options.modelID }
          : undefined,
      maxIterations: options.maxIterations,
      maxConsecutiveErrors: options.maxConsecutiveErrors ?? DEFAULT_LOOP_CONFIG.maxConsecutiveErrors,
      activityTimeoutSeconds: options.activityTimeoutSeconds ?? DEFAULT_LOOP_CONFIG.activityTimeoutSeconds,
      stopPattern: options.stopPattern ?? DEFAULT_LOOP_CONFIG.stopPattern,
      git: {
        branchPrefix: options.gitBranchPrefix ?? DEFAULT_LOOP_CONFIG.git.branchPrefix,
        commitPrefix: options.gitCommitPrefix ?? DEFAULT_LOOP_CONFIG.git.commitPrefix,
      },
      baseBranch: options.baseBranch,
      clearPlanningFolder: options.clearPlanningFolder ?? false,
    };

    const state = createInitialState(id);
    
    // If plan mode is enabled, initialize plan mode state
    if (options.planMode) {
      state.status = "planning";
      state.planMode = {
        active: true,
        feedbackRounds: 0,
        planningFolderCleared: false,
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

    // Start the plan creation
    engine.start().catch((error) => {
      log.error(`Loop ${loopId} plan mode failed:`, String(error));
    });

    // Persist state changes periodically
    this.startStatePersistence(loopId);
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

    // Increment feedback rounds
    if (engine.state.planMode) {
      engine.state.planMode.feedbackRounds += 1;
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
    engine.runPlanIteration().catch((error) => {
      log.error(`Loop ${loopId} plan feedback iteration failed:`, String(error));
    });
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
    // Mark plan mode as no longer active but preserve the flag that folder was cleared
    const updatedState: Partial<LoopState> = {
      status: "running",
      planMode: {
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

    // Start the execution loop in the background
    engine.continueExecution().catch((error) => {
      log.error(`Loop ${loopId} execution after plan acceptance failed:`, String(error));
    });
  }

  /**
   * Discard a plan and delete the loop.
   */
  async discardPlan(loopId: string): Promise<boolean> {
    // Stop the engine if running
    if (this.engines.has(loopId)) {
      await this.stopLoop(loopId, "Plan discarded");
    }

    // Emit plan discarded event
    this.emitter.emit({
      type: "loop.plan.discarded",
      loopId,
      timestamp: createTimestamp(),
    });

    // Delete the loop
    return this.deleteLoop(loopId);
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
    // Stop if running
    if (this.engines.has(loopId)) {
      await this.stopLoop(loopId, "Loop deleted");
    }

    // Get loop to check for git branch
    const loop = await loadLoop(loopId);
    if (!loop) {
      return false;
    }
    
    // If there's a working branch, discard it first
    if (loop.state.git?.workingBranch) {
      const discardResult = await this.discardLoop(loopId);
      if (!discardResult.success) {
        // Log but don't fail the delete - user explicitly wants to delete
        log.warn(`Failed to discard git branch during delete: ${discardResult.error}`);
      }
    }

    // Update status to 'deleted' (soft delete - final state)
    const updatedState = {
      ...loop.state,
      status: "deleted" as const,
    };
    await updateLoopState(loopId, updatedState);

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

    // Start in background
    engine.start().catch((error) => {
      log.error(`Loop ${loopId} failed:`, String(error));
    });

    // Persist state changes periodically
    this.startStatePersistence(loopId);
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

      // Delete the working branch
      await git.deleteBranch(loop.config.directory, loop.state.git.workingBranch);

      // Update status to 'merged' (final state)
      const updatedState = {
        ...loop.state,
        status: "merged" as const,
      };
      await updateLoopState(loopId, updatedState);

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

      // Switch back to the original branch
      await git.checkoutBranch(
        loop.config.directory,
        loop.state.git.originalBranch
      );

      // Update status to 'pushed' (final state)
      const updatedState = {
        ...loop.state,
        status: "pushed" as const,
      };
      await updateLoopState(loopId, updatedState);

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
      await git.resetHard(loop.config.directory);

      // Checkout original branch
      await git.checkoutBranch(
        loop.config.directory,
        loop.state.git.originalBranch
      );

      // Reset original branch to clean state too (in case of any issues)
      await git.resetHard(loop.config.directory);

      // Delete the working branch
      await git.deleteBranch(loop.config.directory, loop.state.git.workingBranch);

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

    // Actually delete the loop file
    const deleted = await deleteLoopFile(loopId);
    if (!deleted) {
      return { success: false, error: "Failed to delete loop file" };
    }

    return { success: true };
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
}

/**
 * Singleton instance of LoopManager.
 */
export const loopManager = new LoopManager();
