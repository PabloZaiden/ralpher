import type { ServerWebSocket } from "bun";
import { createLogger } from "../../core/logger";
import type { WebSocketData } from "./types";
import { startTerminalBridge, sendTerminalAuthError } from "./terminal";

const log = createLogger("api:websocket");

/**
 * Called when a message is received from the client.
 *
 * Handles ping/pong for keep-alive. Clients should send {"type":"ping"}
 * periodically to keep the connection alive; server responds with {"type":"pong"}.
 */
export function message(ws: ServerWebSocket<WebSocketData>, msg: string | Buffer): void {
  if (ws.data.portForwardMode) {
    const proxySocket = ws.data.proxySocket;

    if (proxySocket?.readyState === WebSocket.OPEN) {
      proxySocket.send(msg);
      return;
    }

    log.debug("Closing port-forward WebSocket because upstream proxy is not open", {
      portForwardId: ws.data.portForwardId,
      proxyReadyState: proxySocket ? proxySocket.readyState : "missing",
    });
    try {
      ws.close(1011, "Upstream proxy is not open");
    } catch (closeError) {
      log.debug("Error while closing WebSocket after upstream proxy failure", {
        error: String(closeError),
      });
    }
    return;
  }

  // Parse message if needed for future commands
  try {
    const data = JSON.parse(typeof msg === "string" ? msg : msg.toString());

    if (ws.data.terminalMode && ws.data.sshServerSessionId && !ws.data.terminalBridge) {
      if (data.type === "terminal.auth") {
        const credentialToken = typeof data.credentialToken === "string"
          ? data.credentialToken.trim()
          : "";
        if (!credentialToken) {
          sendTerminalAuthError(
            ws,
            "credentialToken is required for standalone SSH terminals",
          );
          return;
        }
        void startTerminalBridge(ws, credentialToken);
        return;
      }
      if (data.type !== "ping") {
        sendTerminalAuthError(
          ws,
          "terminal.auth is required before using a standalone SSH terminal",
        );
        return;
      }
    }

    if (ws.data.terminalMode && ws.data.terminalBridge) {
      if (data.type === "terminal.input" && typeof data.data === "string") {
        ws.data.terminalBridge.sendInput(data.data);
        return;
      }
      if (
        data.type === "terminal.resize" &&
        typeof data.cols === "number" &&
        typeof data.rows === "number"
      ) {
        void ws.data.terminalBridge.resize(data.cols, data.rows).catch((resizeError: Error) => {
          log.debug("Ignoring SSH terminal resize error", {
            sshSessionId: ws.data.sshSessionId,
            sshServerSessionId: ws.data.sshServerSessionId,
            error: String(resizeError),
          });
        });
        return;
      }
    }

    // Handle ping/pong for keep-alive
    if (data.type === "ping") {
      ws.send(JSON.stringify({ type: "pong" }));
    }
  } catch (parseError) {
    log.trace("Received invalid JSON from WebSocket client", { error: String(parseError) });
  }
}
