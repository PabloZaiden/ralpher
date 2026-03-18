import { useCallback, useEffect, useRef } from "react";

export type WindowFocusRecoveryTrigger = "focus" | "visibilitychange";

export interface UseWindowFocusRecoveryOptions {
  enabled?: boolean;
  cooldownMs?: number;
  onRecover: (trigger: WindowFocusRecoveryTrigger) => void | Promise<void>;
}

export function useWindowFocusRecovery({
  enabled = true,
  cooldownMs = 250,
  onRecover,
}: UseWindowFocusRecoveryOptions): void {
  const onRecoverRef = useRef(onRecover);
  const lastRecoveryAtRef = useRef(0);
  const inFlightRef = useRef<Promise<void> | null>(null);

  useEffect(() => {
    onRecoverRef.current = onRecover;
  }, [onRecover]);

  const triggerRecovery = useCallback((trigger: WindowFocusRecoveryTrigger) => {
    if (!enabled || typeof window === "undefined" || typeof document === "undefined") {
      return;
    }

    if (inFlightRef.current) {
      return;
    }

    const now = Date.now();
    if (now - lastRecoveryAtRef.current < cooldownMs) {
      return;
    }
    lastRecoveryAtRef.current = now;

    const recoveryPromise = Promise.resolve(onRecoverRef.current(trigger)).finally(() => {
      if (inFlightRef.current === recoveryPromise) {
        inFlightRef.current = null;
      }
    });
    inFlightRef.current = recoveryPromise;
  }, [cooldownMs, enabled]);

  useEffect(() => {
    if (!enabled || typeof window === "undefined" || typeof document === "undefined") {
      return;
    }

    const handleFocus = () => {
      triggerRecovery("focus");
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState !== "visible") {
        return;
      }
      triggerRecovery("visibilitychange");
    };

    window.addEventListener("focus", handleFocus);
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      window.removeEventListener("focus", handleFocus);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [enabled, triggerRecovery]);
}
