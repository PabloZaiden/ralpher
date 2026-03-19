/**
 * Hook for managing the SSH terminal WebSocket connection and I/O.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import type React from "react";
import type { FitAddon, Terminal } from "ghostty-web";
import { appWebSocketUrl } from "../../lib/public-path";
import {
  MAX_PENDING_OSC_COLOR_QUERY_BYTES,
} from "./terminal-constants";
import { parseTerminalOscColorQueries } from "./terminal-osc";
import type { SshSessionKind } from "../../hooks/useSshSession";

function isStandaloneCredentialTokenError(message: string): boolean {
  return message.includes("SSH credential token") || message.includes("credential token");
}

interface UseSshConnectionParams {
  terminalUrl: string | null;
  terminalRef: React.MutableRefObject<Terminal | null>;
  fitAddonRef: React.MutableRefObject<FitAddon | null>;
  sessionKind: SshSessionKind | null;
  focusTerminal: () => void;
  refresh: () => Promise<void>;
  showErrorToast: (message: string) => void;
  copyTerminalClipboardText: (text: string) => Promise<void>;
  clearSelectedTerminalText: (options?: { clearTerminalSelection?: boolean }) => void;
  loadStandaloneCredentialToken: (options?: { forceRefresh?: boolean; promptOnFailure?: boolean }) => Promise<string | null>;
  setStandaloneCredentialToken: (token: string | null) => void;
  setPendingStandaloneAction: (action: "terminal" | "delete" | null) => void;
  setShowPasswordPrompt: (show: boolean) => void;
}

export function useSshConnection({
  terminalUrl,
  terminalRef,
  fitAddonRef,
  sessionKind,
  focusTerminal,
  refresh,
  showErrorToast,
  copyTerminalClipboardText,
  clearSelectedTerminalText,
  loadStandaloneCredentialToken,
  setStandaloneCredentialToken,
  setPendingStandaloneAction,
  setShowPasswordPrompt,
}: UseSshConnectionParams) {
  const [socketStatus, setSocketStatus] = useState<"connecting" | "open" | "closed">("connecting");
  const terminalSocketRef = useRef<WebSocket | null>(null);
  const terminalReadyRef = useRef(false);
  const pendingOutputRef = useRef<string[]>([]);
  const pendingOscColorQueryRef = useRef("");
  const lastSentResizeRef = useRef<{ cols: number; rows: number } | null>(null);
  const terminalConnectInFlightRef = useRef(false);
  const standaloneTokenRecoveryAttemptedRef = useRef(false);

  const sendTerminalPayload = useCallback((
    payload: Record<string, unknown>,
    options?: { focusTerminal?: boolean; notifyOnFailure?: boolean },
  ): boolean => {
    if (terminalSocketRef.current?.readyState !== WebSocket.OPEN || !terminalReadyRef.current) {
      if (options?.notifyOnFailure ?? true) {
        showErrorToast("Terminal is still connecting.");
      }
      return false;
    }
    terminalSocketRef.current.send(JSON.stringify(payload));
    if (options?.focusTerminal ?? true) {
      focusTerminal();
    }
    return true;
  }, [focusTerminal, showErrorToast]);

  const sendTerminalInput = useCallback((
    data: string,
    options?: { focusTerminal?: boolean; notifyOnFailure?: boolean },
  ): boolean => {
    return sendTerminalPayload({ type: "terminal.input", data }, options);
  }, [sendTerminalPayload]);

  const sendTerminalResize = useCallback((cols: number, rows: number) => {
    if (cols <= 0 || rows <= 0) {
      return;
    }
    const previousSize = lastSentResizeRef.current;
    if (previousSize && previousSize.cols === cols && previousSize.rows === rows) {
      return;
    }
    const didSend = sendTerminalPayload(
      { type: "terminal.resize", cols, rows },
      { focusTerminal: false, notifyOnFailure: false },
    );
    if (didSend) {
      lastSentResizeRef.current = { cols, rows };
    }
  }, [sendTerminalPayload]);

  const syncTerminalSize = useCallback((options?: { fit?: boolean }) => {
    const terminal = terminalRef.current;
    if (!terminal) {
      return;
    }
    if (options?.fit) {
      fitAddonRef.current?.fit();
    }
    sendTerminalResize(terminal.cols, terminal.rows);
  }, [fitAddonRef, sendTerminalResize, terminalRef]);

  const writeTerminalOutput = useCallback((chunk: string) => {
    const parsed = parseTerminalOscColorQueries(`${pendingOscColorQueryRef.current}${chunk}`);
    const nextVisibleOutput = parsed.remainder.length > MAX_PENDING_OSC_COLOR_QUERY_BYTES
      ? `${parsed.visibleOutput}${parsed.remainder}`
      : parsed.visibleOutput;
    pendingOscColorQueryRef.current = parsed.remainder.length > MAX_PENDING_OSC_COLOR_QUERY_BYTES
      ? ""
      : parsed.remainder;

    for (const reply of parsed.replies) {
      void sendTerminalInput(reply, { focusTerminal: false, notifyOnFailure: false });
    }

    if (!nextVisibleOutput) {
      return;
    }

    if (!terminalRef.current) {
      pendingOutputRef.current.push(nextVisibleOutput);
      return;
    }

    terminalRef.current.write(nextVisibleOutput);
  }, [sendTerminalInput, terminalRef]);

  const flushPendingOutput = useCallback(() => {
    if (!terminalRef.current || pendingOutputRef.current.length === 0) {
      return;
    }
    for (const chunk of pendingOutputRef.current) {
      terminalRef.current.write(chunk);
    }
    pendingOutputRef.current = [];
  }, [terminalRef]);

  const markTerminalReady = useCallback(() => {
    if (terminalReadyRef.current) {
      return;
    }
    terminalReadyRef.current = true;
    standaloneTokenRecoveryAttemptedRef.current = false;
    lastSentResizeRef.current = null;
    setSocketStatus("open");
    syncTerminalSize({ fit: true });
    flushPendingOutput();
    void refresh();
  }, [flushPendingOutput, refresh, syncTerminalSize]);

  const connectTerminal = useCallback(async (
    options?: { refreshStandaloneCredential?: boolean; standaloneCredentialToken?: string },
  ) => {
    if (!terminalUrl) {
      return;
    }
    if (terminalConnectInFlightRef.current) {
      return;
    }
    terminalConnectInFlightRef.current = true;
    try {
      let standaloneAuthToken = options?.standaloneCredentialToken ?? null;
      if (sessionKind === "standalone") {
        if (!standaloneAuthToken) {
          standaloneAuthToken = await loadStandaloneCredentialToken({
            forceRefresh: options?.refreshStandaloneCredential ?? false,
          });
        }
        if (!standaloneAuthToken) {
          return;
        }
      }
      terminalSocketRef.current?.close();
      terminalReadyRef.current = false;
      pendingOutputRef.current = [];
      pendingOscColorQueryRef.current = "";
      lastSentResizeRef.current = null;
      clearSelectedTerminalText();
      setSocketStatus("connecting");

      const ws = new WebSocket(appWebSocketUrl(terminalUrl));
      terminalSocketRef.current = ws;

      ws.onopen = () => {
        if (standaloneAuthToken) {
          ws.send(JSON.stringify({
            type: "terminal.auth",
            credentialToken: standaloneAuthToken,
          }));
        }
      };
      ws.onmessage = (event) => {
        if (terminalSocketRef.current !== ws) {
          return;
        }
        const data = JSON.parse(event.data as string) as {
          type: string;
          data?: string;
          message?: string;
          text?: string;
        };
        if (data.type === "terminal.connected") {
          markTerminalReady();
        }
        if (data.type === "terminal.clipboard" && typeof data.text === "string") {
          void copyTerminalClipboardText(data.text);
        }
        if (data.type === "terminal.output" && data.data) {
          if (!terminalReadyRef.current) {
            markTerminalReady();
          }
          writeTerminalOutput(data.data);
        }
        if (data.type === "terminal.error" && data.message) {
          terminalRef.current?.writeln(`\r\n${data.message}`);
          if (sessionKind === "standalone" && isStandaloneCredentialTokenError(data.message)) {
            setStandaloneCredentialToken(null);
            if (standaloneTokenRecoveryAttemptedRef.current) {
              setPendingStandaloneAction("terminal");
              setShowPasswordPrompt(true);
              showErrorToast("Failed to refresh the SSH session automatically. Re-enter the SSH password to continue.");
              return;
            }
            standaloneTokenRecoveryAttemptedRef.current = true;
            terminalReadyRef.current = false;
            lastSentResizeRef.current = null;
            pendingOscColorQueryRef.current = "";
            setSocketStatus("closed");
            if (terminalSocketRef.current === ws) {
              terminalSocketRef.current = null;
            }
            ws.close();
            void connectTerminal({ refreshStandaloneCredential: true });
            return;
          }
          showErrorToast(data.message);
        }
        if (data.type === "terminal.closed") {
          terminalReadyRef.current = false;
          lastSentResizeRef.current = null;
          pendingOscColorQueryRef.current = "";
          clearSelectedTerminalText();
          setSocketStatus("closed");
        }
      };
      ws.onclose = () => {
        if (terminalSocketRef.current !== ws) {
          return;
        }
        terminalSocketRef.current = null;
        terminalReadyRef.current = false;
        lastSentResizeRef.current = null;
        pendingOscColorQueryRef.current = "";
        clearSelectedTerminalText();
        setSocketStatus("closed");
      };
      ws.onerror = () => {
        if (terminalSocketRef.current !== ws) {
          return;
        }
        terminalReadyRef.current = false;
        lastSentResizeRef.current = null;
        pendingOscColorQueryRef.current = "";
        clearSelectedTerminalText();
        setSocketStatus("closed");
      };
    } finally {
      terminalConnectInFlightRef.current = false;
    }
  }, [
    clearSelectedTerminalText,
    copyTerminalClipboardText,
    loadStandaloneCredentialToken,
    markTerminalReady,
    sessionKind,
    setShowPasswordPrompt,
    setStandaloneCredentialToken,
    setPendingStandaloneAction,
    showErrorToast,
    terminalRef,
    terminalUrl,
    writeTerminalOutput,
  ]);

  const recoverTerminalOnForeground = useCallback(() => {
    if (!terminalUrl) {
      return;
    }
    if (typeof document !== "undefined" && document.visibilityState === "hidden") {
      return;
    }
    const readyState = terminalSocketRef.current?.readyState;
    if (readyState === WebSocket.OPEN || readyState === WebSocket.CONNECTING) {
      return;
    }
    void connectTerminal({ refreshStandaloneCredential: sessionKind === "standalone" });
  }, [connectTerminal, sessionKind, terminalUrl]);

  useEffect(() => {
    if (!terminalUrl) {
      return;
    }
    void connectTerminal();
    return () => {
      terminalReadyRef.current = false;
      terminalSocketRef.current?.close();
      terminalSocketRef.current = null;
      clearSelectedTerminalText();
    };
  }, [clearSelectedTerminalText, connectTerminal, terminalUrl]);

  useEffect(() => {
    if (!terminalUrl || typeof window === "undefined" || typeof document === "undefined") {
      return;
    }

    const handleWindowFocus = () => {
      recoverTerminalOnForeground();
    };
    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        recoverTerminalOnForeground();
      }
    };

    window.addEventListener("focus", handleWindowFocus);
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      window.removeEventListener("focus", handleWindowFocus);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [recoverTerminalOnForeground, terminalUrl]);

  return {
    socketStatus,
    terminalReadyRef,
    sendTerminalPayload,
    sendTerminalInput,
    sendTerminalResize,
    syncTerminalSize,
    writeTerminalOutput,
    flushPendingOutput,
    markTerminalReady,
    connectTerminal,
    recoverTerminalOnForeground,
  };
}
