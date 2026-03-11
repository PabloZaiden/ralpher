import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { writeTextToClipboard } from "@/utils/clipboard";

describe("writeTextToClipboard", () => {
  let originalClipboardDescriptor: PropertyDescriptor | undefined;
  let originalExecCommand: typeof document.execCommand | undefined;

  beforeEach(() => {
    originalClipboardDescriptor = Object.getOwnPropertyDescriptor(navigator, "clipboard");
    originalExecCommand = document.execCommand;
  });

  afterEach(() => {
    if (originalClipboardDescriptor) {
      Object.defineProperty(navigator, "clipboard", originalClipboardDescriptor);
    } else {
      Reflect.deleteProperty(navigator, "clipboard");
    }
    document.execCommand = originalExecCommand as typeof document.execCommand;
    document.body.innerHTML = "";
  });

  test("uses navigator.clipboard when available", async () => {
    const writes: string[] = [];
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: async (text: string) => {
          writes.push(text);
        },
      },
    });

    await writeTextToClipboard("copied");

    expect(writes).toEqual(["copied"]);
  });

  test("falls back to document.execCommand when navigator.clipboard is unavailable", async () => {
    const writes: string[] = [];
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: undefined,
    });
    document.execCommand = ((command: string) => {
      if (command !== "copy") {
        return false;
      }
      const textarea = document.querySelector("textarea");
      if (textarea instanceof HTMLTextAreaElement) {
        writes.push(textarea.value);
      }
      return true;
    }) as typeof document.execCommand;

    await writeTextToClipboard("fallback copy");

    expect(writes).toEqual(["fallback copy"]);
    expect(document.querySelector("textarea")).toBeNull();
  });
});
