/**
 * Dedicated SSH session terminal view.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";
import { Badge, Button, Card, ConfirmModal } from "./common";
import { useSshSession, useToast } from "../hooks";
import {
  defaultTerminalModifiers,
  encodeTerminalInput,
  hasActiveTerminalModifiers,
  type TerminalModifierState,
  type TerminalSpecialKey,
} from "../utils/terminal-keys";

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
}

export function SshSessionDetails({ sshSessionId, onBack }: SshSessionDetailsProps) {
  const toast = useToast();
  const { session, loading, error, refresh, deleteSession } = useSshSession(sshSessionId);
  const terminalContainerRef = useRef<HTMLDivElement>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const terminalSocketRef = useRef<WebSocket | null>(null);
  const [socketStatus, setSocketStatus] = useState<"connecting" | "open" | "closed">("connecting");
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [terminalModifiers, setTerminalModifiers] = useState<TerminalModifierState>(defaultTerminalModifiers);
  const [customKeyInput, setCustomKeyInput] = useState("");

  const terminalUrl = useMemo(
    () => `/api/ssh-terminal?sshSessionId=${encodeURIComponent(sshSessionId)}`,
    [sshSessionId],
  );
  const activeModifierLabel = useMemo(() => {
    return [
      terminalModifiers.ctrl ? "Ctrl" : null,
      terminalModifiers.alt ? "Alt" : null,
      terminalModifiers.shift ? "Shift" : null,
    ].filter(Boolean).join(" + ");
  }, [terminalModifiers]);

  const sendTerminalPayload = useCallback((
    payload: Record<string, unknown>,
    options?: { focusTerminal?: boolean; notifyOnFailure?: boolean },
  ): boolean => {
    if (terminalSocketRef.current?.readyState !== WebSocket.OPEN) {
      if (options?.notifyOnFailure ?? true) {
        toast.error("Terminal is not connected.");
      }
      return false;
    }

    terminalSocketRef.current.send(JSON.stringify(payload));
    if (options?.focusTerminal ?? true) {
      terminalRef.current?.focus();
    }
    return true;
  }, [toast]);

  const sendTerminalInput = useCallback((data: string, options?: { notifyOnFailure?: boolean }): boolean => {
    return sendTerminalPayload({
      type: "terminal.input",
      data,
    }, options);
  }, [sendTerminalPayload]);

  const sendResize = useCallback(() => {
    if (!terminalRef.current || !fitAddonRef.current) {
      return;
    }
    fitAddonRef.current.fit();
    void sendTerminalPayload({
      type: "terminal.resize",
      cols: terminalRef.current.cols,
      rows: terminalRef.current.rows,
    }, { focusTerminal: false, notifyOnFailure: false });
  }, [sendTerminalPayload]);

  const resetTerminalModifiers = useCallback(() => {
    setTerminalModifiers(defaultTerminalModifiers);
  }, []);

  const toggleTerminalModifier = useCallback((modifier: keyof TerminalModifierState) => {
    setTerminalModifiers((current) => ({
      ...current,
      [modifier]: !current[modifier],
    }));
  }, []);

  const sendEncodedTerminalKey = useCallback((key: TerminalSpecialKey | string) => {
    const encoded = encodeTerminalInput(key, terminalModifiers);
    if (!encoded) {
      toast.error("That key combination is not supported.");
      return;
    }

    const didSend = sendTerminalInput(encoded);
    if (didSend) {
      resetTerminalModifiers();
    }
  }, [resetTerminalModifiers, sendTerminalInput, terminalModifiers, toast]);

  const handleCustomKeySend = useCallback(() => {
    if (!customKeyInput) {
      toast.error("Enter a key to send.");
      return;
    }

    sendEncodedTerminalKey(customKeyInput);
    setCustomKeyInput("");
  }, [customKeyInput, sendEncodedTerminalKey, toast]);

  const connectTerminal = useCallback(() => {
    terminalSocketRef.current?.close();
    setSocketStatus("connecting");

    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const ws = new WebSocket(`${protocol}//${window.location.host}${terminalUrl}`);
    terminalSocketRef.current = ws;

    ws.onopen = () => {
      setSocketStatus("open");
      sendResize();
    };
    ws.onmessage = (event) => {
      const data = JSON.parse(event.data) as {
        type: string;
        data?: string;
        message?: string;
      };
      if (data.type === "terminal.output" && data.data) {
        terminalRef.current?.write(data.data);
      }
      if (data.type === "terminal.error" && data.message) {
        terminalRef.current?.writeln(`\r\n${data.message}`);
        toast.error(data.message);
      }
      if (data.type === "terminal.closed") {
        setSocketStatus("closed");
      }
    };
    ws.onclose = () => {
      setSocketStatus("closed");
    };
    ws.onerror = () => {
      setSocketStatus("closed");
    };
  }, [sendResize, terminalUrl, toast]);

  useEffect(() => {
    if (!terminalContainerRef.current || terminalRef.current) {
      return;
    }

    const terminal = new Terminal({
      cursorBlink: true,
      convertEol: true,
      fontSize: 14,
      theme: {
        background: "#111827",
      },
    });
    const fitAddon = new FitAddon();
    terminal.loadAddon(fitAddon);
    terminal.open(terminalContainerRef.current);
    terminal.focus();
    terminalRef.current = terminal;
    fitAddonRef.current = fitAddon;

    const disposable = terminal.onData((data) => {
      void sendTerminalInput(data, { notifyOnFailure: false });
    });

    sendResize();

    const onWindowResize = () => {
      sendResize();
    };
    window.addEventListener("resize", onWindowResize);

    let resizeObserver: ResizeObserver | null = null;
    if (typeof ResizeObserver !== "undefined") {
      resizeObserver = new ResizeObserver(() => {
        sendResize();
      });
      resizeObserver.observe(terminalContainerRef.current);
    }

    return () => {
      disposable.dispose();
      resizeObserver?.disconnect();
      window.removeEventListener("resize", onWindowResize);
      terminal.dispose();
      terminalRef.current = null;
      fitAddonRef.current = null;
    };
  }, [sendResize, sendTerminalInput]);

  useEffect(() => {
    connectTerminal();
    return () => {
      terminalSocketRef.current?.close();
      terminalSocketRef.current = null;
    };
  }, [connectTerminal]);

  async function handleDelete() {
    const success = await deleteSession();
    if (!success) {
      return;
    }
    toast.success("SSH session deleted.");
    setShowDeleteConfirm(false);
    onBack();
  }

  if (loading) {
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
    <div className="h-full flex flex-col bg-gray-50 dark:bg-gray-900">
      <div className="border-b border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-800 px-4 sm:px-6 lg:px-8 py-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <Button variant="ghost" onClick={onBack}>← Back</Button>
            <h1 className="mt-2 text-2xl font-bold text-gray-900 dark:text-gray-100">
              {session.config.name}
            </h1>
            <div className="mt-2 flex items-center gap-2">
              <Badge variant={getStatusVariant(session.state.status)}>
                {session.state.status}
              </Badge>
              <Badge variant={socketStatus === "open" ? "success" : socketStatus === "connecting" ? "info" : "warning"}>
                terminal {socketStatus}
              </Badge>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="secondary" onClick={() => void refresh()}>
              Refresh
            </Button>
            <Button variant="secondary" onClick={connectTerminal}>
              Reconnect Terminal
            </Button>
            <Button variant="danger" onClick={() => setShowDeleteConfirm(true)}>
              Delete Session
            </Button>
          </div>
        </div>
      </div>

      <div className="flex-1 min-h-0 grid grid-cols-1 xl:grid-cols-[320px_1fr] gap-4 p-4 sm:p-6">
        <Card title="Session Info">
          <dl className="space-y-3 text-sm">
            <div>
              <dt className="text-gray-500 dark:text-gray-400">Workspace ID</dt>
              <dd className="font-mono text-gray-900 dark:text-gray-100 break-all">{session.config.workspaceId}</dd>
            </div>
            <div>
              <dt className="text-gray-500 dark:text-gray-400">Directory</dt>
              <dd className="font-mono text-gray-900 dark:text-gray-100 break-all">{session.config.directory}</dd>
            </div>
            <div>
              <dt className="text-gray-500 dark:text-gray-400">tmux session</dt>
              <dd className="font-mono text-gray-900 dark:text-gray-100 break-all">{session.config.remoteSessionName}</dd>
            </div>
            <div>
              <dt className="text-gray-500 dark:text-gray-400">Last connected</dt>
              <dd className="text-gray-900 dark:text-gray-100">{session.state.lastConnectedAt ?? "Never"}</dd>
            </div>
            {session.state.error && (
              <div>
                <dt className="text-gray-500 dark:text-gray-400">Last error</dt>
                <dd className="text-red-600 dark:text-red-400 break-words">{session.state.error}</dd>
              </div>
            )}
          </dl>
        </Card>

        <Card title="Terminal" padding={false} className="min-h-0 flex flex-col">
          <div className="border-b border-gray-200 dark:border-gray-700 px-4 py-3">
            <div className="flex flex-col gap-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-medium text-gray-700 dark:text-gray-200">Touch controls</span>
                {hasActiveTerminalModifiers(terminalModifiers) ? (
                  <Badge variant="info">Next key: {activeModifierLabel}</Badge>
                ) : (
                  <Badge variant="default">Modifiers off</Badge>
                )}
                {hasActiveTerminalModifiers(terminalModifiers) && (
                  <Button variant="ghost" size="sm" onClick={resetTerminalModifiers}>
                    Clear modifiers
                  </Button>
                )}
              </div>

              <div className="flex flex-wrap gap-2">
                <Button
                  variant={terminalModifiers.ctrl ? "primary" : "secondary"}
                  size="sm"
                  aria-pressed={terminalModifiers.ctrl}
                  onClick={() => toggleTerminalModifier("ctrl")}
                >
                  Ctrl
                </Button>
                <Button
                  variant={terminalModifiers.alt ? "primary" : "secondary"}
                  size="sm"
                  aria-pressed={terminalModifiers.alt}
                  onClick={() => toggleTerminalModifier("alt")}
                >
                  Alt
                </Button>
                <Button
                  variant={terminalModifiers.shift ? "primary" : "secondary"}
                  size="sm"
                  aria-pressed={terminalModifiers.shift}
                  onClick={() => toggleTerminalModifier("shift")}
                >
                  Shift
                </Button>
              </div>

              <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 lg:grid-cols-8">
                <Button variant="secondary" size="sm" onClick={() => sendEncodedTerminalKey("Escape")}>
                  Esc
                </Button>
                <Button variant="secondary" size="sm" onClick={() => sendEncodedTerminalKey("Tab")}>
                  Tab
                </Button>
                <Button variant="secondary" size="sm" onClick={() => sendEncodedTerminalKey("Enter")}>
                  Enter
                </Button>
                <Button variant="secondary" size="sm" onClick={() => sendEncodedTerminalKey("Backspace")}>
                  Backspace
                </Button>
                <Button variant="secondary" size="sm" onClick={() => sendEncodedTerminalKey("Space")}>
                  Space
                </Button>
                <Button variant="secondary" size="sm" onClick={() => sendEncodedTerminalKey("ArrowUp")}>
                  ↑
                </Button>
                <Button variant="secondary" size="sm" onClick={() => sendEncodedTerminalKey("ArrowLeft")}>
                  ←
                </Button>
                <Button variant="secondary" size="sm" onClick={() => sendEncodedTerminalKey("ArrowDown")}>
                  ↓
                </Button>
                <Button variant="secondary" size="sm" onClick={() => sendEncodedTerminalKey("ArrowRight")}>
                  →
                </Button>
              </div>

              <div className="flex flex-col gap-2 sm:flex-row">
                <label className="flex-1">
                  <span className="mb-1 block text-sm text-gray-600 dark:text-gray-300">
                    Send a key with the active modifiers
                  </span>
                  <input
                    type="text"
                    inputMode="text"
                    autoCapitalize="none"
                    autoCorrect="off"
                    spellCheck={false}
                    maxLength={1}
                    value={customKeyInput}
                    onChange={(event) => setCustomKeyInput(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        event.preventDefault();
                        handleCustomKeySend();
                      }
                    }}
                    placeholder="a"
                    className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 shadow-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-900 dark:text-gray-100"
                  />
                </label>
                <div className="flex items-end">
                  <Button variant="secondary" onClick={handleCustomKeySend}>
                    Send Key
                  </Button>
                </div>
              </div>
            </div>
          </div>
          <div
            ref={terminalContainerRef}
            className="flex-1 min-h-[400px] bg-gray-900 rounded-b-lg overflow-hidden"
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
    </div>
  );
}
