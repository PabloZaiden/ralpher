/**
 * Dedicated SSH session terminal view.
 */

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Terminal, type ITerminalOptions } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";
import { Badge, Button, Card, ConfirmModal, Modal } from "./common";
import { getSshServerApi, useSshSession, useToast } from "../hooks";
import {
  defaultTerminalModifiers,
  encodeTerminalDataInput,
  encodeTerminalInput,
  encodeTmuxShortcut,
  hasActiveTerminalModifiers,
  type TerminalModifierState,
  type TerminalSpecialKey,
  type TmuxShortcut,
} from "../utils/terminal-keys";
import { writeTextToClipboard } from "../utils";
import { appWebSocketUrl } from "../lib/public-path";
import { getStoredSshCredentialToken, storeSshServerPassword } from "../lib/ssh-browser-credentials";
import type { SshServer } from "../types";

function isStandaloneSession(session: NonNullable<ReturnType<typeof useSshSession>["session"]>): session is Extract<
  NonNullable<ReturnType<typeof useSshSession>["session"]>,
  { config: { sshServerId: string } }
> {
  return "sshServerId" in session.config;
}

function getStatusVariant(status: string) {
  switch (status) {
    case "connected":
      return "success";
    case "connecting":
      return "info";
    case "failed":
      return "error";
    case "disconnected":
      return "warning";
    default:
      return "default";
  }
}

export interface SshSessionDetailsProps {
  sshSessionId: string;
  onBack: () => void;
  copyTextToClipboard?: (text: string) => Promise<void>;
}

interface CompactBarProps {
  title: string;
  expanded: boolean;
  onToggle: () => void;
  summary: ReactNode;
  children: ReactNode;
  contentClassName?: string;
}

function CompactBar({
  title,
  expanded,
  onToggle,
  summary,
  children,
  contentClassName = "",
}: CompactBarProps) {
  return (
    <div className="overflow-hidden rounded-md border border-gray-200 bg-white shadow-sm dark:border-gray-700 dark:bg-gray-800">
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full min-w-0 items-center gap-2 px-3 py-2 text-left transition-colors hover:bg-gray-50 dark:hover:bg-gray-700/50"
        aria-expanded={expanded}
      >
        <span className="shrink-0 text-[11px] text-gray-500 dark:text-gray-400">{expanded ? "▼" : "▶"}</span>
        <span className="shrink-0 text-xs font-semibold text-gray-900 dark:text-gray-100">{title}</span>
        <div className="min-w-0 flex-1">{summary}</div>
      </button>
      {expanded && (
        <div className={`border-t border-gray-200 px-3 py-2 dark:border-gray-700 ${contentClassName}`.trim()}>
          {children}
        </div>
      )}
    </div>
  );
}

const touchButtonClassName = "min-h-[28px] shrink-0 whitespace-nowrap px-1.5 py-0.5 text-[11px]";

const sshTerminalFontFamily = [
  "\"SFMono-Regular\"",
  "\"SF Mono\"",
  "Menlo",
  "Consolas",
  "\"Liberation Mono\"",
  "\"DejaVu Sans Mono\"",
  "\"Noto Sans Mono\"",
  "monospace",
].join(", ");

function createSshTerminalOptions(): ITerminalOptions {
  return {
    cursorBlink: true,
    convertEol: true,
    fontSize: 13,
    fontFamily: sshTerminalFontFamily,
    lineHeight: 1.15,
    customGlyphs: true,
    rescaleOverlappingGlyphs: true,
    theme: {
      background: "#111827",
    },
  };
}

function isStandaloneCredentialTokenError(message: string): boolean {
  return message.includes("SSH credential token") || message.includes("credential token");
}

export function SshSessionDetails({
  sshSessionId,
  onBack,
  copyTextToClipboard = writeTextToClipboard,
}: SshSessionDetailsProps) {
  const { error: showErrorToast } = useToast();
  const { session, sessionKind, loading, error, deleteSession, refresh } = useSshSession(sshSessionId);
  const terminalContainerRef = useRef<HTMLDivElement>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const terminalSocketRef = useRef<WebSocket | null>(null);
  const terminalReadyRef = useRef(false);
  const terminalModifiersRef = useRef<TerminalModifierState>(defaultTerminalModifiers);
  const standaloneCredentialTokenRef = useRef<string | null>(null);
  const pendingStandaloneActionRef = useRef<"terminal" | "delete" | null>(null);
  const pendingOutputRef = useRef<string[]>([]);
  const resizeAnimationFrameRef = useRef<number | null>(null);
  const lastSentResizeRef = useRef<{ cols: number; rows: number } | null>(null);
  const terminalConnectInFlightRef = useRef(false);
  const standaloneTokenRecoveryAttemptedRef = useRef(false);
  const [socketStatus, setSocketStatus] = useState<"connecting" | "open" | "closed">("connecting");
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [showPasswordPrompt, setShowPasswordPrompt] = useState(false);
  const [sessionInfoExpanded, setSessionInfoExpanded] = useState(false);
  const [touchControlsExpanded, setTouchControlsExpanded] = useState(false);
  const [terminalModifiers, setTerminalModifiers] = useState<TerminalModifierState>(defaultTerminalModifiers);
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
  const activeModifierLabel = useMemo(() => {
    return [
      terminalModifiers.ctrl ? "Ctrl" : null,
      terminalModifiers.alt ? "Alt" : null,
      terminalModifiers.shift ? "Shift" : null,
    ].filter(Boolean).join(" + ");
  }, [terminalModifiers]);
  const sessionInfoSummary = useMemo(() => {
    if (!session) {
      return null;
    }
    return (
      <div className="flex min-w-0 items-center justify-end gap-2 overflow-hidden text-xs text-gray-500 dark:text-gray-400">
        <span className="min-w-0 truncate font-mono">{session.config.remoteSessionName}</span>
        {session.state.error && (
          <Badge variant="error" className="shrink-0">
            error
          </Badge>
        )}
      </div>
    );
  }, [session]);
  const touchControlsSummary = useMemo(() => {
    return (
      <div className="flex min-w-0 items-center justify-end gap-2 overflow-hidden">
        {hasActiveTerminalModifiers(terminalModifiers) ? (
          <Badge variant="info" className="shrink-0">
            Next: {activeModifierLabel}
          </Badge>
        ) : (
          <Badge variant="default" className="shrink-0">
            Modifiers off
          </Badge>
        )}
        <span className="hidden min-w-0 truncate text-xs text-gray-500 dark:text-gray-400 sm:block">
          Touch keys and tmux shortcuts
        </span>
      </div>
    );
  }, [activeModifierLabel, terminalModifiers]);

  useEffect(() => {
    terminalModifiersRef.current = terminalModifiers;
  }, [terminalModifiers]);

  useEffect(() => {
    standaloneCredentialTokenRef.current = standaloneCredentialToken;
  }, [standaloneCredentialToken]);

  useEffect(() => {
    pendingStandaloneActionRef.current = pendingStandaloneAction;
  }, [pendingStandaloneAction]);

  const focusTerminal = useCallback(() => {
    terminalRef.current?.focus();
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

  const sendTerminalInput = useCallback((data: string, options?: { notifyOnFailure?: boolean }): boolean => {
    return sendTerminalPayload({
      type: "terminal.input",
      data,
    }, options);
  }, [sendTerminalPayload]);

  const performResize = useCallback(() => {
    const terminal = terminalRef.current;
    const fitAddon = fitAddonRef.current;
    const container = terminalContainerRef.current;
    if (!terminal || !fitAddon || !container) {
      return;
    }

    fitAddon.fit();
    if (terminal.cols <= 0 || terminal.rows <= 0) {
      return;
    }

    const nextSize = {
      cols: terminal.cols,
      rows: terminal.rows,
    };
    const previousSize = lastSentResizeRef.current;
    if (
      previousSize &&
      previousSize.cols === nextSize.cols &&
      previousSize.rows === nextSize.rows
    ) {
      return;
    }

    const didSend = sendTerminalPayload({
      type: "terminal.resize",
      ...nextSize,
    }, { focusTerminal: false, notifyOnFailure: false });
    if (didSend) {
      lastSentResizeRef.current = nextSize;
    }
  }, [sendTerminalPayload]);

  const scheduleResize = useCallback(() => {
    if (typeof window === "undefined" || typeof window.requestAnimationFrame !== "function") {
      performResize();
      return;
    }
    if (resizeAnimationFrameRef.current !== null) {
      return;
    }
    resizeAnimationFrameRef.current = window.requestAnimationFrame(() => {
      resizeAnimationFrameRef.current = null;
      performResize();
    });
  }, [performResize]);

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
    scheduleResize();
    flushPendingOutput();
    void refresh();
  }, [flushPendingOutput, refresh, scheduleResize]);

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

  const sendTmuxShortcut = useCallback((shortcut: TmuxShortcut) => {
    const encoded = encodeTmuxShortcut(shortcut);
    if (!encoded) {
      showErrorToast("That tmux shortcut is not supported.");
      return;
    }

    const didSend = sendTerminalInput(encoded);
    if (didSend) {
      resetTerminalModifiers();
    }
  }, [resetTerminalModifiers, sendTerminalInput, showErrorToast]);

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
      lastSentResizeRef.current = null;
      if (resizeAnimationFrameRef.current !== null && typeof window !== "undefined") {
        window.cancelAnimationFrame(resizeAnimationFrameRef.current);
        resizeAnimationFrameRef.current = null;
      }
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
          if (!terminalRef.current) {
            pendingOutputRef.current.push(data.data);
          } else {
            terminalRef.current.write(data.data);
          }
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
        setSocketStatus("closed");
      };
      ws.onerror = () => {
        if (terminalSocketRef.current !== ws) {
          return;
        }
        terminalReadyRef.current = false;
        lastSentResizeRef.current = null;
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
      showErrorToast,
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
    if (!terminalContainerRef.current || terminalRef.current) {
      return;
    }

    const terminal = new Terminal(createSshTerminalOptions());
    const fitAddon = new FitAddon();
    terminal.loadAddon(fitAddon);
    terminal.open(terminalContainerRef.current);
    const terminalElement = terminal.element;
    if (terminalElement) {
      terminalElement.style.width = "100%";
      terminalElement.style.height = "100%";
      terminalElement.style.fontFamily = sshTerminalFontFamily;
      terminalElement.style.fontVariantLigatures = "none";
      terminalElement.style.fontFeatureSettings = "\"liga\" 0, \"calt\" 0";

      const viewport = terminalElement.querySelector<HTMLElement>(".xterm-viewport");
      if (viewport) {
        viewport.style.width = "100%";
        viewport.style.height = "100%";
      }

      const screen = terminalElement.querySelector<HTMLElement>(".xterm-screen");
      if (screen) {
        screen.style.width = "100%";
        screen.style.height = "100%";
      }

      const accessibilityTree = terminalElement.querySelector<HTMLElement>(".xterm-accessibility-tree");
      if (accessibilityTree) {
        accessibilityTree.style.fontFamily = sshTerminalFontFamily;
        accessibilityTree.style.fontVariantLigatures = "none";
        accessibilityTree.style.fontFeatureSettings = "\"liga\" 0, \"calt\" 0";
      }

      const helperTextarea = terminalElement.querySelector<HTMLElement>(".xterm-helper-textarea");
      if (helperTextarea) {
        helperTextarea.style.fontFamily = sshTerminalFontFamily;
      }
    }
    terminal.focus();
    terminalRef.current = terminal;
    fitAddonRef.current = fitAddon;
    flushPendingOutput();

    const disposable = terminal.onData((data: string) => {
      void sendTerminalKeystroke(data);
    });

    scheduleResize();

    const onWindowResize = () => {
      scheduleResize();
    };
    window.addEventListener("resize", onWindowResize);

    let resizeObserver: ResizeObserver | null = null;
    if (typeof ResizeObserver !== "undefined") {
      resizeObserver = new ResizeObserver(() => {
        scheduleResize();
      });
      resizeObserver.observe(terminalContainerRef.current);
    }

    return () => {
      disposable.dispose();
      resizeObserver?.disconnect();
      window.removeEventListener("resize", onWindowResize);
      if (resizeAnimationFrameRef.current !== null) {
        window.cancelAnimationFrame(resizeAnimationFrameRef.current);
        resizeAnimationFrameRef.current = null;
      }
      terminal.dispose();
      terminalRef.current = null;
      fitAddonRef.current = null;
    };
  }, [flushPendingOutput, scheduleResize, sendTerminalKeystroke, session?.config.id]);

  useEffect(() => {
    if (!terminalUrl) {
      return;
    }
    void connectTerminal();
    return () => {
      terminalReadyRef.current = false;
      terminalSocketRef.current?.close();
      terminalSocketRef.current = null;
    };
  }, [connectTerminal, terminalUrl]);

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
      if (session && isStandaloneSession(session)) {
        setPendingStandaloneAction("delete");
        setShowPasswordPrompt(true);
      }
      return;
    }
    setShowDeleteConfirm(false);
    onBack();
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
          onBack();
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

  if (loading && !session) {
    return <div className="p-6 text-gray-500 dark:text-gray-400">Loading SSH session...</div>;
  }

  if (!session) {
    return (
      <div className="p-6">
        <Button variant="ghost" onClick={onBack}>← Back</Button>
        <p className="mt-4 text-red-600 dark:text-red-400">{error || "SSH session not found."}</p>
      </div>
    );
  }

  return (
    <div className="h-full min-h-0 flex flex-col bg-gray-50 dark:bg-gray-900">
      <div className="border-b border-gray-200 bg-white px-3 py-2 dark:border-gray-800 dark:bg-gray-800">
        <div className="flex flex-wrap items-center justify-between gap-1.5">
          <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5">
            <Button variant="ghost" size="xs" onClick={onBack}>← Back</Button>
            <h1 className="min-w-0 truncate text-base font-semibold text-gray-900 dark:text-gray-100">
              {session.config.name}
            </h1>
            <Badge variant={getStatusVariant(session.state.status)}>
              {session.state.status}
            </Badge>
            <Badge variant={socketStatus === "open" ? "success" : socketStatus === "connecting" ? "info" : "warning"}>
              {socketStatus}
            </Badge>
          </div>
          <div className="flex items-center gap-1.5">
            <Button variant="danger" size="xs" onClick={() => setShowDeleteConfirm(true)}>
              Delete Session
            </Button>
          </div>
        </div>
      </div>

      <div className="flex-1 min-h-0 flex flex-col gap-2 overflow-hidden p-2 sm:p-3">
        <CompactBar
          title="Session Info"
          expanded={sessionInfoExpanded}
          onToggle={() => setSessionInfoExpanded((current) => !current)}
          summary={sessionInfoSummary}
        >
          <dl className="grid gap-3 text-sm sm:grid-cols-2">
            <div className="min-w-0">
              <dt className="text-gray-500 dark:text-gray-400">
                {isStandaloneSession(session) ? "Server" : "Workspace ID"}
              </dt>
              <dd className={isStandaloneSession(session) ? "break-words text-gray-900 dark:text-gray-100" : "break-all font-mono text-gray-900 dark:text-gray-100"}>
                {isStandaloneSession(session) ? standaloneServerName : session.config.workspaceId}
              </dd>
            </div>
            <div className="min-w-0">
              <dt className="text-gray-500 dark:text-gray-400">
                {isStandaloneSession(session) ? "Address" : "Directory"}
              </dt>
              <dd className="break-all font-mono text-gray-900 dark:text-gray-100">
                {isStandaloneSession(session) ? standaloneServerTarget : session.config.directory}
              </dd>
            </div>
            <div className="min-w-0">
              <dt className="text-gray-500 dark:text-gray-400">tmux session</dt>
              <dd className="break-all font-mono text-gray-900 dark:text-gray-100">{session.config.remoteSessionName}</dd>
            </div>
            <div className="min-w-0">
              <dt className="text-gray-500 dark:text-gray-400">Last connected</dt>
              <dd className="text-gray-900 dark:text-gray-100">{session.state.lastConnectedAt ?? "Never"}</dd>
            </div>
            {session.state.error && (
              <div className="min-w-0 sm:col-span-2">
                <dt className="text-gray-500 dark:text-gray-400">Last error</dt>
                <dd className="break-words text-red-600 dark:text-red-400">{session.state.error}</dd>
              </div>
            )}
          </dl>
        </CompactBar>

        <CompactBar
          title="Touch controls"
          expanded={touchControlsExpanded}
          onToggle={() => setTouchControlsExpanded((current) => !current)}
          summary={touchControlsSummary}
        >
          <div className="flex flex-col gap-2">
            <div className="px-1 pb-1" data-testid="ssh-touch-controls-layout">
              <div className="flex flex-wrap items-center gap-1" data-testid="ssh-touch-controls-buttons">
                <Button
                  variant={terminalModifiers.ctrl ? "primary" : "secondary"}
                  size="xs"
                  className={touchButtonClassName}
                  aria-pressed={terminalModifiers.ctrl}
                  onClick={() => toggleTerminalModifier("ctrl")}
                >
                  Ctrl
                </Button>
                <Button
                  variant={terminalModifiers.alt ? "primary" : "secondary"}
                  size="xs"
                  className={touchButtonClassName}
                  aria-pressed={terminalModifiers.alt}
                  onClick={() => toggleTerminalModifier("alt")}
                >
                  Alt
                </Button>
                <Button
                  variant={terminalModifiers.shift ? "primary" : "secondary"}
                  size="xs"
                  className={touchButtonClassName}
                  aria-pressed={terminalModifiers.shift}
                  onClick={() => toggleTerminalModifier("shift")}
                >
                  Shift
                </Button>
                {hasActiveTerminalModifiers(terminalModifiers) && (
                  <Button
                    variant="ghost"
                    size="xs"
                    className={touchButtonClassName}
                    onClick={resetTerminalModifiers}
                  >
                    Clear
                  </Button>
                )}
                <span className="mx-0.5 h-4 w-px shrink-0 bg-gray-200 dark:bg-gray-700" aria-hidden="true" />
                <Button
                  variant="secondary"
                  size="xs"
                  className={touchButtonClassName}
                  onClick={() => sendEncodedTerminalKey("Escape")}
                >
                  Esc
                </Button>
                <Button
                  variant="secondary"
                  size="xs"
                  className={touchButtonClassName}
                  onClick={() => sendEncodedTerminalKey("Tab")}
                >
                  Tab
                </Button>
                <Button
                  variant="secondary"
                  size="xs"
                  className={touchButtonClassName}
                  onClick={() => sendEncodedTerminalKey("Enter")}
                >
                  Enter
                </Button>
                <Button
                  variant="secondary"
                  size="xs"
                  className={touchButtonClassName}
                  aria-label="Backspace"
                  onClick={() => sendEncodedTerminalKey("Backspace")}
                >
                  Bksp
                </Button>
                <Button
                  variant="secondary"
                  size="xs"
                  className={touchButtonClassName}
                  onClick={() => sendEncodedTerminalKey("Space")}
                >
                  Space
                </Button>
                <Button
                  variant="secondary"
                  size="xs"
                  className={touchButtonClassName}
                  onClick={sendCtrlC}
                >
                  Ctrl+C
                </Button>
                <Button
                  variant="secondary"
                  size="xs"
                  className={touchButtonClassName}
                  onClick={() => sendEncodedTerminalKey("ArrowUp")}
                >
                  ↑
                </Button>
                <Button
                  variant="secondary"
                  size="xs"
                  className={touchButtonClassName}
                  onClick={() => sendEncodedTerminalKey("ArrowLeft")}
                >
                  ←
                </Button>
                <Button
                  variant="secondary"
                  size="xs"
                  className={touchButtonClassName}
                  onClick={() => sendEncodedTerminalKey("ArrowDown")}
                >
                  ↓
                </Button>
                <Button
                  variant="secondary"
                  size="xs"
                  className={touchButtonClassName}
                  onClick={() => sendEncodedTerminalKey("ArrowRight")}
                >
                  →
                </Button>
                <span className="mx-0.5 h-4 w-px shrink-0 bg-gray-200 dark:bg-gray-700" aria-hidden="true" />
                <Button
                  variant="secondary"
                  size="xs"
                  className={touchButtonClassName}
                  onClick={() => sendTmuxShortcut("split-pane")}
                >
                  Split
                </Button>
                <Button
                  variant="secondary"
                  size="xs"
                  className={touchButtonClassName}
                  onClick={() => sendTmuxShortcut("next-pane")}
                >
                  Next
                </Button>
                <Button
                  variant="secondary"
                  size="xs"
                  className={touchButtonClassName}
                  onClick={() => sendTmuxShortcut("resize-pane-up")}
                >
                  Pane ↑
                </Button>
                <Button
                  variant="secondary"
                  size="xs"
                  className={touchButtonClassName}
                  onClick={() => sendTmuxShortcut("resize-pane-down")}
                >
                  Pane ↓
                </Button>
                <span className="mx-0.5 h-4 w-px shrink-0 bg-gray-200 dark:bg-gray-700" aria-hidden="true" />
                <Button
                  variant="secondary"
                  size="xs"
                  className={touchButtonClassName}
                  onClick={() => sendTerminalTextShortcut("sudo apt update && sudo apt install neovim")}
                >
                  Install Neovim
                </Button>
                <Button
                  variant="secondary"
                  size="xs"
                  className={touchButtonClassName}
                  onClick={() => sendTerminalTextShortcut("nvim\n")}
                >
                  Neovim
                </Button>
                <Button
                  variant="secondary"
                  size="xs"
                  className={touchButtonClassName}
                  onClick={() => sendTerminalTextShortcut(":Ntree\n")}
                >
                  Ntree
                </Button>
                <Button
                  variant="secondary"
                  size="xs"
                  className={touchButtonClassName}
                  onClick={() => sendTerminalTextShortcut(":q\n")}
                >
                  :q
                </Button>
                <span className="mx-0.5 h-4 w-px shrink-0 bg-gray-200 dark:bg-gray-700" aria-hidden="true" />
                <Button
                  variant="secondary"
                  size="xs"
                  className={touchButtonClassName}
                  onClick={() => sendTerminalTextShortcut("curl https://raw.githubusercontent.com/sinelaw/fresh/refs/heads/master/scripts/install.sh | sh")}
                >
                  Install fresh
                </Button>
                <Button
                  variant="secondary"
                  size="xs"
                  className={touchButtonClassName}
                  onClick={() => sendTerminalTextShortcut("fresh\n")}
                >
                  Fresh
                </Button>
              </div>
            </div>

          </div>
        </CompactBar>

        {pendingTerminalClipboardText !== null && (
          <Card
            data-testid="ssh-terminal-clipboard-fallback"
            className="border-amber-300 bg-amber-50 dark:border-amber-700 dark:bg-amber-950/40"
            bodyClassName="flex flex-col gap-2"
          >
            <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
              <div className="min-w-0">
                <p className="text-sm font-medium text-amber-900 dark:text-amber-200">
                  Browser blocked automatic clipboard access.
                </p>
                <p className="text-xs text-amber-800 dark:text-amber-300">
                  Click <span className="font-semibold">Copy now</span> or copy the pending text manually below.
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <Button variant="primary" size="xs" onClick={retryPendingTerminalClipboardCopy}>
                  Copy now
                </Button>
                <Button variant="ghost" size="xs" onClick={() => setPendingTerminalClipboardText(null)}>
                  Dismiss
                </Button>
              </div>
            </div>
            <textarea
              aria-label="Pending terminal clipboard text"
              readOnly
              value={pendingTerminalClipboardText}
              onFocus={(event) => event.currentTarget.select()}
              onClick={(event) => event.currentTarget.select()}
              className="min-h-24 w-full rounded-md border border-amber-200 bg-white/90 p-2 font-mono text-xs text-gray-900 shadow-sm outline-none focus:border-amber-400 dark:border-amber-800 dark:bg-gray-900 dark:text-gray-100"
            />
          </Card>
        )}

        <Card
          padding={false}
          className="min-h-0 flex flex-1 flex-col overflow-hidden"
          bodyClassName="min-h-0 flex flex-1 flex-col"
        >
          <div
            ref={terminalContainerRef}
            className="min-h-0 flex-1 overflow-hidden rounded-lg bg-gray-900 w-full [&>.xterm]:h-full [&>.xterm]:w-full [&_.xterm-screen]:h-full [&_.xterm-screen]:w-full [&_.xterm-viewport]:h-full [&_.xterm-viewport]:w-full"
          />
        </Card>
      </div>

      <ConfirmModal
        isOpen={showDeleteConfirm}
        onClose={() => setShowDeleteConfirm(false)}
        onConfirm={() => void handleDelete()}
        title="Delete SSH session?"
        message="This removes the Ralpher session metadata and attempts to kill the remote tmux session."
        confirmLabel="Delete"
        loading={false}
      />
      <Modal
        isOpen={showPasswordPrompt}
        onClose={() => {
          setShowPasswordPrompt(false);
          setPendingStandaloneAction(null);
        }}
        title="SSH password required"
        description="Standalone SSH sessions need the password from this browser before they can connect or be deleted."
        size="sm"
        footer={(
          <>
            <Button
              variant="ghost"
              onClick={() => {
                setShowPasswordPrompt(false);
                setPendingStandaloneAction(null);
              }}
            >
              Cancel
            </Button>
            <Button onClick={() => void handleStandalonePasswordSubmit()}>
              Continue
            </Button>
          </>
        )}
      >
        <div className="space-y-3">
          <p className="text-sm text-gray-600 dark:text-gray-300">
            {pendingStandaloneAction === "delete"
              ? "Enter the SSH password to delete the remote tmux session and local metadata."
              : "Enter the SSH password to open the standalone terminal session."}
          </p>
          <div>
            <label
              htmlFor="standalone-session-password"
              className="block text-sm font-medium text-gray-700 dark:text-gray-300"
            >
              SSH password
            </label>
            <input
              id="standalone-session-password"
              type="password"
              value={standalonePassword}
              onChange={(event) => setStandalonePassword(event.target.value)}
              className="mt-1 block w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100"
            />
          </div>
        </div>
      </Modal>
    </div>
  );
}
