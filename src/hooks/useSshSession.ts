/**
 * Hook for a single SSH session detail view.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import type { SshSession, SshSessionEvent, UpdateSshSessionRequest } from "../types";
import { useWebSocket } from "./useWebSocket";
import { appFetch } from "../lib/public-path";

export interface UseSshSessionResult {
  session: SshSession | null;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  updateSession: (request: UpdateSshSessionRequest) => Promise<SshSession | null>;
  deleteSession: () => Promise<boolean>;
}

export function useSshSession(sessionId: string): UseSshSessionResult {
  const [session, setSession] = useState<SshSession | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const initialLoadDoneRef = useRef(false);

  const refreshInternal = useCallback(async (showLoading: boolean) => {
    try {
      if (showLoading) {
        setLoading(true);
      }
      setError(null);
      const response = await appFetch(`/api/ssh-sessions/${sessionId}`);
      if (!response.ok) {
        const data = await response.json() as { message?: string };
        throw new Error(data.message || "Failed to fetch SSH session");
      }
      const data = await response.json() as SshSession;
      setSession(data);
      initialLoadDoneRef.current = true;
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  }, [sessionId]);

  const refresh = useCallback(async () => {
    await refreshInternal(!initialLoadDoneRef.current);
  }, [refreshInternal]);

  const handleEvent = useCallback((event: SshSessionEvent | { type?: string; sshSessionId?: string }) => {
    if (!event.type?.startsWith("ssh_session.")) {
      return;
    }
    if (event.sshSessionId !== sessionId) {
      return;
    }
    if (event.type === "ssh_session.deleted") {
      setSession(null);
      return;
    }
    void refreshInternal(false);
  }, [refreshInternal, sessionId]);

  useWebSocket<SshSessionEvent>({
    url: `/api/ws?sshSessionId=${encodeURIComponent(sessionId)}`,
    onEvent: handleEvent,
  });

  const updateSession = useCallback(async (request: UpdateSshSessionRequest): Promise<SshSession | null> => {
    try {
      setError(null);
      const response = await appFetch(`/api/ssh-sessions/${sessionId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(request),
      });
      if (!response.ok) {
        const data = await response.json() as { message?: string };
        throw new Error(data.message || "Failed to update SSH session");
      }
      const updated = await response.json() as SshSession;
      setSession(updated);
      return updated;
    } catch (err) {
      setError(String(err));
      return null;
    }
  }, [sessionId]);

  const deleteSession = useCallback(async (): Promise<boolean> => {
    try {
      setError(null);
      const response = await appFetch(`/api/ssh-sessions/${sessionId}`, {
        method: "DELETE",
      });
      if (!response.ok) {
        const data = await response.json() as { message?: string };
        throw new Error(data.message || "Failed to delete SSH session");
      }
      setSession(null);
      return true;
    } catch (err) {
      setError(String(err));
      return false;
    }
  }, [sessionId]);

  useEffect(() => {
    initialLoadDoneRef.current = false;
    setSession(null);
    setLoading(true);
    setError(null);
  }, [sessionId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return {
    session,
    loading,
    error,
    refresh,
    updateSession,
    deleteSession,
  };
}
