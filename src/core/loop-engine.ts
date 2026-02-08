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
import { markCommentsAsAddressed } from "../persistence/database";

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
 * Stop pattern detector.
 * Checks if the AI response indicates completion.
 */
export class StopPatternDetector {
  private pattern: RegExp;

  constructor(patternString: string) {
    this.pattern = new RegExp(patternString);
  }

  /**
   * Check if the content matches the stop pattern.
   */
  matches(content: string): boolean {
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
   * Returns the worktree path if available, otherwise falls back to config.directory.
   * This is the directory where the AI session runs and where file operations happen.
   */
  get workingDirectory(): string {
    return this.loop.state.git?.worktreePath ?? this.loop.config.directory;
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
    // Allow starting from idle, stopped, or planning (for plan mode)
    if (this.loop.state.status !== "idle" && this.loop.state.status !== "stopped" && this.loop.state.status !== "planning") {
      throw new Error(`Cannot start loop in status: ${this.loop.state.status}`);
    }

    this.emitLog("info", "Starting loop execution", { loopName: this.config.name });

    this.aborted = false;
    
    // Only update status if not in plan mode (preserve "planning" status)
    const isInPlanMode = this.loop.state.status === "planning";
    this.updateState({
      status: isInPlanMode ? "planning" : "starting",
      startedAt: createTimestamp(),
      currentIteration: 0,
      recentIterations: [],
      error: undefined,
    });

    try {
      // Set up git branch first (before any file modifications)
      // Skip git setup in plan mode - it will happen when plan is accepted
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
   * Set up git branch for the loop (public method for plan mode acceptance).
   * This is called when transitioning from planning to execution.
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
    
    // Generate branch name using loop name and start timestamp
    const startTimestamp = this.loop.state.startedAt ?? createTimestamp();
    const branchName = generateBranchName(
      this.config.git.branchPrefix,
      this.config.name,
      startTimestamp
    );

    // Check if we're in a git repo
    this.emitLog("debug", "Checking if directory is a git repository", { directory });
    const isRepo = await this.git.isGitRepo(directory);
    if (!isRepo) {
      throw new Error(`Directory is not a git repository: ${directory}`);
    }

    // No uncommitted-changes check needed — worktrees are isolated from the main checkout

    // Get the original (base) branch
    // If we already have git state with originalBranch, preserve it
    // (This handles plan mode where branch setup happens after plan acceptance)
    let originalBranch: string;
    if (this.loop.state.git?.originalBranch) {
      originalBranch = this.loop.state.git.originalBranch;
      this.emitLog("info", `Preserving existing original branch: ${originalBranch}`);
    } else if (this.config.baseBranch) {
      originalBranch = this.config.baseBranch;
      this.emitLog("info", `Using configured base branch: ${originalBranch}`);
    } else {
      originalBranch = await this.git.getCurrentBranch(directory);
      this.emitLog("info", `Current branch: ${originalBranch}`);
    }

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

    // Compute the worktree path
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

        if (iterationResult.outcome === "complete") {
          this.emitLog("info", "Stop pattern detected - loop completed successfully", {
            totalIterations: this.loop.state.currentIteration,
          });
          // Clear consecutive error tracker on success
          this.updateState({
            status: "completed",
            completedAt: createTimestamp(),
            consecutiveErrors: undefined,
          });

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
          return;
        }

        if (iterationResult.outcome === "plan_ready") {
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

          // Update plan mode state with the plan content
          if (this.loop.state.planMode) {
            log.trace(`[LoopEngine] runLoop: Before updateState, isPlanReady:`, this.loop.state.planMode.isPlanReady);
            this.updateState({
              planMode: {
                ...this.loop.state.planMode,
                planContent,
              },
            });
            log.trace(`[LoopEngine] runLoop: After updateState, isPlanReady:`, this.loop.state.planMode?.isPlanReady);
          }

          // Emit plan ready event
          this.emit({
            type: "loop.plan.ready",
            loopId: this.config.id,
            planContent: planContent ?? iterationResult.responseContent,
            timestamp: createTimestamp(),
          });
          
          // Exit the loop but stay in "planning" status
          // The loop will be resumed when user sends feedback or accepts the plan
          return;
        }

        if (iterationResult.outcome === "error") {
          const errorMessage = iterationResult.error ?? "Unknown error";
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

            this.emit({
              type: "loop.error",
              loopId: this.config.id,
              error: `Failsafe: ${maxErrors} consecutive identical errors - ${errorMessage}`,
              iteration: this.loop.state.currentIteration,
              timestamp: createTimestamp(),
            });
            return;
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
        } else {
          // Successful iteration (outcome === "continue") - clear error tracker
          this.updateState({ consecutiveErrors: undefined });
        }

        // Check max iterations
        if (
          this.config.maxIterations &&
          this.loop.state.currentIteration >= this.config.maxIterations
        ) {
          this.emitLog("warn", `Reached maximum iterations limit: ${this.config.maxIterations}`);
          this.updateState({
            status: "max_iterations",
            completedAt: createTimestamp(),
          });

          this.emit({
            type: "loop.stopped",
            loopId: this.config.id,
            reason: `Reached maximum iterations: ${this.config.maxIterations}`,
            timestamp: createTimestamp(),
          });
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

    let responseContent = "";
    let reasoningContent = "";
    let messageCount = 0;
    let toolCallCount = 0;
    let outcome: IterationResult["outcome"] = "continue";
    let error: string | undefined;
    let currentMessageId: string | null = null;
    const toolCalls = new Map<string, { id: string; name: string; input: unknown }>();
    
    // Track current log entries for combining consecutive deltas
    let currentResponseLogId: string | null = null;
    let currentResponseLogContent = "";
    let currentReasoningLogId: string | null = null;
    let currentReasoningLogContent = "";

    try {
      // Build the prompt
      log.trace("[LoopEngine] runIteration: Building prompt");
      this.emitLog("debug", "Building prompt for AI agent");
      const prompt = this.buildPrompt(iteration);

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

          switch (event.type) {
            case "message.start":
              currentMessageId = event.messageId;
              messageCount++;
              // Reset response log tracking
              currentResponseLogId = null;
              currentResponseLogContent = "";
              // Log that AI started generating (agent level - visible to user)
              this.emitLog("agent", "AI started generating response");
              break;

            case "message.delta":
              responseContent += event.content;
              // Combine consecutive deltas into the same log entry (agent level - visible to user)
              if (event.content.trim()) {
                currentResponseLogContent += event.content;
                if (currentResponseLogId) {
                  // Update existing log entry
                  this.emitLog("agent", "AI generating response...", {
                    responseContent: currentResponseLogContent,
                  }, currentResponseLogId, "trace");
                } else {
                  // Create new log entry
                  currentResponseLogId = this.emitLog("agent", "AI generating response...", {
                    responseContent: currentResponseLogContent,
                  }, undefined, "trace");
                }
              }
              // Emit progress event for streaming text
              this.emit({
                type: "loop.progress",
                loopId: this.config.id,
                iteration,
                content: event.content,
                timestamp: createTimestamp(),
              });
              break;

            case "reasoning.delta":
              // AI reasoning/thinking content (chain of thought)
              reasoningContent += event.content;
              // Combine consecutive reasoning deltas into the same log entry (agent level - visible to user)
              if (event.content.trim()) {
                currentReasoningLogContent += event.content;
                if (currentReasoningLogId) {
                  // Update existing log entry
                  // Use trace level for console to reduce verbosity
                  this.emitLog("agent", "AI reasoning...", {
                    responseContent: currentReasoningLogContent,
                  }, currentReasoningLogId, "trace");
                } else {
                  // Create new log entry
                  // Use trace level for console to reduce verbosity
                  currentReasoningLogId = this.emitLog("agent", "AI reasoning...", {
                    responseContent: currentReasoningLogContent,
                  }, undefined, "trace");
                }
              }
              break;

            case "message.complete":
              // Reset log tracking
              currentResponseLogId = null;
              currentResponseLogContent = "";
              currentReasoningLogId = null;
              currentReasoningLogContent = "";
              // Log that AI finished (no need to include full content here,
              // the final ASSISTANT message will show it)
              this.emitLog("agent", "AI finished generating response", {
                responseLength: responseContent.length,
              });
              // Create the message data
              const messageData: MessageData = {
                id: currentMessageId || `msg-${Date.now()}`,
                role: "assistant",
                content: responseContent,
                timestamp: createTimestamp(),
              };
              // Persist message for page refresh recovery
              this.persistMessage(messageData);
              // Emit the complete message
              this.emit({
                type: "loop.message",
                loopId: this.config.id,
                iteration,
                message: messageData,
                timestamp: createTimestamp(),
              });
              // Message complete means iteration is done
              break;

            case "tool.start": {
              // Reset response/reasoning log tracking when a tool starts
              currentResponseLogId = null;
              currentResponseLogContent = "";
              currentReasoningLogId = null;
              currentReasoningLogContent = "";
              // Use tool name as the base ID so we can match start/complete events
              const toolId = `tool-${iteration}-${event.toolName}-${toolCallCount}`;
              toolCalls.set(event.toolName, { id: toolId, name: event.toolName, input: event.input });
              toolCallCount++;
              this.emitLog("agent", `AI calling tool: ${event.toolName}`);
              const timestamp = createTimestamp();
              // Create tool call data
              const toolCallData: ToolCallData = {
                id: toolId,
                name: event.toolName,
                input: event.input,
                status: "running",
                timestamp,
              };
              // Persist tool call for page refresh recovery
              this.persistToolCall(toolCallData);
              // Emit tool call event
              this.emit({
                type: "loop.tool_call",
                loopId: this.config.id,
                iteration,
                tool: toolCallData,
                timestamp,
              });
              break;
            }

            case "tool.complete": {
              const toolInfo = toolCalls.get(event.toolName);
              const timestamp = createTimestamp();
              // Create tool complete data - use the same ID from tool.start
              const toolCompleteData: ToolCallData = {
                id: toolInfo?.id ?? `tool-${iteration}-${event.toolName}`,
                name: event.toolName,
                input: toolInfo?.input,
                output: event.output,
                status: "completed",
                timestamp,
              };
              // Persist tool call update for page refresh recovery
              this.persistToolCall(toolCompleteData);
              // Emit tool complete event
              this.emit({
                type: "loop.tool_call",
                loopId: this.config.id,
                iteration,
                tool: toolCompleteData,
                timestamp,
              });
              // Persist to disk after each tool completion (tool calls can take a while)
              await this.triggerPersistence();
              break;
            }

            case "error":
              outcome = "error";
              error = event.message;
              this.emitLog("error", `AI backend error: ${event.message}`);
              break;

            case "permission.asked": {
              // Auto-approve permission requests to keep the loop running unattended
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
              break;
            }

            case "question.asked": {
              // Auto-respond to questions with a helpful default answer
              this.emitLog("info", "Auto-responding to question from AI", {
                requestId: event.requestId,
                questionCount: event.questions.length,
              });
              try {
                // Reply with a custom answer for each question telling the AI to proceed autonomously
                const answers = event.questions.map(() => 
                  ["take the best course of action you recommend"]
                );
                await this.backend.replyToQuestion(event.requestId, answers);
                this.emitLog("info", "Question answered successfully");
              } catch (questionErr) {
                this.emitLog("warn", `Failed to answer question: ${String(questionErr)}`);
              }
              break;
            }

            case "todo.updated": {
              // Store TODOs in loop state for persistence
              this.loop.state.todos = event.todos;
              
              // Emit TODO updated event with the list of todos
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
              
              // Persist state to survive screen refresh/server reboot
              await this.triggerPersistence();
              break;
            }

            case "session.status":
              // Log session status changes for debugging
              this.emitLog("debug", `Session status: ${event.status}`, {
                sessionId: event.sessionId,
                attempt: event.attempt,
                message: event.message,
              });
              break;
          }

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

      this.emitLog("debug", "Exited event stream loop", { outcome, error });

      // Check for stop pattern
      this.emitLog("info", "Evaluating stop pattern...");
      
      // In plan mode, check for PLAN_READY marker instead of the normal stop pattern
      const isInPlanMode = this.loop.state.status === "planning" && this.loop.state.planMode?.active;
      const planReadyPattern = /<promise>PLAN_READY<\/promise>/;
      
      if (outcome !== "error") {
        if (isInPlanMode && planReadyPattern.test(responseContent)) {
          this.emitLog("info", "PLAN_READY marker detected - plan is ready for review");
          outcome = "plan_ready";
          // Set isPlanReady flag in state
          if (this.state.planMode) {
            this.state.planMode.isPlanReady = true;
            log.trace(`[LoopEngine] runIteration: Set isPlanReady = true, planMode:`, JSON.stringify(this.state.planMode));
          }
        } else if (this.stopDetector.matches(responseContent)) {
          this.emitLog("info", "Stop pattern matched - task is complete");
          outcome = "complete";
        } else {
          this.emitLog("info", "Stop pattern not matched - will continue to next iteration");
        }
      }

      // Commit changes after iteration
      if (outcome !== "error") {
        this.emitLog("info", "Checking for changes to commit...");
        await this.commitIteration(iteration, responseContent);
      }
    } catch (err) {
      outcome = "error";
      error = String(err);
      this.emitLog("error", `Iteration error: ${error}`);
    }

    const completedAt = createTimestamp();

    // Record iteration summary
    const summary: IterationSummary = {
      iteration,
      startedAt,
      completedAt,
      messageCount,
      toolCallCount,
      outcome,
    };

    this.updateState({
      lastActivityAt: completedAt,
      recentIterations: [...this.loop.state.recentIterations.slice(-9), summary],
    });

    this.emitLog("info", `Iteration ${iteration} completed`, {
      outcome,
      messageCount,
      toolCallCount,
    });

    this.emit({
      type: "loop.iteration.end",
      loopId: this.config.id,
      iteration,
      outcome,
      timestamp: completedAt,
    });

    // Persist state to disk at the end of each iteration
    // This ensures messages, tool calls, and logs survive server restart
    await this.triggerPersistence();

    return {
      continue: outcome === "continue",
      outcome,
      responseContent,
      error,
      messageCount,
      toolCallCount,
    };
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
      // Plan mode prompt
      const feedbackRounds = this.loop.state.planMode.feedbackRounds;
      
      if (feedbackRounds === 0) {
        // Initial plan creation
        const text = `- Goal: ${this.config.prompt}

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
      } else {
        // Plan feedback prompt (uses pending prompt set by sendPlanFeedback)
        const feedback = this.loop.state.pendingPrompt ?? "Please refine the plan based on feedback.";
        
        // Log the user's plan feedback so it appears in the conversation logs
        if (this.loop.state.pendingPrompt) {
          this.emitLog("user", this.loop.state.pendingPrompt);
        }
        
        const text = `The user has provided feedback on your plan:

---
${feedback}
---

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
    }
    
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

    const text = `- Original Goal: ${this.config.prompt}
${userMessageSection}
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
   */
  private updateState(update: Partial<LoopState>): void {
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
   * All logs are kept until the loop is merged or deleted.
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
    
    this.updateState({ logs });
  }

  /**
   * Persist a message in the loop state for page refresh recovery.
   * All messages are kept until the loop is merged or deleted.
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
    
    this.updateState({ messages });
  }

  /**
   * Persist a tool call in the loop state for page refresh recovery.
   * Updates existing tool call if it exists (by ID), otherwise adds new.
   * All tool calls are kept until the loop is merged or deleted.
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
    
    this.updateState({ toolCalls });
  }
}
