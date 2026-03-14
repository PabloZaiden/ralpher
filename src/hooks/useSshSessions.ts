/**
 * Hook for managing SSH sessions with real-time updates.
 */

import { useCallback, useEffect, useState } from "react";
import type { CreateSshSessionRequest, SshSession, SshSessionEvent, UpdateSshSessionRequest } from "../types";
import { useGlobalEvents } from "./useWebSocket";
import { appFetch } from "../lib/public-path";

export interface UseSshSessionsResult {
  sessions: SshSession[];
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  createSession: (request: CreateSshSessionRequest) => Promise<SshSession>;
  updateSession: (id: string, request: UpdateSshSessionRequest) => Promise<SshSession | null>;
  deleteSession: (id: string) => Promise<boolean>;
  getSession: (id: string) => SshSession | undefined;
}

export function useSshSessions(): UseSshSessionsResult {
  const [sessions, setSessions] = useState<SshSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const response = await appFetch("/api/ssh-sessions");
      if (!response.ok) {
        const data = await response.json() as { message?: string };
        throw new Error(data.message || "Failed to fetch SSH sessions");
      }
      const data = await response.json() as SshSession[];
      setSessions(data);
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  const refreshSession = useCallback(async (id: string) => {
    try {
      const response = await appFetch(`/api/ssh-sessions/${id}`);
      if (!response.ok) {
        if (response.status === 404) {
          setSessions((prev) => prev.filter((session) => session.config.id !== id));
          return;
        }
        const data = await response.json() as { message?: string };
        throw new Error(data.message || "Failed to fetch SSH session");
      }
      const session = await response.json() as SshSession;
      setSessions((prev) => {
        const index = prev.findIndex((item) => item.config.id === id);
        if (index >= 0) {
          const next = [...prev];
          next[index] = session;
          return next;
        }
        return [session, ...prev];
      });
    } catch (err) {
      setError(String(err));
    }
  }, []);

  const handleEvent = useCallback((event: SshSessionEvent | { type?: string; sshSessionId?: string }) => {
    if (!event.type?.startsWith("ssh_session.")) {
      return;
    }

    if (event.type === "ssh_session.deleted" && event.sshSessionId) {
      setSessions((prev) => prev.filter((session) => session.config.id !== event.sshSessionId));
      return;
    }

    if (event.sshSessionId) {
      void refreshSession(event.sshSessionId);
    } else {
      void refresh();
    }
  }, [refresh, refreshSession]);

  useGlobalEvents<SshSessionEvent>({
    onEvent: handleEvent,
  });

  const createSession = useCallback(async (request: CreateSshSessionRequest): Promise<SshSession> => {
    try {
      setError(null);
      const response = await appFetch("/api/ssh-sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(request),
      });
      if (!response.ok) {
        const data = await response.json() as { message?: string };
        throw new Error(data.message || "Failed to create SSH session");
      }
      const session = await response.json() as SshSession;
      setSessions((prev) => [session, ...prev.filter((item) => item.config.id !== session.config.id)]);
      return session;
    } catch (err) {
      const message = String(err);
      setError(message);
      throw err instanceof Error ? err : new Error(message);
    }
  }, []);

  const updateSession = useCallback(async (id: string, request: UpdateSshSessionRequest): Promise<SshSession | null> => {
    try {
      setError(null);
      const response = await appFetch(`/api/ssh-sessions/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(request),
      });
      if (!response.ok) {
        const data = await response.json() as { message?: string };
        throw new Error(data.message || "Failed to update SSH session");
      }
      const session = await response.json() as SshSession;
      setSessions((prev) => prev.map((item) => item.config.id === id ? session : item));
      return session;
    } catch (err) {
      setError(String(err));
      return null;
    }
  }, []);

  const deleteSession = useCallback(async (id: string): Promise<boolean> => {
    try {
      setError(null);
      const response = await appFetch(`/api/ssh-sessions/${id}`, {
        method: "DELETE",
      });
      if (!response.ok) {
        const data = await response.json() as { message?: string };
        throw new Error(data.message || "Failed to delete SSH session");
      }
      setSessions((prev) => prev.filter((item) => item.config.id !== id));
      return true;
    } catch (err) {
      setError(String(err));
      return false;
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return {
    sessions,
    loading,
    error,
    refresh,
    createSession,
    updateSession,
    deleteSession,
    getSession: (id: string) => sessions.find((session) => session.config.id === id),
  };
}
