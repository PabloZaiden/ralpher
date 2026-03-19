import type { ReactNode } from "react";
import { memo, useState } from "react";

interface LazyDetailsProps {
  summary: string;
  renderContent: () => ReactNode;
}

export const LazyDetails = memo(function LazyDetails({
  summary,
  renderContent,
}: LazyDetailsProps) {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <details
      className="mt-1"
      onToggle={(event) => {
        setIsOpen(event.currentTarget.open);
      }}
    >
      <summary className="cursor-pointer text-gray-500 hover:text-gray-400 text-xs">
        {summary}
      </summary>
      {isOpen ? renderContent() : null}
    </details>
  );
});
