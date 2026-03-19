import { useMemo, useState } from "react";
import { Badge, Button } from "../common";
import {
  hasActiveTerminalModifiers,
  type TerminalModifierState,
  type TerminalSpecialKey,
} from "../../utils/terminal-keys";
import { CompactBar } from "./compact-bar";

const touchButtonClassName = "min-h-[28px] shrink-0 whitespace-nowrap px-1.5 py-0.5 text-[11px]";

export interface TouchControlsSectionProps {
  terminalModifiers: TerminalModifierState;
  hasSelectedTerminalText: boolean;
  toggleTerminalModifier: (modifier: keyof TerminalModifierState) => void;
  resetTerminalModifiers: () => void;
  copySelectedTerminalText: () => void;
  sendEncodedTerminalKey: (key: TerminalSpecialKey | string) => void;
  sendCtrlC: () => void;
  sendTerminalTextShortcut: (data: string) => void;
}

export function TouchControlsSection({
  terminalModifiers,
  hasSelectedTerminalText,
  toggleTerminalModifier,
  resetTerminalModifiers,
  copySelectedTerminalText,
  sendEncodedTerminalKey,
  sendCtrlC,
  sendTerminalTextShortcut,
}: TouchControlsSectionProps) {
  const [expanded, setExpanded] = useState(false);

  const activeModifierLabel = useMemo(() => {
    return [
      terminalModifiers.ctrl ? "Ctrl" : null,
      terminalModifiers.alt ? "Alt" : null,
      terminalModifiers.shift ? "Shift" : null,
    ].filter(Boolean).join(" + ");
  }, [terminalModifiers]);

  const summary = useMemo(() => (
    <div className="flex min-w-0 flex-wrap items-center justify-end gap-2">
      {hasActiveTerminalModifiers(terminalModifiers) ? (
        <Badge variant="info" className="shrink-0">
          Next: {activeModifierLabel}
        </Badge>
      ) : (
        <Badge variant="default" className="shrink-0">
          Modifiers off
        </Badge>
      )}
      <span className="hidden min-w-0 break-words text-xs text-gray-500 dark:text-gray-400 [overflow-wrap:anywhere] sm:block">
        Touch keys
      </span>
    </div>
  ), [activeModifierLabel, terminalModifiers]);

  return (
    <CompactBar
      title="Touch controls"
      expanded={expanded}
      onToggle={() => setExpanded((current) => !current)}
      summary={summary}
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
            <span className="mx-0.5 h-4 w-px shrink-0 bg-gray-200 dark:bg-neutral-700" aria-hidden="true" />
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
            <span className="mx-0.5 h-4 w-px shrink-0 bg-gray-200 dark:bg-neutral-700" aria-hidden="true" />
            <Button
              variant="secondary"
              size="xs"
              className={touchButtonClassName}
              disabled={!hasSelectedTerminalText}
              onClick={copySelectedTerminalText}
            >
              Copy selection
            </Button>
            <span className="mx-0.5 h-4 w-px shrink-0 bg-gray-200 dark:bg-neutral-700" aria-hidden="true" />
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
            <span className="mx-0.5 h-4 w-px shrink-0 bg-gray-200 dark:bg-neutral-700" aria-hidden="true" />
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
  );
}
