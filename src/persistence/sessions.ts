/**
 * Session persistence layer for Ralph Loops Management System.
 * Handles mapping between loops and backend sessions using SQLite.
 */

import { getDatabase } from "./database";

/**
 * Session mapping structure.
 */
interface SessionMapping {
  sessionId: string;
  serverUrl?: string;
  createdAt: string;
}

/**
 * Session mappings for a backend.
 * Maps loop IDs to backend session info.
 */
interface SessionMappings {
  [loopId: string]: SessionMapping;
}

/**
 * Load session mappings for a backend.
 */
export async function loadSessionMappings(backendName: string): Promise<SessionMappings> {
  const db = getDatabase();
  
  const stmt = db.prepare(`
    SELECT loop_id, session_id, server_url, created_at 
    FROM sessions 
    WHERE backend_name = ?
  `);
  const rows = stmt.all(backendName) as Array<{
    loop_id: string;
    session_id: string;
    server_url: string | null;
    created_at: string;
  }>;
  
  const mappings: SessionMappings = {};
  for (const row of rows) {
    mappings[row.loop_id] = {
      sessionId: row.session_id,
      serverUrl: row.server_url ?? undefined,
      createdAt: row.created_at,
    };
  }
  
  return mappings;
}

/**
 * Save session mappings for a backend.
 * Replaces all existing mappings for the backend.
 * Uses a transaction to ensure atomicity of DELETE + INSERTs.
 */
export async function saveSessionMappings(
  backendName: string,
  mappings: SessionMappings
): Promise<void> {
  const db = getDatabase();
  
  const deleteStmt = db.prepare("DELETE FROM sessions WHERE backend_name = ?");
  const insertStmt = db.prepare(`
    INSERT INTO sessions (backend_name, loop_id, session_id, server_url, created_at)
    VALUES (?, ?, ?, ?, ?)
  `);
  
  // Wrap DELETE + INSERTs in a transaction to ensure atomicity
  const saveAll = db.transaction(() => {
    deleteStmt.run(backendName);
    
    for (const [loopId, mapping] of Object.entries(mappings)) {
      insertStmt.run(
        backendName,
        loopId,
        mapping.sessionId,
        mapping.serverUrl ?? null,
        mapping.createdAt
      );
    }
  });
  
  saveAll();
}

/**
 * Get a session mapping for a specific loop.
 */
export async function getSessionMapping(
  backendName: string,
  loopId: string
): Promise<{ sessionId: string; serverUrl?: string } | null> {
  const db = getDatabase();
  
  const stmt = db.prepare(`
    SELECT session_id, server_url 
    FROM sessions 
    WHERE backend_name = ? AND loop_id = ?
  `);
  const row = stmt.get(backendName, loopId) as {
    session_id: string;
    server_url: string | null;
  } | null;
  
  if (!row) {
    return null;
  }
  
  return {
    sessionId: row.session_id,
    serverUrl: row.server_url ?? undefined,
  };
}

/**
 * Set a session mapping for a loop.
 * Uses UPSERT to preserve created_at on updates.
 */
export async function setSessionMapping(
  backendName: string,
  loopId: string,
  sessionId: string,
  serverUrl?: string
): Promise<void> {
  const db = getDatabase();
  
  // Use INSERT ... ON CONFLICT to preserve created_at on updates
  const stmt = db.prepare(`
    INSERT INTO sessions (backend_name, loop_id, session_id, server_url, created_at)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(backend_name, loop_id) DO UPDATE SET
      session_id = excluded.session_id,
      server_url = excluded.server_url
  `);
  
  stmt.run(
    backendName,
    loopId,
    sessionId,
    serverUrl ?? null,
    new Date().toISOString()
  );
}

/**
 * Remove a session mapping for a loop.
 */
export async function removeSessionMapping(
  backendName: string,
  loopId: string
): Promise<boolean> {
  const db = getDatabase();
  
  const stmt = db.prepare("DELETE FROM sessions WHERE backend_name = ? AND loop_id = ?");
  const result = stmt.run(backendName, loopId);
  
  return result.changes > 0;
}
