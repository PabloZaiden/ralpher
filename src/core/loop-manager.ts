/**
 * Loop manager for Ralph Loops Management System.
 * Manages the lifecycle of Ralph Loops: CRUD, start/stop, accept/discard.
 * This is the main entry point for loop operations.
 */

import type {
  Loop,
  LoopConfig,
  LoopState,
  GitCommit,
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
import { getBackend } from "../backends/registry";
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
  /** Backend type (default: "opencode") */
  backendType?: string;
  /** Backend mode (default: "spawn") */
  backendMode?: "spawn" | "connect";
  /** Backend hostname for connect mode */
  backendHostname?: string;
  /** Backend port for connect mode */
  backendPort?: number;
  /** Model provider ID */
  modelProviderID?: string;
  /** Model ID */
  modelID?: string;
  /** Maximum iterations (optional) */
  maxIterations?: number;
  /** Custom stop pattern (default: "<promise>COMPLETE</promise>$") */
  stopPattern?: string;
  /** Enable git integration (default: true) */
  gitEnabled?: boolean;
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
      backend: {
        type: (options.backendType as "opencode") ?? DEFAULT_LOOP_CONFIG.backend.type,
        mode: options.backendMode ?? DEFAULT_LOOP_CONFIG.backend.mode,
        hostname: options.backendHostname,
        port: options.backendPort,
      },
      model:
        options.modelProviderID && options.modelID
          ? { providerID: options.modelProviderID, modelID: options.modelID }
          : undefined,
      maxIterations: options.maxIterations,
      stopPattern: options.stopPattern ?? DEFAULT_LOOP_CONFIG.stopPattern,
      git: {
        enabled: options.gitEnabled ?? DEFAULT_LOOP_CONFIG.git.enabled,
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
   * Delete a loop.
   */
  async deleteLoop(loopId: string): Promise<boolean> {
    // Stop if running
    if (this.engines.has(loopId)) {
      await this.stopLoop(loopId, "Loop deleted");
    }

    const deleted = await deleteLoopFile(loopId);

    if (deleted) {
      this.emitter.emit({
        type: "loop.deleted",
        loopId,
        timestamp: createTimestamp(),
      });
    }

    return deleted;
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

    // Check for uncommitted changes if git is enabled
    if (loop.config.git.enabled) {
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
    }

    // Get backend
    const backend = getBackend(loop.config.backend.type);

    // Create engine
    const engine = new LoopEngine({
      loop,
      backend,
      gitService: this.git,
      eventEmitter: this.emitter,
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
   * Pause a running loop.
   */
  async pauseLoop(loopId: string): Promise<void> {
    const engine = this.engines.get(loopId);
    if (!engine) {
      throw new Error("Loop is not running");
    }

    engine.pause();

    // Persist state
    await updateLoopState(loopId, engine.state);
  }

  /**
   * Resume a paused loop.
   */
  async resumeLoop(loopId: string): Promise<void> {
    const engine = this.engines.get(loopId);
    if (!engine) {
      throw new Error("Loop is not running");
    }

    await engine.resume();
  }

  /**
   * Accept a completed loop (merge git branch).
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

    // Must have git enabled
    if (!loop.config.git.enabled || !loop.state.git) {
      return { success: false, error: "Git is not enabled for this loop" };
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
   */
  async discardLoop(loopId: string): Promise<{ success: boolean; error?: string }> {
    // Use getLoop to check engine state first
    const loop = await this.getLoop(loopId);
    if (!loop) {
      return { success: false, error: "Loop not found" };
    }

    // Must have git enabled
    if (!loop.config.git.enabled || !loop.state.git) {
      return { success: false, error: "Git is not enabled for this loop" };
    }

    try {
      // Checkout original branch
      await this.git.checkoutBranch(
        loop.config.directory,
        loop.state.git.originalBranch
      );

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
