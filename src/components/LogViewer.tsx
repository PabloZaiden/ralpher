/**
 * LogViewer component for displaying real-time loop logs and messages.
 * 
 * Performance: This component is memoized to prevent expensive re-renders
 * when typing in input fields. Without memoization, every keystroke would
 * re-render thousands of log entries, causing severe input lag.
 */

import { useEffect, useRef, useMemo, memo } from "react";
import type { MessageData, ToolCallData, LogLevel } from "../types";
import { Badge } from "./common";
import { MarkdownRenderer } from "./MarkdownRenderer";

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
  /** Messages to display (only user messages are rendered; assistant messages are filtered out) */
  messages: MessageData[];
  /** Tool calls to display */
  toolCalls: ToolCallData[];
  /** Application logs to display */
  logs?: LogEntry[];
  /** Whether to auto-scroll to bottom */
  autoScroll?: boolean;
  /** Maximum height */
  maxHeight?: string;
  /** Whether to show system information logs (info, warn, error, debug, trace, system agent messages). Default: false */
  showSystemInfo?: boolean;
  /** Whether to show reasoning entries ("AI reasoning..." logs). Default: true */
  showReasoning?: boolean;
  /** Whether to show tool-related entries (tool calls and "AI calling tool" logs). Default: false */
  showTools?: boolean;
  /** Whether to render response log content as markdown (default: false) */
  markdownEnabled?: boolean;
  /** Whether the loop is actively working (shows a spinner at the bottom). Default: false */
  isActive?: boolean;
  /** ID for the root element (for accessibility) */
  id?: string;
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
 * Base type for a display entry before showHeader annotation.
 */
type EntryBase =
  | { type: "message"; data: MessageData; timestamp: string }
  | { type: "tool"; data: ToolCallData; timestamp: string }
  | { type: "log"; data: LogEntry; timestamp: string };

/**
 * Display entry with showHeader flag for chat-style grouping.
 * When consecutive visible entries share the same actor+action,
 * only the first entry in the group has showHeader=true.
 */
export type DisplayEntry = EntryBase & { showHeader: boolean };

/**
 * Derive a grouping key for an entry. Two consecutive entries belong to
 * the same visual group (and thus collapse their headers) when their
 * keys are equal.
 *
 * - Messages group by role: "message|user" (assistant messages are filtered out before grouping)
 * - Tool calls group by tool name: "tool|Write", "tool|Read"
 * - Log entries group by level + message: "log|agent|AI generating response..."
 */
export function getEntryGroupKey(entry: EntryBase): string {
  switch (entry.type) {
    case "message":
      return `message|${entry.data.role}`;
    case "tool":
      return `tool|${entry.data.name}`;
    case "log":
      return `log|${entry.data.level}|${entry.data.message}`;
  }
}

/**
 * Annotate a sorted array of entries with showHeader flags.
 * The first entry always shows its header. Subsequent entries only show
 * their header when their group key differs from the previous entry.
 *
 * Group keys are precomputed in a single pass to avoid redundant
 * string concatenations — each entry's key is computed exactly once.
 */
export function annotateShowHeader(sorted: EntryBase[]): DisplayEntry[] {
  // Precompute all group keys in one pass so each key is calculated exactly once
  const keys = sorted.map(getEntryGroupKey);
  return sorted.map((entry, i) => ({
    ...entry,
    showHeader: i === 0 || keys[i] !== keys[i - 1],
  }));
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

/**
 * LogViewer displays messages, tool calls, and logs in chronological order.
 * Memoized to prevent re-renders when parent state changes (e.g., typing in inputs).
 */
export const LogViewer = memo(function LogViewer({
  messages,
  toolCalls,
  logs = [],
  autoScroll = true,
  maxHeight,
  showSystemInfo = false,
  showReasoning = true,
  showTools = false,
  markdownEnabled = false,
  isActive = false,
  id,
}: LogViewerProps) {
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
  }, [messages, toolCalls, logs, autoScroll, showSystemInfo, showReasoning, showTools, markdownEnabled, isActive]);

  // Combine, sort, and annotate entries with showHeader for chat-style grouping
  const entries = useMemo(() => {
    const result: EntryBase[] = [];

    // User messages are always shown; assistant messages are filtered out because
    // their content is already displayed via AGENT response log entries (logKind: "response")
    messages.forEach((msg) => {
      if (msg.role === "user") {
        result.push({ type: "message", data: msg, timestamp: msg.timestamp });
      }
    });

    // Tool call entries: only shown if showTools is enabled
    if (showTools) {
      toolCalls.forEach((tool) => {
        result.push({ type: "tool", data: tool, timestamp: tool.timestamp });
      });
    }

    logs.forEach((logEntry) => {
      const logKind = logEntry.details?.["logKind"] as string | undefined;

      // Reasoning entries: only shown if showReasoning is enabled
      if (logKind === "reasoning" || (!logKind && logEntry.message === "AI reasoning...")) {
        if (!showReasoning) return;
        result.push({ type: "log", data: logEntry, timestamp: logEntry.timestamp });
        return;
      }

      // Tool-related log entries: only shown if showTools is enabled
      if (logKind === "tool" || (!logKind && logEntry.message.startsWith("AI calling tool:"))) {
        if (!showTools) return;
        result.push({ type: "log", data: logEntry, timestamp: logEntry.timestamp });
        return;
      }

      // Response streaming entries ("AI generating response..."): always shown
      if (logKind === "response" || (!logKind && logEntry.message === "AI generating response...")) {
        result.push({ type: "log", data: logEntry, timestamp: logEntry.timestamp });
        return;
      }

      // System agent messages (e.g., "AI started/finished generating response"): shown if showSystemInfo
      if (logKind === "system") {
        if (!showSystemInfo) return;
        result.push({ type: "log", data: logEntry, timestamp: logEntry.timestamp });
        return;
      }

      // Non-agent levels (info, warn, error, debug, trace): shown if showSystemInfo
      if (logEntry.level !== "agent" && logEntry.level !== "user") {
        if (!showSystemInfo) return;
        result.push({ type: "log", data: logEntry, timestamp: logEntry.timestamp });
        return;
      }

      // Remaining agent/user entries without logKind (backward compatibility):
      // Use heuristics for old entries that don't have logKind
      if (logEntry.level === "agent" && !logKind) {
        // Old system-like messages
        if (logEntry.message.startsWith("AI started") || logEntry.message.startsWith("AI finished")) {
          if (!showSystemInfo) return;
        }
      }

      // Default: show the entry (user-level entries, and any unclassified agent entries)
      result.push({ type: "log", data: logEntry, timestamp: logEntry.timestamp });
    });

    // Sort by timestamp
    result.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

    // Annotate with showHeader for chat-style consecutive grouping
    return annotateShowHeader(result);
  }, [messages, toolCalls, logs, showSystemInfo, showReasoning, showTools]);

  const isEmpty = entries.length === 0;

  return (
    <div
      ref={containerRef}
      id={id}
      className={`bg-gray-900 text-gray-100 rounded-lg overflow-auto font-mono text-xs sm:text-sm dark-scrollbar ${!maxHeight ? "flex-1 min-h-0" : ""}`}
      style={maxHeight ? { maxHeight } : undefined}
    >
      {isEmpty ? (
        <div className="flex items-center justify-center h-32 text-gray-500 text-xs sm:text-sm">
          {isActive ? (
            <div className="flex items-center gap-2">
              <div className="animate-spin rounded-full h-4 w-4 border-2 border-blue-500 border-t-transparent" />
              <span>Working...</span>
            </div>
          ) : (
            "No logs yet. Waiting for activity."
          )}
        </div>
      ) : (
        <div className="p-2 sm:p-4">
          {entries.map((entry, index) => {
            // Chat-style spacing: tighter within a group, normal between groups
            const spacingClass = index === 0
              ? ""
              : entry.showHeader
                ? "mt-2 sm:mt-3"  // Normal spacing at group boundary
                : "mt-0.5";       // Tight spacing within a group
            if (entry.type === "message") {
              const msg = entry.data;
              return (
                <div key={`msg-${msg.id}-${index}`} className={`group ${spacingClass}`}>
                  <div className="flex items-start gap-2 sm:gap-3">
                    <span className={`text-gray-500 flex-shrink-0 text-xs hidden sm:inline ${!entry.showHeader ? "invisible" : ""}`}>
                      {formatTime(msg.timestamp)}
                    </span>
                    {entry.showHeader ? (
                      <Badge
                        variant="info"
                        size="sm"
                      >
                        {msg.role}
                      </Badge>
                    ) : (
                      <span className="invisible">
                        <Badge
                          variant="info"
                          size="sm"
                        >
                          {msg.role}
                        </Badge>
                      </span>
                    )}
                    <div className="flex-1 min-w-0 whitespace-pre-wrap break-words">
                      {msg.content}
                    </div>
                  </div>
                </div>
              );
            } else if (entry.type === "tool") {
              const tool = entry.data;
              return (
                <div key={`tool-${tool.id}-${index}`} className={`group ${spacingClass}`}>
                  <div className="flex items-start gap-2 sm:gap-3">
                    <span className={`text-gray-500 flex-shrink-0 text-xs hidden sm:inline ${!entry.showHeader ? "invisible" : ""}`}>
                      {formatTime(entry.timestamp)}
                    </span>
                    <span className={`flex-shrink-0 ${getToolStatusColor(tool.status)} ${!entry.showHeader ? "invisible" : ""}`}>
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
                      {/* Always show tool name when input/output exists, so details aren't orphaned */}
                      {(entry.showHeader || tool.input != null || tool.output != null) && (
                        <span className="text-yellow-400 break-all">{tool.name}</span>
                      )}
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
              const logKind = log.details?.["logKind"] as string | undefined;
              const isReasoning = logKind === "reasoning" || (!logKind && log.message === "AI reasoning...");
              // Check if this is an AI response log with responseContent
              const responseContent = log.details?.["responseContent"];
              const hasResponseContent = typeof responseContent === "string" && responseContent.length > 0;
              // Filter out responseContent and logKind from details for separate display
              const otherDetails = log.details
                ? Object.fromEntries(
                    Object.entries(log.details).filter(([key]) => key !== "responseContent" && key !== "logKind")
                  )
                : undefined;
              const hasOtherDetails = otherDetails && Object.keys(otherDetails).length > 0;

              return (
                <div key={`log-${log.id}-${index}`} className={`group ${isReasoning ? "opacity-60" : ""} ${spacingClass}`}>
                  <div className="flex items-start gap-2 sm:gap-3">
                    <span className={`text-gray-500 flex-shrink-0 text-xs hidden sm:inline ${!entry.showHeader ? "invisible" : ""}`}>
                      {formatTime(log.timestamp)}
                    </span>
                    {entry.showHeader ? (
                      <Badge
                        variant={getLogLevelBadge(log.level)}
                        size="sm"
                      >
                        {log.level.toUpperCase()}
                      </Badge>
                    ) : (
                      <span className="invisible">
                        <Badge
                          variant={getLogLevelBadge(log.level)}
                          size="sm"
                        >
                          {log.level.toUpperCase()}
                        </Badge>
                      </span>
                    )}
                    <div className={`flex-1 min-w-0 ${isReasoning ? "text-gray-400 italic" : getLogLevelColor(log.level)}`}>
                      {entry.showHeader && (
                        <span className="break-words">{log.message}</span>
                      )}
                      {/* Show responseContent as proper text */}
                      {hasResponseContent && (
                        markdownEnabled ? (
                          <div className={`mt-2 p-2 sm:p-3 bg-gray-800 rounded ${isReasoning ? "italic" : ""}`}>
                            <MarkdownRenderer content={responseContent as string} className="text-xs" dimmed={isReasoning} />
                          </div>
                        ) : (
                          <div className={`mt-2 p-2 sm:p-3 bg-gray-800 rounded whitespace-pre-wrap break-words text-xs leading-relaxed ${isReasoning ? "text-gray-400 italic" : "text-gray-200"}`}>
                            {responseContent}
                          </div>
                        )
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
          {isActive && (
            <div className="flex items-center gap-2 text-gray-500 text-xs py-2" data-testid="working-indicator">
              <div className="animate-spin rounded-full h-3.5 w-3.5 border-2 border-blue-500 border-t-transparent" />
              <span>Working...</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
});

export default LogViewer;
