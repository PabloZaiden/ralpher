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
  /** Progress content (streaming text) */
  progressContent?: string;
  /** Whether to auto-scroll to bottom */
  autoScroll?: boolean;
  /** Maximum height */
  maxHeight?: string;
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
function getLogLevelBadge(level: LogLevel): "default" | "info" | "success" | "warning" | "danger" {
  switch (level) {
    case "debug":
      return "default";
    case "info":
      return "info";
    case "warn":
      return "warning";
    case "error":
      return "danger";
    default:
      return "default";
  }
}

export function LogViewer({
  messages,
  toolCalls,
  logs = [],
  progressContent,
  autoScroll = true,
  maxHeight = "500px",
}: LogViewerProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom when content changes
  useEffect(() => {
    if (autoScroll && containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight;
    }
  }, [messages, toolCalls, logs, progressContent, autoScroll]);

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
    // Use the message timestamp or current time for tool calls
    entries.push({ type: "tool", data: tool, timestamp: new Date().toISOString() });
  });

  logs.forEach((log) => {
    entries.push({ type: "log", data: log, timestamp: log.timestamp });
  });

  // Sort by timestamp
  entries.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

  const isEmpty = entries.length === 0 && !progressContent;

  return (
    <div
      ref={containerRef}
      className="bg-gray-900 text-gray-100 rounded-lg overflow-auto font-mono text-sm"
      style={{ maxHeight }}
    >
      {isEmpty ? (
        <div className="flex items-center justify-center h-32 text-gray-500">
          No logs yet. Start the loop to see activity.
        </div>
      ) : (
        <div className="p-4 space-y-3">
          {entries.map((entry, index) => {
            if (entry.type === "message") {
              const msg = entry.data;
              return (
                <div key={`msg-${msg.id}-${index}`} className="group">
                  <div className="flex items-start gap-3">
                    <span className="text-gray-500 flex-shrink-0">
                      {formatTime(msg.timestamp)}
                    </span>
                    <Badge
                      variant={msg.role === "user" ? "info" : "success"}
                      size="sm"
                    >
                      {msg.role}
                    </Badge>
                    <div className="flex-1 whitespace-pre-wrap break-words">
                      {msg.content}
                    </div>
                  </div>
                </div>
              );
            } else if (entry.type === "tool") {
              const tool = entry.data;
              return (
                <div key={`tool-${tool.id}-${index}`} className="group">
                  <div className="flex items-start gap-3">
                    <span className="text-gray-500 flex-shrink-0">
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
                    <div className="flex-1">
                      <span className="text-yellow-400">{tool.name}</span>
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
              return (
                <div key={`log-${log.id}-${index}`} className="group">
                  <div className="flex items-start gap-3">
                    <span className="text-gray-500 flex-shrink-0">
                      {formatTime(log.timestamp)}
                    </span>
                    <Badge
                      variant={getLogLevelBadge(log.level)}
                      size="sm"
                    >
                      {log.level.toUpperCase()}
                    </Badge>
                    <div className={`flex-1 ${getLogLevelColor(log.level)}`}>
                      <span>{log.message}</span>
                      {log.details && Object.keys(log.details).length > 0 && (
                        <details className="mt-1">
                          <summary className="cursor-pointer text-gray-500 hover:text-gray-400 text-xs">
                            Details
                          </summary>
                          <pre className="mt-1 p-2 bg-gray-800 rounded text-xs overflow-x-auto">
                            {JSON.stringify(log.details, null, 2)}
                          </pre>
                        </details>
                      )}
                    </div>
                  </div>
                </div>
              );
            }
          })}

          {/* Streaming progress content */}
          {progressContent && (
            <div className="flex items-start gap-3">
              <span className="text-gray-500 flex-shrink-0">
                {formatTime(new Date().toISOString())}
              </span>
              <span className="text-blue-400 flex-shrink-0 animate-pulse">
                ...
              </span>
              <div className="flex-1 whitespace-pre-wrap break-words text-gray-300">
                {progressContent}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default LogViewer;
