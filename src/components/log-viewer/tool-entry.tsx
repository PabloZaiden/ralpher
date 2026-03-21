import { memo, useCallback } from "react";
import type { ToolCallData } from "../../types";
import { formatTime, getToolStatusColor } from "./utils";
import { LazyDetails } from "./lazy-details";

interface ToolEntryProps {
  data: ToolCallData;
  timestamp: string;
  showHeader: boolean;
  spacingClass: string;
  index: number;
}

export const ToolEntry = memo(function ToolEntry({ data: tool, timestamp, showHeader, spacingClass, index }: ToolEntryProps) {
  const renderInput = useCallback(
    () => (
      <pre className="mt-1 p-2 bg-neutral-800 rounded text-xs overflow-x-auto">
        {String(JSON.stringify(tool.input, null, 2))}
      </pre>
    ),
    [tool.input]
  );
  const renderOutput = useCallback(
    () => (
      <pre className="mt-1 p-2 bg-neutral-800 rounded text-xs overflow-x-auto">
        {typeof tool.output === "string"
          ? tool.output
          : String(JSON.stringify(tool.output, null, 2))}
      </pre>
    ),
    [tool.output]
  );

  return (
    <div key={`tool-${tool.id}-${index}`} className={`group ${spacingClass}`}>
      {showHeader && (
        <div className="text-gray-500 text-xs mb-0.5">
          {formatTime(timestamp)}
        </div>
      )}
      <div className="min-w-0">
        {/* Always show tool name when input/output exists, so details aren't orphaned */}
        {(showHeader || tool.input != null || tool.output != null) && (
          <span>
            <span className={`${getToolStatusColor(tool.status)} mr-1`}>
              {tool.status === "running" && (
                <span className="inline-block animate-spin mr-1">⟳</span>
              )}
              {tool.status === "completed" && "✓"}
              {tool.status === "failed" && "✗"}
              {tool.status === "pending" && "○"}
            </span>
            {" "}
            <span className="text-yellow-400 break-all">{tool.name}</span>
          </span>
        )}
        {tool.input != null && (
          <LazyDetails
            summary="Input"
            renderContent={renderInput}
          />
        )}
        {tool.output != null && (
          <LazyDetails
            summary="Output"
            renderContent={renderOutput}
          />
        )}
      </div>
    </div>
  );
});
