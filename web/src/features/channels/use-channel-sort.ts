import { useCallback, useEffect, useRef, useState } from "react";

import { queryEvents, subscribeEvents } from "@/shared/lib/nostr-client";
import { submitEvent } from "@/shared/lib/relay-events";
import { relayWsUrl } from "@/shared/lib/relay-url";
import {
  nip44DecryptFromSelf,
  nip44EncryptToSelf,
} from "@/shared/lib/nostr-signer";

const KIND = 30078;
const D_TAG = "channel-sort";
const STORAGE_PREFIX = "buzz-channel-sort.v1";
const DEBOUNCE_MS = 2_000;

export type ChannelSortMode = "alpha" | "recent";
export type ChannelSortGroup =
  | "starred"
  | "channels"
  | "forums"
  | "dms"
  | `section:${string}`;
type SortStore = { version: 1; groups: Record<string, ChannelSortMode> };

const EMPTY_STORE: SortStore = { version: 1, groups: {} };

function storageKey(pubkey: string) {
  return `${STORAGE_PREFIX}:${pubkey}`;
}

function parseStore(value: unknown): SortStore | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Record<string, unknown>;
  if (candidate.version !== 1 || !candidate.groups) return null;
  const groups = Object.fromEntries(
    Object.entries(candidate.groups as Record<string, unknown>).filter(
      (entry): entry is [string, ChannelSortMode] =>
        entry[1] === "alpha" || entry[1] === "recent",
    ),
  );
  return { version: 1, groups };
}

function readStore(pubkey: string): SortStore {
  try {
    return (
      parseStore(JSON.parse(localStorage.getItem(storageKey(pubkey)) ?? "")) ??
      EMPTY_STORE
    );
  } catch {
    return EMPTY_STORE;
  }
}

function writeStore(pubkey: string, store: SortStore) {
  try {
    localStorage.setItem(storageKey(pubkey), JSON.stringify(store));
  } catch {
    // The encrypted relay copy remains the durable source when storage fails.
  }
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

export function useChannelSort(ownerPubkey: string) {
  const [store, setStore] = useState<SortStore>(() => readStore(ownerPubkey));
  const storeRef = useRef(store);
  const publishTimerRef = useRef<number | null>(null);
  const lastRemoteCreatedAtRef = useRef(0);
  storeRef.current = store;

  const applyStore = useCallback(
    (next: SortStore) => {
      writeStore(ownerPubkey, next);
      storeRef.current = next;
      setStore(next);
    },
    [ownerPubkey],
  );

  const publish = useCallback(async () => {
    const remote = await fetchRemote(ownerPubkey).catch(() => null);
    const next =
      remote && remote.createdAt > lastRemoteCreatedAtRef.current
        ? remote.store
        : storeRef.current;
    const createdAt = Math.max(
      Math.floor(Date.now() / 1_000),
      (remote?.createdAt ?? lastRemoteCreatedAtRef.current) + 1,
    );
    const content = await nip44EncryptToSelf(JSON.stringify(next));
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
    applyStore(next);
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
          applyStore(remote.store);
        } else if (Object.keys(readStore(ownerPubkey).groups).length) {
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
          applyStore(remote);
        });
      },
      { requireNip07: true },
    );
    return () => {
      cancelled = true;
      subscription.close();
      if (publishTimerRef.current !== null) {
        window.clearTimeout(publishTimerRef.current);
        publishTimerRef.current = null;
        void publish().catch(() => {});
      }
    };
  }, [applyStore, ownerPubkey, publish, schedulePublish]);

  const sortModeFor = useCallback(
    (group: ChannelSortGroup): ChannelSortMode =>
      store.groups[group] ?? "alpha",
    [store.groups],
  );
  const setSortMode = useCallback(
    (group: ChannelSortGroup, mode: ChannelSortMode) => {
      const next: SortStore = {
        version: 1,
        groups: { ...storeRef.current.groups, [group]: mode },
      };
      applyStore(next);
      schedulePublish();
    },
    [applyStore, schedulePublish],
  );

  return { sortModeFor, setSortMode };
}
