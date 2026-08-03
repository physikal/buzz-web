import { useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";

export function useChannelRouteState({
  initialChannelId,
  initialMessageId,
}: {
  initialChannelId?: string;
  initialMessageId?: string;
}) {
  const navigate = useNavigate();
  const [selectedId, setSelectedId] = useState<string | null>(
    initialChannelId ?? null,
  );
  const [threadRootId, setThreadRootId] = useState<string | null>(null);
  const [highlightedId, setHighlightedId] = useState<string | null>(
    initialMessageId ?? null,
  );

  useEffect(() => setSelectedId(initialChannelId ?? null), [initialChannelId]);
  useEffect(() => {
    setHighlightedId(initialMessageId ?? null);
    if (!initialMessageId) setThreadRootId(null);
  }, [initialMessageId]);

  const updateLocation = useCallback(
    (channelId?: string, messageId?: string) =>
      void navigate({
        to: "/channels",
        search: {
          ...(channelId ? { channel: channelId } : {}),
          ...(messageId ? { message: messageId } : {}),
        },
      }),
    [navigate],
  );

  const selectChannel = useCallback(
    (channelId: string) => {
      setSelectedId(channelId);
      setThreadRootId(null);
      setHighlightedId(null);
      updateLocation(channelId);
    },
    [updateLocation],
  );
  const openMessage = useCallback(
    (channelId: string, rootId: string, messageId: string) => {
      setSelectedId(channelId);
      setThreadRootId(rootId);
      setHighlightedId(messageId);
      updateLocation(channelId, messageId);
    },
    [updateLocation],
  );
  const closeThread = useCallback(
    (channelId: string) => {
      setThreadRootId(null);
      setHighlightedId(null);
      updateLocation(channelId);
    },
    [updateLocation],
  );
  const clearChannel = useCallback(() => {
    setSelectedId(null);
    setThreadRootId(null);
    setHighlightedId(null);
    updateLocation();
  }, [updateLocation]);

  return {
    clearChannel,
    closeThread,
    highlightedId,
    openMessage,
    selectChannel,
    selectedId,
    setHighlightedId,
    setSelectedId,
    setThreadRootId,
    threadRootId,
  };
}
