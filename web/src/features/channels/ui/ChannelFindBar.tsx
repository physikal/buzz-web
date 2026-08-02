import { ChevronDown, ChevronUp, X } from "lucide-react";
import { useEffect, useRef } from "react";

import { Button } from "@/shared/ui/button";
import type { useChannelFind } from "../use-channel-find";

export function ChannelFindBar({
  find,
}: {
  find: ReturnType<typeof useChannelFind>;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);
  const resultLabel =
    find.query.trim().length < 2
      ? null
      : find.matchCount
        ? `${find.activeIndex + 1} of ${find.matchCount}`
        : "No results";

  return (
    <div className="flex items-center gap-1.5 border-b bg-background px-3 py-1.5">
      <div className="relative min-w-0 flex-1">
        <input
          aria-label="Find in channel"
          autoCapitalize="none"
          autoCorrect="off"
          className="h-8 w-full rounded-md border bg-transparent px-2 pr-20 text-sm outline-none focus:ring-1 focus:ring-ring"
          onChange={(event) => find.setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.preventDefault();
              find.close();
            } else if (event.key === "Enter") {
              event.preventDefault();
              if (event.shiftKey) find.previous();
              else find.next();
            }
          }}
          placeholder="Find in channel"
          ref={inputRef}
          spellCheck={false}
          type="search"
          value={find.query}
        />
        {resultLabel ? (
          <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">
            {resultLabel}
          </span>
        ) : null}
      </div>
      <Button
        aria-label="Previous match"
        disabled={!find.matchCount}
        onClick={find.previous}
        size="icon"
        variant="ghost"
      >
        <ChevronUp />
      </Button>
      <Button
        aria-label="Next match"
        disabled={!find.matchCount}
        onClick={find.next}
        size="icon"
        variant="ghost"
      >
        <ChevronDown />
      </Button>
      <Button
        aria-label="Close find bar"
        onClick={find.close}
        size="icon"
        variant="ghost"
      >
        <X />
      </Button>
    </div>
  );
}
