/**
 * Loop persistence layer for Ralph Loops Management System.
 * Handles reading and writing loop data to JSON files.
 * Uses Bun.file API as per project guidelines.
 */

import { unlink, readdir } from "fs/promises";
import type { Loop, LoopConfig, LoopState } from "../types";
import { getLoopFilePath, getLoopsDir } from "./paths";

/**
 * Persisted loop data structure.
 * This is what gets saved to disk.
 */
interface PersistedLoop {
  config: LoopConfig;
  state: LoopState;
}

/**
 * Save a loop to disk.
 */
export async function saveLoop(loop: Loop): Promise<void> {
  const filePath = getLoopFilePath(loop.config.id);
  const data: PersistedLoop = {
    config: loop.config,
    state: loop.state,
  };
  await Bun.write(filePath, JSON.stringify(data, null, 2));
}

/**
 * Load a loop from disk by ID.
 * Returns null if the loop doesn't exist.
 */
export async function loadLoop(loopId: string): Promise<Loop | null> {
  const filePath = getLoopFilePath(loopId);
  const file = Bun.file(filePath);

  if (!(await file.exists())) {
    return null;
  }

  try {
    const data = await file.json() as PersistedLoop;
    return {
      config: data.config,
      state: data.state,
    };
  } catch {
    // File exists but is corrupted or invalid JSON
    return null;
  }
}

/**
 * Delete a loop from disk.
 * Returns true if deleted, false if it didn't exist.
 */
export async function deleteLoop(loopId: string): Promise<boolean> {
  const filePath = getLoopFilePath(loopId);
  const file = Bun.file(filePath);

  if (!(await file.exists())) {
    return false;
  }

  await unlink(filePath);
  return true;
}

/**
 * List all loops from disk.
 */
export async function listLoops(): Promise<Loop[]> {
  const loopsDir = getLoopsDir();

  try {
    const files = await readdir(loopsDir);
    const jsonFiles = files.filter(f => f.endsWith(".json"));

    const loops: Loop[] = [];
    for (const file of jsonFiles) {
      const loopId = file.replace(".json", "");
      const loop = await loadLoop(loopId);
      if (loop) {
        loops.push(loop);
      }
    }

    // Sort by creation date, newest first
    loops.sort((a, b) =>
      new Date(b.config.createdAt).getTime() - new Date(a.config.createdAt).getTime()
    );

    return loops;
  } catch {
    // Directory doesn't exist or is inaccessible
    return [];
  }
}

/**
 * Check if a loop exists.
 */
export async function loopExists(loopId: string): Promise<boolean> {
  const filePath = getLoopFilePath(loopId);
  const file = Bun.file(filePath);
  return file.exists();
}

/**
 * Update only the state portion of a loop.
 * More efficient than saving the entire loop when only state changes.
 */
export async function updateLoopState(loopId: string, state: LoopState): Promise<boolean> {
  const loop = await loadLoop(loopId);
  if (!loop) {
    return false;
  }

  loop.state = state;
  await saveLoop(loop);
  return true;
}

/**
 * Update only the config portion of a loop.
 */
export async function updateLoopConfig(loopId: string, config: LoopConfig): Promise<boolean> {
  const loop = await loadLoop(loopId);
  if (!loop) {
    return false;
  }

  loop.config = config;
  await saveLoop(loop);
  return true;
}
