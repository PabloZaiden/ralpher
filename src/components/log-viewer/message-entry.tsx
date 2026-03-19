import type { MessageData } from "../../types";
import { Badge } from "../common";
import { formatTime } from "./utils";

interface MessageEntryProps {
  data: MessageData;
  showHeader: boolean;
  spacingClass: string;
  index: number;
}

export function MessageEntry({ data: msg, showHeader, spacingClass, index }: MessageEntryProps) {
  return (
    <div key={`msg-${msg.id}-${index}`} className={`group ${spacingClass}`}>
      <div className="flex items-start gap-2 sm:gap-3">
        <span className={`text-gray-500 flex-shrink-0 text-xs hidden sm:inline ${!showHeader ? "invisible" : ""}`}>
          {formatTime(msg.timestamp)}
        </span>
        {showHeader ? (
          <Badge variant="info" size="sm">
            {msg.role}
          </Badge>
        ) : (
          <span className="invisible">
            <Badge variant="info" size="sm">
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
}
