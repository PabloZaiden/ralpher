import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { act, renderHook, waitFor } from "@testing-library/react";
import { createMockWebSocket } from "../helpers/mock-websocket";
import { useWebSocket } from "@/hooks/useWebSocket";

const ws = createMockWebSocket();

beforeEach(() => {
  ws.reset();
  ws.install();
});

afterEach(() => {
  ws.uninstall();
});

describe("useWebSocket focus recovery", () => {
  test("reconnects immediately on focus when the socket is unhealthy", async () => {
    const recoveryTriggers: string[] = [];

    const { result } = renderHook(() =>
      useWebSocket({
        url: "/api/ws",
        onFocusRecovery: (trigger) => {
          recoveryTriggers.push(trigger);
        },
      })
    );

    await waitFor(() => {
      expect(result.current.status).toBe("open");
      expect(ws.connections()).toHaveLength(1);
    });

    const initialConnection = ws.connections()[0];
    if (!initialConnection) {
      throw new Error("Expected initial websocket connection");
    }

    act(() => {
      initialConnection.instance.close(1006, "lost");
      window.dispatchEvent(new Event("focus"));
    });

    await waitFor(() => {
      expect(ws.connections()).toHaveLength(2);
      expect(result.current.status).toBe("open");
    });

    expect(recoveryTriggers).toEqual(["focus"]);
  });

  test("does not reconnect on focus after a manual disconnect", async () => {
    const { result } = renderHook(() =>
      useWebSocket({
        url: "/api/ws",
      })
    );

    await waitFor(() => {
      expect(result.current.status).toBe("open");
      expect(ws.connections()).toHaveLength(1);
    });

    act(() => {
      result.current.disconnect();
    });

    await waitFor(() => {
      expect(result.current.status).toBe("closed");
    });

    act(() => {
      window.dispatchEvent(new Event("focus"));
    });

    await waitFor(() => {
      expect(ws.connections()).toHaveLength(1);
      expect(result.current.status).toBe("closed");
    });
  });
});
