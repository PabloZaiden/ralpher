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
import { GitService, gitService } from "./git-service";
import { LoopEngine } from "./loop-engine";
import { loopEventEmitter, SimpleEventEmitter } from "./event-emitter";

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
  /** Custom stop pattern (default: "<promise>COMPLETE</promise>$") */
  stopPattern?: string;
  /** Git branch prefix (default: "ralph/") */
  gitBranchPrefix?: string;
  /** Git commit prefix (default: "[Ralph]") */
  gitCommitPrefix?: string;
}

/**
 * Options for starting a loop.
 */
export interface StartLoopOptions {
  /** How to handle uncommitted changes */
  handleUncommitted?: "commit" | "stash";
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
 * LoopManager handles the lifecycle of Ralph Loops.
 */
export class LoopManager {
  private engines = new Map<string, LoopEngine>();
  private git: GitService;
  private emitter: SimpleEventEmitter<LoopEvent>;

  constructor(options?: {
    gitService?: GitService;
    eventEmitter?: SimpleEventEmitter<LoopEvent>;
  }) {
    this.git = options?.gitService ?? gitService;
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
      stopPattern: options.stopPattern ?? DEFAULT_LOOP_CONFIG.stopPattern,
      git: {
        branchPrefix: options.gitBranchPrefix ?? DEFAULT_LOOP_CONFIG.git.branchPrefix,
        commitPrefix: options.gitCommitPrefix ?? DEFAULT_LOOP_CONFIG.git.commitPrefix,
      },
    };

    const state = createInitialState(id);
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
    if (this.engines.has(loopId)) {
      throw new Error("Cannot update a running loop. Stop it first.");
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
        console.warn(`Failed to discard git branch during delete: ${discardResult.error}`);
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
   */
  async startLoop(loopId: string, options?: StartLoopOptions): Promise<void> {
    const loop = await loadLoop(loopId);
    if (!loop) {
      throw new Error(`Loop not found: ${loopId}`);
    }

    // Check if already running
    if (this.engines.has(loopId)) {
      throw new Error("Loop is already running");
    }

    // Check for uncommitted changes
    const hasChanges = await this.git.hasUncommittedChanges(loop.config.directory);

    if (hasChanges) {
      if (!options?.handleUncommitted) {
        const changedFiles = await this.git.getChangedFiles(loop.config.directory);
        const error = new Error("Directory has uncommitted changes") as Error & {
          code: string;
          changedFiles: string[];
        };
        error.code = "UNCOMMITTED_CHANGES";
        error.changedFiles = changedFiles;
        throw error;
      }

      // Handle uncommitted changes
      if (options.handleUncommitted === "commit") {
        await this.git.commit(
          loop.config.directory,
          "[Pre-Ralph] Uncommitted changes"
        );
      } else if (options.handleUncommitted === "stash") {
        await this.git.stash(loop.config.directory);
      }
    }

    // Get backend from global manager
    const backend = backendManager.getBackend();

    // Create engine with persistence callback
    const engine = new LoopEngine({
      loop,
      backend,
      gitService: this.git,
      eventEmitter: this.emitter,
      onPersistState: async (state) => {
        await updateLoopState(loopId, state);
      },
    });

    this.engines.set(loopId, engine);

    // Start in background
    engine.start().catch((error) => {
      console.error(`Loop ${loopId} failed:`, String(error));
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
    // Use getLoop to check engine state first
    const loop = await this.getLoop(loopId);
    if (!loop) {
      return { success: false, error: "Loop not found" };
    }

    // Must be completed
    if (loop.state.status !== "completed" && loop.state.status !== "max_iterations") {
      return { success: false, error: `Cannot accept loop in status: ${loop.state.status}` };
    }

    // Must have git state (branch was created)
    if (!loop.state.git) {
      return { success: false, error: "No git branch was created for this loop" };
    }

    try {
      // Merge working branch into original branch
      const mergeCommit = await this.git.mergeBranch(
        loop.config.directory,
        loop.state.git.workingBranch,
        loop.state.git.originalBranch
      );

      // Delete the working branch
      await this.git.deleteBranch(loop.config.directory, loop.state.git.workingBranch);

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
      // First, reset any uncommitted changes on the working branch
      await this.git.resetHard(loop.config.directory);

      // Checkout original branch
      await this.git.checkoutBranch(
        loop.config.directory,
        loop.state.git.originalBranch
      );

      // Reset original branch to clean state too (in case of any issues)
      await this.git.resetHard(loop.config.directory);

      // Delete the working branch
      await this.git.deleteBranch(loop.config.directory, loop.state.git.workingBranch);

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
   * Only allowed for loops in 'merged' or 'deleted' states.
   */
  async purgeLoop(loopId: string): Promise<{ success: boolean; error?: string }> {
    const loop = await loadLoop(loopId);
    if (!loop) {
      return { success: false, error: "Loop not found" };
    }

    // Only allow purge for final states
    if (loop.state.status !== "merged" && loop.state.status !== "deleted") {
      return { success: false, error: `Cannot purge loop in status: ${loop.state.status}. Only merged or deleted loops can be purged.` };
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
        console.error(`Failed to persist loop state: ${String(error)}`);
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
