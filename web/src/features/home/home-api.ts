import {
  queryEventsHttp,
  subscribeEvents,
  type NostrEvent,
} from "@/shared/lib/nostr-client";
import { relayWsUrl } from "@/shared/lib/relay-url";

export const INBOX_MENTION_KINDS = [
  1, 9, 1618, 1619, 1621, 1630, 1631, 1632, 1633, 40002, 45001, 45003,
];
export const INBOX_ACTION_KINDS = [46010, 46011, 46012];

export type InboxCategory = "mention" | "needs_action";

export type InboxItem = {
  id: string;
  pubkey: string;
  kind: number;
  content: string;
  tags: string[][];
  createdAt: number;
  category: InboxCategory;
  channelId: string | null;
  rootId: string | null;
};

function inboxItem(event: NostrEvent): InboxItem {
  return {
    id: event.id,
    pubkey: event.pubkey,
    kind: event.kind,
    content: event.content,
    tags: event.tags,
    createdAt: event.created_at,
    category: INBOX_ACTION_KINDS.includes(event.kind)
      ? "needs_action"
      : "mention",
    channelId: event.tags.find((tag) => tag[0] === "h")?.[1]?.trim() || null,
    rootId:
      event.tags.find((tag) => tag[0] === "e" && tag[3] === "root")?.[1] ??
      null,
  };
}

export async function listInboxItems(ownerPubkey: string) {
  const events = await queryEventsHttp([
    {
      kinds: INBOX_MENTION_KINDS,
      "#p": [ownerPubkey],
      limit: 100,
    },
    {
      kinds: INBOX_ACTION_KINDS,
      "#p": [ownerPubkey],
      limit: 20,
    },
  ]);
  return [
    ...new Map(events.map((event) => [event.id, inboxItem(event)])).values(),
  ].sort((left, right) => right.createdAt - left.createdAt);
}

export function subscribeInbox(
  ownerPubkey: string,
  onItem: (item: InboxItem) => void,
) {
  const subscription = subscribeEvents(
    relayWsUrl(),
    [
      { kinds: INBOX_MENTION_KINDS, "#p": [ownerPubkey] },
      { kinds: INBOX_ACTION_KINDS, "#p": [ownerPubkey] },
    ],
    (event) => onItem(inboxItem(event)),
    { requireNip07: true },
  );
  return subscription.close;
}
