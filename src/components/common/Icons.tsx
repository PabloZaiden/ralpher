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
