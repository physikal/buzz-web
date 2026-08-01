import { useEffect, useMemo, useState } from "react";

import { subscribeEvents, type NostrEvent } from "@/shared/lib/nostr-client";
import { relayWsUrl } from "@/shared/lib/relay-url";

type TypingEntry = {
  pubkey: string;
  threadId: string | null;
  expiresAt: number;
};

function threadId(event: NostrEvent): string | null {
  return (
    event.tags.find(
      (tag) => tag[0] === "e" && (tag[3] === "reply" || tag[3] === "root"),
    )?.[1] ?? null
  );
}

export function useTypingIndicators({
  channelId,
  channelType,
  ownerPubkey,
}: {
  channelId: string | null;
  channelType: string | null;
  ownerPubkey: string;
}) {
  const [entries, setEntries] = useState<Record<string, TypingEntry>>({});

  useEffect(() => {
    setEntries({});
    if (!channelId || channelType === "forum") return;
    const subscription = subscribeEvents(
      relayWsUrl(),
      {
        kinds: [20002],
        "#h": [channelId],
        since: Math.floor(Date.now() / 1000),
      },
      (event) => {
        if (event.pubkey === ownerPubkey) return;
        const expiresAt = event.created_at * 1_000 + 8_000;
        if (expiresAt <= Date.now()) return;
        const scope = threadId(event);
        setEntries((current) => ({
          ...current,
          [`${event.pubkey}:${scope ?? "channel"}`]: {
            pubkey: event.pubkey,
            threadId: scope,
            expiresAt,
          },
        }));
      },
      { requireNip07: true },
    );
    return subscription.close;
  }, [channelId, channelType, ownerPubkey]);

  useEffect(() => {
    if (!Object.keys(entries).length) return;
    const timer = window.setInterval(() => {
      const now = Date.now();
      setEntries((current) =>
        Object.fromEntries(
          Object.entries(current).filter(([, entry]) => entry.expiresAt > now),
        ),
      );
    }, 1_000);
    return () => window.clearInterval(timer);
  }, [entries]);

  return useMemo(() => Object.values(entries), [entries]);
}
