/**
 * Command executor factory type and utilities.
 * Provides the factory type used to create and cache command executors.
 */

import type { CommandExecutor } from "../command-executor";

/**
 * Factory function type for creating command executors.
 */
export type CommandExecutorFactory = (directory: string) => CommandExecutor;
