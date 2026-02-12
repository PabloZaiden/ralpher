/**
 * Loop engine for Ralph Loops Management System.
 * Handles the execution of Ralph Loop iterations.
 * Each iteration sends a prompt to the AI agent and checks for completion.
 */

import type {
  LoopConfig,
  LoopState,
  Loop,
  IterationSummary,
  GitCommit,
  LoopLogEntry,
  ModelConfig,
} from "../types/loop";
import { DEFAULT_LOOP_CONFIG } from "../types/loop";
import type {
  LoopEvent,
  MessageData,
  ToolCallData,
  LogLevel,
} from "../types/events";
import { createTimestamp } from "../types/events";
import type {
  PromptInput,
  AgentEvent,
} from "../backends/types";
import { OpenCodeBackend } from "../backends/opencode";
import { backendManager, buildConnectionConfig } from "./backend-manager";
import type { GitService } from "./git-service";
import { SimpleEventEmitter, loopEventEmitter } from "./event-emitter";
import { log } from "./logger";
import { sanitizeBranchName } from "../utils";
import { markCommentsAsAddressed } from "../persistence/review-comments";
import { assertValidTransition } from "./loop-state-machine";

/**
 * Maximum number of log entries to persist in loop state.
 * When exceeded, the oldest entries are evicted to keep memory bounded.
 * The frontend loads the last 1000 on page refresh, so 5000 provides
 * ample history while preventing unbounded growth.
 */
const MAX_PERSISTED_LOGS = 5000;

/**
 * Maximum number of messages to persist in loop state.
 * Messages are larger than logs due to AI response content.
 */
const MAX_PERSISTED_MESSAGES = 2000;

/**
 * Maximum number of tool calls to persist in loop state.
 */
const MAX_PERSISTED_TOOL_CALLS = 5000;

/**
 * Generate a git-safe branch name from a loop name and timestamp.
 * - Converts to lowercase
 * - Replaces spaces and special characters with hyphens
 * - Removes consecutive hyphens
 * - Limits length to avoid overly long branch names
 */
function generateBranchName(prefix: string, name: string, timestamp: string): string {
  // Parse the timestamp to get a readable date-time format
  const date = new Date(timestamp);
  const dateStr = date.toISOString()
    .replace(/[:.]/g, "-")  // Replace : and . with -
    .replace("T", "-")       // Replace T with -
    .slice(0, 19);           // Take YYYY-MM-DD-HH-MM-SS

  // Sanitize the name for git branch
  const safeName = sanitizeBranchName(name);

  return `${prefix}${safeName}-${dateStr}`;
}

/**
 * Backend interface for LoopEngine.
 * This is a structural type that defines the methods LoopEngine needs.
 * Both OpenCodeBackend and MockOpenCodeBackend satisfy this interface.
 * Using a structural type (interface) instead of a union allows for
 * easy mocking in tests without requiring all internal class fields.
 */
export interface LoopBackend {
  connect: OpenCodeBackend["connect"];
  disconnect: OpenCodeBackend["disconnect"];
  isConnected: OpenCodeBackend["isConnected"];
  createSession: OpenCodeBackend["createSession"];
  sendPrompt: OpenCodeBackend["sendPrompt"];
  sendPromptAsync: OpenCodeBackend["sendPromptAsync"];
  abortSession: OpenCodeBackend["abortSession"];
  subscribeToEvents: OpenCodeBackend["subscribeToEvents"];
  replyToPermission: OpenCodeBackend["replyToPermission"];
  replyToQuestion: OpenCodeBackend["replyToQuestion"];
}

/**
 * Options for creating a LoopEngine.
 */
export interface LoopEngineOptions {
  /** The loop configuration and state */
  loop: Loop;
  /** The agent backend to use */
  backend: LoopBackend;
  /** Git service instance (required) */
  gitService: GitService;
  /** Event emitter instance (optional, defaults to global) */
  eventEmitter?: SimpleEventEmitter<LoopEvent>;
  /** Callback to persist state to disk (optional) */
  onPersistState?: (state: LoopState) => Promise<void>;
  /** Skip git branch setup (for review cycles where branch is already set up) */
  skipGitSetup?: boolean;
}

/**
 * Result of running an iteration.
 */
export interface IterationResult {
  /** Whether the loop should continue */
  continue: boolean;
  /** The outcome of this iteration */
  outcome: "continue" | "complete" | "error" | "plan_ready";
  /** The full response content from the AI */
  responseContent: string;
  /** Error message if outcome is "error" */
  error?: string;
  /** Number of messages received */
  messageCount: number;
  /** Number of tool calls made */
  toolCallCount: number;
}

/**
 * Mutable context passed through a single iteration.
 * Groups the per-iteration tracking state that processAgentEvent() and
 * evaluateOutcome() need to read and write.
 */
interface IterationContext {
  iteration: number;
  responseContent: string;
  reasoningContent: string;
  messageCount: number;
  toolCallCount: number;
  outcome: IterationResult["outcome"];
  error: string | undefined;
  currentMessageId: string | null;
  toolCalls: Map<string, { id: string; name: string; input: unknown }>;
  /** ID of the current streaming response log entry (for delta combining) */
  currentResponseLogId: string | null;
  currentResponseLogContent: string;
  /** ID of the current streaming reasoning log entry (for delta combining) */
  currentReasoningLogId: string | null;
  currentReasoningLogContent: string;
}

/**
 * Stop pattern detector.
 * Checks if the AI response indicates completion.
 */
export class StopPatternDetector {
  private pattern: RegExp | null;

  constructor(patternString: string) {
    try {
      this.pattern = new RegExp(patternString);
    } catch (error) {
      // Invalid regex pattern — log a warning and disable matching
      // to prevent ReDoS or runtime crashes from user-supplied patterns.
      this.pattern = null;
      console.warn(`Invalid stop pattern regex "${patternString}": ${String(error)}`);
    }
  }

  /**
   * Check if the content matches the stop pattern.
   * Returns false if the pattern was invalid.
   */
  matches(content: string): boolean {
    if (!this.pattern) {
      return false;
    }
    return this.pattern.test(content);
  }
}

/**
 * Wraps an event stream's next() call with a timeout.
 * Throws an error if no event is received within the specified time.
 */
async function nextWithTimeout<T>(
  stream: { next: () => Promise<T | null> },
  timeoutMs: number
): Promise<T | null> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => {
      reject(new Error(`No activity for ${Math.round(timeoutMs / 1000)} seconds`));
    }, timeoutMs);
  });

  try {
    const result = await Promise.race([stream.next(), timeoutPromise]);
    return result;
  } finally {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
  }
}

/**
 * LoopEngine handles the execution of a single Ralph Loop.
 * It manages iterations, stop pattern detection, and git commits.
 */
export class LoopEngine {
  private loop: Loop;
  private backend: LoopBackend;
  private git: GitService;
  private emitter: SimpleEventEmitter<LoopEvent>;
  private stopDetector: StopPatternDetector;
  private aborted = false;
  private sessionId: string | null = null;
  private onPersistState?: (state: LoopState) => Promise<void>;
  /** Guard to prevent concurrent runLoop() executions */
  private isLoopRunning = false;
  /** Skip git branch setup (for review cycles) */
  private skipGitSetup: boolean;
  /** 
   * Flag to indicate that a pending prompt/model was injected and the current
   * iteration should be aborted to immediately start a new one with the injected values.
   * This is different from `aborted` which stops the loop entirely.
   */
  private injectionPending = false;

  constructor(options: LoopEngineOptions) {
    this.loop = options.loop;
    this.backend = options.backend;
    this.git = options.gitService;
    this.emitter = options.eventEmitter ?? loopEventEmitter;
    this.stopDetector = new StopPatternDetector(options.loop.config.stopPattern);
    this.onPersistState = options.onPersistState;
    this.skipGitSetup = options.skipGitSetup ?? false;
  }

  /**
   * Get the current loop state.
   */
  get state(): LoopState {
    return this.loop.state;
  }

  /**
   * Get the loop configuration.
   */
  get config(): LoopConfig {
    return this.loop.config;
  }

  /**
   * Get the effective working directory for this loop.
   * Returns the worktree path. Every loop must operate in its own worktree.
   * Throws if the worktree path is not set -- this indicates a bug in the
   * lifecycle (e.g., calling this before setupGitBranch() completes).
   */
  get workingDirectory(): string {
    const worktreePath = this.loop.state.git?.worktreePath;
    if (!worktreePath) {
      throw new Error(
        `Loop ${this.config.id} has no worktree path. ` +
        `Every loop must operate in its own worktree. ` +
        `This is a bug -- workingDirectory was accessed before setupGitBranch() set the worktree path.`
      );
    }
    return worktreePath;
  }

  /**
   * Set a pending prompt that will be used for the next iteration.
   * This overrides the config.prompt for one iteration only.
   */
  setPendingPrompt(prompt: string): void {
    this.updateState({ pendingPrompt: prompt });
  }

  /**
   * Clear any pending prompt, reverting to the config.prompt.
   */
  clearPendingPrompt(): void {
    this.updateState({ pendingPrompt: undefined });
  }

  /**
   * Set a pending model to use for the next iteration.
   * This overrides the config.model and becomes the new default after use.
   */
  setPendingModel(model: ModelConfig): void {
    this.updateState({ pendingModel: model });
    // Emit event for UI update
    this.emitter.emit({
      type: "loop.pending.updated",
      loopId: this.loop.config.id,
      pendingModel: model,
      timestamp: createTimestamp(),
    });
  }

  /**
   * Clear any pending model.
   */
  clearPendingModel(): void {
    this.updateState({ pendingModel: undefined });
    // Emit event for UI update
    this.emitter.emit({
      type: "loop.pending.updated",
      loopId: this.loop.config.id,
      pendingModel: undefined,
      timestamp: createTimestamp(),
    });
  }

  /**
   * Clear all pending values (prompt and model).
   */
  clearPending(): void {
    this.updateState({ pendingPrompt: undefined, pendingModel: undefined });
    // Emit event for UI update
    this.emitter.emit({
      type: "loop.pending.updated",
      loopId: this.loop.config.id,
      pendingPrompt: undefined,
      pendingModel: undefined,
      timestamp: createTimestamp(),
    });
  }

  /**
   * Inject pending prompt and/or model immediately by aborting the current iteration.
   * Unlike regular setPending methods which wait for the current iteration to complete,
   * this method interrupts the AI and starts a new iteration immediately.
   * 
   * The session is preserved (conversation history maintained), only the current
   * AI processing is interrupted.
   * 
   * @param options - The pending prompt and/or model to inject
   */
  async injectPendingNow(options: { message?: string; model?: ModelConfig }): Promise<void> {
    // Set the pending values first
    if (options.message !== undefined) {
      this.updateState({ pendingPrompt: options.message });
    }
    if (options.model !== undefined) {
      this.updateState({ pendingModel: options.model });
    }

    // Emit event for UI update
    this.emitter.emit({
      type: "loop.pending.updated",
      loopId: this.loop.config.id,
      pendingPrompt: options.message,
      pendingModel: options.model,
      timestamp: createTimestamp(),
    });

    // If the loop is not actively running an iteration, no need to abort
    if (!this.isLoopRunning) {
      this.emitLog("debug", "Pending values set, loop not actively running - will apply on next iteration");
      return;
    }

    // Mark that we're doing an injection abort (not a user stop)
    this.injectionPending = true;

    // Abort the current session to interrupt AI processing
    if (this.sessionId) {
      try {
        this.emitLog("info", "Injecting pending message - aborting current AI processing");
        await this.backend.abortSession(this.sessionId);
      } catch {
        // Ignore abort errors - the session may already be complete
      }
    }
  }

  /**
   * Wait for any ongoing loop iteration to complete.
   * Used to ensure state modifications happen between iterations.
   */
  async waitForLoopIdle(timeoutMs = 30000): Promise<void> {
    const startTime = Date.now();
    while (this.isLoopRunning) {
      if (Date.now() - startTime > timeoutMs) {
        throw new Error(`Timed out waiting for loop to become idle after ${timeoutMs}ms`);
      }
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }

  /**
   * Start the loop execution.
   * This sets up the git branch and backend session.
   */
  async start(): Promise<void> {
    // Allow starting from idle, stopped, planning (for plan mode), or resolving_conflicts (for conflict resolution)
    if (this.loop.state.status !== "idle" && this.loop.state.status !== "stopped" && this.loop.state.status !== "planning" && this.loop.state.status !== "resolving_conflicts") {
      throw new Error(`Cannot start loop in status: ${this.loop.state.status}`);
    }

    this.emitLog("info", "Starting loop execution", { loopName: this.config.name });

    this.aborted = false;
    
    // Only update status if not in plan mode (preserve "planning" status)
    const isInPlanMode = this.loop.state.status === "planning";
    this.updateState({
      status: isInPlanMode ? "planning" : "starting",
      // Preserve existing startedAt (e.g., set by startPlanMode, or from a previous run
      // during jumpstart/review). Only set if not already present, so the timestamp
      // used for branch naming stays consistent with the persisted startedAt.
      startedAt: this.loop.state.startedAt ?? createTimestamp(),
      currentIteration: 0,
      recentIterations: [],
      error: undefined,
    });

    try {
      // Set up git branch first (before any file modifications)
      // Skip git setup in plan mode - already set up in startPlanMode()
      // Skip git setup for review cycles - branch is already set up
      if (!isInPlanMode && !this.skipGitSetup) {
        this.emitLog("info", "Setting up git branch...");
        log.trace("[LoopEngine] Starting setupGitBranch...");
        await this.setupGitBranch();
        log.trace("[LoopEngine] setupGitBranch completed successfully");
      } else if (this.skipGitSetup) {
        this.emitLog("info", "Skipping git branch setup (review cycle)");
      }

      // Clear .planning folder if requested (after branch setup, so deletions are on the new branch)
      // NEVER clear if plan mode already cleared it
      if (this.loop.state.planMode?.planningFolderCleared) {
        this.emitLog("info", "Skipping .planning folder clear - already cleared during plan mode");
      } else if (this.config.clearPlanningFolder) {
        this.emitLog("info", "Clearing .planning folder...");
        await this.clearPlanningFolder();
      }

      // Create backend session
      this.emitLog("info", "Connecting to AI backend...");
      log.trace("[LoopEngine] Starting setupSession...");
      await this.setupSession();
      log.trace("[LoopEngine] setupSession completed successfully");

      // Emit started event (skip in plan mode - will emit when plan is accepted)
      if (!isInPlanMode) {
        log.trace("[LoopEngine] About to emit loop.started event");
        this.emit({
          type: "loop.started",
          loopId: this.config.id,
          iteration: 0,
          timestamp: createTimestamp(),
        });
        log.trace("[LoopEngine] loop.started event emitted");
      }

      log.trace("[LoopEngine] About to emit 'Loop started successfully' log");
      this.emitLog("info", "Loop started successfully, beginning iterations");
      log.trace("[LoopEngine] 'Loop started successfully' log emitted");

      // Start the iteration loop
      log.trace("[LoopEngine] About to call runLoop");
      await this.runLoop();
      log.trace("[LoopEngine] runLoop completed");
    } catch (error) {
      this.emitLog("error", `Failed to start loop: ${String(error)}`);
      this.handleError(error);
    }
  }

  /**
   * Stop the loop execution.
   */
  async stop(reason = "User requested stop"): Promise<void> {
    this.emitLog("info", `Stopping loop: ${reason}`);
    this.aborted = true;

    // Clear the persistence callback to prevent stale async operations
    // from overwriting state after the loop is stopped/deleted
    this.onPersistState = undefined;

    if (this.sessionId) {
      try {
        this.emitLog("info", "Aborting backend session...");
        await this.backend.abortSession(this.sessionId);
      } catch {
        // Ignore abort errors
      }
    }

    this.updateState({
      status: "stopped",
      completedAt: createTimestamp(),
    });

    this.emit({
      type: "loop.stopped",
      loopId: this.config.id,
      reason,
      timestamp: createTimestamp(),
    });

    this.emitLog("info", "Loop stopped");
  }

  /**
   * Abort the backend session without changing loop status.
   * Used during force reset to preserve planning loops while cleaning up resources.
   * The engine will be cleared from memory, but the loop status remains unchanged.
   */
  async abortSessionOnly(reason = "Connection reset requested"): Promise<void> {
    this.emitLog("info", `Aborting session only (preserving status): ${reason}`);
    this.aborted = true;

    // Clear the persistence callback to prevent stale async operations
    this.onPersistState = undefined;

    if (this.sessionId) {
      try {
        this.emitLog("info", "Aborting backend session...");
        await this.backend.abortSession(this.sessionId);
      } catch {
        // Ignore abort errors
      }
    }

    this.emit({
      type: "loop.session_aborted",
      loopId: this.config.id,
      reason,
      timestamp: createTimestamp(),
    });

    this.emitLog("info", "Session aborted (status preserved)");
  }

  /**
   * Set up git branch and worktree for the loop (public method for plan mode).
   * Called from startPlanMode() to create the worktree before the AI session starts.
   * Idempotent: if the worktree already exists, it will be reused.
   */
  async setupGitBranchForPlanAcceptance(): Promise<void> {
    await this.setupGitBranch(true);
  }

  /**
   * Run a single plan mode iteration.
   * Used to process feedback or continue plan refinement.
   * The engine must already be in planning status.
   */
  async runPlanIteration(): Promise<void> {
    if (this.loop.state.status !== "planning") {
      throw new Error(`Cannot run plan iteration in status: ${this.loop.state.status}`);
    }
    
    // Run the loop (will run one iteration and return on plan_ready or error)
    await this.runLoop();
  }

  /**
   * Inject plan feedback immediately, interrupting the current AI processing if active.
   * 
   * If the loop is actively running an iteration, this aborts the session and
   * sets the injection flag so the runLoop() while-loop picks up the feedback
   * in the next iteration. If the loop is idle (e.g., plan was already ready),
   * starts a new plan iteration as a fire-and-forget operation.
   * 
   * The caller (LoopManager.sendPlanFeedback) is responsible for:
   * - Incrementing feedbackRounds and resetting isPlanReady before calling this
   * - Persisting state changes
   * - Emitting the loop.plan.feedback event
   * 
   * @param feedback - The user's feedback message
   */
  async injectPlanFeedback(feedback: string): Promise<void> {
    // Set the feedback as a pending prompt
    this.updateState({ pendingPrompt: feedback });

    // Emit event for UI update
    this.emitter.emit({
      type: "loop.pending.updated",
      loopId: this.loop.config.id,
      pendingPrompt: feedback,
      timestamp: createTimestamp(),
    });

    if (this.isLoopRunning) {
      // Loop is actively running an iteration — inject by aborting current processing.
      // The runLoop() while-loop (line 964-971) detects injectionPending after abort,
      // resets the flags, and continues to the next iteration which picks up pendingPrompt.
      this.injectionPending = true;

      if (this.sessionId) {
        try {
          this.emitLog("info", "Injecting plan feedback - aborting current AI processing");
          await this.backend.abortSession(this.sessionId);
        } catch {
          // Ignore abort errors - the session may already be complete
        }
      }
    } else {
      // Loop is idle (plan was ready, or between iterations) — start a new plan iteration.
      // Fire-and-forget: the plan iteration runs asynchronously and will emit events/update state.
      // This matches the pattern used by engine.start() and continueExecution() fire-and-forget calls.
      this.emitLog("info", "Injecting plan feedback - starting new plan iteration");
      this.runPlanIteration().catch((error) => {
        this.emitLog("error", `Plan feedback iteration failed: ${String(error)}`);
      });
    }
  }

  /**
   * Continue loop execution after plan acceptance.
   * Used to start the execution phase after a plan has been accepted.
   * The engine must be in running status with a pending prompt set.
   */
  async continueExecution(): Promise<void> {
    if (this.loop.state.status !== "running") {
      throw new Error(`Cannot continue execution in status: ${this.loop.state.status}`);
    }
    
    // Check if already running (guard against duplicate calls)
    if (this.isLoopRunning) {
      log.warn("[LoopEngine] continueExecution: Loop is already running, ignoring duplicate call");
      this.emitLog("warn", "Execution already in progress, ignoring duplicate continueExecution call");
      return;
    }
    
    log.trace("[LoopEngine] continueExecution: Starting execution loop");
    this.emitLog("info", "Starting execution after plan acceptance");
    
    // Run the loop
    await this.runLoop();
  }

  /**
   * Clear the .planning folder contents (except .gitkeep).
   * If any tracked files were deleted, commits the changes.
   */
  private async clearPlanningFolder(): Promise<void> {
    const planningDir = `${this.workingDirectory}/.planning`;
    
    try {
      // Get command executor for the worktree directory
      const executor = await backendManager.getCommandExecutorAsync(this.config.workspaceId, this.workingDirectory);
      
      // Check if .planning directory exists
      const exists = await executor.directoryExists(planningDir);
      
      if (!exists) {
        this.emitLog("debug", ".planning directory does not exist, skipping clear");
        return;
      }
      
      // List all files in the directory
      const files = await executor.listDirectory(planningDir);
      
      if (files.length === 0) {
        this.emitLog("debug", ".planning directory is already empty");
        return;
      }
      
      // Filter out .gitkeep
      const filesToDelete = files.filter((file) => file !== ".gitkeep");
      
      if (filesToDelete.length === 0) {
        this.emitLog("debug", ".planning directory only contains .gitkeep");
        return;
      }
      
      // Delete all files except .gitkeep using rm command
      const fileArgs = filesToDelete.map((file) => `${planningDir}/${file}`);
      const result = await executor.exec("rm", ["-rf", ...fileArgs], {
        cwd: this.workingDirectory,
      });
      
      if (!result.success) {
        throw new Error(`rm command failed: ${result.stderr}`);
      }
      
      this.emitLog("info", `Cleared .planning folder: ${filesToDelete.length} file(s) deleted`, {
        deletedCount: filesToDelete.length,
        preservedFiles: files.includes(".gitkeep") ? [".gitkeep"] : [],
      });
      
      // Check if clearing caused any uncommitted changes (deleted tracked files)
      // If so, commit them so the loop can proceed cleanly
      const hasChanges = await this.git.hasUncommittedChanges(this.workingDirectory);
      if (hasChanges) {
        this.emitLog("info", "Committing cleared .planning folder...");
        try {
          const commitInfo = await this.git.commit(
            this.workingDirectory,
            `${this.config.git.commitPrefix} Clear .planning folder for fresh start`,
            { expectedBranch: this.loop.state.git?.workingBranch }
          );
          this.emitLog("info", `Committed .planning folder cleanup`, {
            sha: commitInfo.sha.slice(0, 8),
            filesChanged: commitInfo.filesChanged,
          });
        } catch (commitError) {
          // Log but don't fail - the loop can still proceed
          this.emitLog("warn", `Failed to commit .planning folder cleanup: ${String(commitError)}`);
        }
      }
    } catch (error) {
      // Log error but don't fail the loop - this is not critical
      this.emitLog("warn", `Failed to clear .planning folder: ${String(error)}`);
    }
  }

  /**
   * Set up git branch for the loop using a git worktree.
   * Creates a new worktree with a dedicated branch for the loop, isolated from the main checkout.
   * @param allowPlanningFolderChanges - If true, allow uncommitted changes in .planning folder only (unused with worktrees, kept for API compatibility)
   */
  private async setupGitBranch(_allowPlanningFolderChanges = false): Promise<void> {
    const directory = this.config.directory;
    
    const branchName = this.resolveBranchName();

    // Check if we're in a git repo
    this.emitLog("debug", "Checking if directory is a git repository", { directory });
    const isRepo = await this.git.isGitRepo(directory);
    if (!isRepo) {
      throw new Error(`Directory is not a git repository: ${directory}`);
    }

    // No uncommitted-changes check needed — worktrees are isolated from the main checkout

    const originalBranch = await this.resolveOriginalBranch(directory);

    if (originalBranch.startsWith(this.config.git.branchPrefix) && !this.loop.state.git?.originalBranch) {
      this.emitLog("warn", `Base branch is a working branch (${originalBranch}); preserving base branch but continuing`, {
        originalBranch,
      });
    }

    // Pull latest changes from the base branch to minimize merge conflicts
    // Pull happens on the main checkout (config.directory), not the worktree
    this.emitLog("info", `Pulling latest changes from remote for branch: ${originalBranch}`);
    const pullSucceeded = await this.git.pull(directory, originalBranch);
    if (pullSucceeded) {
      this.emitLog("info", `Successfully pulled latest changes for ${originalBranch}`);
    } else {
      this.emitLog("debug", `Skipped pull for ${originalBranch} (no remote or upstream configured)`);
    }

    // Set up the worktree (create new, recreate, or reuse existing)
    const worktreePath = await this.setupWorktree(directory, branchName, originalBranch);

    // Update state with git info including the worktree path
    this.updateState({
      git: {
        originalBranch,
        workingBranch: branchName,
        worktreePath,
        commits: this.loop.state.git?.commits ?? [],
      },
    });

    log.trace("[LoopEngine] About to emit 'Git branch setup complete' log");
    this.emitLog("info", `Git branch setup complete`, { 
      originalBranch, 
      workingBranch: branchName,
      worktreePath,
    });
    log.trace("[LoopEngine] Exiting setupGitBranch");
  }

  /**
   * Determine the branch name for this loop.
   * Reuses an existing workingBranch if present (idempotent), otherwise generates
   * a new name from the loop name + startedAt timestamp.
   */
  private resolveBranchName(): string {
    if (this.loop.state.git?.workingBranch) {
      // Branch was already created (e.g., retry, jumpstart, or plan mode setup).
      // Reuse the authoritative name rather than regenerating from timestamp.
      return this.loop.state.git.workingBranch;
    }

    // First-time setup: generate branch name from startedAt.
    // startedAt must already be set by the caller (engine.start() or startPlanMode()).
    // If missing, this is a programming error — fail loudly rather than silently
    // generating a one-off timestamp that can't be reproduced.
    const startTimestamp = this.loop.state.startedAt;
    if (!startTimestamp) {
      throw new Error("Cannot set up git branch: loop.state.startedAt is not set. Ensure startedAt is set before calling setupGitBranch.");
    }
    return generateBranchName(
      this.config.git.branchPrefix,
      this.config.name,
      startTimestamp
    );
  }

  /**
   * Determine the original (base) branch for this loop.
   * Preserves an existing originalBranch from state, uses the configured baseBranch,
   * or falls back to the current branch of the directory.
   */
  private async resolveOriginalBranch(directory: string): Promise<string> {
    if (this.loop.state.git?.originalBranch) {
      const branch = this.loop.state.git.originalBranch;
      this.emitLog("info", `Preserving existing original branch: ${branch}`);
      return branch;
    }
    if (this.config.baseBranch) {
      const branch = this.config.baseBranch;
      this.emitLog("info", `Using configured base branch: ${branch}`);
      return branch;
    }
    const branch = await this.git.getCurrentBranch(directory);
    this.emitLog("info", `Current branch: ${branch}`);
    return branch;
  }

  /**
   * Set up the git worktree for this loop.
   * Creates a new worktree, recreates one for an existing branch, or reuses an existing one.
   * Returns the worktree path.
   */
  private async setupWorktree(directory: string, branchName: string, originalBranch: string): Promise<string> {
    const worktreePath = `${directory}/.ralph-worktrees/${this.config.id}`;

    // Check if the working branch already exists
    const branchExists = await this.git.branchExists(directory, branchName);
    
    // Check if the worktree already exists
    const wtExists = await this.git.worktreeExists(directory, worktreePath);

    if (wtExists) {
      // Worktree already exists — reuse it (e.g., jumpstart or review cycle)
      this.emitLog("info", `Reusing existing worktree at: ${worktreePath}`);
    } else if (branchExists) {
      // Branch exists but worktree doesn't — recreate the worktree for the existing branch
      this.emitLog("info", `Recreating worktree for existing branch: ${branchName}`);
      await this.git.addWorktreeForExistingBranch(directory, worktreePath, branchName);
    } else {
      // Create new worktree with a new branch
      this.emitLog("info", `Creating new worktree with branch: ${branchName} at ${worktreePath}`);
      await this.git.createWorktree(directory, worktreePath, branchName, originalBranch);
    }

    return worktreePath;
  }

  /**
   * Set up the backend session.
   * Uses workspace-specific server settings.
   */
  private async setupSession(): Promise<void> {
    log.trace("[LoopEngine] setupSession: Entry point");
    
    // Get workspace-specific server settings (uses test settings in test mode)
    const settings = await backendManager.getWorkspaceSettings(this.config.workspaceId);
    log.trace("[LoopEngine] setupSession: Got settings", { mode: settings.mode, workspaceId: this.config.workspaceId });
    
    // Connect to backend if not already connected
    const isConnected = this.backend.isConnected();
    log.trace("[LoopEngine] setupSession: Backend connected?", { isConnected });
    if (!isConnected) {
      this.emitLog("info", "Backend not connected, establishing connection...", {
        mode: settings.mode,
        hostname: settings.hostname,
        port: settings.port,
      });
      log.trace("[LoopEngine] setupSession: About to call backend.connect");
      await this.backend.connect(buildConnectionConfig(settings, this.workingDirectory));
      log.trace("[LoopEngine] setupSession: backend.connect completed");
      this.emitLog("info", "Backend connection established");
    } else {
      this.emitLog("debug", "Backend already connected");
    }

    // Create a new session for this loop
    log.trace("[LoopEngine] setupSession: About to create session");
    this.emitLog("info", "Creating new AI session...");
    const session = await this.backend.createSession({
      title: `Ralph Loop: ${this.config.name}`,
      directory: this.workingDirectory,
    });
    log.trace("[LoopEngine] setupSession: Session created", { sessionId: session.id });

    this.sessionId = session.id;
    this.emitLog("info", `AI session created`, { sessionId: session.id });

    // Store session info - use hostname for connect mode, undefined for spawn mode
    const protocol = settings.useHttps ? "https" : "http";
    const serverUrl = settings.mode === "connect" && settings.hostname
      ? `${protocol}://${settings.hostname}:${settings.port ?? 4096}`
      : undefined;

    log.trace("[LoopEngine] setupSession: About to update state");
    this.updateState({
      session: {
        id: session.id,
        serverUrl,
      },
    });
    log.trace("[LoopEngine] setupSession: Exit point");
  }

  /**
   * Reconnect to an existing session for plan mode feedback.
   * This is called when the engine is recreated after a server restart
   * while a loop is still in planning mode.
   */
  async reconnectSession(): Promise<void> {
    log.trace("[LoopEngine] reconnectSession: Entry point");
    
    // Check if we already have a session
    if (this.sessionId) {
      log.trace("[LoopEngine] reconnectSession: Already have sessionId", { sessionId: this.sessionId });
      return;
    }
    
    // Check if the loop state has a session we can reconnect to
    const existingSession = this.loop.state.session;
    if (existingSession?.id) {
      log.trace("[LoopEngine] reconnectSession: Found existing session in state", { 
        sessionId: existingSession.id,
        serverUrl: existingSession.serverUrl,
      });
      
      // Get workspace-specific server settings (uses test settings in test mode)
      const settings = await backendManager.getWorkspaceSettings(this.config.workspaceId);
      const isConnected = this.backend.isConnected();
      
      if (!isConnected) {
        this.emitLog("info", "Reconnecting to backend...", {
          mode: settings.mode,
          hostname: settings.hostname,
          port: settings.port,
        });
        await this.backend.connect(buildConnectionConfig(settings, this.workingDirectory));
        this.emitLog("info", "Backend connection re-established");
      }
      
      // Reuse the existing session ID
      this.sessionId = existingSession.id;
      this.emitLog("info", "Reconnected to existing session", { sessionId: this.sessionId });
      log.trace("[LoopEngine] reconnectSession: Reconnected to session", { sessionId: this.sessionId });
      return;
    }
    
    // No existing session, create a new one
    log.trace("[LoopEngine] reconnectSession: No existing session, creating new one");
    this.emitLog("info", "No existing session found, creating new session");
    await this.setupSession();
    log.trace("[LoopEngine] reconnectSession: Exit point (new session created)");
  }

  /**
   * Run the main iteration loop.
   * Now continues on errors unless max consecutive identical errors is reached.
   * Protected by isLoopRunning guard to prevent concurrent executions.
   */
  private async runLoop(): Promise<void> {
    log.trace("[LoopEngine] runLoop: Entry point");
    
    // Guard against concurrent runLoop() calls
    if (this.isLoopRunning) {
      log.warn("[LoopEngine] runLoop: Already running, skipping duplicate call");
      this.emitLog("warn", "Loop execution already in progress, ignoring duplicate call");
      return;
    }
    
    this.isLoopRunning = true;
    log.trace("[LoopEngine] runLoop: Set isLoopRunning = true");
    
    try {
      this.emitLog("debug", "Entering runLoop", {
        aborted: this.aborted,
        status: this.loop.state.status,
        shouldContinue: this.shouldContinue(),
      });
      log.trace("[LoopEngine] runLoop: Emitted debug log, checking while condition", {
        aborted: this.aborted,
        shouldContinue: this.shouldContinue(),
      });

      while (!this.aborted && this.shouldContinue()) {
        log.trace("[LoopEngine] runLoop: Entered while loop, about to call runIteration");
        this.emitLog("debug", "Loop iteration check passed", {
          aborted: this.aborted,
          status: this.loop.state.status,
        });

        const iterationResult = await this.runIteration();
        log.trace("[LoopEngine] runLoop: runIteration completed", { outcome: iterationResult.outcome });

        // Delegate outcome handling — returns true if the loop should exit
        const shouldExit = await this.handleIterationOutcome(iterationResult);
        if (shouldExit) {
          // Check if an injection arrived during outcome handling (e.g., plan feedback
          // arrived between evaluateOutcome and handlePlanReadyOutcome, while
          // isLoopRunning was still true). If so, clear the flags and continue
          // the while loop to process the injected prompt instead of exiting.
          if (this.injectionPending && this.shouldContinue()) {
            this.emitLog("debug", "Injection pending during outcome handling - continuing loop to process injected prompt");
            this.aborted = false;
            this.injectionPending = false;
            continue;
          }
          return;
        }

        // Check max iterations
        if (await this.hasReachedMaxIterations()) {
          return;
        }

        // Check if aborted during iteration
        if (this.aborted) {
          // Check if this was an injection abort (not a user stop)
          if (this.injectionPending) {
            this.emitLog("debug", "Injection abort detected, restarting iteration with pending values");
            // Reset both flags to allow the loop to continue
            this.aborted = false;
            this.injectionPending = false;
            // Continue the while loop - next iteration will use pending values
            continue;
          }
          this.emitLog("debug", "Aborted during iteration, exiting runLoop");
          return; // Stop method already updated status
        }
      }

      this.emitLog("debug", "Exiting runLoop - loop condition not met", {
        aborted: this.aborted,
        status: this.loop.state.status,
        shouldContinue: this.shouldContinue(),
      });
    } finally {
      this.isLoopRunning = false;
      log.trace("[LoopEngine] runLoop: Set isLoopRunning = false");
    }
  }

  /**
   * Handle the outcome of a single iteration.
   * Returns true if the loop should exit, false to continue iterating.
   */
  private async handleIterationOutcome(result: IterationResult): Promise<boolean> {
    if (result.outcome === "complete") {
      return this.handleCompletedOutcome();
    }

    if (result.outcome === "plan_ready") {
      return this.handlePlanReadyOutcome(result);
    }

    if (result.outcome === "error") {
      return this.handleErrorOutcome(result);
    }

    // Successful iteration (outcome === "continue") - clear error tracker
    this.updateState({ consecutiveErrors: undefined });
    return false;
  }

  /**
   * Handle a "complete" iteration outcome.
   * Updates state, marks review comments as addressed, emits completion event.
   * Always returns true (loop should exit).
   */
  private async handleCompletedOutcome(): Promise<boolean> {
    this.emitLog("info", "Stop pattern detected - loop completed successfully", {
      totalIterations: this.loop.state.currentIteration,
    });
    // Clear consecutive error tracker on success
    this.updateState({
      status: "completed",
      completedAt: createTimestamp(),
      consecutiveErrors: undefined,
    });

    // Persist immediately so callbacks (e.g., auto-push after conflict resolution)
    // can act on the completed status without waiting for the periodic persistence interval.
    await this.triggerPersistence();

    // Auto-mark any pending comments as addressed if this is a review cycle
    if (this.loop.state.reviewMode && this.loop.state.reviewMode.reviewCycles > 0) {
      try {
        const addressedAt = new Date().toISOString();
        markCommentsAsAddressed(
          this.config.id,
          this.loop.state.reviewMode.reviewCycles,
          addressedAt
        );
        log.debug(`Marked comments as addressed for loop ${this.config.id}, cycle ${this.loop.state.reviewMode.reviewCycles}`);
      } catch (error) {
        log.error(`Failed to mark comments as addressed: ${String(error)}`);
      }
    }

    this.emit({
      type: "loop.completed",
      loopId: this.config.id,
      totalIterations: this.loop.state.currentIteration,
      timestamp: createTimestamp(),
    });
    return true;
  }

  /**
   * Handle a "plan_ready" iteration outcome.
   * Reads plan content from the .planning folder, updates plan mode state,
   * emits the plan ready event, and exits the loop (waits for user feedback).
   * Always returns true (loop should exit).
   */
  private async handlePlanReadyOutcome(result: IterationResult): Promise<boolean> {
    this.emitLog("info", "Plan ready - waiting for user feedback or acceptance", {
      iteration: this.loop.state.currentIteration,
    });
    
    // Read plan content from .planning/plan.md if possible
    let planContent: string | undefined;
    try {
      const planExecutor = await backendManager.getCommandExecutorAsync(this.config.workspaceId, this.workingDirectory);
      const planFilePath = `${this.workingDirectory}/.planning/plan.md`;
      const planFileExists = await planExecutor.fileExists(planFilePath);
      if (planFileExists) {
        planContent = await planExecutor.readFile(planFilePath) ?? undefined;
      }
    } catch {
      // Ignore errors reading plan file
    }

    // Update plan mode state with the plan content, and clear consecutive
    // error tracker since this iteration succeeded (prevents stale error
    // context from leaking into subsequent plan feedback prompts).
    if (this.loop.state.planMode) {
      log.trace(`[LoopEngine] runLoop: Before updateState, isPlanReady:`, this.loop.state.planMode.isPlanReady);
      this.updateState({
        planMode: {
          ...this.loop.state.planMode,
          planContent,
        },
        consecutiveErrors: undefined,
      });
      log.trace(`[LoopEngine] runLoop: After updateState, isPlanReady:`, this.loop.state.planMode?.isPlanReady);
    } else {
      // Even without planMode state, clear the error tracker on success
      this.updateState({ consecutiveErrors: undefined });
    }

    // Emit plan ready event
    this.emit({
      type: "loop.plan.ready",
      loopId: this.config.id,
      planContent: planContent ?? result.responseContent,
      timestamp: createTimestamp(),
    });
    
    // Exit the loop but stay in "planning" status
    // The loop will be resumed when user sends feedback or accepts the plan
    return true;
  }

  /**
   * Handle an "error" iteration outcome.
   * Tracks consecutive errors and triggers failsafe exit if the limit is reached.
   * Returns true if the loop should exit (failsafe), false to retry.
   */
  private async handleErrorOutcome(result: IterationResult): Promise<boolean> {
    const errorMessage = result.error ?? "Unknown error";
    this.emitLog("error", `Iteration failed with error: ${errorMessage}`);

    // Error iterations don't count towards maxIterations - roll back the counter
    // This treats the error as a retry, not a completed iteration
    this.updateState({
      currentIteration: this.loop.state.currentIteration - 1,
    });

    // Track consecutive identical errors
    const shouldFailsafe = this.trackConsecutiveError(errorMessage);

    if (shouldFailsafe) {
      const maxErrors = this.config.maxConsecutiveErrors ?? DEFAULT_LOOP_CONFIG.maxConsecutiveErrors;
      this.emitLog("error", `Failsafe exit: ${maxErrors} consecutive identical errors`, {
        errorMessage,
      });
      this.updateState({
        status: "failed",
        completedAt: createTimestamp(),
        error: {
          message: `Failsafe: ${maxErrors} consecutive identical errors - ${errorMessage}`,
          iteration: this.loop.state.currentIteration,
          timestamp: createTimestamp(),
        },
      });

      // Persist immediately so callbacks can act on the failed status
      await this.triggerPersistence();

      this.emit({
        type: "loop.error",
        loopId: this.config.id,
        error: `Failsafe: ${maxErrors} consecutive identical errors - ${errorMessage}`,
        iteration: this.loop.state.currentIteration,
        timestamp: createTimestamp(),
      });
      return true;
    }

    // Log that we're continuing despite the error (as a retry)
    this.emitLog("warn", "Error occurred, retrying iteration", {
      errorMessage,
      consecutiveErrors: this.loop.state.consecutiveErrors?.count ?? 1,
      maxConsecutiveErrors: this.config.maxConsecutiveErrors ?? "unlimited",
    });

    // Emit error event but don't stop
    this.emit({
      type: "loop.error",
      loopId: this.config.id,
      error: errorMessage,
      iteration: this.loop.state.currentIteration,
      timestamp: createTimestamp(),
    });

    // Continue to retry (next iteration will use same iteration number)
    return false;
  }

  /**
   * Check if the loop has reached the maximum iteration limit.
   * If so, updates state to "max_iterations", persists, emits event, and returns true.
   */
  private async hasReachedMaxIterations(): Promise<boolean> {
    if (
      this.config.maxIterations &&
      this.loop.state.currentIteration >= this.config.maxIterations
    ) {
      this.emitLog("warn", `Reached maximum iterations limit: ${this.config.maxIterations}`);
      this.updateState({
        status: "max_iterations",
        completedAt: createTimestamp(),
      });

      // Persist immediately so callbacks can act on the max_iterations status
      await this.triggerPersistence();

      this.emit({
        type: "loop.stopped",
        loopId: this.config.id,
        reason: `Reached maximum iterations: ${this.config.maxIterations}`,
        timestamp: createTimestamp(),
      });
      return true;
    }
    return false;
  }

  /**
   * Track consecutive identical errors.
   * Returns true if we should failsafe exit (max consecutive errors reached).
   * Returns false if maxConsecutiveErrors is undefined or 0 (unlimited).
   */
  private trackConsecutiveError(errorMessage: string): boolean {
    const tracker = this.loop.state.consecutiveErrors;
    const maxErrors = this.config.maxConsecutiveErrors;

    // If maxErrors is undefined or 0, errors are unlimited - never failsafe
    if (maxErrors === undefined || maxErrors === 0) {
      // Still track the error count for logging purposes
      if (tracker && tracker.lastErrorMessage === errorMessage) {
        this.updateState({
          consecutiveErrors: {
            lastErrorMessage: errorMessage,
            count: tracker.count + 1,
          },
        });
      } else {
        this.updateState({
          consecutiveErrors: {
            lastErrorMessage: errorMessage,
            count: 1,
          },
        });
      }
      return false;
    }

    if (tracker && tracker.lastErrorMessage === errorMessage) {
      // Same error as before, increment count
      const newCount = tracker.count + 1;
      this.updateState({
        consecutiveErrors: {
          lastErrorMessage: errorMessage,
          count: newCount,
        },
      });
      return newCount >= maxErrors;
    } else {
      // Different error or first error, reset tracker to 1
      this.updateState({
        consecutiveErrors: {
          lastErrorMessage: errorMessage,
          count: 1,
        },
      });
      // Check if even 1 error exceeds the max (for maxConsecutiveErrors: 1 case)
      return 1 >= maxErrors;
    }
  }

  /**
   * Run a single iteration with real-time event streaming.
   */
  private async runIteration(): Promise<IterationResult> {
    log.trace("[LoopEngine] runIteration: Entry point");
    const iteration = this.loop.state.currentIteration + 1;
    const startedAt = createTimestamp();
    
    // Check if we're in plan mode - need to check before updating status
    const isInPlanMode = this.loop.state.status === "planning" && this.loop.state.planMode?.active;

    this.emitLog("info", `Starting iteration ${iteration}`, {
      maxIterations: this.config.maxIterations,
    });

    // In plan mode, keep status as "planning"; otherwise set to "running"
    this.updateState({
      status: isInPlanMode ? "planning" : "running",
      currentIteration: iteration,
      lastActivityAt: startedAt,
    });

    this.emit({
      type: "loop.iteration.start",
      loopId: this.config.id,
      iteration,
      timestamp: startedAt,
    });

    const ctx: IterationContext = {
      iteration,
      responseContent: "",
      reasoningContent: "",
      messageCount: 0,
      toolCallCount: 0,
      outcome: "continue",
      error: undefined,
      currentMessageId: null,
      toolCalls: new Map(),
      currentResponseLogId: null,
      currentResponseLogContent: "",
      currentReasoningLogId: null,
      currentReasoningLogContent: "",
    };

    try {
      // Build and send prompt, then process the event stream
      await this.executeIterationPrompt(ctx);

      // Evaluate whether the response matches a stop/completion pattern
      this.evaluateOutcome(ctx);

      // Commit changes after iteration
      if (ctx.outcome !== "error") {
        this.emitLog("info", "Checking for changes to commit...");
        await this.commitIteration(iteration, ctx.responseContent);
      }
    } catch (err) {
      ctx.outcome = "error";
      ctx.error = String(err);
      this.emitLog("error", `Iteration error: ${ctx.error}`);
    }

    return this.buildIterationResult(ctx, startedAt);
  }

  /**
   * Send the prompt to the AI backend and process all events from the response stream.
   * Handles subscribing to the event stream, sending the prompt, and iterating
   * through all agent events until the message completes or an error occurs.
   */
  private async executeIterationPrompt(ctx: IterationContext): Promise<void> {
    // Build the prompt
    log.trace("[LoopEngine] runIteration: Building prompt");
    this.emitLog("debug", "Building prompt for AI agent");
    const prompt = this.buildPrompt(ctx.iteration);

    // Log the prompt for debugging
    log.debug("[LoopEngine] runIteration: Prompt details", {
      partsCount: prompt.parts.length,
      model: prompt.model ? `${prompt.model.providerID}/${prompt.model.modelID}` : "default",
      textLength: prompt.parts[0]?.text?.length ?? 0,
      textPreview: prompt.parts[0]?.text?.slice(0, 200) ?? "",
    });

    // Send prompt and collect response
    if (!this.sessionId) {
      throw new Error("No session ID");
    }

    // Subscribe to events BEFORE sending the prompt.
    // IMPORTANT: We must await the subscription to ensure the SSE connection is established
    // before sending the prompt. This prevents a race condition where events are emitted
    // by the server before we're ready to receive them.
    log.trace("[LoopEngine] runIteration: About to subscribe to events");
    this.emitLog("debug", "Subscribing to AI response stream");
    const eventStream = await this.backend.subscribeToEvents(this.sessionId);
    log.trace("[LoopEngine] runIteration: Subscription established, got event stream");

    // Now send prompt asynchronously (subscription is definitely active)
    log.trace("[LoopEngine] runIteration: About to send prompt async");
    this.emitLog("info", "Sending prompt to AI agent...");
    await this.backend.sendPromptAsync(this.sessionId, prompt);
    log.trace("[LoopEngine] runIteration: sendPromptAsync completed");

    try {
      log.trace("[LoopEngine] runIteration: About to start event iteration loop");
      
      // Calculate activity timeout
      const activityTimeoutMs = (this.config.activityTimeoutSeconds ?? DEFAULT_LOOP_CONFIG.activityTimeoutSeconds) * 1000;
      
      let event: AgentEvent | null = await nextWithTimeout(eventStream, activityTimeoutMs);
      while (event !== null) {
        log.trace("[LoopEngine] runIteration: Received event", { type: event.type });
        // Check if aborted
        if (this.aborted) {
          if (this.injectionPending) {
            this.emitLog("info", "Iteration interrupted for pending message injection");
          } else {
            this.emitLog("info", "Iteration aborted by user");
          }
          break;
        }

        // Update last activity timestamp
        this.updateState({ lastActivityAt: createTimestamp() });

        // Delegate event processing to the handler
        await this.processAgentEvent(event, ctx);

        // If message is complete or error occurred, stop listening
        if (event.type === "message.complete" || event.type === "error") {
          this.emitLog("debug", `Breaking out of event stream: ${event.type}`);
          break;
        }

        // Get next event with timeout
        event = await nextWithTimeout(eventStream, activityTimeoutMs);
      }
    } finally {
      // Close the stream to abort the subscription
      eventStream.close();
    }

    this.emitLog("debug", "Exited event stream loop", { outcome: ctx.outcome, error: ctx.error });
  }

  /**
   * Process a single agent event during an iteration.
   * Handles all event types: message streaming, tool calls, errors,
   * permissions, questions, TODOs, and session status updates.
   */
  private async processAgentEvent(event: AgentEvent, ctx: IterationContext): Promise<void> {
    switch (event.type) {
      case "message.start":
        ctx.currentMessageId = event.messageId;
        ctx.messageCount++;
        ctx.currentResponseLogId = null;
        ctx.currentResponseLogContent = "";
        this.emitLog("agent", "AI started generating response");
        break;

      case "message.delta":
        ctx.responseContent += event.content;
        this.handleStreamingDelta(event.content, ctx, "response");
        this.emit({
          type: "loop.progress",
          loopId: this.config.id,
          iteration: ctx.iteration,
          content: event.content,
          timestamp: createTimestamp(),
        });
        break;

      case "reasoning.delta":
        ctx.reasoningContent += event.content;
        this.handleStreamingDelta(event.content, ctx, "reasoning");
        break;

      case "message.complete":
        this.handleMessageComplete(ctx);
        break;

      case "tool.start":
        this.handleToolStart(event, ctx);
        break;

      case "tool.complete":
        await this.handleToolComplete(event, ctx);
        break;

      case "error":
        ctx.outcome = "error";
        ctx.error = event.message;
        this.emitLog("error", `AI backend error: ${event.message}`);
        break;

      case "permission.asked":
        await this.handlePermissionAsked(event);
        break;

      case "question.asked":
        await this.handleQuestionAsked(event);
        break;

      case "todo.updated": {
        this.loop.state.todos = event.todos;
        this.emitLog("debug", "TODOs updated", {
          sessionId: event.sessionId,
          todoCount: event.todos.length,
        });
        this.emit({
          type: "loop.todo.updated",
          loopId: this.config.id,
          todos: event.todos,
          timestamp: createTimestamp(),
        });
        await this.triggerPersistence();
        break;
      }

      case "session.status":
        this.emitLog("debug", `Session status: ${event.status}`, {
          sessionId: event.sessionId,
          attempt: event.attempt,
          message: event.message,
        });
        break;
    }
  }

  /**
   * Handle streaming delta content (response or reasoning).
   * Combines consecutive deltas into a single log entry to reduce log noise.
   */
  private handleStreamingDelta(
    content: string,
    ctx: IterationContext,
    kind: "response" | "reasoning",
  ): void {
    if (!content.trim()) return;

    if (kind === "response") {
      ctx.currentResponseLogContent += content;
      const logMsg = "AI generating response...";
      if (ctx.currentResponseLogId) {
        this.emitLog("agent", logMsg, { responseContent: ctx.currentResponseLogContent }, ctx.currentResponseLogId, "trace");
      } else {
        ctx.currentResponseLogId = this.emitLog("agent", logMsg, { responseContent: ctx.currentResponseLogContent }, undefined, "trace");
      }
    } else {
      ctx.currentReasoningLogContent += content;
      const logMsg = "AI reasoning...";
      if (ctx.currentReasoningLogId) {
        this.emitLog("agent", logMsg, { responseContent: ctx.currentReasoningLogContent }, ctx.currentReasoningLogId, "trace");
      } else {
        ctx.currentReasoningLogId = this.emitLog("agent", logMsg, { responseContent: ctx.currentReasoningLogContent }, undefined, "trace");
      }
    }
  }

  /**
   * Handle a completed AI message.
   * Resets log tracking, persists the message, and emits the message event.
   */
  private handleMessageComplete(ctx: IterationContext): void {
    ctx.currentResponseLogId = null;
    ctx.currentResponseLogContent = "";
    ctx.currentReasoningLogId = null;
    ctx.currentReasoningLogContent = "";
    this.emitLog("agent", "AI finished generating response", {
      responseLength: ctx.responseContent.length,
    });
    const messageData: MessageData = {
      id: ctx.currentMessageId || `msg-${Date.now()}`,
      role: "assistant",
      content: ctx.responseContent,
      timestamp: createTimestamp(),
    };
    this.persistMessage(messageData);
    this.emit({
      type: "loop.message",
      loopId: this.config.id,
      iteration: ctx.iteration,
      message: messageData,
      timestamp: createTimestamp(),
    });
  }

  /**
   * Handle a tool start event.
   * Resets streaming log tracking, records the tool call, and emits the event.
   */
  private handleToolStart(event: AgentEvent & { type: "tool.start" }, ctx: IterationContext): void {
    ctx.currentResponseLogId = null;
    ctx.currentResponseLogContent = "";
    ctx.currentReasoningLogId = null;
    ctx.currentReasoningLogContent = "";
    const toolId = `tool-${ctx.iteration}-${event.toolName}-${ctx.toolCallCount}`;
    ctx.toolCalls.set(event.toolName, { id: toolId, name: event.toolName, input: event.input });
    ctx.toolCallCount++;
    this.emitLog("agent", `AI calling tool: ${event.toolName}`);
    const timestamp = createTimestamp();
    const toolCallData: ToolCallData = {
      id: toolId,
      name: event.toolName,
      input: event.input,
      status: "running",
      timestamp,
    };
    this.persistToolCall(toolCallData);
    this.emit({
      type: "loop.tool_call",
      loopId: this.config.id,
      iteration: ctx.iteration,
      tool: toolCallData,
      timestamp,
    });
  }

  /**
   * Handle a tool complete event.
   * Matches the completion to the original tool.start, persists, and emits the event.
   */
  private async handleToolComplete(event: AgentEvent & { type: "tool.complete" }, ctx: IterationContext): Promise<void> {
    const toolInfo = ctx.toolCalls.get(event.toolName);
    const timestamp = createTimestamp();
    const toolCompleteData: ToolCallData = {
      id: toolInfo?.id ?? `tool-${ctx.iteration}-${event.toolName}`,
      name: event.toolName,
      input: toolInfo?.input,
      output: event.output,
      status: "completed",
      timestamp,
    };
    this.persistToolCall(toolCompleteData);
    this.emit({
      type: "loop.tool_call",
      loopId: this.config.id,
      iteration: ctx.iteration,
      tool: toolCompleteData,
      timestamp,
    });
    await this.triggerPersistence();
  }

  /**
   * Auto-approve a permission request to keep the loop running unattended.
   */
  private async handlePermissionAsked(event: AgentEvent & { type: "permission.asked" }): Promise<void> {
    this.emitLog("info", `Auto-approving permission request: ${event.permission}`, {
      requestId: event.requestId,
      patterns: event.patterns,
    });
    try {
      await this.backend.replyToPermission(event.requestId, "always");
      this.emitLog("info", "Permission approved successfully");
    } catch (permErr) {
      this.emitLog("warn", `Failed to approve permission: ${String(permErr)}`);
    }
  }

  /**
   * Auto-respond to a question from the AI with a default answer.
   */
  private async handleQuestionAsked(event: AgentEvent & { type: "question.asked" }): Promise<void> {
    this.emitLog("info", "Auto-responding to question from AI", {
      requestId: event.requestId,
      questionCount: event.questions.length,
    });
    try {
      const answers = event.questions.map(() => 
        ["take the best course of action you recommend"]
      );
      await this.backend.replyToQuestion(event.requestId, answers);
      this.emitLog("info", "Question answered successfully");
    } catch (questionErr) {
      this.emitLog("warn", `Failed to answer question: ${String(questionErr)}`);
    }
  }

  /**
   * Evaluate the iteration outcome by checking stop patterns.
   * In plan mode, checks for the PLAN_READY marker.
   * In execution mode, checks the configured stop pattern.
   * Skips evaluation if the outcome is already "error".
   */
  private evaluateOutcome(ctx: IterationContext): void {
    this.emitLog("info", "Evaluating stop pattern...");
    
    if (ctx.outcome === "error") {
      return;
    }

    // In plan mode, check for PLAN_READY marker instead of the normal stop pattern
    const isInPlanMode = this.loop.state.status === "planning" && this.loop.state.planMode?.active;
    const planReadyPattern = /<promise>PLAN_READY<\/promise>/;

    if (isInPlanMode && planReadyPattern.test(ctx.responseContent)) {
      this.emitLog("info", "PLAN_READY marker detected - plan is ready for review");
      ctx.outcome = "plan_ready";
      // Set isPlanReady flag in state
      if (this.state.planMode) {
        this.state.planMode.isPlanReady = true;
        log.trace(`[LoopEngine] runIteration: Set isPlanReady = true, planMode:`, JSON.stringify(this.state.planMode));
      }
    } else if (this.stopDetector.matches(ctx.responseContent)) {
      this.emitLog("info", "Stop pattern matched - task is complete");
      ctx.outcome = "complete";
    } else {
      this.emitLog("info", "Stop pattern not matched - will continue to next iteration");
    }
  }

  /**
   * Build the final IterationResult from the iteration context.
   * Records the iteration summary, emits completion events, and persists state.
   */
  private async buildIterationResult(ctx: IterationContext, startedAt: string): Promise<IterationResult> {
    const completedAt = createTimestamp();

    // Record iteration summary
    const summary: IterationSummary = {
      iteration: ctx.iteration,
      startedAt,
      completedAt,
      messageCount: ctx.messageCount,
      toolCallCount: ctx.toolCallCount,
      outcome: ctx.outcome,
    };

    this.updateState({
      lastActivityAt: completedAt,
      recentIterations: [...this.loop.state.recentIterations.slice(-9), summary],
    });

    this.emitLog("info", `Iteration ${ctx.iteration} completed`, {
      outcome: ctx.outcome,
      messageCount: ctx.messageCount,
      toolCallCount: ctx.toolCallCount,
    });

    this.emit({
      type: "loop.iteration.end",
      loopId: this.config.id,
      iteration: ctx.iteration,
      outcome: ctx.outcome,
      timestamp: completedAt,
    });

    // Persist state to disk at the end of each iteration
    // This ensures messages, tool calls, and logs survive server restart
    await this.triggerPersistence();

    return {
      continue: ctx.outcome === "continue",
      outcome: ctx.outcome,
      responseContent: ctx.responseContent,
      error: ctx.error,
      messageCount: ctx.messageCount,
      toolCallCount: ctx.toolCallCount,
    };
  }

  /**
   * Build error context string for retry iterations.
   * Returns a prompt section describing the previous error, or empty string if no errors.
   * Used by buildPrompt() to inform the AI about what went wrong in the previous iteration.
   */
  private buildErrorContext(): string {
    const errors = this.loop.state.consecutiveErrors;
    if (!errors) {
      return "";
    }

    return `\n- **Previous Iteration Error**: The previous iteration failed with the following error (occurred ${errors.count} time(s) consecutively). Please try a different approach to avoid this error:\n\n  Error: ${errors.lastErrorMessage}\n`;
  }

  /**
   * Build the prompt for an iteration.
   * Uses a consistent template that instructs the AI to follow the planning docs pattern.
   * If a pendingPrompt is set, it overrides the config.prompt for this iteration only.
   * If a pendingModel is set, it overrides the config.model and becomes the new default.
   * If loop is in planning mode, uses the plan creation prompt instead.
   */
  private buildPrompt(_iteration: number): PromptInput {
    // Determine the model to use (pending model takes precedence)
    // If pendingModel is set, use it and update config.model so it persists
    let model = this.config.model;
    if (this.loop.state.pendingModel) {
      model = this.loop.state.pendingModel;
      this.emitLog("info", "Using pending model for this iteration", {
        previousModel: this.config.model ? `${this.config.model.providerID}/${this.config.model.modelID}` : "default",
        newModel: `${model.providerID}/${model.modelID}`,
      });
      // Update config.model so the new model persists for subsequent iterations
      this.config.model = model;
      // Clear pendingModel after consumption
      this.updateState({ pendingModel: undefined });
    }

    // Check if this is a plan mode iteration
    if (this.loop.state.status === "planning" && this.loop.state.planMode?.active) {
      return this.buildPlanModePrompt(model);
    }
    
    return this.buildExecutionPrompt(model);
  }

  /**
   * Build the prompt for plan mode iterations.
   * Handles both initial plan creation (feedbackRounds === 0) and
   * subsequent plan feedback rounds.
   */
  private buildPlanModePrompt(model: ModelConfig | undefined): PromptInput {
    const feedbackRounds = this.loop.state.planMode!.feedbackRounds;
    
    if (feedbackRounds === 0) {
      // Initial plan creation
      const errorContext = this.buildErrorContext();
      const text = `- Goal: ${this.config.prompt}
${errorContext}
- Create a detailed plan to achieve this goal. Write the plan to \`./.planning/plan.md\`.

- The plan should include:
  - Clear objectives
  - Step-by-step tasks with descriptions
  - Any dependencies between tasks
  - Estimated complexity per task

- Create a \`./.planning/status.md\` file to track progress.

- Do NOT start implementing yet. Only create the plan.

- When the plan is ready, end your response with:

<promise>PLAN_READY</promise>`;

      return {
        parts: [{ type: "text", text }],
        model,
      };
    }

    // Plan feedback prompt (uses pending prompt set by sendPlanFeedback)
    const feedback = this.loop.state.pendingPrompt ?? "Please refine the plan based on feedback.";
    
    // Log the user's plan feedback so it appears in the conversation logs
    if (this.loop.state.pendingPrompt) {
      this.emitLog("user", this.loop.state.pendingPrompt);
    }
    
    const errorContext = this.buildErrorContext();
    const text = `The user has provided feedback on your plan:

---
${feedback}
---
${errorContext}
**FIRST**: Immediately add this feedback as a pending item in \`./.planning/status.md\` so it is tracked and preserved even if the conversation context is compacted.

Then, update the plan in \`./.planning/plan.md\` based on this feedback.

When the updated plan is ready, end your response with:

<promise>PLAN_READY</promise>`;

    // Clear the pending prompt after use
    this.updateState({ pendingPrompt: undefined });

    return {
      parts: [{ type: "text", text }],
      model,
    };
  }

  /**
   * Build the prompt for execution mode iterations.
   * Includes the original goal, any injected user message, error context for retries,
   * and instructions for the AI to follow the planning docs pattern.
   */
  private buildExecutionPrompt(model: ModelConfig | undefined): PromptInput {
    // Get the pending user message if any (new message injected by the user)
    const userMessage = this.loop.state.pendingPrompt;
    
    // Clear the pending prompt after consumption (it's a one-time override)
    if (userMessage) {
      // Log the user's injected message so it appears in the conversation logs
      this.emitLog("user", userMessage);
      this.emitLog("info", "User injected a new message", {
        originalGoal: this.config.prompt.slice(0, 50) + (this.config.prompt.length > 50 ? "..." : ""),
        userMessage: userMessage.slice(0, 50) + (userMessage.length > 50 ? "..." : ""),
      });
      // Clear it so next iteration doesn't see it again
      this.updateState({
        pendingPrompt: undefined,
      });
    }

    // Build the prompt with original goal always present, and user message as an addition
    const userMessageSection = userMessage
      ? `\n- **User Message**: The user has added the following message. This should be your primary focus for this iteration. Address it while keeping the original goal in mind. **Before starting work on this message, immediately add it as a pending task in \`./.planning/status.md\`** so it is tracked and preserved even if the conversation context is compacted:\n\n${userMessage}\n`
      : "";

    // Build error context for retry iterations (shows previous error info)
    const errorContext = this.buildErrorContext();

    const text = `- Original Goal: ${this.config.prompt}
${userMessageSection}${errorContext}
- Read AGENTS.md, read the document in the \`./.planning\` folder, pick up the most important task to continue with, and make sure you make a plan with coding tasks that includes updating the docs with your progress and what the next steps to work on are, at the end. Don't ask for confirmation and start working on it right away.

- If the \`./.planning\` folder does not exist or is empty, create it and add a file called \`plan.md\` where you outline your plan to achieve the goal, and a \`status.md\` file to track progress.

- If the user added a new message above, prioritize addressing it. It may change or add to the plan. If it contradicts something in the original goal or plan, follow the user's latest message.

- Make sure that the implementations and fixes you make don't contradict the core design principles outlined in AGENTS.md and the planning document.

- Add tasks to the plan to achieve the goal.

- Never ask for input from the user or any questions. This will always run unattended

- **IMPORTANT — Incremental progress tracking**: After completing each individual task, immediately update \`./.planning/status.md\` to mark the task as completed and note any relevant findings or context. Do NOT wait until the end of the iteration to update status — update it after every task so that progress is preserved even if the iteration is interrupted or the conversation context is compacted mid-work.

- **IMPORTANT — Pre-compaction persistence**: Before ending your response, you MUST also update \`./.planning/status.md\` with:
  - The task you are currently working on and its current state
  - Updated status of all tasks in the plan
  - Any new learnings, discoveries, or important context gathered during this iteration
  - What the next steps should be when work resumes
  This ensures that your progress is preserved even if the conversation context is compacted or summarized between iterations. The status file is your persistent memory — treat it as the source of truth for what has been done and what remains.

- When you think you're done, check the plan and status files to ensure all tasks are actually marked as completed.

- Only if you have completed every single non-manual task in the plan, end your response with:

<promise>COMPLETE</promise>`;

    return {
      parts: [{ type: "text", text }],
      model,
    };
  }

  /**
   * Commit changes after an iteration.
   * Generates a meaningful commit message based on the changes made.
   */
  private async commitIteration(iteration: number, responseContent: string): Promise<void> {
    const directory = this.workingDirectory;
    const hasChanges = await this.git.hasUncommittedChanges(directory);

    if (!hasChanges) {
      this.emitLog("info", "No changes to commit");
      return; // No changes to commit
    }

    // Generate commit message based on changes
    let message: string;
    try {
      this.emitLog("info", "Generating commit message...");
      message = await this.generateCommitMessage(iteration, responseContent);
    } catch (err) {
      // Fallback to generic message if generation fails
      this.emitLog("warn", `Failed to generate commit message: ${String(err)}, using fallback`);
      message = `${this.config.git.commitPrefix} Iteration ${iteration}`;
    }

    try {
      this.emitLog("info", "Committing changes...");
      const commitInfo = await this.git.commit(directory, message, {
        expectedBranch: this.loop.state.git?.workingBranch,
      });

      const commit: GitCommit = {
        iteration,
        sha: commitInfo.sha,
        message,
        timestamp: createTimestamp(),
        filesChanged: commitInfo.filesChanged,
      };

      // Update git state
      if (this.loop.state.git) {
        this.updateState({
          git: {
            ...this.loop.state.git,
            commits: [...this.loop.state.git.commits, commit],
          },
        });
      }

      this.emitLog("info", `Committed ${commitInfo.filesChanged} file(s)`, {
        sha: commitInfo.sha.slice(0, 8),
        message: message.split("\n")[0],
      });

      this.emit({
        type: "loop.git.commit",
        loopId: this.config.id,
        iteration,
        commit,
        timestamp: createTimestamp(),
      });
    } catch (err) {
      // Log but don't fail the iteration
      this.emitLog("warn", `Failed to commit: ${String(err)}`);
      log.error(`Failed to commit iteration ${iteration}: ${String(err)}`);
    }
  }

  /**
   * Generate a meaningful commit message based on the changes.
   * Uses opencode to summarize what was done.
   */
  private async generateCommitMessage(iteration: number, responseContent: string): Promise<string> {
    if (!this.sessionId) {
      return `${this.config.git.commitPrefix} Iteration ${iteration}`;
    }

    // Get the list of changed files
    const changedFiles = await this.git.getChangedFiles(this.workingDirectory);
    if (changedFiles.length === 0) {
      return `${this.config.git.commitPrefix} Iteration ${iteration}`;
    }

    // Ask opencode to generate a commit message
    const prompt: PromptInput = {
      parts: [{
        type: "text",
        text: `Generate a concise git commit message (max 72 characters for the first line) for the following changes. Do not include any explanation, just output the commit message directly.

Changed files:
${changedFiles.map(f => `- ${f}`).join("\n")}

Summary of work done this iteration:
${responseContent.slice(0, 500)}...

The commit message should:
1. Start with a verb (Add, Fix, Update, Refactor, etc.)
2. Be specific about what changed
3. First line max 72 characters
4. Optionally include a blank line and more details

Output ONLY the commit message, nothing else.`
      }],
    };

    try {
      const response = await this.backend.sendPrompt(this.sessionId, prompt);
      const generatedMessage = response.content.trim();
      
      // Validate the message isn't too long or empty
      if (generatedMessage && generatedMessage.length > 0 && generatedMessage.length < 500) {
        // Prepend the commit prefix
        const firstLine = generatedMessage.split("\n")[0] ?? generatedMessage;
        const rest = generatedMessage.split("\n").slice(1).join("\n");
        
        if (rest) {
          return `${this.config.git.commitPrefix} ${firstLine}\n${rest}`;
        }
        return `${this.config.git.commitPrefix} ${firstLine}`;
      }
    } catch (err) {
      log.warn(`Failed to generate commit message via AI: ${String(err)}`);
    }

    // Fallback: generate a simple message based on changed files
    const fileList = changedFiles.slice(0, 3).join(", ");
    const moreFiles = changedFiles.length > 3 ? ` (+${changedFiles.length - 3} more)` : "";
    return `${this.config.git.commitPrefix} Iteration ${iteration}: ${fileList}${moreFiles}`;
  }

  /**
   * Check if the loop should continue running.
   */
  private shouldContinue(): boolean {
    const status = this.loop.state.status;
    return status === "running" || status === "starting" || status === "planning";
  }

  /**
   * Handle an error during loop execution.
   */
  private handleError(error: unknown): void {
    const message = String(error);

    this.updateState({
      status: "failed",
      completedAt: createTimestamp(),
      error: {
        message,
        iteration: this.loop.state.currentIteration,
        timestamp: createTimestamp(),
      },
    });

    this.emit({
      type: "loop.error",
      loopId: this.config.id,
      error: message,
      iteration: this.loop.state.currentIteration,
      timestamp: createTimestamp(),
    });
  }

  /**
   * Update the loop state.
   * Validates status transitions against the state machine when a status change is included.
   */
  private updateState(update: Partial<LoopState>): void {
    if (update.status !== undefined && update.status !== this.loop.state.status) {
      assertValidTransition(this.loop.state.status, update.status, "LoopEngine.updateState");
    }
    Object.assign(this.loop.state, update);
  }

  /**
   * Trigger disk persistence of the current state.
   * This is called at key points to ensure data survives server restart.
   */
  private async triggerPersistence(): Promise<void> {
    if (this.onPersistState) {
      try {
        await this.onPersistState(this.loop.state);
      } catch (error) {
        log.error(`Failed to persist loop state: ${String(error)}`);
      }
    }
  }

  /**
   * Emit a loop event.
   */
  private emit(event: LoopEvent): void {
    this.emitter.emit(event);
  }

  /**
   * Emit an application log event.
   * Used to communicate internal loop engine operations to the UI.
   * Also persists the log in the loop state for page refresh recovery.
   * @param level - The log level for the event (used for SSE events and persistence)
   * @param message - The log message
   * @param details - Optional additional details
   * @param id - Optional ID for updating existing log entries
   * @param consoleLevel - Optional override for the server console log level (tslog).
   *                       When provided, this level is used for console output instead of deriving from `level`.
   *                       Useful for reducing console verbosity while keeping frontend events unchanged.
   * @returns The ID of the log entry (for updates)
   */
  private emitLog(
    level: LogLevel,
    message: string,
    details?: Record<string, unknown>,
    id?: string,
    consoleLevel?: "trace" | "debug" | "info" | "warn" | "error"
  ): string {
    const logId = id ?? `log-${this.config.id}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const timestamp = createTimestamp();
    
    // Also log to app logger for holistic view
    const loopPrefix = `[Loop:${this.config.name}]`;
    const detailsStr = details ? ` ${JSON.stringify(details)}` : "";
    
    // If consoleLevel is provided, use it for server console output
    // Otherwise, derive from level (existing behavior)
    if (consoleLevel) {
      const levelTag = level === "agent" || level === "user" ? ` [${level}]` : "";
      const logMessage = `${loopPrefix}${levelTag} ${message}${detailsStr}`;
      switch (consoleLevel) {
        case "trace":
          log.trace(logMessage);
          break;
        case "debug":
          log.debug(logMessage);
          break;
        case "info":
          log.info(logMessage);
          break;
        case "warn":
          log.warn(logMessage);
          break;
        case "error":
          log.error(logMessage);
          break;
      }
    } else {
      switch (level) {
        case "error":
          log.error(`${loopPrefix} ${message}${detailsStr}`);
          break;
        case "warn":
          log.warn(`${loopPrefix} ${message}${detailsStr}`);
          break;
        case "info":
          log.info(`${loopPrefix} ${message}${detailsStr}`);
          break;
        case "debug":
          log.debug(`${loopPrefix} ${message}${detailsStr}`);
          break;
        case "trace":
          log.trace(`${loopPrefix} ${message}${detailsStr}`);
          break;
        case "agent":
        case "user":
          // Log agent and user messages at info level
          log.info(`${loopPrefix} [${level}] ${message}${detailsStr}`);
          break;
      }
    }
    
    // Persist log in loop state (for page refresh recovery)
    const logEntry: LoopLogEntry = {
      id: logId,
      level,
      message,
      details,
      timestamp,
    };
    this.persistLog(logEntry, id !== undefined);
    
    // Emit log event for real-time updates
    this.emit({
      type: "loop.log",
      loopId: this.config.id,
      id: logId,
      level,
      message,
      details,
      timestamp,
    });
    return logId;
  }

  /**
   * Persist a log entry in the loop state.
   * If isUpdate is true, update an existing entry; otherwise append.
   * Evicts oldest entries when buffer exceeds MAX_PERSISTED_LOGS.
   */
  private persistLog(entry: LoopLogEntry, isUpdate: boolean): void {
    const logs = this.loop.state.logs ?? [];
    
    if (isUpdate) {
      // Find and update existing entry
      const index = logs.findIndex((log) => log.id === entry.id);
      if (index >= 0) {
        logs[index] = entry;
      } else {
        logs.push(entry);
      }
    } else {
      logs.push(entry);
    }
    
    // Evict oldest entries if buffer is full
    if (logs.length > MAX_PERSISTED_LOGS) {
      logs.splice(0, logs.length - MAX_PERSISTED_LOGS);
    }
    
    this.updateState({ logs });
  }

  /**
   * Persist a message in the loop state for page refresh recovery.
   * Evicts oldest entries when buffer exceeds MAX_PERSISTED_MESSAGES.
   */
  private persistMessage(message: MessageData): void {
    const messages = this.loop.state.messages ?? [];
    
    // Check if message already exists (by ID)
    const existingIndex = messages.findIndex((m) => m.id === message.id);
    if (existingIndex >= 0) {
      // Update existing message
      messages[existingIndex] = {
        id: message.id,
        role: message.role,
        content: message.content,
        timestamp: message.timestamp,
      };
    } else {
      // Add new message
      messages.push({
        id: message.id,
        role: message.role,
        content: message.content,
        timestamp: message.timestamp,
      });
    }
    
    // Evict oldest entries if buffer is full
    if (messages.length > MAX_PERSISTED_MESSAGES) {
      messages.splice(0, messages.length - MAX_PERSISTED_MESSAGES);
    }
    
    this.updateState({ messages });
  }

  /**
   * Persist a tool call in the loop state for page refresh recovery.
   * Updates existing tool call if it exists (by ID), otherwise adds new.
   * Evicts oldest entries when buffer exceeds MAX_PERSISTED_TOOL_CALLS.
   */
  private persistToolCall(toolCall: ToolCallData): void {
    const toolCalls = this.loop.state.toolCalls ?? [];
    
    // Check if tool call already exists (by ID)
    const existingIndex = toolCalls.findIndex((tc) => tc.id === toolCall.id);
    if (existingIndex >= 0) {
      // Update existing tool call
      toolCalls[existingIndex] = {
        id: toolCall.id,
        name: toolCall.name,
        input: toolCall.input,
        output: toolCall.output,
        status: toolCall.status,
        timestamp: toolCall.timestamp,
      };
    } else {
      // Add new tool call
      toolCalls.push({
        id: toolCall.id,
        name: toolCall.name,
        input: toolCall.input,
        output: toolCall.output,
        status: toolCall.status,
        timestamp: toolCall.timestamp,
      });
    }
    
    // Evict oldest entries if buffer is full
    if (toolCalls.length > MAX_PERSISTED_TOOL_CALLS) {
      toolCalls.splice(0, toolCalls.length - MAX_PERSISTED_TOOL_CALLS);
    }
    
    this.updateState({ toolCalls });
  }
}
