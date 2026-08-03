import { useEffect, useMemo } from "react";

import type { ChannelMessage } from "./channel-api";

export function useHighlightedMessage(
  highlightedId: string | null,
  messages: ChannelMessage[],
  openThread: (rootId: string) => void,
  openRootMessage = false,
) {
  const highlightedRootId = useMemo(() => {
    const message = messages.find(
      (candidate) => candidate.id === highlightedId,
    );
    return message
      ? (message.rootId ?? (openRootMessage ? message.id : null))
      : null;
  }, [highlightedId, messages, openRootMessage]);
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
