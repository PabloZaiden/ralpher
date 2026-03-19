import type { ToolCallData } from "../../types";
import { formatTime, getToolStatusColor } from "./utils";

interface ToolEntryProps {
  data: ToolCallData;
  timestamp: string;
  showHeader: boolean;
  spacingClass: string;
  index: number;
}

export function ToolEntry({ data: tool, timestamp, showHeader, spacingClass, index }: ToolEntryProps) {
  return (
    <div key={`tool-${tool.id}-${index}`} className={`group ${spacingClass}`}>
      <div className="flex items-start gap-2 sm:gap-3">
        <span className={`text-gray-500 flex-shrink-0 text-xs hidden sm:inline ${!showHeader ? "invisible" : ""}`}>
          {formatTime(timestamp)}
        </span>
        <span className={`flex-shrink-0 ${getToolStatusColor(tool.status)} ${!showHeader ? "invisible" : ""}`}>
          {tool.status === "running" && (
            <span className="inline-block animate-spin mr-1">⟳</span>
          )}
          {tool.status === "completed" && "✓ "}
          {tool.status === "failed" && "✗ "}
          {tool.status === "pending" && "○ "}
        </span>
        <div className="flex-1 min-w-0">
          {/* Always show tool name when input/output exists, so details aren't orphaned */}
          {(showHeader || tool.input != null || tool.output != null) && (
            <span className="text-yellow-400 break-all">{tool.name}</span>
          )}
          {tool.input != null && (
            <details className="mt-1">
              <summary className="cursor-pointer text-gray-500 hover:text-gray-400 text-xs">
                Input
              </summary>
              <pre className="mt-1 p-2 bg-neutral-800 rounded text-xs overflow-x-auto">
                {String(JSON.stringify(tool.input, null, 2))}
              </pre>
            </details>
          )}
          {tool.output != null && (
            <details className="mt-1">
              <summary className="cursor-pointer text-gray-500 hover:text-gray-400 text-xs">
                Output
              </summary>
              <pre className="mt-1 p-2 bg-neutral-800 rounded text-xs overflow-x-auto">
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
}
