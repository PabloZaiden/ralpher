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
        <div className="flex-1 min-w-0 space-y-2">
          <div className="whitespace-pre-wrap break-words">
            {msg.content}
          </div>
          {msg.attachments && msg.attachments.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {msg.attachments.map((attachment) => (
                <div
                  key={attachment.id}
                  className="rounded border border-gray-700 bg-neutral-800 p-1"
                >
                  <img
                    src={`data:${attachment.mimeType};base64,${attachment.data}`}
                    alt={attachment.filename}
                    className="h-20 w-20 rounded object-cover"
                  />
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
