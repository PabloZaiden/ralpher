/**
 * Dedicated SSH session terminal view.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";
import { Badge, Button, Card, ConfirmModal } from "./common";
import { useSshSession, useToast } from "../hooks";

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

  const terminalUrl = useMemo(
    () => `/api/ssh-terminal?sshSessionId=${encodeURIComponent(sshSessionId)}`,
    [sshSessionId],
  );

  const sendResize = useCallback(() => {
    if (!terminalRef.current || !fitAddonRef.current) {
      return;
    }
    fitAddonRef.current.fit();
    if (terminalSocketRef.current?.readyState === WebSocket.OPEN) {
      terminalSocketRef.current.send(JSON.stringify({
        type: "terminal.resize",
        cols: terminalRef.current.cols,
        rows: terminalRef.current.rows,
      }));
    }
  }, []);

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
    terminalRef.current = terminal;
    fitAddonRef.current = fitAddon;

    const disposable = terminal.onData((data) => {
      if (terminalSocketRef.current?.readyState === WebSocket.OPEN) {
        terminalSocketRef.current.send(JSON.stringify({
          type: "terminal.input",
          data,
        }));
      }
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
  }, [sendResize]);

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

