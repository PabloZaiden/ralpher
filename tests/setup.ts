/**
 * Test setup and utilities for Ralph Loops Management System.
 */

import { mkdtemp, rm, writeFile, mkdir } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { SimpleEventEmitter } from "../src/core/event-emitter";
import { GitService } from "../src/core/git-service";
import { LoopManager } from "../src/core/loop-manager";
import { backendRegistry } from "../src/backends/registry";
import { backendManager } from "../src/core/backend-manager";
import { ensureDataDirectories } from "../src/persistence/paths";
import { MockBackend } from "./mocks/mock-backend";
import type { LoopEvent } from "../src/types/events";

/**
 * Test context containing all test dependencies.
 */
export interface TestContext {
  /** Temporary data directory for persistence */
  dataDir: string;
  /** Temporary working directory (simulates a project) */
  workDir: string;
  /** Event emitter for loop events */
  emitter: SimpleEventEmitter<LoopEvent>;
  /** Collected events for assertions */
  events: LoopEvent[];
  /** Git service instance */
  git: GitService;
  /** Loop manager instance */
  manager: LoopManager;
  /** Mock backend instance (if using mock) */
  mockBackend?: MockBackend;
}

/**
 * Options for setting up a test context.
 */
export interface SetupOptions {
  /** Use mock backend (default: true) */
  useMockBackend?: boolean;
  /** Mock backend responses */
  mockResponses?: string[];
  /** Initialize git in work directory (default: false) */
  initGit?: boolean;
  /** Create initial files in work directory */
  initialFiles?: Record<string, string>;
}

/**
 * Set up a test context with all dependencies.
 */
export async function setupTestContext(options: SetupOptions = {}): Promise<TestContext> {
  const {
    useMockBackend = true,
    mockResponses = ["<promise>COMPLETE</promise>"],
    initGit = false,
    initialFiles = {},
  } = options;

  // Create temp directories
  const dataDir = await mkdtemp(join(tmpdir(), "ralpher-test-data-"));
  const workDir = await mkdtemp(join(tmpdir(), "ralpher-test-work-"));

  // Set env var for persistence
  process.env["RALPHER_DATA_DIR"] = dataDir;
  await ensureDataDirectories();

  // Create initial files
  for (const [path, content] of Object.entries(initialFiles)) {
    const fullPath = join(workDir, path);
    const dir = fullPath.substring(0, fullPath.lastIndexOf("/"));
    if (dir !== workDir) {
      await mkdir(dir, { recursive: true });
    }
    await writeFile(fullPath, content);
  }

  // Initialize git if requested
  const git = new GitService();
  if (initGit) {
    await Bun.$`git init`.cwd(workDir).quiet();
    await Bun.$`git config user.email "test@test.com"`.cwd(workDir).quiet();
    await Bun.$`git config user.name "Test User"`.cwd(workDir).quiet();
    // Create initial commit so we have a valid branch
    await writeFile(join(workDir, ".gitkeep"), "");
    await Bun.$`git add .`.cwd(workDir).quiet();
    await Bun.$`git commit -m "Initial commit"`.cwd(workDir).quiet();
  }

  // Set up event emitter
  const events: LoopEvent[] = [];
  const emitter = new SimpleEventEmitter<LoopEvent>();
  emitter.subscribe((event) => events.push(event));

  // Register mock backend if requested
  let mockBackend: MockBackend | undefined;
  if (useMockBackend) {
    mockBackend = new MockBackend({ responses: mockResponses });
    backendRegistry.register("opencode", () => mockBackend!);
    // Also set the mock backend in the global backend manager
    backendManager.setBackendForTesting(mockBackend);
  }

  // Create manager
  const manager = new LoopManager({
    eventEmitter: emitter,
  });

  return {
    dataDir,
    workDir,
    emitter,
    events,
    git,
    manager,
    mockBackend,
  };
}

/**
 * Clean up a test context.
 */
export async function teardownTestContext(ctx: TestContext): Promise<void> {
  // Shutdown manager
  await ctx.manager.shutdown();

  // Clear registry
  await backendRegistry.clear();

  // Reset global backend manager
  backendManager.resetForTesting();

  // Clean up env
  delete process.env["RALPHER_DATA_DIR"];

  // Remove temp directories
  await rm(ctx.dataDir, { recursive: true });
  await rm(ctx.workDir, { recursive: true });
}

/**
 * Wait for a specific event type to be emitted.
 */
export function waitForEvent<T extends LoopEvent["type"]>(
  events: LoopEvent[],
  eventType: T,
  timeout = 5000,
): Promise<Extract<LoopEvent, { type: T }>> {
  return new Promise((resolve, reject) => {
    const startTime = Date.now();

    const check = () => {
      const event = events.find((e) => e.type === eventType);
      if (event) {
        resolve(event as Extract<LoopEvent, { type: T }>);
        return;
      }

      if (Date.now() - startTime > timeout) {
        reject(new Error(`Timeout waiting for event: ${eventType}`));
        return;
      }

      setTimeout(check, 50);
    };

    check();
  });
}

/**
 * Wait for an event matching a predicate.
 */
export function waitForEventMatching<T extends LoopEvent>(
  events: LoopEvent[],
  predicate: (event: LoopEvent) => event is T,
  timeout = 5000,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const startTime = Date.now();

    const check = () => {
      const event = events.find(predicate);
      if (event) {
        resolve(event);
        return;
      }

      if (Date.now() - startTime > timeout) {
        reject(new Error(`Timeout waiting for matching event`));
        return;
      }

      setTimeout(check, 50);
    };

    check();
  });
}

/**
 * Count events of a specific type.
 */
export function countEvents(events: LoopEvent[], eventType: LoopEvent["type"]): number {
  return events.filter((e) => e.type === eventType).length;
}

/**
 * Get all events of a specific type.
 */
export function getEvents<T extends LoopEvent["type"]>(
  events: LoopEvent[],
  eventType: T,
): Extract<LoopEvent, { type: T }>[] {
  return events.filter((e) => e.type === eventType) as Extract<LoopEvent, { type: T }>[];
}

/**
 * Delay helper for tests.
 */
export function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
