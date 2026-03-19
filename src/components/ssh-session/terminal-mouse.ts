import type { Terminal } from "ghostty-web";
import {
  TERMINAL_MOUSE_ANY_MOTION_MODE,
  TERMINAL_MOUSE_BUTTON_MODE,
  TERMINAL_MOUSE_DRAG_MODE,
  TERMINAL_MOUSE_SGR_MODE,
} from "./terminal-constants";

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

export function installTerminalMouseHandlers(options: {
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
