import { useCallback, useEffect, useMemo, useState } from "react";

const FOLLOWS_PREFIX = "buzz-thread-follows.v1";
const MUTED_PREFIX = "buzz-thread-muted.v1";
const MAX_ENTRIES = 500;
export const THREAD_NOTIFICATION_PREFERENCES_EVENT =
  "buzz-web:thread-notification-preferences";

type FollowEntry = { rootId: string; followedAt: number };

function key(prefix: string, pubkey: string) {
  return `${prefix}:${pubkey}`;
}

function readFollows(pubkey: string): FollowEntry[] {
  try {
    const value = JSON.parse(
      localStorage.getItem(key(FOLLOWS_PREFIX, pubkey)) ?? "[]",
    ) as unknown;
    if (!Array.isArray(value)) return [];
    return value.filter(
      (entry): entry is FollowEntry =>
        Boolean(entry) &&
        typeof entry === "object" &&
        typeof (entry as FollowEntry).rootId === "string" &&
        typeof (entry as FollowEntry).followedAt === "number",
    );
  } catch {
    return [];
  }
}

function readMuted(pubkey: string) {
  try {
    const value = JSON.parse(
      localStorage.getItem(key(MUTED_PREFIX, pubkey)) ?? "[]",
    ) as unknown;
    return new Set(
      Array.isArray(value)
        ? value.filter((rootId): rootId is string => typeof rootId === "string")
        : [],
    );
  } catch {
    return new Set<string>();
  }
}

function writeValue(prefix: string, pubkey: string, value: unknown) {
  try {
    localStorage.setItem(key(prefix, pubkey), JSON.stringify(value));
    window.dispatchEvent(new Event(THREAD_NOTIFICATION_PREFERENCES_EVENT));
    return true;
  } catch {
    return false;
  }
}

export function readThreadNotificationPreferences(pubkey: string) {
  return {
    followedRootIds: new Set(readFollows(pubkey).map((entry) => entry.rootId)),
    mutedRootIds: readMuted(pubkey),
  };
}

export function useThreadFollows(ownerPubkey: string) {
  const [entries, setEntries] = useState(() => readFollows(ownerPubkey));
  const [mutedRootIds, setMutedRootIds] = useState(() =>
    readMuted(ownerPubkey),
  );

  useEffect(() => {
    setEntries(readFollows(ownerPubkey));
    setMutedRootIds(readMuted(ownerPubkey));
  }, [ownerPubkey]);

  const followedRootIds = useMemo(
    () => new Set(entries.map((entry) => entry.rootId)),
    [entries],
  );

  const followThread = useCallback(
    (rootId: string) => {
      setEntries((current) => {
        if (current.some((entry) => entry.rootId === rootId)) return current;
        const next = [...current, { rootId, followedAt: Date.now() }]
          .sort((left, right) => right.followedAt - left.followedAt)
          .slice(0, MAX_ENTRIES);
        return writeValue(FOLLOWS_PREFIX, ownerPubkey, next) ? next : current;
      });
      setMutedRootIds((current) => {
        if (!current.has(rootId)) return current;
        const next = new Set(current);
        next.delete(rootId);
        return writeValue(MUTED_PREFIX, ownerPubkey, [...next])
          ? next
          : current;
      });
    },
    [ownerPubkey],
  );

  const unfollowThread = useCallback(
    (rootId: string) => {
      setEntries((current) => {
        const next = current.filter((entry) => entry.rootId !== rootId);
        return writeValue(FOLLOWS_PREFIX, ownerPubkey, next) ? next : current;
      });
      setMutedRootIds((current) => {
        if (current.has(rootId)) return current;
        const next = new Set(current).add(rootId);
        return writeValue(MUTED_PREFIX, ownerPubkey, [...next])
          ? next
          : current;
      });
    },
    [ownerPubkey],
  );

  return { followedRootIds, mutedRootIds, followThread, unfollowThread };
}
