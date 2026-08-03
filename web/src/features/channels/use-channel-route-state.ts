import { useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";

export function useChannelRouteState({
  initialChannelId,
  initialMessageId,
  initialProfilePubkey,
}: {
  initialChannelId?: string;
  initialMessageId?: string;
  initialProfilePubkey?: string;
}) {
  const navigate = useNavigate();
  const [selectedId, setSelectedId] = useState<string | null>(
    initialChannelId ?? null,
  );
  const [threadRootId, setThreadRootId] = useState<string | null>(null);
  const [highlightedId, setHighlightedId] = useState<string | null>(
    initialMessageId ?? null,
  );
  const [profileTarget, setProfileTarget] = useState<string | null>(
    initialProfilePubkey ?? null,
  );

  useEffect(() => setSelectedId(initialChannelId ?? null), [initialChannelId]);
  useEffect(() => {
    setHighlightedId(initialMessageId ?? null);
    if (!initialMessageId) setThreadRootId(null);
  }, [initialMessageId]);
  useEffect(
    () => setProfileTarget(initialProfilePubkey ?? null),
    [initialProfilePubkey],
  );

  const updateLocation = useCallback(
    (channelId?: string, messageId?: string, profile?: string) =>
      void navigate({
        to: "/channels",
        search: {
          ...(channelId ? { channel: channelId } : {}),
          ...(messageId ? { message: messageId } : {}),
          ...(profile ? { profile } : {}),
        },
      }),
    [navigate],
  );

  const selectChannel = useCallback(
    (channelId: string) => {
      setSelectedId(channelId);
      setThreadRootId(null);
      setHighlightedId(null);
      setProfileTarget(null);
      updateLocation(channelId);
    },
    [updateLocation],
  );
  const openMessage = useCallback(
    (channelId: string, rootId: string, messageId: string) => {
      setSelectedId(channelId);
      setThreadRootId(rootId);
      setHighlightedId(messageId);
      setProfileTarget(null);
      updateLocation(channelId, messageId);
    },
    [updateLocation],
  );
  const closeThread = useCallback(
    (channelId: string) => {
      setThreadRootId(null);
      setHighlightedId(null);
      updateLocation(channelId, undefined, profileTarget ?? undefined);
    },
    [profileTarget, updateLocation],
  );
  const selectProfile = useCallback(
    (pubkey: string | null) => {
      setProfileTarget(pubkey);
      updateLocation(
        selectedId ?? undefined,
        highlightedId ?? undefined,
        pubkey ?? undefined,
      );
    },
    [highlightedId, selectedId, updateLocation],
  );
  const clearChannel = useCallback(() => {
    setSelectedId(null);
    setThreadRootId(null);
    setHighlightedId(null);
    setProfileTarget(null);
    updateLocation();
  }, [updateLocation]);

  return {
    clearChannel,
    closeThread,
    highlightedId,
    openMessage,
    profileTarget,
    selectChannel,
    selectProfile,
    selectedId,
    setHighlightedId,
    setSelectedId,
    setThreadRootId,
    threadRootId,
  };
}
