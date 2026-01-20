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
} from "../types/loop";
import type {
  LoopEvent,
  MessageData,
  ToolCallData,
} from "../types/events";
import { createTimestamp } from "../types/events";
import type {
  AgentBackend,
  AgentEvent,
  PromptInput,
} from "../backends/types";
import { GitService, gitService } from "./git-service";
import { SimpleEventEmitter, loopEventEmitter } from "./event-emitter";

/**
 * Options for creating a LoopEngine.
 */
export interface LoopEngineOptions {
  /** The loop configuration and state */
  loop: Loop;
  /** The agent backend to use */
  backend: AgentBackend;
  /** Git service instance (optional, defaults to singleton) */
  gitService?: GitService;
  /** Event emitter instance (optional, defaults to global) */
  eventEmitter?: SimpleEventEmitter<LoopEvent>;
}

/**
 * Result of running an iteration.
 */
export interface IterationResult {
  /** Whether the loop should continue */
  continue: boolean;
  /** The outcome of this iteration */
  outcome: "continue" | "complete" | "error";
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
 * LoopEngine handles the execution of a single Ralph Loop.
 * It manages iterations, stop pattern detection, and git commits.
 */
export class LoopEngine {
  private loop: Loop;
  private backend: AgentBackend;
  private git: GitService;
  private emitter: SimpleEventEmitter<LoopEvent>;
  private stopDetector: StopPatternDetector;
  private aborted = false;
  private sessionId: string | null = null;

  constructor(options: LoopEngineOptions) {
    this.loop = options.loop;
    this.backend = options.backend;
    this.git = options.gitService ?? gitService;
    this.emitter = options.eventEmitter ?? loopEventEmitter;
    this.stopDetector = new StopPatternDetector(options.loop.config.stopPattern);
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
   * Start the loop execution.
   * This sets up the git branch and backend session.
   */
  async start(): Promise<void> {
    if (this.loop.state.status !== "idle" && this.loop.state.status !== "stopped") {
      throw new Error(`Cannot start loop in status: ${this.loop.state.status}`);
    }

    this.aborted = false;
    this.updateState({
      status: "starting",
      startedAt: createTimestamp(),
      currentIteration: 0,
      recentIterations: [],
      error: undefined,
    });

    try {
      // Set up git branch if enabled
      if (this.config.git.enabled) {
        await this.setupGitBranch();
      }

      // Create backend session
      await this.setupSession();

      // Emit started event
      this.emit({
        type: "loop.started",
        loopId: this.config.id,
        iteration: 0,
        timestamp: createTimestamp(),
      });

      // Start the iteration loop
      await this.runLoop();
    } catch (error) {
      this.handleError(error);
    }
  }

  /**
   * Stop the loop execution.
   */
  async stop(reason = "User requested stop"): Promise<void> {
    this.aborted = true;

    if (this.sessionId) {
      try {
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
  }

  /**
   * Pause the loop execution.
   */
  pause(): void {
    if (this.loop.state.status !== "running" && this.loop.state.status !== "waiting") {
      throw new Error(`Cannot pause loop in status: ${this.loop.state.status}`);
    }

    this.updateState({ status: "paused" });

    this.emit({
      type: "loop.paused",
      loopId: this.config.id,
      timestamp: createTimestamp(),
    });
  }

  /**
   * Resume a paused loop.
   */
  async resume(): Promise<void> {
    if (this.loop.state.status !== "paused") {
      throw new Error(`Cannot resume loop in status: ${this.loop.state.status}`);
    }

    this.emit({
      type: "loop.resumed",
      loopId: this.config.id,
      timestamp: createTimestamp(),
    });

    // Continue the loop
    await this.runLoop();
  }

  /**
   * Set up the git branch for this loop.
   */
  private async setupGitBranch(): Promise<void> {
    const directory = this.config.directory;
    const branchName = `${this.config.git.branchPrefix}${this.config.id}`;

    // Check if we're in a git repo
    const isRepo = await this.git.isGitRepo(directory);
    if (!isRepo) {
      throw new Error(`Directory is not a git repository: ${directory}`);
    }

    // Check for uncommitted changes
    const hasChanges = await this.git.hasUncommittedChanges(directory);
    if (hasChanges) {
      throw new Error("Directory has uncommitted changes. Please commit or stash them first.");
    }

    // Get the current branch (original branch)
    const originalBranch = await this.git.getCurrentBranch(directory);

    // Check if the working branch already exists
    const branchExists = await this.git.branchExists(directory, branchName);
    if (branchExists) {
      // Checkout existing branch
      await this.git.checkoutBranch(directory, branchName);
    } else {
      // Create new branch
      await this.git.createBranch(directory, branchName);
    }

    // Update state with git info
    this.updateState({
      git: {
        originalBranch,
        workingBranch: branchName,
        commits: this.loop.state.git?.commits ?? [],
      },
    });
  }

  /**
   * Set up the backend session.
   */
  private async setupSession(): Promise<void> {
    // Connect to backend if not already connected
    if (!this.backend.isConnected()) {
      await this.backend.connect({
        mode: this.config.backend.mode,
        hostname: this.config.backend.hostname,
        port: this.config.backend.port,
        directory: this.config.directory,
      });
    }

    // Create a new session for this loop
    const session = await this.backend.createSession({
      title: `Ralph Loop: ${this.config.name}`,
      directory: this.config.directory,
    });

    this.sessionId = session.id;

    this.updateState({
      session: {
        id: session.id,
        serverUrl: this.config.backend.hostname
          ? `http://${this.config.backend.hostname}:${this.config.backend.port ?? 4096}`
          : undefined,
      },
    });
  }

  /**
   * Run the main iteration loop.
   */
  private async runLoop(): Promise<void> {
    while (!this.aborted && this.shouldContinue()) {
      if (this.loop.state.status === "paused") {
        return; // Will resume later
      }

      const iterationResult = await this.runIteration();

      if (iterationResult.outcome === "complete") {
        this.updateState({
          status: "completed",
          completedAt: createTimestamp(),
        });

        this.emit({
          type: "loop.completed",
          loopId: this.config.id,
          totalIterations: this.loop.state.currentIteration,
          timestamp: createTimestamp(),
        });
        return;
      }

      if (iterationResult.outcome === "error") {
        this.updateState({
          status: "failed",
          completedAt: createTimestamp(),
          error: {
            message: iterationResult.error ?? "Unknown error",
            iteration: this.loop.state.currentIteration,
            timestamp: createTimestamp(),
          },
        });

        this.emit({
          type: "loop.error",
          loopId: this.config.id,
          error: iterationResult.error ?? "Unknown error",
          iteration: this.loop.state.currentIteration,
          timestamp: createTimestamp(),
        });
        return;
      }

      // Check max iterations
      if (
        this.config.maxIterations &&
        this.loop.state.currentIteration >= this.config.maxIterations
      ) {
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
        return; // Stop method already updated status
      }

      // Wait briefly between iterations
      this.updateState({ status: "waiting" });
      await this.delay(1000);
    }
  }

  /**
   * Run a single iteration.
   */
  private async runIteration(): Promise<IterationResult> {
    const iteration = this.loop.state.currentIteration + 1;
    const startedAt = createTimestamp();

    this.updateState({
      status: "running",
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
    let messageCount = 0;
    let toolCallCount = 0;
    let outcome: IterationResult["outcome"] = "continue";
    let error: string | undefined;

    try {
      // Build the prompt
      const prompt = this.buildPrompt(iteration);

      // Send prompt and collect response
      if (!this.sessionId) {
        throw new Error("No session ID");
      }

      const response = await this.backend.sendPrompt(this.sessionId, prompt);
      responseContent = response.content;
      messageCount = 1;
      toolCallCount = response.parts.filter((p) => p.type === "tool_call").length;

      // Emit message event
      this.emit({
        type: "loop.message",
        loopId: this.config.id,
        iteration,
        message: {
          id: response.id,
          role: "assistant",
          content: responseContent,
          timestamp: createTimestamp(),
        },
        timestamp: createTimestamp(),
      });

      // Check for stop pattern
      if (this.stopDetector.matches(responseContent)) {
        outcome = "complete";
      }

      // Commit changes if git is enabled
      if (this.config.git.enabled) {
        await this.commitIteration(iteration);
      }
    } catch (err) {
      outcome = "error";
      error = String(err);
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

    this.emit({
      type: "loop.iteration.end",
      loopId: this.config.id,
      iteration,
      outcome,
      timestamp: completedAt,
    });

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
   */
  private buildPrompt(iteration: number): PromptInput {
    const text = `- Read AGENTS.md, read the document in the \`./.planning\` folder, pick up the most important set of tasks to continue with, and make sure you make a plan with coding tasks that includes updating the docs with your progress and what the next steps to work on are, at the end. Don't ask for confirmation and start working on it right away.

- Make sure that the implementations and fixes you make don't contradict the core design principles outlined in AGENTS.md and the planning document.

- Goal: ${this.config.prompt}

- Add tasks to the plan to achieve the goal.

- When you have completed all tasks, end your response with:

<promise>COMPLETE</promise>`;

    return {
      parts: [{ type: "text", text }],
      model: this.config.model,
    };
  }

  /**
   * Commit changes after an iteration.
   */
  private async commitIteration(iteration: number): Promise<void> {
    const directory = this.config.directory;
    const hasChanges = await this.git.hasUncommittedChanges(directory);

    if (!hasChanges) {
      return; // No changes to commit
    }

    const message = `${this.config.git.commitPrefix} Iteration ${iteration}`;

    try {
      const commitInfo = await this.git.commit(directory, message);

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

      this.emit({
        type: "loop.git.commit",
        loopId: this.config.id,
        iteration,
        commit,
        timestamp: createTimestamp(),
      });
    } catch (err) {
      // Log but don't fail the iteration
      console.error(`Failed to commit iteration ${iteration}: ${String(err)}`);
    }
  }

  /**
   * Check if the loop should continue running.
   */
  private shouldContinue(): boolean {
    const status = this.loop.state.status;
    return (
      status === "running" ||
      status === "waiting" ||
      status === "starting"
    );
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
   * Emit a loop event.
   */
  private emit(event: LoopEvent): void {
    this.emitter.emit(event);
  }

  /**
   * Delay for a given number of milliseconds.
   */
  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
