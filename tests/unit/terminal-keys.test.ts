import { describe, expect, test } from "bun:test";
import {
  defaultTerminalModifiers,
  encodeTerminalDataInput,
  encodeTerminalInput,
  encodeTmuxShortcut,
  hasActiveTerminalModifiers,
} from "../../src/utils/terminal-keys";

describe("terminal key encoding", () => {
  test("reports whether modifiers are active", () => {
    expect(hasActiveTerminalModifiers(defaultTerminalModifiers)).toBe(false);
    expect(hasActiveTerminalModifiers({ ctrl: true, alt: false, shift: false })).toBe(true);
  });

  test("encodes plain and modified arrow keys", () => {
    expect(encodeTerminalInput("ArrowUp", defaultTerminalModifiers)).toBe("\u001b[A");
    expect(encodeTerminalInput("ArrowUp", { ctrl: true, alt: false, shift: false })).toBe("\u001b[1;5A");
    expect(encodeTerminalInput("ArrowLeft", { ctrl: false, alt: true, shift: true })).toBe("\u001b[1;4D");
  });

  test("encodes tab combinations", () => {
    expect(encodeTerminalInput("Tab", defaultTerminalModifiers)).toBe("\t");
    expect(encodeTerminalInput("Tab", { ctrl: false, alt: false, shift: true })).toBe("\u001b[Z");
    expect(encodeTerminalInput("Tab", { ctrl: true, alt: false, shift: true })).toBe("\u001b[1;6Z");
  });

  test("encodes modifier combinations for printable keys", () => {
    expect(encodeTerminalInput("c", { ctrl: true, alt: false, shift: false })).toBe("\u0003");
    expect(encodeTerminalInput("d", { ctrl: true, alt: true, shift: false })).toBe("\u001b\u0004");
    expect(encodeTerminalInput("a", { ctrl: false, alt: false, shift: true })).toBe("A");
  });

  test("supports control-space and rejects unsupported multi-character keys", () => {
    expect(encodeTerminalInput("Space", { ctrl: true, alt: false, shift: false })).toBe("\u0000");
    expect(encodeTerminalInput("ab", defaultTerminalModifiers)).toBeNull();
  });

  test("encodes raw terminal data with active modifiers", () => {
    expect(encodeTerminalDataInput("c", { ctrl: true, alt: false, shift: false })).toBe("\u0003");
    expect(encodeTerminalDataInput("\t", { ctrl: false, alt: false, shift: true })).toBe("\u001b[Z");
    expect(encodeTerminalDataInput("\u001b[A", { ctrl: false, alt: true, shift: false })).toBe("\u001b[1;3A");
    expect(encodeTerminalDataInput("c", defaultTerminalModifiers)).toBe("c");
  });

  test("encodes tmux helper shortcuts", () => {
    expect(encodeTmuxShortcut("split-pane")).toBe("\u0002\"");
    expect(encodeTmuxShortcut("next-pane")).toBe("\u0002o");
    expect(encodeTmuxShortcut("resize-pane-up")).toBe("\u0002\u001b[1;5A");
    expect(encodeTmuxShortcut("resize-pane-down")).toBe("\u0002\u001b[1;5B");
  });
});
