import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { queryEvents, subscribeEvents } from "@/shared/lib/nostr-client";
import { submitEvent } from "@/shared/lib/relay-events";
import { relayWsUrl } from "@/shared/lib/relay-url";
import {
  nip44DecryptFromSelf,
  nip44EncryptToSelf,
} from "@/shared/lib/nostr-signer";

const KIND = 30078;
const D_TAG = "channel-stars";
const STORAGE_PREFIX = "buzz-channel-stars.v1";
const DEBOUNCE_MS = 2_000;

type StarEntry = { starred: boolean; updatedAt: number };
type StarStore = { version: 1; channels: Record<string, StarEntry> };

const EMPTY_STORE: StarStore = { version: 1, channels: {} };

function storageKey(pubkey: string) {
  return `${STORAGE_PREFIX}:${pubkey}`;
}

function parseStore(value: unknown): StarStore | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Record<string, unknown>;
  if (candidate.version !== 1 || !candidate.channels) return null;
  const channels = Object.fromEntries(
    Object.entries(candidate.channels as Record<string, unknown>).flatMap(
      ([id, raw]) => {
        if (!raw || typeof raw !== "object") return [];
        const entry = raw as Record<string, unknown>;
        if (
          typeof entry.starred !== "boolean" ||
          typeof entry.updatedAt !== "number" ||
          !Number.isFinite(entry.updatedAt) ||
          entry.updatedAt < 0
        )
          return [];
        return [[id, { starred: entry.starred, updatedAt: entry.updatedAt }]];
      },
    ),
  );
  return { version: 1, channels };
}

function readStore(pubkey: string): StarStore {
  try {
    return (
      parseStore(JSON.parse(localStorage.getItem(storageKey(pubkey)) ?? "")) ??
      EMPTY_STORE
    );
  } catch {
    return EMPTY_STORE;
  }
}

function writeStore(pubkey: string, store: StarStore) {
  localStorage.setItem(storageKey(pubkey), JSON.stringify(store));
}

function mergeStores(left: StarStore, right: StarStore): StarStore {
  const channels = { ...left.channels };
  for (const [id, entry] of Object.entries(right.channels)) {
    if (!channels[id] || channels[id].updatedAt < entry.updatedAt)
      channels[id] = entry;
  }
  return { version: 1, channels };
}

async function decodeEvent(event: { content: string }) {
  try {
    return parseStore(JSON.parse(await nip44DecryptFromSelf(event.content)));
  } catch {
    return null;
  }
}

async function fetchRemote(pubkey: string) {
  const events = await queryEvents(
    relayWsUrl(),
    { kinds: [KIND], authors: [pubkey], "#d": [D_TAG], limit: 5 },
    { requireNip07: true },
  );
  for (const event of events.sort(
    (a, b) => b.created_at - a.created_at || b.id.localeCompare(a.id),
  )) {
    if (event.pubkey !== pubkey) continue;
    const store = await decodeEvent(event);
    if (store) return { store, createdAt: event.created_at };
  }
  return null;
}

export function useChannelStars(ownerPubkey: string) {
  const [store, setStore] = useState<StarStore>(() => readStore(ownerPubkey));
  const storeRef = useRef(store);
  const publishTimerRef = useRef<number | null>(null);
  const lastRemoteCreatedAtRef = useRef(0);
  storeRef.current = store;

  const applyStore = useCallback(
    (next: StarStore) => {
      writeStore(ownerPubkey, next);
      storeRef.current = next;
      setStore(next);
    },
    [ownerPubkey],
  );

  const publish = useCallback(async () => {
    const local = storeRef.current;
    const remote = await fetchRemote(ownerPubkey).catch(() => null);
    const merged = remote ? mergeStores(local, remote.store) : local;
    const createdAt = Math.max(
      Math.floor(Date.now() / 1_000),
      (remote?.createdAt ?? lastRemoteCreatedAtRef.current) + 1,
    );
    const content = await nip44EncryptToSelf(JSON.stringify(merged));
    const { event } = await submitEvent({
      kind: KIND,
      created_at: createdAt,
      content,
      tags: [
        ["d", D_TAG],
        ["t", D_TAG],
      ],
    });
    lastRemoteCreatedAtRef.current = event.created_at;
    applyStore(merged);
  }, [applyStore, ownerPubkey]);

  const schedulePublish = useCallback(() => {
    if (publishTimerRef.current !== null)
      window.clearTimeout(publishTimerRef.current);
    publishTimerRef.current = window.setTimeout(() => {
      publishTimerRef.current = null;
      void publish().catch(() => {});
    }, DEBOUNCE_MS);
  }, [publish]);

  useEffect(() => {
    let cancelled = false;
    setStore(readStore(ownerPubkey));
    void fetchRemote(ownerPubkey)
      .then((remote) => {
        if (cancelled) return;
        if (remote) {
          lastRemoteCreatedAtRef.current = remote.createdAt;
          applyStore(mergeStores(readStore(ownerPubkey), remote.store));
        } else if (Object.keys(readStore(ownerPubkey).channels).length) {
          schedulePublish();
        }
      })
      .catch(() => {});
    const subscription = subscribeEvents(
      relayWsUrl(),
      { kinds: [KIND], authors: [ownerPubkey], "#d": [D_TAG] },
      (event) => {
        if (event.pubkey !== ownerPubkey) return;
        void decodeEvent(event).then((remote) => {
          if (!remote || cancelled) return;
          lastRemoteCreatedAtRef.current = Math.max(
            lastRemoteCreatedAtRef.current,
            event.created_at,
          );
          applyStore(mergeStores(storeRef.current, remote));
        });
      },
      { requireNip07: true },
    );
    const handleStorage = (event: StorageEvent) => {
      if (event.key === storageKey(ownerPubkey))
        setStore(readStore(ownerPubkey));
    };
    window.addEventListener("storage", handleStorage);
    return () => {
      cancelled = true;
      subscription.close();
      window.removeEventListener("storage", handleStorage);
      if (publishTimerRef.current !== null) {
        window.clearTimeout(publishTimerRef.current);
        publishTimerRef.current = null;
        void publish().catch(() => {});
      }
    };
  }, [applyStore, ownerPubkey, publish, schedulePublish]);

  const starredChannelIds = useMemo(
    () =>
      new Set(
        Object.entries(store.channels)
          .filter(([, entry]) => entry.starred)
          .map(([id]) => id),
      ),
    [store],
  );
  const setStarred = useCallback(
    (channelId: string, starred: boolean) => {
      const next = {
        version: 1,
        channels: {
          ...storeRef.current.channels,
          [channelId]: {
            starred,
            updatedAt: Math.floor(Date.now() / 1_000),
          },
        },
      } satisfies StarStore;
      applyStore(next);
      schedulePublish();
    },
    [applyStore, schedulePublish],
  );

  return { starredChannelIds, setStarred };
}
