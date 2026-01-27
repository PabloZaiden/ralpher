/**
 * LogViewer component for displaying real-time loop logs and messages.
 */

import { useEffect, useRef } from "react";
import type { MessageData, ToolCallData, LogLevel } from "../types";
import { Badge } from "./common";

/**
 * Application log entry for display in the UI.
 */
export interface LogEntry {
  /** Unique ID for the log entry */
  id: string;
  /** Log level */
  level: LogLevel;
  /** Log message */
  message: string;
  /** Optional additional details */
  details?: Record<string, unknown>;
  /** ISO timestamp */
  timestamp: string;
}

export interface LogViewerProps {
  /** Messages to display */
  messages: MessageData[];
  /** Tool calls to display */
  toolCalls: ToolCallData[];
  /** Application logs to display */
  logs?: LogEntry[];
  /** Whether to auto-scroll to bottom */
  autoScroll?: boolean;
  /** Maximum height */
  maxHeight?: string;
  /** Whether to show debug logs (default: true) */
  showDebugLogs?: boolean;
}

/**
 * Format a timestamp for display.
 */
function formatTime(isoString: string): string {
  const date = new Date(isoString);
  return date.toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

/**
 * Get the status color for a tool call.
 */
function getToolStatusColor(status: ToolCallData["status"]): string {
  switch (status) {
    case "pending":
      return "text-gray-500";
    case "running":
      return "text-blue-500";
    case "completed":
      return "text-green-500";
    case "failed":
      return "text-red-500";
    default:
      return "text-gray-500";
  }
}

/**
 * Get the color for a log level.
 */
function getLogLevelColor(level: LogLevel): string {
  switch (level) {
    case "agent":
      return "text-purple-400";
    case "debug":
      return "text-gray-500";
    case "info":
      return "text-cyan-400";
    case "warn":
      return "text-yellow-400";
    case "error":
      return "text-red-400";
    default:
      return "text-gray-400";
  }
}

/**
 * Get the badge variant for a log level.
 */
function getLogLevelBadge(level: LogLevel): "default" | "info" | "success" | "warning" | "error" {
  switch (level) {
    case "agent":
      return "success";
    case "debug":
      return "default";
    case "info":
      return "info";
    case "warn":
      return "warning";
    case "error":
      return "error";
    default:
      return "default";
  }
}

export function LogViewer({
  messages,
  toolCalls,
  logs = [],
  autoScroll = true,
  maxHeight = "500px",
  showDebugLogs = true,
}: LogViewerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const isAtBottomRef = useRef<boolean>(true);

  // Track if the user is scrolled to the bottom
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const handleScroll = () => {
      const { scrollTop, scrollHeight, clientHeight } = container;
      // Consider "at bottom" if within 10px of the bottom
      isAtBottomRef.current = scrollHeight - scrollTop - clientHeight < 10;
    };

    container.addEventListener("scroll", handleScroll);
    return () => container.removeEventListener("scroll", handleScroll);
  }, []);

  // Auto-scroll to bottom when content changes, but only if user was already at bottom
  useEffect(() => {
    if (autoScroll && containerRef.current && isAtBottomRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight;
    }
  }, [messages, toolCalls, logs, autoScroll]);

  // Combine and sort entries by timestamp
  const entries: Array<
    | { type: "message"; data: MessageData; timestamp: string }
    | { type: "tool"; data: ToolCallData; timestamp: string }
    | { type: "log"; data: LogEntry; timestamp: string }
  > = [];

  messages.forEach((msg) => {
    entries.push({ type: "message", data: msg, timestamp: msg.timestamp });
  });

  toolCalls.forEach((tool) => {
    // Use the tool's timestamp
    entries.push({ type: "tool", data: tool, timestamp: tool.timestamp });
  });

  logs.forEach((log) => {
    // Filter out debug logs if showDebugLogs is false
    if (!showDebugLogs && log.level === "debug") {
      return;
    }
    entries.push({ type: "log", data: log, timestamp: log.timestamp });
  });

  // Sort by timestamp
  entries.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

  const isEmpty = entries.length === 0;

  return (
    <div
      ref={containerRef}
      className="bg-gray-900 text-gray-100 rounded-lg overflow-auto font-mono text-xs sm:text-sm"
      style={{ maxHeight }}
    >
      {isEmpty ? (
        <div className="flex items-center justify-center h-32 text-gray-500 text-xs sm:text-sm">
          No logs yet. Start the loop to see activity.
        </div>
      ) : (
        <div className="p-2 sm:p-4 space-y-2 sm:space-y-3">
          {entries.map((entry, index) => {
            if (entry.type === "message") {
              const msg = entry.data;
              return (
                <div key={`msg-${msg.id}-${index}`} className="group">
                  <div className="flex items-start gap-2 sm:gap-3">
                    <span className="text-gray-500 flex-shrink-0 text-xs hidden sm:inline">
                      {formatTime(msg.timestamp)}
                    </span>
                    <Badge
                      variant={msg.role === "user" ? "info" : "success"}
                      size="sm"
                    >
                      {msg.role}
                    </Badge>
                    <div className="flex-1 whitespace-pre-wrap break-words min-w-0">
                      {msg.content}
                    </div>
                  </div>
                </div>
              );
            } else if (entry.type === "tool") {
              const tool = entry.data;
              return (
                <div key={`tool-${tool.id}-${index}`} className="group">
                  <div className="flex items-start gap-2 sm:gap-3">
                    <span className="text-gray-500 flex-shrink-0 text-xs hidden sm:inline">
                      {formatTime(entry.timestamp)}
                    </span>
                    <span className={`flex-shrink-0 ${getToolStatusColor(tool.status)}`}>
                      {tool.status === "running" && (
                        <span className="inline-block animate-spin mr-1">
                          ⟳
                        </span>
                      )}
                      {tool.status === "completed" && "✓ "}
                      {tool.status === "failed" && "✗ "}
                      {tool.status === "pending" && "○ "}
                    </span>
                    <div className="flex-1 min-w-0">
                      <span className="text-yellow-400 break-all">{tool.name}</span>
                      {tool.input != null && (
                        <details className="mt-1">
                          <summary className="cursor-pointer text-gray-500 hover:text-gray-400 text-xs">
                            Input
                          </summary>
                          <pre className="mt-1 p-2 bg-gray-800 rounded text-xs overflow-x-auto">
                            {String(JSON.stringify(tool.input, null, 2))}
                          </pre>
                        </details>
                      )}
                      {tool.output != null && (
                        <details className="mt-1">
                          <summary className="cursor-pointer text-gray-500 hover:text-gray-400 text-xs">
                            Output
                          </summary>
                          <pre className="mt-1 p-2 bg-gray-800 rounded text-xs overflow-x-auto">
                            {typeof tool.output === "string"
                              ? tool.output
                              : String(JSON.stringify(tool.output, null, 2))}
                          </pre>
                        </details>
                      )}
                    </div>
                  </div>
                </div>
              );
            } else {
              // Log entry
              const log = entry.data;
              // Check if this is an AI response log with responseContent
              const responseContent = log.details?.["responseContent"];
              const hasResponseContent = typeof responseContent === "string" && responseContent.length > 0;
              // Filter out responseContent from details for separate display
              const otherDetails = log.details
                ? Object.fromEntries(
                    Object.entries(log.details).filter(([key]) => key !== "responseContent")
                  )
                : undefined;
              const hasOtherDetails = otherDetails && Object.keys(otherDetails).length > 0;

              return (
                <div key={`log-${log.id}-${index}`} className="group">
                  <div className="flex items-start gap-2 sm:gap-3">
                    <span className="text-gray-500 flex-shrink-0 text-xs hidden sm:inline">
                      {formatTime(log.timestamp)}
                    </span>
                    <Badge
                      variant={getLogLevelBadge(log.level)}
                      size="sm"
                    >
                      {log.level.toUpperCase()}
                    </Badge>
                    <div className={`flex-1 min-w-0 ${getLogLevelColor(log.level)}`}>
                      <span className="break-words">{log.message}</span>
                      {/* Show responseContent as proper text */}
                      {hasResponseContent && (
                        <div className="mt-2 p-2 sm:p-3 bg-gray-800 rounded whitespace-pre-wrap break-words text-gray-200 text-xs leading-relaxed">
                          {responseContent}
                        </div>
                      )}
                      {/* Show other details as JSON */}
                      {hasOtherDetails && (
                        <details className="mt-1">
                          <summary className="cursor-pointer text-gray-500 hover:text-gray-400 text-xs">
                            Details
                          </summary>
                          <pre className="mt-1 p-2 bg-gray-800 rounded text-xs overflow-x-auto">
                            {JSON.stringify(otherDetails, null, 2)}
                          </pre>
                        </details>
                      )}
                    </div>
                  </div>
                </div>
              );
            }
          })}
        </div>
      )}
    </div>
  );
}

export default LogViewer;
