/**
 * Shared component props types for Ralph Loops Management System.
 *
 * Types in this module are shared between multiple UI components
 * (e.g., LoopCard, LoopRow) to avoid coupling one component's
 * implementation to another. They are the single source of truth
 * for shared component prop shapes.
 *
 * @module types/components
 */

import type { Loop } from "./loop";

/**
 * Shared props for loop summary display components (LoopCard, LoopRow).
 * Both components render a loop summary with identical action callbacks.
 */
export interface LoopSummaryProps {
  /** The loop to display */
  loop: Loop;
  /** Callback when the component is clicked */
  onClick?: () => void;
  /** Callback when accept button is clicked (merge) */
  onAccept?: () => void;
  /** Callback when delete button is clicked */
  onDelete?: () => void;
  /** Callback when purge button is clicked */
  onPurge?: () => void;
  /** Callback when address comments button is clicked */
  onAddressComments?: () => void;
  /** Callback when rename button is clicked */
  onRename?: () => void;
}
