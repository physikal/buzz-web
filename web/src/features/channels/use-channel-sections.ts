import { useCallback, useEffect, useRef, useState } from "react";

import { queryEvents, subscribeEvents } from "@/shared/lib/nostr-client";
import { submitEvent } from "@/shared/lib/relay-events";
import { relayWsUrl } from "@/shared/lib/relay-url";
import {
  nip44DecryptFromSelf,
  nip44EncryptToSelf,
} from "@/shared/lib/nostr-signer";

const KIND = 30078;
const D_TAG = "channel-sections";
const STORAGE_PREFIX = "buzz-channel-sections.v1";
const DEBOUNCE_MS = 2_000;

export type ChannelSection = {
  id: string;
  name: string;
  icon?: string;
  order: number;
};
type SectionStore = {
  version: 1;
  sections: ChannelSection[];
  assignments: Record<string, string>;
};

const EMPTY_STORE: SectionStore = { version: 1, sections: [], assignments: {} };

function storageKey(pubkey: string) {
  return `${STORAGE_PREFIX}:${pubkey}`;
}

function parseStore(value: unknown): SectionStore | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Record<string, unknown>;
  if (candidate.version !== 1) return null;
  const sections = Array.isArray(candidate.sections)
    ? candidate.sections.flatMap((raw): ChannelSection[] => {
        if (!raw || typeof raw !== "object") return [];
        const section = raw as Record<string, unknown>;
        if (
          typeof section.id !== "string" ||
          typeof section.name !== "string" ||
          typeof section.order !== "number" ||
          !Number.isFinite(section.order)
        )
          return [];
        const icon =
          typeof section.icon === "string" && section.icon.trim()
            ? section.icon.trim()
            : undefined;
        return [
          {
            id: section.id,
            name: section.name,
            order: section.order,
            ...(icon ? { icon } : {}),
          },
        ];
      })
    : [];
  const sectionIds = new Set(sections.map((section) => section.id));
  const assignments = Object.fromEntries(
    candidate.assignments && typeof candidate.assignments === "object"
      ? Object.entries(candidate.assignments as Record<string, unknown>).filter(
          (entry): entry is [string, string] =>
            typeof entry[1] === "string" && sectionIds.has(entry[1]),
        )
      : [],
  );
  return { version: 1, sections, assignments };
}

function readStore(pubkey: string): SectionStore {
  try {
    return (
      parseStore(JSON.parse(localStorage.getItem(storageKey(pubkey)) ?? "")) ??
      EMPTY_STORE
    );
  } catch {
    return EMPTY_STORE;
  }
}

function writeStore(pubkey: string, store: SectionStore) {
  try {
    localStorage.setItem(storageKey(pubkey), JSON.stringify(store));
    return true;
  } catch {
    return false;
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

export function useChannelSections(ownerPubkey: string) {
  const [store, setStore] = useState<SectionStore>(() =>
    readStore(ownerPubkey),
  );
  const storeRef = useRef(store);
  const publishTimerRef = useRef<number | null>(null);
  const lastRemoteCreatedAtRef = useRef(0);
  storeRef.current = store;

  const applyStore = useCallback(
    (next: SectionStore) => {
      if (!writeStore(ownerPubkey, next)) return false;
      storeRef.current = next;
      setStore(next);
      return true;
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
        } else if (readStore(ownerPubkey).sections.length) schedulePublish();
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

  const update = useCallback(
    (mutate: (current: SectionStore) => SectionStore) => {
      const next = mutate(storeRef.current);
      if (applyStore(next)) schedulePublish();
    },
    [applyStore, schedulePublish],
  );
  const createSection = useCallback(
    (name: string, icon?: string) => {
      const section: ChannelSection = {
        id: crypto.randomUUID(),
        name: name.trim(),
        icon: icon?.trim() || undefined,
        order:
          Math.max(-1, ...storeRef.current.sections.map((item) => item.order)) +
          1,
      };
      update((current) => ({
        ...current,
        sections: [...current.sections, section],
      }));
      return section;
    },
    [update],
  );
  const renameSection = useCallback(
    (id: string, name: string, icon?: string) =>
      update((current) => ({
        ...current,
        sections: current.sections.map((section) =>
          section.id === id
            ? { ...section, name: name.trim(), icon: icon?.trim() || undefined }
            : section,
        ),
      })),
    [update],
  );
  const deleteSection = useCallback(
    (id: string) =>
      update((current) => ({
        ...current,
        sections: current.sections.filter((section) => section.id !== id),
        assignments: Object.fromEntries(
          Object.entries(current.assignments).filter(
            ([, sectionId]) => sectionId !== id,
          ),
        ),
      })),
    [update],
  );
  const assignChannel = useCallback(
    (channelId: string, sectionId: string | null) =>
      update((current) => {
        const assignments = { ...current.assignments };
        if (sectionId) assignments[channelId] = sectionId;
        else delete assignments[channelId];
        return { ...current, assignments };
      }),
    [update],
  );
  const moveSection = useCallback(
    (id: string, direction: -1 | 1) =>
      update((current) => {
        const ordered = [...current.sections].sort((a, b) => a.order - b.order);
        const index = ordered.findIndex((section) => section.id === id);
        const swapIndex = index + direction;
        if (index < 0 || swapIndex < 0 || swapIndex >= ordered.length)
          return current;
        [ordered[index], ordered[swapIndex]] = [
          ordered[swapIndex],
          ordered[index],
        ];
        return {
          ...current,
          sections: ordered.map((section, order) => ({ ...section, order })),
        };
      }),
    [update],
  );

  return {
    sections: [...store.sections].sort((a, b) => a.order - b.order),
    assignments: store.assignments,
    createSection,
    renameSection,
    deleteSection,
    assignChannel,
    moveSection,
  };
}
