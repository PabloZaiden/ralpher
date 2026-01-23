/**
 * Button component with various variants and sizes.
 */

import type { ButtonHTMLAttributes, ReactNode } from "react";

export type ButtonVariant = "primary" | "secondary" | "danger" | "ghost";
export type ButtonSize = "sm" | "md" | "lg";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** Visual variant */
  variant?: ButtonVariant;
  /** Size variant */
  size?: ButtonSize;
  /** Whether the button is loading */
  loading?: boolean;
  /** Icon to display before the label */
  icon?: ReactNode;
  /** Children (label) */
  children: ReactNode;
}

const variantClasses: Record<ButtonVariant, string> = {
  primary:
    "bg-blue-600 text-white hover:bg-blue-700 focus:ring-blue-500 disabled:bg-gray-300 disabled:text-gray-600",
  secondary:
    "bg-gray-200 text-gray-900 hover:bg-gray-300 focus:ring-gray-500 disabled:bg-gray-100 disabled:text-gray-400 dark:bg-gray-700 dark:text-gray-100 dark:hover:bg-gray-600 dark:disabled:bg-gray-800 dark:disabled:text-gray-500",
  danger:
    "bg-red-600 text-white hover:bg-red-700 focus:ring-red-500 disabled:bg-gray-300 disabled:text-gray-600",
  ghost:
    "bg-transparent text-gray-700 hover:bg-gray-100 focus:ring-gray-500 disabled:bg-gray-100 disabled:text-gray-400 dark:text-gray-300 dark:hover:bg-gray-800 dark:disabled:bg-gray-800 dark:disabled:text-gray-500",
};

const sizeClasses: Record<ButtonSize, string> = {
  sm: "px-2 py-1 text-sm",
  md: "px-4 py-2 text-base",
  lg: "px-6 py-3 text-lg",
};

export function Button({
  variant = "primary",
  size = "md",
  loading = false,
  icon,
  children,
  className = "",
  disabled,
  ...props
}: ButtonProps) {
  return (
    <button
      className={`inline-flex items-center justify-center gap-2 rounded-md font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-offset-2 disabled:cursor-not-allowed ${variantClasses[variant]} ${sizeClasses[size]} ${className}`}
      disabled={disabled || loading}
      {...props}
    >
      {loading ? (
        <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
      ) : icon ? (
        <span className="inline-flex">{icon}</span>
      ) : null}
      {children}
    </button>
  );
}

export default Button;
