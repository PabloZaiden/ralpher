/**
 * Reusable collapsible section component for the dashboard.
 * Follows the same pattern as the collapsible sections in LoopDetails.tsx.
 */

import { useState } from "react";
import type { ReactNode } from "react";

export interface CollapsibleSectionProps {
  /** Section title displayed in the header */
  title: string;
  /** Number of items in the section, displayed in parentheses */
  count: number;
  /** Whether the section should be collapsed by default */
  defaultCollapsed?: boolean;
  /** Section content (rendered when expanded) */
  children: ReactNode;
}

export function CollapsibleSection({
  title,
  count,
  defaultCollapsed = false,
  children,
}: CollapsibleSectionProps) {
  const [collapsed, setCollapsed] = useState(defaultCollapsed);

  const sectionId = `section-${title.toLowerCase().replace(/\s+/g, "-")}`;

  return (
    <section>
      <button
        onClick={() => setCollapsed(!collapsed)}
        className="text-md font-semibold text-gray-700 dark:text-gray-300 mb-3 flex items-center gap-2 hover:text-gray-900 dark:hover:text-gray-100 transition-colors text-left cursor-pointer"
        aria-expanded={!collapsed}
        aria-controls={sectionId}
      >
        <span className="text-xs">{collapsed ? "\u25B6" : "\u25BC"}</span>
        <span>{title} ({count})</span>
      </button>
      {!collapsed && (
        <div id={sectionId}>
          {children}
        </div>
      )}
    </section>
  );
}
