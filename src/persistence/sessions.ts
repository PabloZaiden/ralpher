/**
 * Session persistence layer for Ralph Loops Management System.
 * Handles mapping between loops and backend sessions.
 */

import { getSessionsFilePath } from "./paths";

/**
 * Session mappings for a backend.
 * Maps loop IDs to backend session IDs.
 */
interface SessionMappings {
  [loopId: string]: {
    sessionId: string;
    serverUrl?: string;
    createdAt: string;
  };
}

/**
 * Load session mappings for a backend.
 */
export async function loadSessionMappings(backendName: string): Promise<SessionMappings> {
  const filePath = getSessionsFilePath(backendName);
  const file = Bun.file(filePath);

  if (!(await file.exists())) {
    return {};
  }

  try {
    return await file.json() as SessionMappings;
  } catch {
    return {};
  }
}

/**
 * Save session mappings for a backend.
 */
export async function saveSessionMappings(
  backendName: string,
  mappings: SessionMappings
): Promise<void> {
  const filePath = getSessionsFilePath(backendName);
  await Bun.write(filePath, JSON.stringify(mappings, null, 2));
}

/**
 * Get a session mapping for a specific loop.
 */
export async function getSessionMapping(
  backendName: string,
  loopId: string
): Promise<{ sessionId: string; serverUrl?: string } | null> {
  const mappings = await loadSessionMappings(backendName);
  const mapping = mappings[loopId];
  return mapping ?? null;
}

/**
 * Set a session mapping for a loop.
 */
export async function setSessionMapping(
  backendName: string,
  loopId: string,
  sessionId: string,
  serverUrl?: string
): Promise<void> {
  const mappings = await loadSessionMappings(backendName);
  mappings[loopId] = {
    sessionId,
    serverUrl,
    createdAt: new Date().toISOString(),
  };
  await saveSessionMappings(backendName, mappings);
}

/**
 * Remove a session mapping for a loop.
 */
export async function removeSessionMapping(
  backendName: string,
  loopId: string
): Promise<boolean> {
  const mappings = await loadSessionMappings(backendName);
  if (!(loopId in mappings)) {
    return false;
  }

  delete mappings[loopId];
  await saveSessionMappings(backendName, mappings);
  return true;
}
