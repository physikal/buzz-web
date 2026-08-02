import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { readNotificationSettings } from "@/features/settings/settings-api";
import {
  queryEvents,
  subscribeEvents,
  type NostrEvent,
} from "@/shared/lib/nostr-client";
import { relayWsUrl } from "@/shared/lib/relay-url";
import type { Channel } from "./channel-api";
import { ReadStateManager } from "./read-state";

const CONTENT_KINDS = [9, 40002, 40008, 40099, 45001, 45003];
const LIVE_KINDS = [
  5, 7, 9, 9002, 9005, 39000, 40002, 40003, 40008, 40099, 45001, 45002, 45003,
];
const READ_HORIZON_SECONDS = 7 * 24 * 60 * 60;

type Activity = Record<
  string,
  Record<string, { createdAt: number; pubkey: string }>
>;

export type RelayLiveStatus = "connecting" | "live" | "offline";

function mergeActivity(current: Activity, events: NostrEvent[]): Activity {
  let next = current;
  for (const event of events) {
    const channelId = event.tags.find((tag) => tag[0] === "h")?.[1];
    if (!channelId || !CONTENT_KINDS.includes(event.kind)) continue;
    const existing = current[channelId]?.[event.id];
    if (existing) continue;
    if (next === current) next = { ...current };
    next[channelId] = {
      ...(next[channelId] ?? {}),
      [event.id]: { createdAt: event.created_at, pubkey: event.pubkey },
    };
  }
  return next;
}

export function useLiveChannels({
  ownerPubkey,
  channels,
  selectedChannelId,
  onChannelEvent,
  mutedChannelIds,
}: {
  ownerPubkey: string;
  channels: Channel[];
  selectedChannelId: string | null;
  onChannelEvent: (channelId: string) => void;
  mutedChannelIds?: ReadonlySet<string>;
}) {
  const [status, setStatus] = useState<RelayLiveStatus>("connecting");
  const [activity, setActivity] = useState<Activity>({});
  const [readMarkers, setReadMarkers] = useState<Record<string, number>>({});
  const managerRef = useRef<ReadStateManager | null>(null);
  const channelIds = useMemo(
    () => channels.map((channel) => channel.id).sort(),
    [channels],
  );

  useEffect(() => {
    const manager = new ReadStateManager(ownerPubkey);
    managerRef.current = manager;
    const unsubscribe = manager.subscribe(() =>
      setReadMarkers(manager.snapshot()),
    );
    setReadMarkers(manager.snapshot());
    void manager.initialize();
    return () => {
      unsubscribe();
      manager.destroy();
      if (managerRef.current === manager) managerRef.current = null;
    };
  }, [ownerPubkey]);

  useEffect(() => {
    if (!channelIds.length) {
      setActivity({});
      return;
    }
    let cancelled = false;
    void queryEvents(
      relayWsUrl(),
      {
        kinds: CONTENT_KINDS,
        "#h": channelIds,
        since: Math.floor(Date.now() / 1000) - READ_HORIZON_SECONDS,
        limit: 5_000,
      },
      { requireNip07: true },
    )
      .then((events) => {
        if (!cancelled)
          setActivity((current) => mergeActivity(current, events));
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [channelIds]);

  const markSelectedRead = useCallback(() => {
    if (!selectedChannelId || document.hidden) return;
    const timestamps = Object.values(activity[selectedChannelId] ?? {}).map(
      (event) => event.createdAt,
    );
    if (timestamps.length)
      managerRef.current?.markRead(selectedChannelId, Math.max(...timestamps));
  }, [activity, selectedChannelId]);

  useEffect(() => {
    markSelectedRead();
  }, [markSelectedRead]);
  useEffect(() => {
    const handleVisibility = () => markSelectedRead();
    document.addEventListener("visibilitychange", handleVisibility);
    window.addEventListener("focus", handleVisibility);
    return () => {
      document.removeEventListener("visibilitychange", handleVisibility);
      window.removeEventListener("focus", handleVisibility);
    };
  }, [markSelectedRead]);

  useEffect(() => {
    if (!channelIds.length) return;
    const subscription = subscribeEvents(
      relayWsUrl(),
      { kinds: LIVE_KINDS, "#h": channelIds },
      (event) => {
        const channelId = event.tags.find((tag) => tag[0] === "h")?.[1];
        if (!channelId) return;
        onChannelEvent(channelId);
        if (CONTENT_KINDS.includes(event.kind)) {
          setActivity((current) => mergeActivity(current, [event]));
          if (channelId === selectedChannelId && !document.hidden)
            managerRef.current?.markRead(channelId, event.created_at);
        }
        if (CONTENT_KINDS.includes(event.kind)) {
          const settings = readNotificationSettings();
          const directlyMentioned = event.tags.some(
            (tag) => tag[0] === "p" && tag[1] === ownerPubkey,
          );
          const shouldNotify =
            settings.enabled &&
            (channelId !== selectedChannelId || settings.notifyWhileViewing) &&
            event.pubkey !== ownerPubkey &&
            (!mutedChannelIds?.has(channelId) || directlyMentioned) &&
            typeof Notification !== "undefined" &&
            Notification.permission === "granted";
          if (shouldNotify) {
            const channel = channels.find((item) => item.id === channelId);
            const notification = new Notification(
              channel?.channelType === "dm"
                ? channel.name
                : `#${channel?.name ?? "Buzz"}`,
              {
                body: event.content.slice(0, 240),
                silent: !settings.sound,
                tag: event.id,
              },
            );
            notification.onclick = () => window.focus();
          }
        }
      },
      { requireNip07: true, onStatus: setStatus },
    );
    return subscription.close;
  }, [
    channelIds,
    channels,
    mutedChannelIds,
    onChannelEvent,
    ownerPubkey,
    selectedChannelId,
  ]);

  const unread = useMemo(() => {
    const result: Record<string, number> = {};
    for (const channelId of channelIds) {
      const marker = readMarkers[channelId] ?? 0;
      result[channelId] = Object.values(activity[channelId] ?? {}).filter(
        (event) => event.pubkey !== ownerPubkey && event.createdAt > marker,
      ).length;
    }
    return result;
  }, [activity, channelIds, ownerPubkey, readMarkers]);

  const markContextRead = useCallback(
    (contextId: string, timestamp: number) => {
      managerRef.current?.markRead(contextId, timestamp);
    },
    [],
  );

  return { status, unread, markContextRead };
}
