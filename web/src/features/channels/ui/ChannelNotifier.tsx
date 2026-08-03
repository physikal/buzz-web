import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";

import {
  playNotificationSound,
  readNotificationSettings,
  type SoundSlot,
} from "@/features/settings/notification-settings";
import {
  queryEvents,
  subscribeEvents,
  type NostrEvent,
} from "@/shared/lib/nostr-client";
import { relayWsUrl } from "@/shared/lib/relay-url";
import { listChannels, type Channel } from "../channel-api";
import {
  CHANNEL_MUTES_UPDATED_EVENT,
  readMutedChannelIds,
} from "../use-channel-mutes";
import {
  readThreadNotificationPreferences,
  THREAD_NOTIFICATION_PREFERENCES_EVENT,
} from "../use-thread-follows";

const CONTENT_KINDS = [9, 40002, 40008, 40099, 45001, 45003];
const ACTIVE_CHANNEL_EVENT = "buzz-web:active-notification-channel";
const INTEREST_STORAGE_PREFIX = "buzz-thread-interest.v1";
const MAX_INTEREST_IDS = 500;
const MAX_SEEN_IDS = 1_000;
const EVENT_ID_PATTERN = /^[0-9a-f]{64}$/u;

type ThreadInterest = {
  authoredRootIds: Set<string>;
  participatedRootIds: Set<string>;
};

type NotificationPreferences = ThreadInterest & {
  followedRootIds: Set<string>;
  mutedChannelIds: Set<string>;
  mutedRootIds: Set<string>;
};

export function setActiveNotificationChannel(channelId: string | null) {
  window.dispatchEvent(
    new CustomEvent(ACTIVE_CHANNEL_EVENT, { detail: channelId }),
  );
}

export function useActiveNotificationChannel(channelId: string | null) {
  useEffect(() => {
    setActiveNotificationChannel(channelId);
    return () => setActiveNotificationChannel(null);
  }, [channelId]);
}

function interestStorageKey(ownerPubkey: string) {
  return `${INTEREST_STORAGE_PREFIX}:${ownerPubkey}`;
}

function validInterestIds(value: unknown) {
  if (!Array.isArray(value)) return new Set<string>();
  return new Set(
    value
      .filter(
        (candidate): candidate is string =>
          typeof candidate === "string" && EVENT_ID_PATTERN.test(candidate),
      )
      .slice(-MAX_INTEREST_IDS),
  );
}

function readThreadInterest(ownerPubkey: string): ThreadInterest {
  try {
    const raw = localStorage.getItem(interestStorageKey(ownerPubkey));
    const value = raw ? (JSON.parse(raw) as unknown) : null;
    if (!value || typeof value !== "object" || Array.isArray(value))
      throw new Error("Invalid thread interest");
    const candidate = value as Record<string, unknown>;
    return {
      authoredRootIds: validInterestIds(candidate.authoredRootIds),
      participatedRootIds: validInterestIds(candidate.participatedRootIds),
    };
  } catch {
    return { authoredRootIds: new Set(), participatedRootIds: new Set() };
  }
}

function writeThreadInterest(ownerPubkey: string, interest: ThreadInterest) {
  try {
    localStorage.setItem(
      interestStorageKey(ownerPubkey),
      JSON.stringify({
        authoredRootIds: [...interest.authoredRootIds].slice(-MAX_INTEREST_IDS),
        participatedRootIds: [...interest.participatedRootIds].slice(
          -MAX_INTEREST_IDS,
        ),
      }),
    );
  } catch {
    // Thread interest is best-effort per-browser notification state.
  }
}

function threadReference(tags: string[][]) {
  const eventTags = tags.filter(
    (tag) => tag[0] === "e" && EVENT_ID_PATTERN.test(tag[1] ?? ""),
  );
  const rootTag = eventTags.find((tag) => tag[3] === "root");
  const replyTag = [...eventTags].reverse().find((tag) => tag[3] === "reply");
  const parentId = replyTag?.[1] ?? null;
  return { parentId, rootId: rootTag?.[1] ?? parentId };
}

function recordOwnerInterest(event: NostrEvent, interest: ThreadInterest) {
  const { parentId, rootId } = threadReference(event.tags);
  if (parentId && rootId) interest.participatedRootIds.add(rootId);
  else interest.authoredRootIds.add(event.id);
  while (interest.authoredRootIds.size > MAX_INTEREST_IDS)
    interest.authoredRootIds.delete(
      interest.authoredRootIds.values().next().value ?? "",
    );
  while (interest.participatedRootIds.size > MAX_INTEREST_IDS)
    interest.participatedRootIds.delete(
      interest.participatedRootIds.values().next().value ?? "",
    );
}

function readPreferences(ownerPubkey: string): NotificationPreferences {
  return {
    ...readThreadInterest(ownerPubkey),
    ...readThreadNotificationPreferences(ownerPubkey),
    mutedChannelIds: readMutedChannelIds(ownerPubkey),
  };
}

function notificationSlot(
  event: NostrEvent,
  channel: Channel,
  ownerPubkey: string,
  preferences: NotificationPreferences,
): SoundSlot | null {
  const directlyMentioned = event.tags.some(
    (tag) => tag[0] === "p" && tag[1]?.toLowerCase() === ownerPubkey,
  );
  if (channel.channelType === "dm") return directlyMentioned ? "dm" : null;
  if (directlyMentioned) return "mention";

  const broadcast = event.tags.some(
    (tag) => tag[0] === "broadcast" && tag[1] === "1",
  );
  const { parentId, rootId } = threadReference(event.tags);
  if (!parentId || !rootId) return null;
  if (broadcast) return "thread_reply";
  if (preferences.mutedChannelIds.has(channel.id)) return null;
  if (preferences.mutedRootIds.has(rootId)) return null;
  return preferences.followedRootIds.has(rootId) ||
    preferences.participatedRootIds.has(rootId) ||
    preferences.authoredRootIds.has(rootId)
    ? "thread_reply"
    : null;
}

export function ChannelNotifier({
  ownerPubkey,
}: {
  ownerPubkey: string | null;
}) {
  const navigate = useNavigate();
  const [activeChannelId, setActiveChannelId] = useState<string | null>(null);
  const preferencesRef = useRef<NotificationPreferences | null>(null);
  const channelsQuery = useQuery({
    enabled: Boolean(ownerPubkey),
    queryKey: ["channels", ownerPubkey],
    queryFn: () => listChannels(ownerPubkey ?? ""),
    staleTime: 5_000,
    retry: false,
  });
  const channels = channelsQuery.data ?? [];
  const channelsById = useMemo(
    () => new Map(channels.map((channel) => [channel.id, channel])),
    [channels],
  );
  const channelIds = useMemo(
    () => channels.map((channel) => channel.id).sort(),
    [channels],
  );

  useEffect(() => {
    const updateActiveChannel = (event: Event) => {
      const channelId = (event as CustomEvent<unknown>).detail;
      setActiveChannelId(typeof channelId === "string" ? channelId : null);
    };
    window.addEventListener(ACTIVE_CHANNEL_EVENT, updateActiveChannel);
    return () =>
      window.removeEventListener(ACTIVE_CHANNEL_EVENT, updateActiveChannel);
  }, []);

  useEffect(() => {
    if (!ownerPubkey) {
      preferencesRef.current = null;
      return;
    }
    const update = () => {
      preferencesRef.current = readPreferences(ownerPubkey);
    };
    update();
    window.addEventListener(CHANNEL_MUTES_UPDATED_EVENT, update);
    window.addEventListener(THREAD_NOTIFICATION_PREFERENCES_EVENT, update);
    return () => {
      window.removeEventListener(CHANNEL_MUTES_UPDATED_EVENT, update);
      window.removeEventListener(THREAD_NOTIFICATION_PREFERENCES_EVENT, update);
    };
  }, [ownerPubkey]);

  useEffect(() => {
    if (!ownerPubkey || channelIds.length === 0) return;
    let cancelled = false;
    void queryEvents(
      relayWsUrl(),
      {
        kinds: CONTENT_KINDS,
        authors: [ownerPubkey],
        "#h": channelIds,
        limit: 1_000,
      },
      { requireNip07: true },
    )
      .then((events) => {
        if (cancelled) return;
        const preferences =
          preferencesRef.current ?? readPreferences(ownerPubkey);
        for (const event of events) recordOwnerInterest(event, preferences);
        writeThreadInterest(ownerPubkey, preferences);
        preferencesRef.current = preferences;
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [channelIds, ownerPubkey]);

  useEffect(() => {
    if (!ownerPubkey || channelIds.length === 0) return;
    const startedAt = Math.floor(Date.now() / 1_000);
    const seenIds = new Set<string>();
    const subscription = subscribeEvents(
      relayWsUrl(),
      { kinds: CONTENT_KINDS, "#h": channelIds, since: startedAt },
      (event) => {
        if (event.created_at < startedAt || seenIds.has(event.id)) return;
        seenIds.add(event.id);
        if (seenIds.size > MAX_SEEN_IDS)
          seenIds.delete(seenIds.values().next().value ?? "");
        const preferences =
          preferencesRef.current ?? readPreferences(ownerPubkey);
        if (event.pubkey.toLowerCase() === ownerPubkey) {
          recordOwnerInterest(event, preferences);
          writeThreadInterest(ownerPubkey, preferences);
          preferencesRef.current = preferences;
          return;
        }
        const channelId = event.tags.find((tag) => tag[0] === "h")?.[1];
        const channel = channelId ? channelsById.get(channelId) : undefined;
        if (!channel) return;
        const slot = notificationSlot(event, channel, ownerPubkey, preferences);
        if (!slot) return;
        const settings = readNotificationSettings(ownerPubkey);
        if (
          !settings.desktopEnabled ||
          !settings.slotAlertsEnabled[slot] ||
          (channelId === activeChannelId && !settings.notifyWhileViewing) ||
          typeof Notification === "undefined" ||
          Notification.permission !== "granted"
        )
          return;
        try {
          const notification = new Notification(
            channel.channelType === "dm" ? channel.name : `#${channel.name}`,
            {
              body: event.content.slice(0, 240),
              silent: true,
              tag: event.id,
            },
          );
          playNotificationSound(settings.sounds[slot]);
          notification.onclick = () => {
            window.focus();
            notification.close();
            void navigate({
              to: "/channels",
              search: { channel: channel.id, message: event.id },
            });
          };
        } catch {
          // Browser notification delivery is best-effort after permission.
        }
      },
      { requireNip07: true },
    );
    return subscription.close;
  }, [activeChannelId, channelIds, channelsById, navigate, ownerPubkey]);

  return null;
}
