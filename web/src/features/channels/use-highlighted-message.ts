import { useEffect, useMemo } from "react";

import type { ChannelMessage } from "./channel-api";

export function useHighlightedMessage(
  highlightedId: string | null,
  messages: ChannelMessage[],
  openThread: (rootId: string) => void,
) {
  const highlightedRootId = useMemo(
    () => messages.find((message) => message.id === highlightedId)?.rootId,
    [highlightedId, messages],
  );
  useEffect(() => {
    if (!highlightedId || messages.length === 0) return;
    if (highlightedRootId) openThread(highlightedRootId);
    const timer = window.setTimeout(() => {
      document.getElementById(`message-${highlightedId}`)?.scrollIntoView({
        behavior: "smooth",
        block: "center",
      });
    }, 100);
    return () => window.clearTimeout(timer);
  }, [highlightedId, highlightedRootId, messages.length, openThread]);
}
