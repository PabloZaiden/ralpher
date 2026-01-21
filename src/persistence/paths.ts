/**
 * Persistence path configuration for Ralph Loops Management System.
 * Provides centralized path management for the data directory.
 * Supports environment variable override for Docker volume mounting.
 */

import { join } from "path";

/**
 * Get the root data directory path.
 * Can be overridden via RALPHER_DATA_DIR environment variable.
 */
export function getDataDir(): string {
  return process.env["RALPHER_DATA_DIR"] ?? "./data";
}

/**
 * Get the loops directory path.
 * Stores loop configuration and state JSON files.
 */
export function getLoopsDir(): string {
  return join(getDataDir(), "loops");
}

/**
 * Get the sessions directory path.
 * Stores backend session mappings.
 */
export function getSessionsDir(): string {
  return join(getDataDir(), "sessions");
}

/**
 * Get the path for a specific loop's JSON file.
 */
export function getLoopFilePath(loopId: string): string {
  return join(getLoopsDir(), `${loopId}.json`);
}

/**
 * Get the path for a backend's session mapping file.
 */
export function getSessionsFilePath(backendName: string): string {
  return join(getSessionsDir(), `${backendName}.json`);
}

/**
 * Ensure all required directories exist.
 * Creates them if they don't exist.
 */
export async function ensureDataDirectories(): Promise<void> {
  const { mkdir } = await import("fs/promises");

  const dirs = [getDataDir(), getLoopsDir(), getSessionsDir()];

  for (const dir of dirs) {
    await mkdir(dir, { recursive: true });
  }
}

/**
 * Check if the data directory is properly configured.
 */
export async function isDataDirectoryReady(): Promise<boolean> {
  const { access } = await import("fs/promises");

  try {
    await access(getLoopsDir());
    await access(getSessionsDir());
    return true;
  } catch {
    return false;
  }
}
