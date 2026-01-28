/**
 * TodoViewer component for displaying TODOs from agent sessions.
 */

import { useEffect, useRef } from "react";
import type { TodoItem } from "../backends/types";
import { Badge } from "./common";

export interface TodoViewerProps {
  /** TODOs to display */
  todos: TodoItem[];
  /** Whether to auto-scroll to bottom */
  autoScroll?: boolean;
  /** Maximum height */
  maxHeight?: string;
  /** ID for the root element (for accessibility) */
  id?: string;
}

/**
 * Get the badge variant for a TODO status.
 */
function getStatusBadge(status: TodoItem["status"]): "default" | "info" | "success" | "warning" {
  switch (status) {
    case "pending":
      return "default";
    case "in_progress":
      return "info";
    case "completed":
      return "success";
    case "cancelled":
      return "default";
    default:
      return "default";
  }
}

/**
 * Get the icon for a TODO status.
 */
function getStatusIcon(status: TodoItem["status"]): string {
  switch (status) {
    case "pending":
      return "○";
    case "in_progress":
      return "⟳";
    case "completed":
      return "✓";
    case "cancelled":
      return "✗";
    default:
      return "○";
  }
}

/**
 * Get the color for a TODO status icon.
 */
function getStatusColor(status: TodoItem["status"]): string {
  switch (status) {
    case "pending":
      return "text-gray-500";
    case "in_progress":
      return "text-blue-500";
    case "completed":
      return "text-green-500";
    case "cancelled":
      return "text-gray-500";
    default:
      return "text-gray-500";
  }
}

/**
 * Get the border color for a TODO status.
 */
function getStatusBorderColor(status: TodoItem["status"]): string {
  switch (status) {
    case "pending":
      return "border-l-gray-600";
    case "in_progress":
      return "border-l-blue-500";
    case "completed":
      return "border-l-green-500";
    case "cancelled":
      return "border-l-gray-600";
    default:
      return "border-l-gray-600";
  }
}

/**
 * Get text styling for completed/cancelled items.
 */
function getTextStyle(status: TodoItem["status"]): string {
  if (status === "completed" || status === "cancelled") {
    return "text-gray-500";
  }
  return "text-gray-100";
}

export function TodoViewer({
  todos,
  autoScroll = true,
  maxHeight,
  id,
}: TodoViewerProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom when content changes
  useEffect(() => {
    if (autoScroll && containerRef.current) {
      // Use requestAnimationFrame to ensure DOM has updated
      requestAnimationFrame(() => {
        if (containerRef.current) {
          containerRef.current.scrollTop = containerRef.current.scrollHeight;
        }
      });
    }
  }, [todos, autoScroll]);

  const isEmpty = todos.length === 0;

  return (
    <div
      ref={containerRef}
      id={id}
      className={`bg-gray-900 text-gray-100 rounded-lg overflow-auto font-mono text-xs dark-scrollbar ${!maxHeight ? "flex-1 min-h-0" : ""}`}
      style={maxHeight ? { maxHeight } : undefined}
    >
      {isEmpty ? (
        <div className="flex items-center justify-center h-32 text-gray-500 text-xs">
          No TODOs yet.
        </div>
      ) : (
        <div className="p-2 space-y-1.5">
          {todos.map((todo) => (
            <div
              key={todo.id}
              className={`flex items-start gap-2 p-1.5 rounded border-l-2 ${getStatusBorderColor(todo.status)} bg-gray-800/50`}
            >
              {/* Status Icon */}
              <span className={`flex-shrink-0 ${getStatusColor(todo.status)} text-xs`}>
                {getStatusIcon(todo.status)}
              </span>

              {/* Content */}
              <div className="flex-1 min-w-0">
                <div className={`whitespace-pre-wrap break-words text-xs leading-tight ${getTextStyle(todo.status)}`}>
                  {todo.content}
                </div>
                
                {/* Status Badge */}
                <div className="mt-0.5">
                  <Badge variant={getStatusBadge(todo.status)} size="sm">
                    {todo.status.replace("_", " ").toUpperCase()}
                  </Badge>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default TodoViewer;
