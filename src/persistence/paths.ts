/**
 * Persistence path configuration for Ralph Loops Management System.
 * Provides data directory path configuration.
 * Supports environment variable override for Docker volume mounting.
 * 
 * Note: Most path functions have been removed as we now use SQLite.
 * The database path is managed in database.ts.
 */

import { initializeDatabase, isDatabaseReady } from "./database";

/**
 * Ensure all required directories exist and database is initialized.
 */
export async function ensureDataDirectories(): Promise<void> {
  await initializeDatabase();
}

/**
 * Check if the data directory is properly configured.
 */
export async function isDataDirectoryReady(): Promise<boolean> {
  return isDatabaseReady();
}
