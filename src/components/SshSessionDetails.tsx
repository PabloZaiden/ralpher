/**
 * Dedicated SSH session terminal view.
 */

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { FitAddon, init, Terminal } from "ghostty-web";
import { Badge, Button, Card, ConfirmModal, EditIcon, Modal, PASSWORD_INPUT_PROPS } from "./common";
import { getSshServerApi, useSshSession, useToast } from "../hooks";
import { RenameSshSessionModal } from "./RenameSshSessionModal";
import {
  defaultTerminalModifiers,
  encodeTerminalDataInput,
  encodeTerminalInput,
  hasActiveTerminalModifiers,
  type TerminalModifierState,
  type TerminalSpecialKey,
} from "../utils/terminal-keys";
import {
  getEffectiveSshConnectionMode,
  getSshConnectionModeLabel,
  isPersistentSshSession,
  writeTextToClipboard,
} from "../utils";
import { appWebSocketUrl } from "../lib/public-path";
import { getStoredSshCredentialToken, storeSshServerPassword } from "../lib/ssh-browser-credentials";
import type { SshServer } from "../types";

function isStandaloneSession(session: NonNullable<ReturnType<typeof useSshSession>["session"]>): session is Extract<
  NonNullable<ReturnType<typeof useSshSession>["session"]>,
  { config: { sshServerId: string } }
> {
  return "sshServerId" in session.config;
}

function getStatusVariant(status: string) {
  switch (status) {
    case "connected":
      return "success";
    case "connecting":
      return "info";
    case "failed":
      return "error";
    case "disconnected":
      return "warning";
    default:
      return "default";
  }
}

export interface SshSessionDetailsProps {
  sshSessionId: string;
  onBack: () => void;
  copyTextToClipboard?: (text: string) => Promise<void>;
}

interface CompactBarProps {
  title: string;
  expanded: boolean;
  onToggle: () => void;
  summary: ReactNode;
  children: ReactNode;
  contentClassName?: string;
}

function CompactBar({
  title,
  expanded,
  onToggle,
  summary,
  children,
  contentClassName = "",
}: CompactBarProps) {
  return (
    <div className="overflow-hidden rounded-md border border-gray-200 bg-white shadow-sm dark:border-gray-700 dark:bg-gray-800">
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full min-w-0 items-center gap-2 px-3 py-2 text-left transition-colors hover:bg-gray-50 dark:hover:bg-gray-700/50"
        aria-expanded={expanded}
      >
        <span className="shrink-0 text-[11px] text-gray-500 dark:text-gray-400">{expanded ? "▼" : "▶"}</span>
        <span className="shrink-0 text-xs font-semibold text-gray-900 dark:text-gray-100">{title}</span>
        <div className="min-w-0 flex-1">{summary}</div>
      </button>
      {expanded && (
        <div className={`border-t border-gray-200 px-3 py-2 dark:border-gray-700 ${contentClassName}`.trim()}>
          {children}
        </div>
      )}
    </div>
  );
}

const touchButtonClassName = "min-h-[28px] shrink-0 whitespace-nowrap px-1.5 py-0.5 text-[11px]";
const TERMINAL_FONT_SIZE_PX = 12;
const TERMINAL_SYMBOL_FONT_FAMILIES = [
  "Liga SFMono Nerd Font",
  "MesloLGS NF",
  "MonaspiceNe Nerd Font Mono",
  "MonaspiceXe Nerd Font Mono",
  "Iosevka Nerd Font",
  "RecMonoLinear Nerd Font Mono",
  "Terminess Nerd Font Mono",
  "FiraCode Nerd Font Mono",
  "CaskaydiaMono Nerd Font Mono",
  "CaskaydiaCove Nerd Font Mono",
  "JetBrainsMono Nerd Font Mono",
  "JetBrainsMono Nerd Font",
  "Hack Nerd Font Mono",
  "SauceCodePro Nerd Font Mono",
  "Symbols Nerd Font Mono",
  "Symbols Nerd Font",
] as const;
const TERMINAL_BUNDLED_NERD_FONT_FAMILIES = ["Ralpher Terminal Nerd Font"] as const;
const TERMINAL_TEXT_FONT_FAMILIES = [
  "SFMono-Regular",
  "SF Mono",
  "Menlo",
  "Monaco",
  "Consolas",
  "Liberation Mono",
  "monospace",
] as const;
const TERMINAL_GLYPH_SAMPLE = "\ue62b\uf07b\uf15b\uf002";

function formatTerminalFontFamily(fontFamily: string) {
  return fontFamily === "monospace" || !fontFamily.includes(" ") ? fontFamily : `"${fontFamily}"`;
}

function buildTerminalFontFamily(fontFamilies: readonly string[]) {
  return fontFamilies.map((fontFamily) => formatTerminalFontFamily(fontFamily)).join(", ");
}

// Prefer locally installed patched fonts so the browser terminal tracks the host's
// native terminal appearance more closely. Keep Nerd Fonts only as fallbacks for
// symbol/private-use glyphs so the main text shape stays closer to native macOS terminals.
const TERMINAL_FONT_FAMILY = buildTerminalFontFamily([
  ...TERMINAL_TEXT_FONT_FAMILIES,
  ...TERMINAL_SYMBOL_FONT_FAMILIES,
  ...TERMINAL_BUNDLED_NERD_FONT_FAMILIES,
]);
const TERMINAL_PADDING_X_PX = 2;
const TERMINAL_PADDING_BOTTOM_PX = 2;
const TERMINAL_PADDING_TOP_PX = 4;
const TERMINAL_OSC_QUERY_SEQUENCE_START = "\u001b]";
const TERMINAL_OSC_STRING_TERMINATOR = "\u001b\\";
const TERMINAL_OSC_BELL_TERMINATOR = "\u0007";
const TERMINAL_OSC_C1_TERMINATOR = "\u009c";
const MAX_PENDING_OSC_COLOR_QUERY_BYTES = 4 * 1024;
const TERMINAL_MOUSE_BUTTON_MODE = 1000;
const TERMINAL_MOUSE_DRAG_MODE = 1002;
const TERMINAL_MOUSE_ANY_MOTION_MODE = 1003;
const TERMINAL_MOUSE_SGR_MODE = 1006;
const TERMINAL_THEME = {
  background: "#1e1e1e",
  foreground: "#d4d4d4",
  cursor: "#aeafad",
  cursorAccent: "#1e1e1e",
  selectionBackground: "#264f78",
  selectionForeground: "#ffffff",
  black: "#000000",
  red: "#cd3131",
  green: "#0dbc79",
  yellow: "#e5e510",
  blue: "#2472c8",
  magenta: "#bc3fbc",
  cyan: "#11a8cd",
  white: "#e5e5e5",
  brightBlack: "#666666",
  brightRed: "#f14c4c",
  brightGreen: "#23d18b",
  brightYellow: "#f5f543",
  brightBlue: "#3b8eea",
  brightMagenta: "#d670d6",
  brightCyan: "#29b8db",
  brightWhite: "#ffffff",
} as const;

let ghosttyInitPromise: Promise<void> | null = null;

function initializeGhosttyWeb(): Promise<void> {
  if (!ghosttyInitPromise) {
    ghosttyInitPromise = init().catch((error) => {
      ghosttyInitPromise = null;
      throw error;
    });
  }

  return ghosttyInitPromise;
}

async function resolveTerminalFontFamily() {
  if (typeof document === "undefined" || !("fonts" in document)) {
    return TERMINAL_FONT_FAMILY;
  }

  await Promise.allSettled(
    [...TERMINAL_SYMBOL_FONT_FAMILIES, ...TERMINAL_BUNDLED_NERD_FONT_FAMILIES].map((fontFamily) =>
      document.fonts.load(
        `${TERMINAL_FONT_SIZE_PX}px ${buildTerminalFontFamily([fontFamily])}`,
        TERMINAL_GLYPH_SAMPLE,
      ),
    ),
  );
  await document.fonts.ready;

  const availableSymbolFonts = [...TERMINAL_SYMBOL_FONT_FAMILIES, ...TERMINAL_BUNDLED_NERD_FONT_FAMILIES]
    .filter((fontFamily) =>
      document.fonts.check(
        `${TERMINAL_FONT_SIZE_PX}px ${buildTerminalFontFamily([fontFamily])}`,
        TERMINAL_GLYPH_SAMPLE,
      )
    );

  return buildTerminalFontFamily([
    ...TERMINAL_TEXT_FONT_FAMILIES,
    ...availableSymbolFonts,
  ]);
}

async function remeasureTerminalFont(terminal: Terminal, fitAddon: FitAddon | null) {
  if (typeof document === "undefined" || !("fonts" in document) || !terminal.renderer || !terminal.wasmTerm) {
    return;
  }

  await document.fonts.ready;
  terminal.renderer.remeasureFont();

  const nextDimensions = fitAddon?.proposeDimensions();
  if (
    nextDimensions &&
    (nextDimensions.cols !== terminal.cols || nextDimensions.rows !== terminal.rows)
  ) {
    terminal.resize(nextDimensions.cols, nextDimensions.rows);
    return;
  }

  terminal.renderer.resize(terminal.cols, terminal.rows);
  terminal.renderer.render(terminal.wasmTerm, true, terminal.getViewportY());
}

function toOscRgb(color: string): string | null {
  const match = /^#([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(color);
  if (!match) {
    return null;
  }

  return `rgb:${match[1]}/${match[2]}/${match[3]}`;
}

function buildTerminalOscColorReply(command: "10" | "11"): string | null {
  const color = command === "10" ? TERMINAL_THEME.foreground : TERMINAL_THEME.background;
  const rgb = toOscRgb(color);
  return rgb ? `${TERMINAL_OSC_QUERY_SEQUENCE_START}${command};${rgb}${TERMINAL_OSC_STRING_TERMINATOR}` : null;
}

const TERMINAL_ANSI_PALETTE = [
  TERMINAL_THEME.black,
  TERMINAL_THEME.red,
  TERMINAL_THEME.green,
  TERMINAL_THEME.yellow,
  TERMINAL_THEME.blue,
  TERMINAL_THEME.magenta,
  TERMINAL_THEME.cyan,
  TERMINAL_THEME.white,
  TERMINAL_THEME.brightBlack,
  TERMINAL_THEME.brightRed,
  TERMINAL_THEME.brightGreen,
  TERMINAL_THEME.brightYellow,
  TERMINAL_THEME.brightBlue,
  TERMINAL_THEME.brightMagenta,
  TERMINAL_THEME.brightCyan,
  TERMINAL_THEME.brightWhite,
] as const;

function formatOscRgbComponent(value: number): string {
  return value.toString(16).padStart(2, "0");
}

function buildOscRgbFromChannels(red: number, green: number, blue: number): string {
  return `rgb:${formatOscRgbComponent(red)}/${formatOscRgbComponent(green)}/${formatOscRgbComponent(blue)}`;
}

function getTerminalPaletteOscRgb(index: number): string | null {
  if (index >= 0 && index < TERMINAL_ANSI_PALETTE.length) {
    return toOscRgb(TERMINAL_ANSI_PALETTE[index] ?? "") ?? null;
  }

  if (index >= 16 && index <= 231) {
    const cubeIndex = index - 16;
    const blue = cubeIndex % 6;
    const green = Math.floor(cubeIndex / 6) % 6;
    const red = Math.floor(cubeIndex / 36);
    const toChannel = (value: number) => value === 0 ? 0 : 55 + value * 40;

    return buildOscRgbFromChannels(toChannel(red), toChannel(green), toChannel(blue));
  }

  if (index >= 232 && index <= 255) {
    const gray = 8 + (index - 232) * 10;
    return buildOscRgbFromChannels(gray, gray, gray);
  }

  return null;
}

function buildTerminalOscPaletteReply(payload: string): string | null {
  const parts = payload.split(";");
  if (parts.length === 0 || parts.length % 2 !== 0) {
    return null;
  }

  const replyParts: string[] = [];
  for (let index = 0; index < parts.length; index += 2) {
    const paletteIndex = Number(parts[index]);
    const queryValue = parts[index + 1];
    if (!Number.isInteger(paletteIndex) || paletteIndex < 0 || queryValue !== "?") {
      return null;
    }

    const rgb = getTerminalPaletteOscRgb(paletteIndex);
    if (!rgb) {
      return null;
    }

    replyParts.push(String(paletteIndex), rgb);
  }

  return `${TERMINAL_OSC_QUERY_SEQUENCE_START}4;${replyParts.join(";")}${TERMINAL_OSC_STRING_TERMINATOR}`;
}

type TerminalOscColorQuery = {
  command: "4" | "10" | "11";
  index: number;
  length: number;
};

type ParsedTerminalOscColorQueries = {
  visibleOutput: string;
  replies: string[];
  remainder: string;
};

function findTerminalOscColorQuery(buffer: string, cursor: number): TerminalOscColorQuery | null {
  const query4Index = buffer.indexOf(`${TERMINAL_OSC_QUERY_SEQUENCE_START}4;`, cursor);
  const query10Index = buffer.indexOf(`${TERMINAL_OSC_QUERY_SEQUENCE_START}10;?`, cursor);
  const query11Index = buffer.indexOf(`${TERMINAL_OSC_QUERY_SEQUENCE_START}11;?`, cursor);
  const candidates = [
    query4Index >= 0 ? { command: "4" as const, index: query4Index, length: `${TERMINAL_OSC_QUERY_SEQUENCE_START}4;`.length } : null,
    query10Index >= 0 ? { command: "10" as const, index: query10Index, length: `${TERMINAL_OSC_QUERY_SEQUENCE_START}10;?`.length } : null,
    query11Index >= 0 ? { command: "11" as const, index: query11Index, length: `${TERMINAL_OSC_QUERY_SEQUENCE_START}11;?`.length } : null,
  ].filter((candidate): candidate is TerminalOscColorQuery => candidate !== null);

  if (candidates.length === 0) {
    return null;
  }

  return candidates.reduce((earliest, candidate) => candidate.index < earliest.index ? candidate : earliest);
}

function findTerminalOscQueryTerminator(buffer: string, cursor: number): { index: number; length: number } | null {
  const bellIndex = buffer.indexOf(TERMINAL_OSC_BELL_TERMINATOR, cursor);
  const stringIndex = buffer.indexOf(TERMINAL_OSC_STRING_TERMINATOR, cursor);
  const c1Index = buffer.indexOf(TERMINAL_OSC_C1_TERMINATOR, cursor);
  const candidates = [
    bellIndex >= 0 ? { index: bellIndex, length: TERMINAL_OSC_BELL_TERMINATOR.length } : null,
    stringIndex >= 0 ? { index: stringIndex, length: TERMINAL_OSC_STRING_TERMINATOR.length } : null,
    c1Index >= 0 ? { index: c1Index, length: TERMINAL_OSC_C1_TERMINATOR.length } : null,
  ].filter((candidate): candidate is { index: number; length: number } => candidate !== null);

  if (candidates.length === 0) {
    return null;
  }

  return candidates.reduce((earliest, candidate) => candidate.index < earliest.index ? candidate : earliest);
}

function getTerminalOscQueryCarryoverLength(buffer: string): number {
  const query = findTerminalOscColorQuery(buffer, 0);
  if (query) {
    const terminator = findTerminalOscQueryTerminator(buffer, query.index + query.length);
    if (!terminator) {
      return buffer.length - query.index;
    }
  }

  const queryPrefixes = [
    `${TERMINAL_OSC_QUERY_SEQUENCE_START}4;`,
    `${TERMINAL_OSC_QUERY_SEQUENCE_START}10;?`,
    `${TERMINAL_OSC_QUERY_SEQUENCE_START}11;?`,
  ];
  const maxCarryoverLength = queryPrefixes.reduce((maxLength, prefix) => Math.max(maxLength, prefix.length), 0) - 1;

  for (let length = Math.min(buffer.length, maxCarryoverLength); length > 0; length -= 1) {
    const suffix = buffer.slice(-length);
    if (queryPrefixes.some((prefix) => prefix.startsWith(suffix))) {
      return length;
    }
  }

  return 0;
}

function parseTerminalOscColorQueries(buffer: string): ParsedTerminalOscColorQueries {
  let visibleOutput = "";
  const replies: string[] = [];
  let cursor = 0;

  while (cursor < buffer.length) {
    const query = findTerminalOscColorQuery(buffer, cursor);
    if (!query) {
      const carryoverLength = getTerminalOscQueryCarryoverLength(buffer.slice(cursor));
      const flushEnd = buffer.length - carryoverLength;
      visibleOutput += buffer.slice(cursor, flushEnd);
      return {
        visibleOutput,
        replies,
        remainder: buffer.slice(flushEnd),
      };
    }

    visibleOutput += buffer.slice(cursor, query.index);
    const terminator = findTerminalOscQueryTerminator(buffer, query.index + query.length);
    if (!terminator) {
      return {
        visibleOutput,
        replies,
        remainder: buffer.slice(query.index),
      };
    }

    if (query.command === "4") {
      const payload = buffer.slice(query.index + query.length, terminator.index);
      const reply = buildTerminalOscPaletteReply(payload);
      if (reply) {
        replies.push(reply);
      } else {
        visibleOutput += buffer.slice(query.index, terminator.index + terminator.length);
      }
      cursor = terminator.index + terminator.length;
      continue;
    }

    const reply = buildTerminalOscColorReply(query.command);
    if (reply) {
      replies.push(reply);
    }
    cursor = terminator.index + terminator.length;
  }

  return {
    visibleOutput,
    replies,
    remainder: "",
  };
}

type TerminalMousePosition = {
  column: number;
  row: number;
};

type TerminalMouseModes = {
  trackingEnabled: boolean;
  sgr: boolean;
  button: boolean;
  drag: boolean;
  anyMotion: boolean;
};

function readTerminalMouseModes(terminal: Terminal): TerminalMouseModes {
  return {
    trackingEnabled: terminal.hasMouseTracking(),
    sgr: terminal.getMode(TERMINAL_MOUSE_SGR_MODE),
    button: terminal.getMode(TERMINAL_MOUSE_BUTTON_MODE),
    drag: terminal.getMode(TERMINAL_MOUSE_DRAG_MODE),
    anyMotion: terminal.getMode(TERMINAL_MOUSE_ANY_MOTION_MODE),
  };
}

function isTerminalMouseForwardingEnabled(terminal: Terminal): boolean {
  const modes = readTerminalMouseModes(terminal);
  return modes.trackingEnabled && modes.sgr;
}

function getTerminalMouseModifiers(event: MouseEvent | WheelEvent): number {
  let modifiers = 0;
  if (event.shiftKey) {
    modifiers += 4;
  }
  if (event.altKey || event.metaKey) {
    modifiers += 8;
  }
  if (event.ctrlKey) {
    modifiers += 16;
  }
  return modifiers;
}

function getTerminalMousePosition(terminal: Terminal, clientX: number, clientY: number): TerminalMousePosition | null {
  const canvas = terminal.renderer?.getCanvas();
  if (!canvas || terminal.cols <= 0 || terminal.rows <= 0) {
    return null;
  }

  const rect = canvas.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) {
    return null;
  }

  const relativeX = Math.min(Math.max(clientX - rect.left, 0), rect.width - 1);
  const relativeY = Math.min(Math.max(clientY - rect.top, 0), rect.height - 1);
  return {
    column: Math.min(terminal.cols, Math.max(1, Math.floor(relativeX / rect.width * terminal.cols) + 1)),
    row: Math.min(terminal.rows, Math.max(1, Math.floor(relativeY / rect.height * terminal.rows) + 1)),
  };
}

function encodeSgrMouseSequence(
  buttonCode: number,
  position: TerminalMousePosition,
  options?: { release?: boolean },
): string {
  return `\u001b[<${buttonCode};${position.column};${position.row}${options?.release ? "m" : "M"}`;
}

function getMouseButtonCode(button: number): number | null {
  switch (button) {
    case 0:
      return 0;
    case 1:
      return 1;
    case 2:
      return 2;
    default:
      return null;
  }
}

function getPressedMouseButtonCode(buttons: number): number {
  if (buttons & 1) {
    return 0;
  }
  if (buttons & 4) {
    return 1;
  }
  if (buttons & 2) {
    return 2;
  }
  return 3;
}

function encodeTerminalMouseButtonEvent(
  event: MouseEvent,
  position: TerminalMousePosition,
  options?: { release?: boolean },
): string | null {
  const buttonCode = getMouseButtonCode(event.button);
  if (buttonCode === null) {
    return null;
  }

  return encodeSgrMouseSequence(
    buttonCode + getTerminalMouseModifiers(event),
    position,
    options,
  );
}

function encodeTerminalMouseMoveEvent(
  event: MouseEvent,
  position: TerminalMousePosition,
): string {
  return encodeSgrMouseSequence(
    32 + getPressedMouseButtonCode(event.buttons) + getTerminalMouseModifiers(event),
    position,
  );
}

function encodeTerminalMouseWheelEvent(
  event: WheelEvent,
  position: TerminalMousePosition,
): string | null {
  const useHorizontalAxis = Math.abs(event.deltaX) > Math.abs(event.deltaY);
  const dominantDelta = useHorizontalAxis ? event.deltaX : event.deltaY;
  if (dominantDelta === 0) {
    return null;
  }

  const buttonCode = useHorizontalAxis
    ? dominantDelta < 0 ? 66 : 67
    : dominantDelta < 0 ? 64 : 65;
  return encodeSgrMouseSequence(buttonCode + getTerminalMouseModifiers(event), position);
}

function isTerminalMouseEventTarget(container: HTMLElement, target: EventTarget | null): boolean {
  return target instanceof Node && container.contains(target);
}

function stopTerminalMouseEvent(event: MouseEvent | WheelEvent) {
  event.preventDefault();
  event.stopPropagation();
  event.stopImmediatePropagation();
}

function installTerminalMouseHandlers(options: {
  terminal: Terminal;
  container: HTMLElement;
  sendInput: (data: string) => boolean;
}) {
  const { terminal, container, sendInput } = options;
  const ownerDocument = container.ownerDocument;
  let trackedMouseButton = false;

  terminal.attachCustomWheelEventHandler((event: WheelEvent) => {
    if (!isTerminalMouseForwardingEnabled(terminal)) {
      return false;
    }

    const position = getTerminalMousePosition(terminal, event.clientX, event.clientY);
    const sequence = position ? encodeTerminalMouseWheelEvent(event, position) : null;
    if (!sequence) {
      return false;
    }

    void sendInput(sequence);
    return true;
  });

  const handleMouseDown = (event: MouseEvent) => {
    if (!isTerminalMouseEventTarget(container, event.target) || !isTerminalMouseForwardingEnabled(terminal)) {
      return;
    }

    const modes = readTerminalMouseModes(terminal);
    if (!modes.button && !modes.drag && !modes.anyMotion) {
      return;
    }

    const position = getTerminalMousePosition(terminal, event.clientX, event.clientY);
    const sequence = position ? encodeTerminalMouseButtonEvent(event, position) : null;
    if (!sequence) {
      return;
    }

    stopTerminalMouseEvent(event);
    trackedMouseButton = true;
    void sendInput(sequence);
  };

  const handleMouseMove = (event: MouseEvent) => {
    if (!isTerminalMouseForwardingEnabled(terminal)) {
      return;
    }

    const modes = readTerminalMouseModes(terminal);
    const insideTerminal = isTerminalMouseEventTarget(container, event.target);
    const shouldSendMotion = modes.anyMotion || (modes.drag && event.buttons !== 0);
    if (!shouldSendMotion || (!insideTerminal && !trackedMouseButton)) {
      return;
    }

    const position = getTerminalMousePosition(terminal, event.clientX, event.clientY);
    if (!position) {
      return;
    }

    stopTerminalMouseEvent(event);
    void sendInput(encodeTerminalMouseMoveEvent(event, position));
  };

  const handleMouseUp = (event: MouseEvent) => {
    const insideTerminal = isTerminalMouseEventTarget(container, event.target);
    if ((!insideTerminal && !trackedMouseButton) || !isTerminalMouseForwardingEnabled(terminal)) {
      trackedMouseButton = false;
      return;
    }

    const modes = readTerminalMouseModes(terminal);
    if (!modes.button && !modes.drag && !modes.anyMotion) {
      trackedMouseButton = false;
      return;
    }

    const position = getTerminalMousePosition(terminal, event.clientX, event.clientY);
    const sequence = position ? encodeTerminalMouseButtonEvent(event, position, { release: true }) : null;
    trackedMouseButton = false;
    if (!sequence) {
      return;
    }

    stopTerminalMouseEvent(event);
    void sendInput(sequence);
  };

  const swallowMouseEvent = (event: MouseEvent) => {
    if (isTerminalMouseEventTarget(container, event.target) && isTerminalMouseForwardingEnabled(terminal)) {
      stopTerminalMouseEvent(event);
    }
  };

  ownerDocument.addEventListener("mousedown", handleMouseDown, true);
  ownerDocument.addEventListener("mousemove", handleMouseMove, true);
  ownerDocument.addEventListener("mouseup", handleMouseUp, true);
  ownerDocument.addEventListener("click", swallowMouseEvent, true);
  ownerDocument.addEventListener("contextmenu", swallowMouseEvent, true);

  return () => {
    terminal.attachCustomWheelEventHandler(undefined);
    ownerDocument.removeEventListener("mousedown", handleMouseDown, true);
    ownerDocument.removeEventListener("mousemove", handleMouseMove, true);
    ownerDocument.removeEventListener("mouseup", handleMouseUp, true);
    ownerDocument.removeEventListener("click", swallowMouseEvent, true);
    ownerDocument.removeEventListener("contextmenu", swallowMouseEvent, true);
  };
}

function isStandaloneCredentialTokenError(message: string): boolean {
  return message.includes("SSH credential token") || message.includes("credential token");
}

export function SshSessionDetails({
  sshSessionId,
  onBack,
  copyTextToClipboard = writeTextToClipboard,
}: SshSessionDetailsProps) {
  const toast = useToast();
  const { error: showErrorToast, warning: showWarningToast } = toast;
  const { session, sessionKind, loading, error, deleteSession, refresh, updateSession } = useSshSession(sshSessionId);
  const terminalContainerRef = useRef<HTMLDivElement>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const terminalSocketRef = useRef<WebSocket | null>(null);
  const terminalReadyRef = useRef(false);
  const terminalModifiersRef = useRef<TerminalModifierState>(defaultTerminalModifiers);
  const standaloneCredentialTokenRef = useRef<string | null>(null);
  const pendingStandaloneActionRef = useRef<"terminal" | "delete" | null>(null);
  const pendingOutputRef = useRef<string[]>([]);
  const pendingOscColorQueryRef = useRef("");
  const lastSentResizeRef = useRef<{ cols: number; rows: number } | null>(null);
  const terminalConnectInFlightRef = useRef(false);
  const standaloneTokenRecoveryAttemptedRef = useRef(false);
  const lastShownNoticeRef = useRef<string | null>(null);
  const [socketStatus, setSocketStatus] = useState<"connecting" | "open" | "closed">("connecting");
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [showRenameModal, setShowRenameModal] = useState(false);
  const [showPasswordPrompt, setShowPasswordPrompt] = useState(false);
  const [sessionInfoExpanded, setSessionInfoExpanded] = useState(false);
  const [touchControlsExpanded, setTouchControlsExpanded] = useState(false);
  const [terminalModifiers, setTerminalModifiers] = useState<TerminalModifierState>(defaultTerminalModifiers);
  const [hasSelectedTerminalText, setHasSelectedTerminalText] = useState(false);
  const [pendingTerminalClipboardText, setPendingTerminalClipboardText] = useState<string | null>(null);
  const [standalonePassword, setStandalonePassword] = useState("");
  const [standaloneCredentialToken, setStandaloneCredentialToken] = useState<string | null>(null);
  const [pendingStandaloneAction, setPendingStandaloneAction] = useState<"terminal" | "delete" | null>(null);
  const [standaloneServer, setStandaloneServer] = useState<SshServer | null>(null);
  const standaloneServerId = useMemo(() => {
    if (!session || !isStandaloneSession(session)) {
      return null;
    }
    return session.config.sshServerId;
  }, [session]);
  const standaloneServerName = useMemo(() => {
    if (!standaloneServerId) {
      return null;
    }
    return standaloneServer?.config.name ?? standaloneServerId;
  }, [standaloneServer, standaloneServerId]);
  const standaloneServerTarget = useMemo(() => {
    if (!standaloneServerId) {
      return null;
    }
    return standaloneServer
      ? `${standaloneServer.config.username}@${standaloneServer.config.address}`
      : standaloneServerId;
  }, [standaloneServer, standaloneServerId]);

  const terminalUrl = useMemo(
    () => {
      if (!session) {
        return null;
      }
      if (isStandaloneSession(session)) {
        return `/api/ssh-terminal?sshServerSessionId=${encodeURIComponent(sshSessionId)}`;
      }
      return `/api/ssh-terminal?sshSessionId=${encodeURIComponent(sshSessionId)}`;
    },
    [session, sshSessionId],
  );
  const activeModifierLabel = useMemo(() => {
    return [
      terminalModifiers.ctrl ? "Ctrl" : null,
      terminalModifiers.alt ? "Alt" : null,
      terminalModifiers.shift ? "Shift" : null,
    ].filter(Boolean).join(" + ");
  }, [terminalModifiers]);
  const effectiveConnectionMode = useMemo(() => {
    return session ? getEffectiveSshConnectionMode(session) : null;
  }, [session]);
  const hasPersistentSession = useMemo(() => {
    return session ? isPersistentSshSession(session) : false;
  }, [session]);
  const canRenameSession = sessionKind === "workspace";
  const sessionInfoSummary = useMemo(() => {
    if (!session) {
      return null;
    }
    return (
      <div className="flex min-w-0 items-center justify-end gap-2 overflow-hidden text-xs text-gray-500 dark:text-gray-400">
        <Badge variant={effectiveConnectionMode === "direct" ? "info" : "default"} className="shrink-0">
          {getSshConnectionModeLabel(effectiveConnectionMode ?? session.config.connectionMode)}
        </Badge>
        {hasPersistentSession ? (
          <span className="min-w-0 truncate font-mono">{session.config.remoteSessionName}</span>
        ) : (
          <span className="min-w-0 truncate">fresh shell on reconnect</span>
        )}
        {session.state.notice && (
          <Badge variant="warning" className="shrink-0">
            fallback
          </Badge>
        )}
        {session.state.error && (
          <Badge variant="error" className="shrink-0">
            error
          </Badge>
        )}
      </div>
    );
  }, [session]);
  const touchControlsSummary = useMemo(() => {
    return (
      <div className="flex min-w-0 items-center justify-end gap-2 overflow-hidden">
        {hasActiveTerminalModifiers(terminalModifiers) ? (
          <Badge variant="info" className="shrink-0">
            Next: {activeModifierLabel}
          </Badge>
        ) : (
          <Badge variant="default" className="shrink-0">
            Modifiers off
          </Badge>
        )}
        <span className="hidden min-w-0 truncate text-xs text-gray-500 dark:text-gray-400 sm:block">
          Touch keys
        </span>
      </div>
    );
  }, [activeModifierLabel, terminalModifiers]);

  useEffect(() => {
    terminalModifiersRef.current = terminalModifiers;
  }, [terminalModifiers]);

  useEffect(() => {
    const notice = session?.state.notice ?? null;
    if (!notice) {
      lastShownNoticeRef.current = null;
      return;
    }
    if (notice === lastShownNoticeRef.current) {
      return;
    }
    lastShownNoticeRef.current = notice;
    showWarningToast(notice, { duration: 12_000 });
  }, [session?.state.notice, showWarningToast]);

  useEffect(() => {
    standaloneCredentialTokenRef.current = standaloneCredentialToken;
  }, [standaloneCredentialToken]);

  useEffect(() => {
    pendingStandaloneActionRef.current = pendingStandaloneAction;
  }, [pendingStandaloneAction]);

  const focusTerminal = useCallback(() => {
    terminalRef.current?.focus();
  }, []);

  const syncTerminalSelectionState = useCallback(() => {
    const terminal = terminalRef.current;
    setHasSelectedTerminalText(Boolean(terminal?.hasSelection()));
  }, []);

  const clearSelectedTerminalText = useCallback((options?: { clearTerminalSelection?: boolean }) => {
    if (options?.clearTerminalSelection ?? true) {
      terminalRef.current?.clearSelection();
    }
    setHasSelectedTerminalText(false);
  }, []);

  const sendTerminalPayload = useCallback((
    payload: Record<string, unknown>,
    options?: { focusTerminal?: boolean; notifyOnFailure?: boolean },
  ): boolean => {
    if (terminalSocketRef.current?.readyState !== WebSocket.OPEN || !terminalReadyRef.current) {
      if (options?.notifyOnFailure ?? true) {
        showErrorToast("Terminal is still connecting.");
      }
      return false;
    }

    terminalSocketRef.current.send(JSON.stringify(payload));
    if (options?.focusTerminal ?? true) {
      focusTerminal();
    }
    return true;
  }, [focusTerminal, showErrorToast]);

  const sendTerminalInput = useCallback((
    data: string,
    options?: { focusTerminal?: boolean; notifyOnFailure?: boolean },
  ): boolean => {
    return sendTerminalPayload({
      type: "terminal.input",
      data,
    }, options);
  }, [sendTerminalPayload]);

  const sendTerminalResize = useCallback((cols: number, rows: number) => {
    if (cols <= 0 || rows <= 0) {
      return;
    }

    const previousSize = lastSentResizeRef.current;
    if (previousSize && previousSize.cols === cols && previousSize.rows === rows) {
      return;
    }

    const didSend = sendTerminalPayload({
      type: "terminal.resize",
      cols,
      rows,
    }, { focusTerminal: false, notifyOnFailure: false });
    if (didSend) {
      lastSentResizeRef.current = { cols, rows };
    }
  }, [sendTerminalPayload]);

  const syncTerminalSize = useCallback((options?: { fit?: boolean }) => {
    const terminal = terminalRef.current;
    if (!terminal) {
      return;
    }

    if (options?.fit) {
      fitAddonRef.current?.fit();
    }

    sendTerminalResize(terminal.cols, terminal.rows);
  }, [sendTerminalResize]);

  const writeTerminalOutput = useCallback((chunk: string) => {
    const parsed = parseTerminalOscColorQueries(`${pendingOscColorQueryRef.current}${chunk}`);
    const nextVisibleOutput = parsed.remainder.length > MAX_PENDING_OSC_COLOR_QUERY_BYTES
      ? `${parsed.visibleOutput}${parsed.remainder}`
      : parsed.visibleOutput;
    pendingOscColorQueryRef.current = parsed.remainder.length > MAX_PENDING_OSC_COLOR_QUERY_BYTES
      ? ""
      : parsed.remainder;

    for (const reply of parsed.replies) {
      void sendTerminalInput(reply, { focusTerminal: false, notifyOnFailure: false });
    }

    if (!nextVisibleOutput) {
      return;
    }

    if (!terminalRef.current) {
      pendingOutputRef.current.push(nextVisibleOutput);
      return;
    }

    terminalRef.current.write(nextVisibleOutput);
  }, [sendTerminalInput]);

  const flushPendingOutput = useCallback(() => {
    if (!terminalRef.current || pendingOutputRef.current.length === 0) {
      return;
    }
    for (const chunk of pendingOutputRef.current) {
      terminalRef.current.write(chunk);
    }
    pendingOutputRef.current = [];
  }, []);

  const markTerminalReady = useCallback(() => {
    if (terminalReadyRef.current) {
      return;
    }
    terminalReadyRef.current = true;
    standaloneTokenRecoveryAttemptedRef.current = false;
    lastSentResizeRef.current = null;
    setSocketStatus("open");
    syncTerminalSize({ fit: true });
    flushPendingOutput();
    void refresh();
  }, [flushPendingOutput, refresh, syncTerminalSize]);

  const resetTerminalModifiers = useCallback(() => {
    setTerminalModifiers(defaultTerminalModifiers);
  }, []);

  const toggleTerminalModifier = useCallback((modifier: keyof TerminalModifierState) => {
    setTerminalModifiers((current) => ({
      ...current,
      [modifier]: !current[modifier],
    }));
    focusTerminal();
  }, [focusTerminal]);

  const sendEncodedTerminalKey = useCallback((key: TerminalSpecialKey | string) => {
    const encoded = encodeTerminalInput(key, terminalModifiers);
    if (!encoded) {
      showErrorToast("That key combination is not supported.");
      return;
    }

    const didSend = sendTerminalInput(encoded);
    if (didSend) {
      resetTerminalModifiers();
    }
  }, [resetTerminalModifiers, sendTerminalInput, terminalModifiers, showErrorToast]);

  const sendCtrlC = useCallback(() => {
    const encoded = encodeTerminalInput("c", {
      ctrl: true,
      alt: false,
      shift: false,
    });
    if (!encoded) {
      showErrorToast("Ctrl+C is not supported.");
      return;
    }

    const didSend = sendTerminalInput(encoded);
    if (didSend) {
      resetTerminalModifiers();
    }
  }, [resetTerminalModifiers, sendTerminalInput, showErrorToast]);

  const sendTerminalTextShortcut = useCallback((data: string) => {
    const didSend = sendTerminalInput(data);
    if (didSend) {
      resetTerminalModifiers();
    }
  }, [resetTerminalModifiers, sendTerminalInput]);

  const sendTerminalKeystroke = useCallback((data: string) => {
    const modifiers = terminalModifiersRef.current;
    if (!hasActiveTerminalModifiers(modifiers)) {
      return sendTerminalInput(data, { notifyOnFailure: false });
    }

    const encoded = encodeTerminalDataInput(data, modifiers);
    if (!encoded) {
      showErrorToast("That key combination is not supported.");
      return;
    }

    const didSend = sendTerminalInput(encoded, { notifyOnFailure: false });
    if (didSend) {
      resetTerminalModifiers();
    }
  }, [resetTerminalModifiers, sendTerminalInput, showErrorToast]);

  const copyTerminalClipboardText = useCallback(async (
    text: string,
    options?: { userInitiated?: boolean },
  ) => {
    try {
      await copyTextToClipboard(text);
      setPendingTerminalClipboardText(null);
    } catch (error) {
      setPendingTerminalClipboardText(text);
      if (options?.userInitiated) {
        showErrorToast(`Failed to copy terminal text to the clipboard: ${String(error)}`);
      }
    } finally {
      focusTerminal();
    }
  }, [copyTextToClipboard, focusTerminal, showErrorToast]);

  const retryPendingTerminalClipboardCopy = useCallback(() => {
    if (!pendingTerminalClipboardText) {
      return;
    }
    void copyTerminalClipboardText(pendingTerminalClipboardText, { userInitiated: true });
  }, [copyTerminalClipboardText, pendingTerminalClipboardText]);

  const copySelectedTerminalText = useCallback(() => {
    const terminal = terminalRef.current;
    const nextSelectedText = terminal?.getSelection() ?? "";
    if (!nextSelectedText) {
      focusTerminal();
      return;
    }
    void copyTerminalClipboardText(nextSelectedText, { userInitiated: true });
  }, [copyTerminalClipboardText, focusTerminal]);

  const loadStandaloneCredentialToken = useCallback(async (
    options?: { forceRefresh?: boolean; promptOnFailure?: boolean },
  ): Promise<string | null> => {
    if (!standaloneServerId) {
      setStandaloneCredentialToken(null);
      return null;
    }

    if (!options?.forceRefresh && standaloneCredentialTokenRef.current) {
      return standaloneCredentialTokenRef.current;
    }

    try {
      const token = await getStoredSshCredentialToken(standaloneServerId);
      setStandaloneCredentialToken(token);
      if (token) {
        if (pendingStandaloneActionRef.current !== "delete") {
          setShowPasswordPrompt(false);
          setPendingStandaloneAction(null);
        }
        return token;
      }

      if ((options?.promptOnFailure ?? true) && pendingStandaloneActionRef.current !== "delete") {
        setPendingStandaloneAction("terminal");
        setShowPasswordPrompt(true);
      }
      return null;
    } catch (error) {
      setStandaloneCredentialToken(null);
      setSocketStatus("closed");
      showErrorToast(`Failed to refresh the stored SSH credential: ${String(error)}`);
      if ((options?.promptOnFailure ?? true) && pendingStandaloneActionRef.current !== "delete") {
        setPendingStandaloneAction("terminal");
        setShowPasswordPrompt(true);
      }
      return null;
    }
  }, [showErrorToast, standaloneServerId]);

  const connectTerminal = useCallback(async (
    options?: { refreshStandaloneCredential?: boolean; standaloneCredentialToken?: string },
  ) => {
    if (!terminalUrl) {
      return;
    }
    if (terminalConnectInFlightRef.current) {
      return;
    }
    terminalConnectInFlightRef.current = true;
    try {
      let standaloneAuthToken = options?.standaloneCredentialToken ?? null;
      if (sessionKind === "standalone") {
        if (!standaloneAuthToken) {
          standaloneAuthToken = await loadStandaloneCredentialToken({
            forceRefresh: options?.refreshStandaloneCredential ?? false,
          });
        }
        if (!standaloneAuthToken) {
          return;
        }
      }
      terminalSocketRef.current?.close();
      terminalReadyRef.current = false;
      pendingOutputRef.current = [];
      pendingOscColorQueryRef.current = "";
      lastSentResizeRef.current = null;
      clearSelectedTerminalText();
      setSocketStatus("connecting");

      const ws = new WebSocket(appWebSocketUrl(terminalUrl));
      terminalSocketRef.current = ws;

      ws.onopen = () => {
        if (standaloneAuthToken) {
          ws.send(JSON.stringify({
            type: "terminal.auth",
            credentialToken: standaloneAuthToken,
          }));
        }
      };
      ws.onmessage = (event) => {
        if (terminalSocketRef.current !== ws) {
          return;
        }
        const data = JSON.parse(event.data) as {
          type: string;
          data?: string;
          message?: string;
          text?: string;
        };
        if (data.type === "terminal.connected") {
          markTerminalReady();
        }
        if (data.type === "terminal.clipboard" && typeof data.text === "string") {
          void copyTerminalClipboardText(data.text);
        }
        if (data.type === "terminal.output" && data.data) {
          if (!terminalReadyRef.current) {
            markTerminalReady();
          }
          writeTerminalOutput(data.data);
        }
        if (data.type === "terminal.error" && data.message) {
          terminalRef.current?.writeln(`\r\n${data.message}`);
          if (
            sessionKind === "standalone"
            && isStandaloneCredentialTokenError(data.message)
          ) {
            setStandaloneCredentialToken(null);
            if (standaloneTokenRecoveryAttemptedRef.current) {
              setPendingStandaloneAction("terminal");
              setShowPasswordPrompt(true);
              showErrorToast("Failed to refresh the SSH session automatically. Re-enter the SSH password to continue.");
              return;
            }
            standaloneTokenRecoveryAttemptedRef.current = true;
            terminalReadyRef.current = false;
            lastSentResizeRef.current = null;
            pendingOscColorQueryRef.current = "";
            setSocketStatus("closed");
            if (terminalSocketRef.current === ws) {
              terminalSocketRef.current = null;
            }
            ws.close();
            void connectTerminal({ refreshStandaloneCredential: true });
            return;
          }
          showErrorToast(data.message);
        }
        if (data.type === "terminal.closed") {
          terminalReadyRef.current = false;
          lastSentResizeRef.current = null;
          pendingOscColorQueryRef.current = "";
          clearSelectedTerminalText();
          setSocketStatus("closed");
        }
      };
      ws.onclose = () => {
        if (terminalSocketRef.current !== ws) {
          return;
        }
        terminalSocketRef.current = null;
        terminalReadyRef.current = false;
        lastSentResizeRef.current = null;
        pendingOscColorQueryRef.current = "";
        clearSelectedTerminalText();
        setSocketStatus("closed");
      };
      ws.onerror = () => {
        if (terminalSocketRef.current !== ws) {
          return;
        }
        terminalReadyRef.current = false;
        lastSentResizeRef.current = null;
        pendingOscColorQueryRef.current = "";
        clearSelectedTerminalText();
        setSocketStatus("closed");
      };
    } finally {
      terminalConnectInFlightRef.current = false;
    }
  }, [
      copyTerminalClipboardText,
      loadStandaloneCredentialToken,
      markTerminalReady,
      sessionKind,
      terminalUrl,
      clearSelectedTerminalText,
      showErrorToast,
      writeTerminalOutput,
    ]);

  const recoverTerminalOnForeground = useCallback(() => {
    if (!terminalUrl) {
      return;
    }
    if (typeof document !== "undefined" && document.visibilityState === "hidden") {
      return;
    }
    const readyState = terminalSocketRef.current?.readyState;
    if (readyState === WebSocket.OPEN || readyState === WebSocket.CONNECTING) {
      return;
    }
    void connectTerminal({ refreshStandaloneCredential: sessionKind === "standalone" });
  }, [connectTerminal, sessionKind, terminalUrl]);

  useEffect(() => {
    let disposed = false;
    let terminal: Terminal | null = null;
    let fitAddon: FitAddon | null = null;
    let dataDisposable: { dispose(): void } | null = null;
    let resizeDisposable: { dispose(): void } | null = null;
    let selectionDisposable: { dispose(): void } | null = null;
    let removeMouseHandlers: (() => void) | null = null;

    async function setupTerminal() {
      if (!terminalContainerRef.current || terminalRef.current) {
        return;
      }

      try {
        await initializeGhosttyWeb();
        if (disposed || !terminalContainerRef.current || terminalRef.current) {
          return;
        }
        const terminalFontFamily = await resolveTerminalFontFamily();
        if (disposed || !terminalContainerRef.current || terminalRef.current) {
          return;
        }

        terminal = new Terminal({
          fontSize: TERMINAL_FONT_SIZE_PX,
          fontFamily: terminalFontFamily,
          theme: TERMINAL_THEME,
        });
        fitAddon = new FitAddon();
        terminal.loadAddon(fitAddon);
        terminal.open(terminalContainerRef.current);
        fitAddon.observeResize();
        terminal.focus();
        terminalRef.current = terminal;
        fitAddonRef.current = fitAddon;
        syncTerminalSelectionState();
        flushPendingOutput();

        dataDisposable = terminal.onData((data: string) => {
          void sendTerminalKeystroke(data);
        });
        resizeDisposable = terminal.onResize(({ cols, rows }) => {
          sendTerminalResize(cols, rows);
        });
        selectionDisposable = terminal.onSelectionChange(() => {
          syncTerminalSelectionState();
        });
        terminal.attachCustomKeyEventHandler((event: KeyboardEvent) => {
          if (event.key !== "Tab" || !event.shiftKey || event.ctrlKey || event.altKey || event.metaKey) {
            return false;
          }

          void sendTerminalInput("\u001b[Z", { notifyOnFailure: false });
          return true;
        });
        removeMouseHandlers = installTerminalMouseHandlers({
          terminal,
          container: terminalContainerRef.current,
          sendInput: (data: string) => sendTerminalInput(data, { notifyOnFailure: false }),
        });

        syncTerminalSize({ fit: true });
        if (typeof window !== "undefined" && typeof window.requestAnimationFrame === "function") {
          window.requestAnimationFrame(() => {
            window.requestAnimationFrame(() => {
              if (!disposed && terminalRef.current === terminal) {
                syncTerminalSize({ fit: true });
              }
            });
          });
        }
        if (terminalReadyRef.current) {
          syncTerminalSize();
        }
        void remeasureTerminalFont(terminal, fitAddon);
      } catch (error) {
        if (!disposed) {
          showErrorToast(`Failed to initialize the terminal renderer: ${String(error)}`);
        }
      }
    }

    void setupTerminal();

    return () => {
      disposed = true;
      removeMouseHandlers?.();
      dataDisposable?.dispose();
      resizeDisposable?.dispose();
      selectionDisposable?.dispose();
      setHasSelectedTerminalText(false);
      terminal?.dispose();
      terminalRef.current = null;
      fitAddonRef.current = null;
    };
  }, [
      flushPendingOutput,
      sendTerminalInput,
      sendTerminalKeystroke,
      sendTerminalResize,
      session?.config.id,
      syncTerminalSelectionState,
      showErrorToast,
      syncTerminalSize,
    ]);

  useEffect(() => {
    if (!terminalUrl) {
      return;
    }
    void connectTerminal();
    return () => {
      terminalReadyRef.current = false;
      terminalSocketRef.current?.close();
      terminalSocketRef.current = null;
      clearSelectedTerminalText();
    };
  }, [clearSelectedTerminalText, connectTerminal, terminalUrl]);

  useEffect(() => {
    if (!terminalUrl || typeof window === "undefined" || typeof document === "undefined") {
      return;
    }

    const handleWindowFocus = () => {
      recoverTerminalOnForeground();
    };
    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        recoverTerminalOnForeground();
      }
    };

    window.addEventListener("focus", handleWindowFocus);
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      window.removeEventListener("focus", handleWindowFocus);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [recoverTerminalOnForeground, terminalUrl]);

  useEffect(() => {
    let cancelled = false;

    async function loadStandaloneServer() {
      if (!standaloneServerId) {
        setStandaloneServer(null);
        return;
      }

      try {
        const server = await getSshServerApi(standaloneServerId);
        if (!cancelled) {
          setStandaloneServer(server);
        }
      } catch (error) {
        if (!cancelled) {
          setStandaloneServer(null);
          showErrorToast(`Failed to load SSH server details: ${String(error)}`);
        }
      }
    }

    void loadStandaloneServer();

    return () => {
      cancelled = true;
    };
  }, [showErrorToast, standaloneServerId]);

  useEffect(() => {
    if (sessionKind !== "standalone") {
      setStandaloneCredentialToken(null);
      setShowPasswordPrompt(false);
      setPendingStandaloneAction(null);
    }
  }, [sessionKind]);

  async function handleDelete() {
    const success = await deleteSession();
    if (!success) {
      if (session && isStandaloneSession(session) && isPersistentSshSession(session)) {
        setPendingStandaloneAction("delete");
        setShowPasswordPrompt(true);
      }
      return;
    }
    setShowDeleteConfirm(false);
    onBack();
  }

  async function handleStandalonePasswordSubmit() {
    if (!session || !isStandaloneSession(session)) {
      return;
    }

    const trimmedPassword = standalonePassword.trim();
    if (!trimmedPassword) {
      showErrorToast("Enter the SSH password for this server.");
      return;
    }

    try {
      await storeSshServerPassword(session.config.sshServerId, trimmedPassword);

      if (pendingStandaloneAction === "delete") {
        const success = await deleteSession({ password: trimmedPassword });
        if (success) {
          setStandalonePassword("");
          setShowPasswordPrompt(false);
          setPendingStandaloneAction(null);
          setShowDeleteConfirm(false);
          onBack();
        }
        return;
      }

      const token = await getStoredSshCredentialToken(session.config.sshServerId);
      if (!token) {
        showErrorToast("Failed to retrieve a valid SSH credential token.");
        return;
      }

      setStandalonePassword("");
      setStandaloneCredentialToken(token);
      setShowPasswordPrompt(false);
      setPendingStandaloneAction(null);
      void connectTerminal({ standaloneCredentialToken: token });
    } catch (error) {
      showErrorToast(String(error));
    }
  }

  async function handleRename(newName: string) {
    await updateSession({ name: newName });
    toast.success("SSH session renamed");
  }

  if (loading && !session) {
    return <div className="p-6 text-gray-500 dark:text-gray-400">Loading SSH session...</div>;
  }

  if (!session) {
    return (
      <div className="p-6">
        <Button variant="ghost" onClick={onBack}>← Back</Button>
        <p className="mt-4 text-red-600 dark:text-red-400">{error || "SSH session not found."}</p>
      </div>
    );
  }

  return (
    <div className="h-full min-h-0 flex flex-col bg-gray-50 dark:bg-gray-900">
      <div className="border-b border-gray-200 bg-white px-3 py-2 dark:border-gray-800 dark:bg-gray-800">
        <div className="flex flex-wrap items-center justify-between gap-1.5">
          <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5">
            <Button variant="ghost" size="xs" onClick={onBack}>← Back</Button>
            <h1 className="min-w-0 truncate text-base font-semibold text-gray-900 dark:text-gray-100">
              {session.config.name}
            </h1>
            <Badge variant={effectiveConnectionMode === "direct" ? "info" : "default"}>
              {getSshConnectionModeLabel(effectiveConnectionMode ?? session.config.connectionMode)}
            </Badge>
            <Badge variant={getStatusVariant(session.state.status)}>
              {session.state.status}
            </Badge>
            {session.state.notice && (
              <Badge variant="warning">
                fallback
              </Badge>
            )}
            <Badge variant={socketStatus === "open" ? "success" : socketStatus === "connecting" ? "info" : "warning"}>
              {socketStatus}
            </Badge>
          </div>
          <div className="flex items-center gap-1.5">
            {canRenameSession && (
              <Button
                variant="ghost"
                size="xs"
                onClick={() => setShowRenameModal(true)}
                aria-label="Rename SSH session"
                title="Rename SSH session"
              >
                <span className="flex items-center gap-1">
                  <EditIcon size="h-3.5 w-3.5" />
                  Rename
                </span>
              </Button>
            )}
            <Button variant="danger" size="xs" onClick={() => setShowDeleteConfirm(true)}>
              Delete Session
            </Button>
          </div>
        </div>
      </div>

      <div className="flex-1 min-h-0 flex flex-col gap-2 overflow-hidden p-2 sm:p-3">
        <CompactBar
          title="Session Info"
          expanded={sessionInfoExpanded}
          onToggle={() => setSessionInfoExpanded((current) => !current)}
          summary={sessionInfoSummary}
        >
          <dl className="grid gap-3 text-sm sm:grid-cols-2">
            <div className="min-w-0">
              <dt className="text-gray-500 dark:text-gray-400">Mode</dt>
              <dd className="text-gray-900 dark:text-gray-100">
                {getSshConnectionModeLabel(effectiveConnectionMode ?? session.config.connectionMode)}
              </dd>
            </div>
            <div className="min-w-0">
              <dt className="text-gray-500 dark:text-gray-400">
                {isStandaloneSession(session) ? "Server" : "Workspace ID"}
              </dt>
              <dd className={isStandaloneSession(session) ? "break-words text-gray-900 dark:text-gray-100" : "break-all font-mono text-gray-900 dark:text-gray-100"}>
                {isStandaloneSession(session) ? standaloneServerName : session.config.workspaceId}
              </dd>
            </div>
            <div className="min-w-0">
              <dt className="text-gray-500 dark:text-gray-400">
                {isStandaloneSession(session) ? "Address" : "Directory"}
              </dt>
              <dd className="break-all font-mono text-gray-900 dark:text-gray-100">
                {isStandaloneSession(session) ? standaloneServerTarget : session.config.directory}
              </dd>
            </div>
            {hasPersistentSession ? (
              <div className="min-w-0">
                <dt className="text-gray-500 dark:text-gray-400">Persistent session ID</dt>
                <dd className="break-all font-mono text-gray-900 dark:text-gray-100">{session.config.remoteSessionName}</dd>
              </div>
            ) : (
              <div className="min-w-0">
                <dt className="text-gray-500 dark:text-gray-400">Reconnect behavior</dt>
                <dd className="text-gray-900 dark:text-gray-100">Opens a fresh shell each time</dd>
              </div>
            )}
            <div className="min-w-0">
              <dt className="text-gray-500 dark:text-gray-400">Last connected</dt>
              <dd className="text-gray-900 dark:text-gray-100">{session.state.lastConnectedAt ?? "Never"}</dd>
            </div>
            {session.state.notice && (
              <div className="min-w-0 sm:col-span-2">
                <dt className="text-gray-500 dark:text-gray-400">Notice</dt>
                <dd className="break-words text-amber-700 dark:text-amber-300">{session.state.notice}</dd>
              </div>
            )}
            {session.state.error && (
              <div className="min-w-0 sm:col-span-2">
                <dt className="text-gray-500 dark:text-gray-400">Last error</dt>
                <dd className="break-words text-red-600 dark:text-red-400">{session.state.error}</dd>
              </div>
            )}
          </dl>
        </CompactBar>

        <CompactBar
          title="Touch controls"
          expanded={touchControlsExpanded}
          onToggle={() => setTouchControlsExpanded((current) => !current)}
          summary={touchControlsSummary}
        >
          <div className="flex flex-col gap-2">
            <div className="px-1 pb-1" data-testid="ssh-touch-controls-layout">
              <div className="flex flex-wrap items-center gap-1" data-testid="ssh-touch-controls-buttons">
                <Button
                  variant={terminalModifiers.ctrl ? "primary" : "secondary"}
                  size="xs"
                  className={touchButtonClassName}
                  aria-pressed={terminalModifiers.ctrl}
                  onClick={() => toggleTerminalModifier("ctrl")}
                >
                  Ctrl
                </Button>
                <Button
                  variant={terminalModifiers.alt ? "primary" : "secondary"}
                  size="xs"
                  className={touchButtonClassName}
                  aria-pressed={terminalModifiers.alt}
                  onClick={() => toggleTerminalModifier("alt")}
                >
                  Alt
                </Button>
                <Button
                  variant={terminalModifiers.shift ? "primary" : "secondary"}
                  size="xs"
                  className={touchButtonClassName}
                  aria-pressed={terminalModifiers.shift}
                  onClick={() => toggleTerminalModifier("shift")}
                >
                  Shift
                </Button>
                {hasActiveTerminalModifiers(terminalModifiers) && (
                  <Button
                    variant="ghost"
                    size="xs"
                    className={touchButtonClassName}
                    onClick={resetTerminalModifiers}
                  >
                    Clear
                  </Button>
                )}
                <span className="mx-0.5 h-4 w-px shrink-0 bg-gray-200 dark:bg-gray-700" aria-hidden="true" />
                <Button
                  variant="secondary"
                  size="xs"
                  className={touchButtonClassName}
                  onClick={() => sendEncodedTerminalKey("Escape")}
                >
                  Esc
                </Button>
                <Button
                  variant="secondary"
                  size="xs"
                  className={touchButtonClassName}
                  onClick={() => sendEncodedTerminalKey("Tab")}
                >
                  Tab
                </Button>
                <Button
                  variant="secondary"
                  size="xs"
                  className={touchButtonClassName}
                  onClick={() => sendEncodedTerminalKey("Enter")}
                >
                  Enter
                </Button>
                <Button
                  variant="secondary"
                  size="xs"
                  className={touchButtonClassName}
                  aria-label="Backspace"
                  onClick={() => sendEncodedTerminalKey("Backspace")}
                >
                  Bksp
                </Button>
                <Button
                  variant="secondary"
                  size="xs"
                  className={touchButtonClassName}
                  onClick={() => sendEncodedTerminalKey("Space")}
                >
                  Space
                </Button>
                <Button
                  variant="secondary"
                  size="xs"
                  className={touchButtonClassName}
                  onClick={sendCtrlC}
                >
                  Ctrl+C
                </Button>
                <Button
                  variant="secondary"
                  size="xs"
                  className={touchButtonClassName}
                  onClick={() => sendEncodedTerminalKey("ArrowUp")}
                >
                  ↑
                </Button>
                <Button
                  variant="secondary"
                  size="xs"
                  className={touchButtonClassName}
                  onClick={() => sendEncodedTerminalKey("ArrowLeft")}
                >
                  ←
                </Button>
                <Button
                  variant="secondary"
                  size="xs"
                  className={touchButtonClassName}
                  onClick={() => sendEncodedTerminalKey("ArrowDown")}
                >
                  ↓
                </Button>
                <Button
                  variant="secondary"
                  size="xs"
                  className={touchButtonClassName}
                  onClick={() => sendEncodedTerminalKey("ArrowRight")}
                >
                  →
                </Button>
                <span className="mx-0.5 h-4 w-px shrink-0 bg-gray-200 dark:bg-gray-700" aria-hidden="true" />
                <Button
                  variant="secondary"
                  size="xs"
                  className={touchButtonClassName}
                  disabled={!hasSelectedTerminalText}
                  onClick={copySelectedTerminalText}
                >
                  Copy selection
                </Button>
                <span className="mx-0.5 h-4 w-px shrink-0 bg-gray-200 dark:bg-gray-700" aria-hidden="true" />
                <Button
                  variant="secondary"
                  size="xs"
                  className={touchButtonClassName}
                  onClick={() => sendTerminalTextShortcut("sudo apt update && sudo apt install neovim")}
                >
                  Install Neovim
                </Button>
                <Button
                  variant="secondary"
                  size="xs"
                  className={touchButtonClassName}
                  onClick={() => sendTerminalTextShortcut("nvim\n")}
                >
                  Neovim
                </Button>
                <Button
                  variant="secondary"
                  size="xs"
                  className={touchButtonClassName}
                  onClick={() => sendTerminalTextShortcut(":Ntree\n")}
                >
                  Ntree
                </Button>
                <Button
                  variant="secondary"
                  size="xs"
                  className={touchButtonClassName}
                  onClick={() => sendTerminalTextShortcut(":q\n")}
                >
                  :q
                </Button>
                <span className="mx-0.5 h-4 w-px shrink-0 bg-gray-200 dark:bg-gray-700" aria-hidden="true" />
                <Button
                  variant="secondary"
                  size="xs"
                  className={touchButtonClassName}
                  onClick={() => sendTerminalTextShortcut("curl https://raw.githubusercontent.com/sinelaw/fresh/refs/heads/master/scripts/install.sh | sh")}
                >
                  Install fresh
                </Button>
                <Button
                  variant="secondary"
                  size="xs"
                  className={touchButtonClassName}
                  onClick={() => sendTerminalTextShortcut("fresh\n")}
                >
                  Fresh
                </Button>
              </div>
            </div>

          </div>
        </CompactBar>

        {pendingTerminalClipboardText !== null && (
          <Card
            data-testid="ssh-terminal-clipboard-fallback"
            className="border-amber-300 bg-amber-50 dark:border-amber-700 dark:bg-amber-950/40"
            bodyClassName="flex flex-col gap-2"
          >
            <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
              <div className="min-w-0">
                <p className="text-sm font-medium text-amber-900 dark:text-amber-200">
                  Browser blocked automatic clipboard access.
                </p>
                <p className="text-xs text-amber-800 dark:text-amber-300">
                  Click <span className="font-semibold">Copy now</span> or copy the pending text manually below.
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <Button variant="primary" size="xs" onClick={retryPendingTerminalClipboardCopy}>
                  Copy now
                </Button>
                <Button variant="ghost" size="xs" onClick={() => setPendingTerminalClipboardText(null)}>
                  Dismiss
                </Button>
              </div>
            </div>
            <textarea
              aria-label="Pending terminal clipboard text"
              readOnly
              value={pendingTerminalClipboardText}
              onFocus={(event) => event.currentTarget.select()}
              onClick={(event) => event.currentTarget.select()}
              className="min-h-24 w-full rounded-md border border-amber-200 bg-white/90 p-2 font-mono text-xs text-gray-900 shadow-sm outline-none focus:border-amber-400 dark:border-amber-800 dark:bg-gray-900 dark:text-gray-100"
            />
          </Card>
        )}

        <Card
          padding={false}
          className="min-h-0 flex flex-1 flex-col overflow-visible rounded-sm bg-[#1e1e1e] dark:bg-[#1e1e1e]"
          bodyClassName="min-h-0 flex flex-1 flex-col bg-[#1e1e1e] dark:bg-[#1e1e1e]"
        >
          <div
            ref={terminalContainerRef}
            className="relative box-border min-h-0 h-full flex-1 bg-[#1e1e1e] w-full"
            style={{
              padding: `${TERMINAL_PADDING_TOP_PX}px ${TERMINAL_PADDING_X_PX}px ${TERMINAL_PADDING_BOTTOM_PX}px`,
            }}
          />
        </Card>
      </div>

      <ConfirmModal
        isOpen={showDeleteConfirm}
        onClose={() => setShowDeleteConfirm(false)}
        onConfirm={() => void handleDelete()}
        title="Delete SSH session?"
        message={hasPersistentSession
          ? "This removes the Ralpher session metadata and attempts to stop the remote persistent session."
          : "This removes the saved Ralpher session metadata. Direct SSH mode does not keep a remote persistent session."}
        confirmLabel="Delete"
        loading={false}
      />
      <RenameSshSessionModal
        isOpen={showRenameModal}
        onClose={() => setShowRenameModal(false)}
        currentName={sessionKind === "workspace" ? session.config.name : ""}
        onRename={handleRename}
      />
      <Modal
        isOpen={showPasswordPrompt}
        onClose={() => {
          setShowPasswordPrompt(false);
          setPendingStandaloneAction(null);
        }}
        title="SSH password required"
        description={hasPersistentSession
          ? "Standalone persistent SSH sessions need the password from this browser before they can connect or be deleted."
          : "Standalone direct SSH sessions need the password from this browser before they can connect."}
        size="sm"
        footer={(
          <>
            <Button
              variant="ghost"
              onClick={() => {
                setShowPasswordPrompt(false);
                setPendingStandaloneAction(null);
              }}
            >
              Cancel
            </Button>
            <Button onClick={() => void handleStandalonePasswordSubmit()}>
              Continue
            </Button>
          </>
        )}
      >
        <div className="space-y-3">
          <p className="text-sm text-gray-600 dark:text-gray-300">
            {pendingStandaloneAction === "delete"
              ? hasPersistentSession
                ? "Enter the SSH password to delete the remote persistent session and local metadata."
                : "Enter the SSH password to delete the standalone session metadata."
              : "Enter the SSH password to open the standalone terminal session."}
          </p>
          <div>
            <label
              htmlFor="standalone-session-password"
              className="block text-sm font-medium text-gray-700 dark:text-gray-300"
            >
              SSH password
            </label>
            <input
              id="standalone-session-password"
              type="password"
              value={standalonePassword}
              onChange={(event) => setStandalonePassword(event.target.value)}
              className="mt-1 block w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100"
              {...PASSWORD_INPUT_PROPS}
            />
          </div>
        </div>
      </Modal>
    </div>
  );
}
