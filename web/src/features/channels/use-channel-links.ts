import { useCallback, useMemo, useState } from "react";

import type { Channel } from "./channel-api";
import {
  channelSuggestions,
  findChannelQuery,
  type ChannelSuggestion,
} from "./channel-links";

export type ChannelAutocompleteState = {
  query: string;
  start: number;
  selectedIndex: number;
};

export function useChannelLinks(channels: readonly Channel[]) {
  const [autocomplete, setAutocomplete] =
    useState<ChannelAutocompleteState | null>(null);
  const suggestions = useMemo(
    () =>
      autocomplete ? channelSuggestions(channels, autocomplete.query) : [],
    [autocomplete, channels],
  );

  const update = useCallback(
    (content: string, selection: number) => {
      const query = findChannelQuery(content, selection, channels);
      setAutocomplete(query ? { ...query, selectedIndex: 0 } : null);
      return query !== null;
    },
    [channels],
  );
  const clear = useCallback(() => setAutocomplete(null), []);
  const handleKeyDown = useCallback(
    (
      event: React.KeyboardEvent,
    ): { handled: boolean; suggestion?: ChannelSuggestion } => {
      if (!autocomplete || !suggestions.length) return { handled: false };
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        const direction = event.key === "ArrowDown" ? 1 : -1;
        setAutocomplete((current) =>
          current
            ? {
                ...current,
                selectedIndex:
                  (current.selectedIndex + direction + suggestions.length) %
                  suggestions.length,
              }
            : null,
        );
        return { handled: true };
      }
      if (
        event.key === "Tab" ||
        (event.key === "Enter" &&
          !event.ctrlKey &&
          !event.metaKey &&
          !event.altKey &&
          !event.shiftKey)
      ) {
        event.preventDefault();
        return {
          handled: true,
          suggestion: suggestions[autocomplete.selectedIndex],
        };
      }
      if (event.key === "Escape") {
        event.preventDefault();
        clear();
        return { handled: true };
      }
      return { handled: false };
    },
    [autocomplete, clear, suggestions],
  );

  return { autocomplete, clear, handleKeyDown, suggestions, update };
}
