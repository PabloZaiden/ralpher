import { memo } from "react";
import { Badge } from "../common";
import { MarkdownRenderer } from "../MarkdownRenderer";
import { LazyDetails } from "./lazy-details";
import type { LogEntry } from "./types";
import { formatTime, getLogLevelColor, getLogLevelBadge } from "./utils";

interface LogEntryItemProps {
  data: LogEntry;
  showHeader: boolean;
  spacingClass: string;
  index: number;
  markdownEnabled: boolean;
}

function getOtherDetails(details: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(details).filter(([key]) => key !== "responseContent" && key !== "logKind")
  );
}

export const LogEntryItem = memo(function LogEntryItem({ data: log, showHeader, spacingClass, index, markdownEnabled }: LogEntryItemProps) {
  const logKind = log.details?.["logKind"] as string | undefined;
  const isReasoning = logKind === "reasoning" || (!logKind && log.message === "AI reasoning...");
  const responseContent = log.details?.["responseContent"];
  const hasResponseContent = typeof responseContent === "string" && responseContent.length > 0;
  const hasOtherDetails = log.details
    ? Object.keys(log.details).some((key) => key !== "responseContent" && key !== "logKind")
    : false;

  return (
    <div key={`log-${log.id}-${index}`} className={`group ${isReasoning ? "opacity-60" : ""} ${spacingClass}`}>
      <div className="flex items-start gap-2 sm:gap-3">
        <span className={`text-gray-500 flex-shrink-0 text-xs hidden sm:inline ${!showHeader ? "invisible" : ""}`}>
          {formatTime(log.timestamp)}
        </span>
        {showHeader ? (
          <Badge variant={getLogLevelBadge(log.level)} size="sm">
            {log.level.toUpperCase()}
          </Badge>
        ) : (
          <span className="invisible">
            <Badge variant={getLogLevelBadge(log.level)} size="sm">
              {log.level.toUpperCase()}
            </Badge>
          </span>
        )}
        <div className={`flex-1 min-w-0 ${isReasoning ? "text-gray-400 italic" : getLogLevelColor(log.level)}`}>
          {showHeader && (
            <span className="break-words">{log.message}</span>
          )}
          {/* Show responseContent as proper text */}
          {hasResponseContent && (
            markdownEnabled ? (
              <div className={`mt-2 p-2 sm:p-3 bg-neutral-800 rounded ${isReasoning ? "italic" : ""}`}>
                <MarkdownRenderer content={responseContent as string} className="text-xs" dimmed={isReasoning} />
              </div>
            ) : (
              <div className={`mt-2 p-2 sm:p-3 bg-neutral-800 rounded whitespace-pre-wrap break-words text-xs leading-relaxed ${isReasoning ? "text-gray-400 italic" : "text-gray-200"}`}>
                {responseContent}
              </div>
            )
          )}
          {/* Show other details as JSON */}
          {hasOtherDetails && (
            <LazyDetails
              summary="Details"
              renderContent={() => (
                <pre className="mt-1 p-2 bg-neutral-800 rounded text-xs overflow-x-auto">
                  {JSON.stringify(getOtherDetails(log.details!), null, 2)}
                </pre>
              )}
            />
          )}
        </div>
      </div>
    </div>
  );
});
