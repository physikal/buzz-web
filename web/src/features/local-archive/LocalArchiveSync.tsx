import { useEffect } from "react";

import {
  subscribeEvents,
  type LiveSubscription,
  type NostrFilter,
} from "@/shared/lib/nostr-client";
import { relayWsUrl } from "@/shared/lib/relay-url";
import { nip44DecryptFromPeer } from "@/shared/lib/nostr-signer";
import { parseAgentTurnMetric } from "./agent-turn-metric";
import {
  archiveVerifiedEvents,
  listArchiveSubscriptions,
  onArchiveSubscriptionChange,
  type ArchiveCandidate,
  type ArchiveSubscription,
} from "./local-archive-store";

const FLUSH_BATCH_SIZE = 25;
const FLUSH_IDLE_MS = 2_000;

function subscriptionKey(subscription: ArchiveSubscription) {
  return JSON.stringify([
    subscription.scopeType,
    subscription.scopeValue,
    subscription.kinds,
  ]);
}

function subscriptionFilter(subscription: ArchiveSubscription): NostrFilter {
  const filter: NostrFilter = { kinds: subscription.kinds, limit: 0 };
  if (subscription.scopeType === "channel_h") {
    filter["#h"] = [subscription.scopeValue];
  } else if (subscription.scopeType === "owner_p") {
    filter["#p"] = [subscription.scopeValue];
  } else {
    filter["#e"] = [subscription.scopeValue];
  }
  return filter;
}

export function LocalArchiveSync({
  ownerPubkey,
}: {
  ownerPubkey: string | null;
}) {
  useEffect(() => {
    if (!ownerPubkey) return;
    const relayUrl = relayWsUrl();
    const active = new Map<string, LiveSubscription>();
    const buffer: ArchiveCandidate[] = [];
    let flushTimer: ReturnType<typeof setTimeout> | null = null;
    let stopped = false;
    let reloadGeneration = 0;

    const flush = () => {
      if (flushTimer) clearTimeout(flushTimer);
      flushTimer = null;
      const candidates = buffer.splice(0, FLUSH_BATCH_SIZE);
      if (candidates.length === 0) return;
      void archiveVerifiedEvents({ ownerPubkey, relayUrl, candidates }).catch(
        (error: unknown) =>
          console.warn("[LocalArchiveSync] archive write failed:", error),
      );
      if (buffer.length > 0) flushTimer = setTimeout(flush, FLUSH_IDLE_MS);
    };

    const enqueue = (candidate: ArchiveCandidate) => {
      if (stopped) return;
      buffer.push(candidate);
      if (buffer.length >= FLUSH_BATCH_SIZE) flush();
      else if (!flushTimer) flushTimer = setTimeout(flush, FLUSH_IDLE_MS);
    };

    const reload = async () => {
      const generation = ++reloadGeneration;
      try {
        const subscriptions = await listArchiveSubscriptions(
          ownerPubkey,
          relayUrl,
        );
        if (stopped || generation !== reloadGeneration) return;
        const wanted = new Set(subscriptions.map(subscriptionKey));
        for (const [key, live] of active) {
          if (!wanted.has(key)) {
            live.close();
            active.delete(key);
          }
        }
        for (const subscription of subscriptions) {
          const key = subscriptionKey(subscription);
          if (active.has(key)) continue;
          active.set(
            key,
            subscribeEvents(
              relayUrl,
              subscriptionFilter(subscription),
              (event) => {
                const candidate = {
                  event,
                  scopeType: subscription.scopeType,
                  scopeValue: subscription.scopeValue,
                } as ArchiveCandidate;
                if (event.kind !== 44_200) {
                  enqueue(candidate);
                  return;
                }
                void nip44DecryptFromPeer(event.pubkey, event.content)
                  .then(parseAgentTurnMetric)
                  .then((storedJson) => enqueue({ ...candidate, storedJson }))
                  .catch(() => {
                    // Metrics that fail decrypt or protocol validation are dropped.
                  });
              },
              { requireNip07: true },
            ),
          );
        }
      } catch (error) {
        console.warn("[LocalArchiveSync] subscription load failed:", error);
      }
    };

    const unsubscribeChanges = onArchiveSubscriptionChange(() => void reload());
    void reload();
    return () => {
      stopped = true;
      reloadGeneration += 1;
      unsubscribeChanges();
      for (const live of active.values()) live.close();
      active.clear();
      if (flushTimer) clearTimeout(flushTimer);
      flushTimer = null;
      while (buffer.length > 0) {
        const candidates = buffer.splice(0, FLUSH_BATCH_SIZE);
        void archiveVerifiedEvents({ ownerPubkey, relayUrl, candidates }).catch(
          (error: unknown) =>
            console.warn(
              "[LocalArchiveSync] final archive write failed:",
              error,
            ),
        );
      }
    };
  }, [ownerPubkey]);

  return null;
}
