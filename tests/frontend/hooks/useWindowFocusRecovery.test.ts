import { describe, expect, spyOn, test } from "bun:test";
import { act, renderHook, waitFor } from "@testing-library/react";
import { useWindowFocusRecovery } from "@/hooks/useWindowFocusRecovery";
import { log } from "@/lib/logger";

describe("useWindowFocusRecovery", () => {
  test("logs rejected recoveries and allows later retries", async () => {
    const errorSpy = spyOn(log, "error").mockImplementation(() => undefined);
    let attempts = 0;

    try {
      renderHook(() =>
        useWindowFocusRecovery({
          cooldownMs: 0,
          onRecover: async () => {
            attempts++;
            if (attempts === 1) {
              throw new Error("boom");
            }
          },
        })
      );

      act(() => {
        window.dispatchEvent(new Event("focus"));
      });

      await waitFor(() => {
        expect(errorSpy).toHaveBeenCalledWith("Window focus recovery failed", {
          trigger: "focus",
          error: "Error: boom",
        });
      });

      act(() => {
        window.dispatchEvent(new Event("focus"));
      });

      await waitFor(() => {
        expect(attempts).toBe(2);
      });
      expect(errorSpy).toHaveBeenCalledTimes(1);
    } finally {
      errorSpy.mockRestore();
    }
  });
});
