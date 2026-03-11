/**
 * Helpers for encoding terminal key presses and modifier combinations.
 */

export interface TerminalModifierState {
  ctrl: boolean;
  alt: boolean;
  shift: boolean;
}

export type TerminalSpecialKey =
  | "ArrowUp"
  | "ArrowDown"
  | "ArrowLeft"
  | "ArrowRight"
  | "Escape"
  | "Tab"
  | "Enter"
  | "Backspace"
  | "Space";

const ESC = "\u001b";
const CSI = `${ESC}[`;

export const defaultTerminalModifiers: TerminalModifierState = {
  ctrl: false,
  alt: false,
  shift: false,
};

export function hasActiveTerminalModifiers(modifiers: TerminalModifierState): boolean {
  return modifiers.ctrl || modifiers.alt || modifiers.shift;
}

function getModifierParameter(modifiers: TerminalModifierState): number {
  let parameter = 1;
  if (modifiers.shift) {
    parameter += 1;
  }
  if (modifiers.alt) {
    parameter += 2;
  }
  if (modifiers.ctrl) {
    parameter += 4;
  }
  return parameter;
}

function withAltPrefix(value: string, modifiers: TerminalModifierState): string {
  return modifiers.alt ? `${ESC}${value}` : value;
}

function encodeArrowKey(key: "A" | "B" | "C" | "D", modifiers: TerminalModifierState): string {
  if (!hasActiveTerminalModifiers(modifiers)) {
    return `${CSI}${key}`;
  }
  return `${CSI}1;${getModifierParameter(modifiers)}${key}`;
}

function encodeCtrlCharacter(character: string): string | null {
  if (character.length !== 1) {
    return null;
  }

  const upperCharacter = character.toUpperCase();
  if (upperCharacter >= "A" && upperCharacter <= "Z") {
    return String.fromCharCode(upperCharacter.charCodeAt(0) - 64);
  }

  switch (character) {
    case "@":
    case " ":
      return "\u0000";
    case "[":
      return "\u001b";
    case "\\":
      return "\u001c";
    case "]":
      return "\u001d";
    case "^":
      return "\u001e";
    case "_":
      return "\u001f";
    case "?":
      return "\u007f";
    default:
      return null;
  }
}

export function encodeTerminalInput(
  key: TerminalSpecialKey | string,
  modifiers: TerminalModifierState = defaultTerminalModifiers,
): string | null {
  switch (key) {
    case "ArrowUp":
      return encodeArrowKey("A", modifiers);
    case "ArrowDown":
      return encodeArrowKey("B", modifiers);
    case "ArrowRight":
      return encodeArrowKey("C", modifiers);
    case "ArrowLeft":
      return encodeArrowKey("D", modifiers);
    case "Tab":
      if (!hasActiveTerminalModifiers(modifiers)) {
        return "\t";
      }
      if (modifiers.shift && !modifiers.ctrl && !modifiers.alt) {
        return `${CSI}Z`;
      }
      return `${CSI}1;${getModifierParameter(modifiers)}Z`;
    case "Enter":
      return withAltPrefix("\r", modifiers);
    case "Backspace":
      return withAltPrefix("\u007f", modifiers);
    case "Escape":
      return modifiers.alt ? `${ESC}${ESC}` : ESC;
    case "Space":
      if (modifiers.ctrl) {
        const value = "\u0000";
        return modifiers.alt ? `${ESC}${value}` : value;
      }
      return withAltPrefix(" ", modifiers);
    default:
      if (key.length !== 1) {
        return null;
      }

      const shiftedKey = modifiers.shift ? key.toUpperCase() : key;
      if (modifiers.ctrl) {
        const ctrlValue = encodeCtrlCharacter(shiftedKey);
        if (!ctrlValue) {
          return null;
        }
        return modifiers.alt ? `${ESC}${ctrlValue}` : ctrlValue;
      }

      return withAltPrefix(shiftedKey, modifiers);
  }
}
