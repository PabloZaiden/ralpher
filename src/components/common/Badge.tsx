/**
 * Badge component for displaying status or labels.
 */

import type { HTMLAttributes } from "react";

export type BadgeVariant = 
  | "default" 
  | "success" 
  | "warning" 
  | "error" 
  | "info"
  | "idle"
  | "planning"
  | "running"
  | "completed"
  | "stopped"
  | "failed"
  | "merged"
  | "pushed"
  | "deleted";

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  /** Visual variant */
  variant?: BadgeVariant;
  /** Size */
  size?: "sm" | "md";
  /** Badge text */
  children: React.ReactNode;
}

const variantClasses: Record<BadgeVariant, string> = {
  default: "bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-300",
  success: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-300",
  warning: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-300",
  error: "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-300",
  info: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-300",
  // Loop status variants
  idle: "bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-300",
  planning: "bg-cyan-100 text-cyan-800 dark:bg-cyan-900 dark:text-cyan-300",
  running: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-300",
  completed: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-300",
  stopped: "bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-300",
  failed: "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-300",
  // Final states
  merged: "bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-300",
  pushed: "bg-indigo-100 text-indigo-800 dark:bg-indigo-900 dark:text-indigo-300",
  deleted: "bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-500",
};

const sizeClasses = {
  sm: "px-2 py-0.5 text-xs",
  md: "px-2.5 py-1 text-sm",
};

export function Badge({
  variant = "default",
  size = "sm",
  children,
  className = "",
  ...props
}: BadgeProps) {
  return (
    <span
      className={`inline-flex items-center font-medium rounded-full ${variantClasses[variant]} ${sizeClasses[size]} ${className}`}
      {...props}
    >
      {children}
    </span>
  );
}

/**
 * Get the badge variant for a loop status.
 */
export function getStatusBadgeVariant(status: string): BadgeVariant {
  switch (status) {
    case "idle":
      return "idle";
    case "planning":
      return "planning";
    case "starting":
    case "running":
    case "waiting":
    case "resolving_conflicts":
      return "running";
    case "completed":
      return "completed";
    case "stopped":
    case "max_iterations":
      return "stopped";
    case "failed":
      return "failed";
    case "merged":
      return "merged";
    case "pushed":
      return "pushed";
    case "deleted":
      return "deleted";
    default:
      return "default";
  }
}

export default Badge;
