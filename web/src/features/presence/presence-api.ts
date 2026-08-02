import {
  type NostrEvent,
  subscribeEvents,
  validNostrEvent,
} from "@/shared/lib/nostr-client";
import { makeNip98AuthHeader } from "@/shared/lib/nip98";
import { relayHttpBaseUrl, relayWsUrl } from "@/shared/lib/relay-url";
import { sendPresence } from "@/features/channels/channel-api";

export type PresenceStatus = "online" | "away" | "offline";

export type UserStatus = {
  text: string;
  emoji: string;
  updatedAt: number;
};

function normalizedPubkeys(pubkeys: string[]) {
  return [...new Set(pubkeys.map((value) => value.trim().toLowerCase()))]
    .filter((value) => /^[0-9a-f]{64}$/.test(value))
    .sort();
}

function parseLivePresence(event: NostrEvent) {
  if (!(["online", "away", "offline"] as string[]).includes(event.content))
    return null;
  return {
    pubkey: event.pubkey.toLowerCase(),
    status: event.content as PresenceStatus,
  };
}

export async function listPresence(pubkeys: string[]) {
  const authors = normalizedPubkeys(pubkeys);
  if (!authors.length) return new Map<string, PresenceStatus>();
  const events = await authenticatedQuery({
    kinds: [20001],
    authors,
    limit: authors.length,
  });
  const result = new Map<string, PresenceStatus>();
  for (const event of events) {
    const subject = event.tags.find(
      (tag) => tag[0] === "p" && authors.includes(tag[1] ?? ""),
    )?.[1];
    if (
      subject &&
      (["online", "away", "offline"] as string[]).includes(event.content)
    )
      result.set(subject, event.content as PresenceStatus);
  }
  return result;
}

export async function listUserStatuses(pubkeys: string[]) {
  const authors = normalizedPubkeys(pubkeys);
  if (!authors.length) return new Map<string, UserStatus>();
  const events = await authenticatedQuery({
    kinds: [30315],
    authors,
    "#d": ["general"],
    limit: Math.max(authors.length * 2, 20),
  });
  const latest = new Map<string, NostrEvent>();
  for (const event of events) {
    if (!authors.includes(event.pubkey) || event.content.length > 160) continue;
    const current = latest.get(event.pubkey);
    if (!current || current.created_at < event.created_at)
      latest.set(event.pubkey, event);
  }
  return new Map(
    [...latest].flatMap(([pubkey, event]) => {
      const emoji =
        event.tags.find(
          (tag) => tag[0] === "emoji" && (tag[1]?.length ?? 0) <= 64,
        )?.[1] ?? "";
      if (!event.content && !emoji) return [];
      return [
        [
          pubkey,
          { text: event.content, emoji, updatedAt: event.created_at },
        ] as const,
      ];
    }),
  );
}

export function subscribePresence(
  pubkeys: string[],
  onUpdate: (pubkey: string, status: PresenceStatus) => void,
) {
  const authors = normalizedPubkeys(pubkeys);
  if (!authors.length) return () => {};
  const subscription = subscribeEvents(
    relayWsUrl(),
    { kinds: [20001], authors },
    (event) => {
      const parsed = parseLivePresence(event);
      if (parsed && authors.includes(parsed.pubkey))
        onUpdate(parsed.pubkey, parsed.status);
    },
    { requireNip07: true },
  );
  return subscription.close;
}

export { sendPresence };

async function authenticatedQuery(filter: Record<string, unknown>) {
  const url = `${relayHttpBaseUrl()}/query`;
  const body = JSON.stringify([filter]);
  const authorization = await makeNip98AuthHeader(url, "POST", {
    body,
    requireNip07: true,
  });
  const response = await fetch(url, {
    method: "POST",
    headers: {
      Accept: "application/json",
      Authorization: authorization,
      "Content-Type": "application/json",
    },
    body,
  });
  const payload = (await response.json().catch(() => null)) as unknown;
  if (!response.ok)
    throw new Error(
      payload &&
        typeof payload === "object" &&
        "error" in payload &&
        typeof payload.error === "string"
        ? payload.error
        : `Presence query failed (${response.status}).`,
    );
  if (!Array.isArray(payload)) throw new Error("Invalid relay query response.");
  return payload.filter(validNostrEvent);
}
