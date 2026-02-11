/**
 * Reusable SVG icon components.
 */

export interface IconProps {
  /** CSS class name */
  className?: string;
  /** Icon size in Tailwind format (e.g., "h-4 w-4") */
  size?: string;
}

/**
 * Edit/Pencil icon for rename and edit actions.
 */
export function EditIcon({ className = "", size = "h-4 w-4" }: IconProps) {
  return (
    <svg
      className={`${size} ${className}`.trim()}
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={2}
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z"
      />
    </svg>
  );
}

/**
 * Grid icon for card view mode toggle.
 */
export function GridIcon({ className = "", size = "h-4 w-4" }: IconProps) {
  return (
    <svg
      className={`${size} ${className}`.trim()}
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={2}
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M4 5a1 1 0 011-1h4a1 1 0 011 1v4a1 1 0 01-1 1H5a1 1 0 01-1-1V5zM14 5a1 1 0 011-1h4a1 1 0 011 1v4a1 1 0 01-1 1h-4a1 1 0 01-1-1V5zM4 15a1 1 0 011-1h4a1 1 0 011 1v4a1 1 0 01-1 1H5a1 1 0 01-1-1v-4zM14 15a1 1 0 011-1h4a1 1 0 011 1v4a1 1 0 01-1 1h-4a1 1 0 01-1-1v-4z"
      />
    </svg>
  );
}

/**
 * List icon for row view mode toggle.
 */
export function ListIcon({ className = "", size = "h-4 w-4" }: IconProps) {
  return (
    <svg
      className={`${size} ${className}`.trim()}
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={2}
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M4 6h16M4 12h16M4 18h16"
      />
    </svg>
  );
}
