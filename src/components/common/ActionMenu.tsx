/**
 * ActionMenu component — a dropdown menu triggered by a button.
 * Used to collapse multiple actions behind a single toggle on mobile.
 */

import { useCallback, useEffect, useRef, useState } from "react";

export interface ActionMenuItem {
  /** Display label for the menu item */
  label: string;
  /** Callback when the item is clicked */
  onClick: () => void;
}

export interface ActionMenuProps {
  /** List of menu items to display */
  items: ActionMenuItem[];
  /** Accessible label for the trigger button */
  ariaLabel?: string;
}

export function ActionMenu({ items, ariaLabel = "Actions" }: ActionMenuProps) {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const close = useCallback(() => setIsOpen(false), []);

  // Close on Escape key and click outside
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        close();
      }
    };

    const handleMouseDown = (e: MouseEvent) => {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node)
      ) {
        close();
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    document.addEventListener("mousedown", handleMouseDown);

    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.removeEventListener("mousedown", handleMouseDown);
    };
  }, [isOpen, close]);

  const handleItemClick = (item: ActionMenuItem) => {
    close();
    item.onClick();
  };

  return (
    <div ref={containerRef} className="relative">
      {/* Trigger button */}
      <button
        type="button"
        onClick={() => setIsOpen((prev) => !prev)}
        className="flex items-center justify-center min-w-[44px] min-h-[44px] rounded-md bg-blue-600 text-white hover:bg-blue-700 transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
        aria-label={ariaLabel}
        aria-expanded={isOpen}
        aria-haspopup="true"
      >
        <PlusIcon />
      </button>

      {/* Dropdown menu */}
      {isOpen && (
        <div
          className="absolute right-0 top-full mt-1 z-50 min-w-[160px] rounded-md bg-white shadow-lg ring-1 ring-black/5 dark:bg-gray-800 dark:ring-gray-700"
          role="menu"
          aria-orientation="vertical"
        >
          <div className="py-1">
            {items.map((item) => (
              <button
                key={item.label}
                type="button"
                role="menuitem"
                onClick={() => handleItemClick(item)}
                className="flex w-full items-center px-4 py-3 text-sm text-gray-700 hover:bg-gray-100 dark:text-gray-200 dark:hover:bg-gray-700 transition-colors"
              >
                {item.label}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Plus icon for the action menu trigger.
 */
function PlusIcon() {
  return (
    <svg
      className="w-5 h-5"
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={2}
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M12 4.5v15m7.5-7.5h-15"
      />
    </svg>
  );
}

export default ActionMenu;
