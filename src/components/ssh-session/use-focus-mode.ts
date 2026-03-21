import { useCallback, useState } from "react";

const STORAGE_KEY = "ralpher-ssh-focus-mode";

function readStoredValue(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) !== "false";
  } catch {
    return true;
  }
}

export function useFocusMode() {
  const [isFocusMode, setIsFocusMode] = useState(readStoredValue);

  const toggleFocusMode = useCallback(() => {
    setIsFocusMode((current) => {
      const next = !current;
      try {
        localStorage.setItem(STORAGE_KEY, String(next));
      } catch {
        // localStorage may be unavailable
      }
      return next;
    });
  }, []);

  return { isFocusMode, toggleFocusMode } as const;
}
