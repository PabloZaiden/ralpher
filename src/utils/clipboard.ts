/**
 * Browser clipboard helper with a legacy execCommand fallback.
 */

export async function writeTextToClipboard(text: string): Promise<void> {
  let clipboardApiError: unknown;
  if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return;
    } catch (error) {
      clipboardApiError = error;
    }
  }

  if (typeof document === "undefined" || typeof document.execCommand !== "function") {
    if (clipboardApiError instanceof Error) {
      throw clipboardApiError;
    }
    if (clipboardApiError !== undefined) {
      throw new Error(String(clipboardApiError));
    }
    throw new Error("Browser clipboard access is unavailable.");
  }

  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "true");
  textarea.style.position = "fixed";
  textarea.style.left = "-9999px";
  textarea.style.opacity = "0";
  textarea.style.pointerEvents = "none";
  document.body.appendChild(textarea);
  let didCopy = false;
  try {
    textarea.focus();
    textarea.select();
    didCopy = document.execCommand("copy");
  } finally {
    textarea.remove();
  }
  if (!didCopy) {
    if (clipboardApiError instanceof Error) {
      throw clipboardApiError;
    }
    if (clipboardApiError !== undefined) {
      throw new Error(String(clipboardApiError));
    }
    throw new Error("Browser clipboard access is unavailable.");
  }
}
