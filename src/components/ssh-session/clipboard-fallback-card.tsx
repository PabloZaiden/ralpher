import { Button, Card } from "../common";

export interface ClipboardFallbackCardProps {
  pendingText: string;
  onDismiss: () => void;
  onRetry: () => void;
}

export function ClipboardFallbackCard({ pendingText, onDismiss, onRetry }: ClipboardFallbackCardProps) {
  return (
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
          <Button variant="primary" size="xs" onClick={onRetry}>
            Copy now
          </Button>
          <Button variant="ghost" size="xs" onClick={onDismiss}>
            Dismiss
          </Button>
        </div>
      </div>
      <textarea
        aria-label="Pending terminal clipboard text"
        readOnly
        value={pendingText}
        onFocus={(event) => event.currentTarget.select()}
        onClick={(event) => event.currentTarget.select()}
        className="min-h-24 w-full rounded-md border border-amber-200 bg-white/90 p-2 font-mono text-xs text-gray-900 shadow-sm outline-none focus:border-amber-400 dark:border-amber-800 dark:bg-neutral-900 dark:text-gray-100"
      />
    </Card>
  );
}
