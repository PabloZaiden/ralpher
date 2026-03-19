/**
 * Mode tab switcher between Manual and Automatic workspace creation.
 */

type WorkspaceMode = "manual" | "automatic";

interface ModeTabsProps {
  mode: WorkspaceMode;
  onChange: (mode: WorkspaceMode) => void;
}

export function ModeTabs({ mode, onChange }: ModeTabsProps) {
  return (
    <div className="flex gap-2">
      <button
        type="button"
        className={`rounded-md px-3 py-2 text-sm font-medium ${
          mode === "manual"
            ? "bg-blue-600 text-white"
            : "bg-gray-100 text-gray-700 dark:bg-neutral-800 dark:text-gray-300"
        }`}
        onClick={() => onChange("manual")}
      >
        Manual
      </button>
      <button
        type="button"
        className={`rounded-md px-3 py-2 text-sm font-medium ${
          mode === "automatic"
            ? "bg-blue-600 text-white"
            : "bg-gray-100 text-gray-700 dark:bg-neutral-800 dark:text-gray-300"
        }`}
        onClick={() => onChange("automatic")}
      >
        Automatic
      </button>
    </div>
  );
}
