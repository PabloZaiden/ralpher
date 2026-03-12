import { describe, expect, mock, test } from "bun:test";
import type { ServerWebSocket } from "bun";
import { websocketHandlers, type WebSocketData } from "../../src/api/websocket";

describe("websocketHandlers port-forward mode", () => {
  test("closes the client socket when the upstream proxy is not open", () => {
    const close = mock(() => {});
    const send = mock(() => {});
    const proxySocket = {
      readyState: WebSocket.CONNECTING,
      send,
    } as unknown as WebSocket;
    const ws = {
      data: {
        portForwardMode: true,
        portForwardId: "forward-1",
        proxySocket,
      } as WebSocketData,
      close,
    } as unknown as ServerWebSocket<WebSocketData>;

    websocketHandlers.message(ws, "not-json");

    expect(send).not.toHaveBeenCalled();
    expect(close).toHaveBeenCalledWith(1011, "Upstream proxy is not open");
  });
});
