/**
 * Shared preference types for Ralph Loops Management System.
 *
 * Types in this module are shared between the frontend (hooks)
 * and backend (persistence layer). They are the single source
 * of truth for preference value shapes.
 *
 * @module types/preferences
 */

/**
 * Dashboard view mode: either a list of rows or a grid of cards.
 */
export type DashboardViewMode = "rows" | "cards";
