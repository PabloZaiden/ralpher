/**
 * Dedicated SSH session terminal view.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FitAddon, Terminal } from "ghostty-web";
import { Badge, Button, Card, ConfirmModal, EditIcon } from "../common";
import { getSshServerApi, useSshSession, useToast } from "../../hooks";
import { RenameSshSessionModal } from "../RenameSshSessionModal";
import {
  defaultTerminalModifiers,
  encodeTerminalDataInput,
  encodeTerminalInput,
  hasActiveTerminalModifiers,
  type TerminalModifierState,
  type TerminalSpecialKey,
} from "../../utils/terminal-keys";
import { isPersistentSshSession, writeTextToClipboard } from "../../utils";
import { appWebSocketUrl } from "../../lib/public-path";
import { getStoredSshCredentialToken, storeSshServerPassword } from "../../lib/ssh-browser-credentials";
import type { SshServer } from "../../types";
import { isStandaloneSession } from "./session-utils";
import {
  initializeGhosttyWeb,
  MAX_PENDING_OSC_COLOR_QUERY_BYTES,
  remeasureTerminalFont,
  resolveTerminalFontFamily,
  TERMINAL_FONT_SIZE_PX,
  TERMINAL_PADDING_BOTTOM_PX,
  TERMINAL_PADDING_TOP_PX,
  TERMINAL_PADDING_X_PX,
  TERMINAL_THEME,
} from "./terminal-constants";
import { parseTerminalOscColorQueries } from "./terminal-osc";
import { installTerminalMouseHandlers } from "./terminal-mouse";
import { SessionInfoSection } from "./session-info-section";
import { TouchControlsSection } from "./touch-controls-section";
import { ClipboardFallbackCard } from "./clipboard-fallback-card";
import { StandalonePasswordModal } from "./standalone-password-modal";

export interface SshSessionDetailsProps {
  sshSessionId: string;
  onBack?: () => void;
  showBackButton?: boolean;
  headerOffsetClassName?: string;
  copyTextToClipboard?: (text: string) => Promise<void>;
}

function isStandaloneCredentialTokenError(message: string): boolean {
  return message.includes("SSH credential token") || message.includes("credential token");
}

export function SshSessionDetails({
  sshSessionId,
  onBack,
  showBackButton = true,
  headerOffsetClassName,
  copyTextToClipboard = writeTextToClipboard,
}: SshSessionDetailsProps) {
  const toast = useToast();
  const { error: showErrorToast, warning: showWarningToast } = toast;
  const { session, sessionKind, loading, error, deleteSession, refresh, updateSession } = useSshSession(sshSessionId);
  const terminalContainerRef = useRef<HTMLDivElement>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const terminalSocketRef = useRef<WebSocket | null>(null);
  const terminalReadyRef = useRef(false);
  const terminalModifiersRef = useRef<TerminalModifierState>(defaultTerminalModifiers);
  const standaloneCredentialTokenRef = useRef<string | null>(null);
  const pendingStandaloneActionRef = useRef<"terminal" | "delete" | null>(null);
  const pendingOutputRef = useRef<string[]>([]);
  const pendingOscColorQueryRef = useRef("");
  const lastSentResizeRef = useRef<{ cols: number; rows: number } | null>(null);
  const terminalConnectInFlightRef = useRef(false);
  const standaloneTokenRecoveryAttemptedRef = useRef(false);
  const lastShownNoticeRef = useRef<string | null>(null);
  const [socketStatus, setSocketStatus] = useState<"connecting" | "open" | "closed">("connecting");
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [showRenameModal, setShowRenameModal] = useState(false);
  const [showPasswordPrompt, setShowPasswordPrompt] = useState(false);
  const [terminalModifiers, setTerminalModifiers] = useState<TerminalModifierState>(defaultTerminalModifiers);
  const [hasSelectedTerminalText, setHasSelectedTerminalText] = useState(false);
  const [pendingTerminalClipboardText, setPendingTerminalClipboardText] = useState<string | null>(null);
  const [standalonePassword, setStandalonePassword] = useState("");
  const [standaloneCredentialToken, setStandaloneCredentialToken] = useState<string | null>(null);
  const [pendingStandaloneAction, setPendingStandaloneAction] = useState<"terminal" | "delete" | null>(null);
  const [standaloneServer, setStandaloneServer] = useState<SshServer | null>(null);
  const standaloneServerId = useMemo(() => {
    if (!session || !isStandaloneSession(session)) {
      return null;
    }
    return session.config.sshServerId;
  }, [session]);
  const standaloneServerName = useMemo(() => {
    if (!standaloneServerId) {
      return null;
    }
    return standaloneServer?.config.name ?? standaloneServerId;
  }, [standaloneServer, standaloneServerId]);
  const standaloneServerTarget = useMemo(() => {
    if (!standaloneServerId) {
      return null;
    }
    return standaloneServer
      ? `${standaloneServer.config.username}@${standaloneServer.config.address}`
      : standaloneServerId;
  }, [standaloneServer, standaloneServerId]);

  const terminalUrl = useMemo(
    () => {
      if (!session) {
        return null;
      }
      if (isStandaloneSession(session)) {
        return `/api/ssh-terminal?sshServerSessionId=${encodeURIComponent(sshSessionId)}`;
      }
      return `/api/ssh-terminal?sshSessionId=${encodeURIComponent(sshSessionId)}`;
    },
    [session, sshSessionId],
  );
  const hasPersistentSession = useMemo(() => {
    return session ? isPersistentSshSession(session) : false;
  }, [session]);
  const canRenameSession = sessionKind === "workspace";

  useEffect(() => {
    terminalModifiersRef.current = terminalModifiers;
  }, [terminalModifiers]);

  useEffect(() => {
    const notice = session?.state.notice ?? null;
    if (!notice) {
      lastShownNoticeRef.current = null;
      return;
    }
    if (notice === lastShownNoticeRef.current) {
      return;
    }
    lastShownNoticeRef.current = notice;
    showWarningToast(notice, { duration: 12_000 });
  }, [session?.state.notice, showWarningToast]);

  useEffect(() => {
    standaloneCredentialTokenRef.current = standaloneCredentialToken;
  }, [standaloneCredentialToken]);

  useEffect(() => {
    pendingStandaloneActionRef.current = pendingStandaloneAction;
  }, [pendingStandaloneAction]);

  const focusTerminal = useCallback(() => {
    terminalRef.current?.focus();
  }, []);

  const syncTerminalSelectionState = useCallback(() => {
    const terminal = terminalRef.current;
    setHasSelectedTerminalText(Boolean(terminal?.hasSelection()));
  }, []);

  const clearSelectedTerminalText = useCallback((options?: { clearTerminalSelection?: boolean }) => {
    if (options?.clearTerminalSelection ?? true) {
      terminalRef.current?.clearSelection();
    }
    setHasSelectedTerminalText(false);
  }, []);

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
    return sendTerminalPayload({
      type: "terminal.input",
      data,
    }, options);
  }, [sendTerminalPayload]);

  const sendTerminalResize = useCallback((cols: number, rows: number) => {
    if (cols <= 0 || rows <= 0) {
      return;
    }

    const previousSize = lastSentResizeRef.current;
    if (previousSize && previousSize.cols === cols && previousSize.rows === rows) {
      return;
    }

    const didSend = sendTerminalPayload({
      type: "terminal.resize",
      cols,
      rows,
    }, { focusTerminal: false, notifyOnFailure: false });
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
  }, [sendTerminalResize]);

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
  }, [sendTerminalInput]);

  const flushPendingOutput = useCallback(() => {
    if (!terminalRef.current || pendingOutputRef.current.length === 0) {
      return;
    }
    for (const chunk of pendingOutputRef.current) {
      terminalRef.current.write(chunk);
    }
    pendingOutputRef.current = [];
  }, []);

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

  const resetTerminalModifiers = useCallback(() => {
    setTerminalModifiers(defaultTerminalModifiers);
  }, []);

  const toggleTerminalModifier = useCallback((modifier: keyof TerminalModifierState) => {
    setTerminalModifiers((current) => ({
      ...current,
      [modifier]: !current[modifier],
    }));
    focusTerminal();
  }, [focusTerminal]);

  const sendEncodedTerminalKey = useCallback((key: TerminalSpecialKey | string) => {
    const encoded = encodeTerminalInput(key, terminalModifiers);
    if (!encoded) {
      showErrorToast("That key combination is not supported.");
      return;
    }

    const didSend = sendTerminalInput(encoded);
    if (didSend) {
      resetTerminalModifiers();
    }
  }, [resetTerminalModifiers, sendTerminalInput, terminalModifiers, showErrorToast]);

  const sendCtrlC = useCallback(() => {
    const encoded = encodeTerminalInput("c", {
      ctrl: true,
      alt: false,
      shift: false,
    });
    if (!encoded) {
      showErrorToast("Ctrl+C is not supported.");
      return;
    }

    const didSend = sendTerminalInput(encoded);
    if (didSend) {
      resetTerminalModifiers();
    }
  }, [resetTerminalModifiers, sendTerminalInput, showErrorToast]);

  const sendTerminalTextShortcut = useCallback((data: string) => {
    const didSend = sendTerminalInput(data);
    if (didSend) {
      resetTerminalModifiers();
    }
  }, [resetTerminalModifiers, sendTerminalInput]);

  const sendTerminalKeystroke = useCallback((data: string) => {
    const modifiers = terminalModifiersRef.current;
    if (!hasActiveTerminalModifiers(modifiers)) {
      return sendTerminalInput(data, { notifyOnFailure: false });
    }

    const encoded = encodeTerminalDataInput(data, modifiers);
    if (!encoded) {
      showErrorToast("That key combination is not supported.");
      return;
    }

    const didSend = sendTerminalInput(encoded, { notifyOnFailure: false });
    if (didSend) {
      resetTerminalModifiers();
    }
  }, [resetTerminalModifiers, sendTerminalInput, showErrorToast]);

  const copyTerminalClipboardText = useCallback(async (
    text: string,
    options?: { userInitiated?: boolean },
  ) => {
    try {
      await copyTextToClipboard(text);
      setPendingTerminalClipboardText(null);
    } catch (error) {
      setPendingTerminalClipboardText(text);
      if (options?.userInitiated) {
        showErrorToast(`Failed to copy terminal text to the clipboard: ${String(error)}`);
      }
    } finally {
      focusTerminal();
    }
  }, [copyTextToClipboard, focusTerminal, showErrorToast]);

  const retryPendingTerminalClipboardCopy = useCallback(() => {
    if (!pendingTerminalClipboardText) {
      return;
    }
    void copyTerminalClipboardText(pendingTerminalClipboardText, { userInitiated: true });
  }, [copyTerminalClipboardText, pendingTerminalClipboardText]);

  const copySelectedTerminalText = useCallback(() => {
    const terminal = terminalRef.current;
    const nextSelectedText = terminal?.getSelection() ?? "";
    if (!nextSelectedText) {
      focusTerminal();
      return;
    }
    void copyTerminalClipboardText(nextSelectedText, { userInitiated: true });
  }, [copyTerminalClipboardText, focusTerminal]);

  const loadStandaloneCredentialToken = useCallback(async (
    options?: { forceRefresh?: boolean; promptOnFailure?: boolean },
  ): Promise<string | null> => {
    if (!standaloneServerId) {
      setStandaloneCredentialToken(null);
      return null;
    }

    if (!options?.forceRefresh && standaloneCredentialTokenRef.current) {
      return standaloneCredentialTokenRef.current;
    }

    try {
      const token = await getStoredSshCredentialToken(standaloneServerId);
      setStandaloneCredentialToken(token);
      if (token) {
        if (pendingStandaloneActionRef.current !== "delete") {
          setShowPasswordPrompt(false);
          setPendingStandaloneAction(null);
        }
        return token;
      }

      if ((options?.promptOnFailure ?? true) && pendingStandaloneActionRef.current !== "delete") {
        setPendingStandaloneAction("terminal");
        setShowPasswordPrompt(true);
      }
      return null;
    } catch (error) {
      setStandaloneCredentialToken(null);
      setSocketStatus("closed");
      showErrorToast(`Failed to refresh the stored SSH credential: ${String(error)}`);
      if ((options?.promptOnFailure ?? true) && pendingStandaloneActionRef.current !== "delete") {
        setPendingStandaloneAction("terminal");
        setShowPasswordPrompt(true);
      }
      return null;
    }
  }, [showErrorToast, standaloneServerId]);

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
        const data = JSON.parse(event.data) as {
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
          if (
            sessionKind === "standalone"
            && isStandaloneCredentialTokenError(data.message)
          ) {
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
      copyTerminalClipboardText,
      loadStandaloneCredentialToken,
      markTerminalReady,
      sessionKind,
      terminalUrl,
      clearSelectedTerminalText,
      showErrorToast,
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
    let disposed = false;
    let terminal: Terminal | null = null;
    let fitAddon: FitAddon | null = null;
    let dataDisposable: { dispose(): void } | null = null;
    let resizeDisposable: { dispose(): void } | null = null;
    let selectionDisposable: { dispose(): void } | null = null;
    let removeMouseHandlers: (() => void) | null = null;

    async function setupTerminal() {
      if (!terminalContainerRef.current || terminalRef.current) {
        return;
      }

      try {
        await initializeGhosttyWeb();
        if (disposed || !terminalContainerRef.current || terminalRef.current) {
          return;
        }
        const terminalFontFamily = await resolveTerminalFontFamily();
        if (disposed || !terminalContainerRef.current || terminalRef.current) {
          return;
        }

        terminal = new Terminal({
          fontSize: TERMINAL_FONT_SIZE_PX,
          fontFamily: terminalFontFamily,
          theme: TERMINAL_THEME,
        });
        fitAddon = new FitAddon();
        terminal.loadAddon(fitAddon);
        terminal.open(terminalContainerRef.current);
        fitAddon.observeResize();
        terminal.focus();
        terminalRef.current = terminal;
        fitAddonRef.current = fitAddon;
        syncTerminalSelectionState();
        flushPendingOutput();

        dataDisposable = terminal.onData((data: string) => {
          void sendTerminalKeystroke(data);
        });
        resizeDisposable = terminal.onResize(({ cols, rows }) => {
          sendTerminalResize(cols, rows);
        });
        selectionDisposable = terminal.onSelectionChange(() => {
          syncTerminalSelectionState();
        });
        terminal.attachCustomKeyEventHandler((event: KeyboardEvent) => {
          if (event.key !== "Tab" || !event.shiftKey || event.ctrlKey || event.altKey || event.metaKey) {
            return false;
          }

          void sendTerminalInput("\u001b[Z", { notifyOnFailure: false });
          return true;
        });
        removeMouseHandlers = installTerminalMouseHandlers({
          terminal,
          container: terminalContainerRef.current,
          sendInput: (data: string) => sendTerminalInput(data, { notifyOnFailure: false }),
        });

        syncTerminalSize({ fit: true });
        if (typeof window !== "undefined" && typeof window.requestAnimationFrame === "function") {
          window.requestAnimationFrame(() => {
            window.requestAnimationFrame(() => {
              if (!disposed && terminalRef.current === terminal) {
                syncTerminalSize({ fit: true });
              }
            });
          });
        }
        if (terminalReadyRef.current) {
          syncTerminalSize();
        }
        void remeasureTerminalFont(terminal, fitAddon);
      } catch (error) {
        if (!disposed) {
          showErrorToast(`Failed to initialize the terminal renderer: ${String(error)}`);
        }
      }
    }

    void setupTerminal();

    return () => {
      disposed = true;
      removeMouseHandlers?.();
      dataDisposable?.dispose();
      resizeDisposable?.dispose();
      selectionDisposable?.dispose();
      setHasSelectedTerminalText(false);
      terminal?.dispose();
      terminalRef.current = null;
      fitAddonRef.current = null;
    };
  }, [
      flushPendingOutput,
      sendTerminalInput,
      sendTerminalKeystroke,
      sendTerminalResize,
      session?.config.id,
      syncTerminalSelectionState,
      showErrorToast,
      syncTerminalSize,
    ]);

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

  useEffect(() => {
    let cancelled = false;

    async function loadStandaloneServer() {
      if (!standaloneServerId) {
        setStandaloneServer(null);
        return;
      }

      try {
        const server = await getSshServerApi(standaloneServerId);
        if (!cancelled) {
          setStandaloneServer(server);
        }
      } catch (error) {
        if (!cancelled) {
          setStandaloneServer(null);
          showErrorToast(`Failed to load SSH server details: ${String(error)}`);
        }
      }
    }

    void loadStandaloneServer();

    return () => {
      cancelled = true;
    };
  }, [showErrorToast, standaloneServerId]);

  useEffect(() => {
    if (sessionKind !== "standalone") {
      setStandaloneCredentialToken(null);
      setShowPasswordPrompt(false);
      setPendingStandaloneAction(null);
    }
  }, [sessionKind]);

  async function handleDelete() {
    const success = await deleteSession();
    if (!success) {
      if (session && isStandaloneSession(session) && isPersistentSshSession(session)) {
        setPendingStandaloneAction("delete");
        setShowPasswordPrompt(true);
      }
      return;
    }
    setShowDeleteConfirm(false);
    onBack?.();
  }

  async function handleStandalonePasswordSubmit() {
    if (!session || !isStandaloneSession(session)) {
      return;
    }

    const trimmedPassword = standalonePassword.trim();
    if (!trimmedPassword) {
      showErrorToast("Enter the SSH password for this server.");
      return;
    }

    try {
      await storeSshServerPassword(session.config.sshServerId, trimmedPassword);

      if (pendingStandaloneAction === "delete") {
        const success = await deleteSession({ password: trimmedPassword });
        if (success) {
          setStandalonePassword("");
          setShowPasswordPrompt(false);
          setPendingStandaloneAction(null);
          setShowDeleteConfirm(false);
          onBack?.();
        }
        return;
      }

      const token = await getStoredSshCredentialToken(session.config.sshServerId);
      if (!token) {
        showErrorToast("Failed to retrieve a valid SSH credential token.");
        return;
      }

      setStandalonePassword("");
      setStandaloneCredentialToken(token);
      setShowPasswordPrompt(false);
      setPendingStandaloneAction(null);
      void connectTerminal({ standaloneCredentialToken: token });
    } catch (error) {
      showErrorToast(String(error));
    }
  }

  async function handleRename(newName: string) {
    await updateSession({ name: newName });
  }

  if (loading && !session) {
    return <div className="p-6 text-gray-500 dark:text-gray-400">Loading SSH session...</div>;
  }

  if (!session) {
    return (
      <div className="p-6">
        {showBackButton && onBack && <Button variant="ghost" onClick={onBack}>← Back</Button>}
        <p className="mt-4 text-red-600 dark:text-red-400">{error || "SSH session not found."}</p>
      </div>
    );
  }

  return (
    <div className="h-full min-h-0 flex flex-col bg-gray-50 dark:bg-neutral-900">
      <div className="border-b border-gray-200 bg-white px-3 py-2 dark:border-gray-800 dark:bg-neutral-800">
        <div
          className={[
            headerOffsetClassName ?? "ml-14 sm:ml-16 lg:ml-0",
            "flex min-h-14 flex-wrap items-center justify-between gap-1.5",
          ].join(" ")}
        >
          <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5">
            {showBackButton && onBack && (
              <Button variant="ghost" size="xs" onClick={onBack}>← Back</Button>
            )}
            <h1 className="min-w-0 break-words text-base font-semibold text-gray-900 dark:text-gray-100 [overflow-wrap:anywhere]">
              {session.config.name}
            </h1>
            <Badge variant={socketStatus === "open" ? "success" : socketStatus === "connecting" ? "info" : "warning"}>
              {socketStatus === "open" ? "connected" : socketStatus === "closed" ? "disconnected" : "connecting"}
            </Badge>
          </div>
          <div className="ml-auto flex flex-wrap items-center justify-end gap-1.5">
            {canRenameSession && (
              <Button
                variant="ghost"
                size="xs"
                onClick={() => setShowRenameModal(true)}
                aria-label="Rename SSH session"
                title="Rename SSH session"
              >
                <span className="flex items-center gap-1">
                  <EditIcon size="h-3.5 w-3.5" />
                  Rename
                </span>
              </Button>
            )}
            <Button variant="danger" size="xs" onClick={() => setShowDeleteConfirm(true)}>
              Delete Session
            </Button>
          </div>
        </div>
      </div>

      <div className="flex-1 min-h-0 flex flex-col gap-2 overflow-hidden p-2 sm:p-3">
        <SessionInfoSection
          session={session}
          standaloneServerName={standaloneServerName}
          standaloneServerTarget={standaloneServerTarget}
        />

        <TouchControlsSection
          terminalModifiers={terminalModifiers}
          hasSelectedTerminalText={hasSelectedTerminalText}
          toggleTerminalModifier={toggleTerminalModifier}
          resetTerminalModifiers={resetTerminalModifiers}
          copySelectedTerminalText={copySelectedTerminalText}
          sendEncodedTerminalKey={sendEncodedTerminalKey}
          sendCtrlC={sendCtrlC}
          sendTerminalTextShortcut={sendTerminalTextShortcut}
        />

        {pendingTerminalClipboardText !== null && (
          <ClipboardFallbackCard
            pendingText={pendingTerminalClipboardText}
            onDismiss={() => setPendingTerminalClipboardText(null)}
            onRetry={retryPendingTerminalClipboardCopy}
          />
        )}

        <Card
          padding={false}
          className="min-h-0 flex flex-1 flex-col overflow-visible rounded-sm bg-[#1e1e1e] dark:bg-[#1e1e1e]"
          bodyClassName="min-h-0 flex flex-1 flex-col bg-[#1e1e1e] dark:bg-[#1e1e1e]"
        >
          <div
            ref={terminalContainerRef}
            className="relative box-border min-h-0 h-full flex-1 bg-[#1e1e1e] w-full"
            style={{
              padding: `${TERMINAL_PADDING_TOP_PX}px ${TERMINAL_PADDING_X_PX}px ${TERMINAL_PADDING_BOTTOM_PX}px`,
            }}
          />
        </Card>
      </div>

      <ConfirmModal
        isOpen={showDeleteConfirm}
        onClose={() => setShowDeleteConfirm(false)}
        onConfirm={() => void handleDelete()}
        title="Delete SSH session?"
        message={hasPersistentSession
          ? "This removes the Ralpher session metadata and attempts to stop the remote persistent session."
          : "This removes the saved Ralpher session metadata. Direct SSH mode does not keep a remote persistent session."}
        confirmLabel="Delete"
        loading={false}
      />
      <RenameSshSessionModal
        isOpen={showRenameModal}
        onClose={() => setShowRenameModal(false)}
        currentName={sessionKind === "workspace" ? session.config.name : ""}
        onRename={handleRename}
      />
      <StandalonePasswordModal
        isOpen={showPasswordPrompt}
        onClose={() => {
          setShowPasswordPrompt(false);
          setPendingStandaloneAction(null);
        }}
        onSubmit={() => void handleStandalonePasswordSubmit()}
        password={standalonePassword}
        onPasswordChange={setStandalonePassword}
        pendingAction={pendingStandaloneAction}
        hasPersistentSession={hasPersistentSession}
      />
    </div>
  );
}
