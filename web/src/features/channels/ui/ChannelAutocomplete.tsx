import { useEffect, useRef } from "react";

import { Badge } from "@/shared/ui/badge";
import type { ChannelSuggestion } from "../channel-links";

export function ChannelAutocomplete({
  onSelect,
  selectedIndex,
  suggestions,
}: {
  onSelect: (suggestion: ChannelSuggestion) => void;
  selectedIndex: number;
  suggestions: ChannelSuggestion[];
}) {
  const listRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const selected = listRef.current?.children[selectedIndex] as
      | HTMLElement
      | undefined;
    selected?.scrollIntoView({ block: "nearest" });
  }, [selectedIndex]);
  if (!suggestions.length) return null;
  return (
    <div
      aria-label="Channel suggestions"
      className="absolute bottom-full left-2 z-20 mb-2 max-h-48 w-[min(24rem,calc(100vw-3rem))] overflow-y-auto rounded-md border bg-popover p-1 text-popover-foreground shadow-lg"
      ref={listRef}
      role="listbox"
    >
      {suggestions.map((suggestion, index) => (
        <button
          aria-label={`Insert #${suggestion.name}`}
          aria-selected={index === selectedIndex}
          className={`flex w-full items-center gap-2 rounded px-3 py-1.5 text-left text-sm hover:bg-muted ${
            index === selectedIndex ? "bg-muted" : ""
          }`}
          key={suggestion.id}
          onClick={() => onSelect(suggestion)}
          onMouseDown={(event) => event.preventDefault()}
          role="option"
          type="button"
        >
          <span className="min-w-0 flex-1 truncate font-medium">
            #{suggestion.name}
          </span>
          <Badge variant="secondary">{suggestion.channelType}</Badge>
        </button>
      ))}
    </div>
  );
}
