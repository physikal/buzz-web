import { useEffect, useMemo, useState } from "react";

import { subscribeEvents } from "@/shared/lib/nostr-client";
import { relayWsUrl } from "@/shared/lib/relay-url";
import type { Channel } from "./channel-api";

const LIVE_KINDS = [
  5, 7, 9, 9002, 9005, 39000, 40002, 40003, 40008, 40099, 45001, 45002, 45003,
];

export type RelayLiveStatus = "connecting" | "live" | "offline";

function readUnread(ownerPubkey: string): Record<string, number> {
  try {
    return JSON.parse(
      localStorage.getItem(`buzz-web:unread:${ownerPubkey}`) ?? "{}",
    ) as Record<string, number>;
  } catch {
    return {};
  }
}

export function useLiveChannels({
  ownerPubkey,
  channels,
  selectedChannelId,
  onChannelEvent,
}: {
  ownerPubkey: string;
  channels: Channel[];
  selectedChannelId: string | null;
  onChannelEvent: (channelId: string) => void;
}) {
  const [status, setStatus] = useState<RelayLiveStatus>("connecting");
  const [unread, setUnread] = useState<Record<string, number>>(() =>
    readUnread(ownerPubkey),
  );
  const channelIds = useMemo(
    () => channels.map((channel) => channel.id).sort(),
    [channels],
  );

  useEffect(() => {
    if (!selectedChannelId) return;
    setUnread((current) => {
      if (!current[selectedChannelId]) return current;
      const next = { ...current, [selectedChannelId]: 0 };
      localStorage.setItem(
        `buzz-web:unread:${ownerPubkey}`,
        JSON.stringify(next),
      );
      return next;
    });
  }, [ownerPubkey, selectedChannelId]);

  useEffect(() => {
    if (!channelIds.length) return;
    const subscription = subscribeEvents(
      relayWsUrl(),
      { kinds: LIVE_KINDS, "#h": channelIds },
      (event) => {
        const channelId = event.tags.find((tag) => tag[0] === "h")?.[1];
        if (!channelId) return;
        onChannelEvent(channelId);
        if (
          channelId !== selectedChannelId &&
          event.pubkey !== ownerPubkey &&
          [9, 40002, 40008, 45001, 45003].includes(event.kind)
        ) {
          setUnread((current) => {
            const next = {
              ...current,
              [channelId]: (current[channelId] ?? 0) + 1,
            };
            localStorage.setItem(
              `buzz-web:unread:${ownerPubkey}`,
              JSON.stringify(next),
            );
            return next;
          });
        }
      },
      { requireNip07: true, onStatus: setStatus },
    );
    return subscription.close;
  }, [channelIds, onChannelEvent, ownerPubkey, selectedChannelId]);

  return { status, unread };
}
