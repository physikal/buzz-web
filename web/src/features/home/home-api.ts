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
  projectAddress: string | null;
  isThread: boolean;
};

function inboxItem(event: NostrEvent): InboxItem {
  const projectAddress =
    event.tags.find(
      (tag) => tag[0] === "a" && /^30617:[0-9a-f]{64}:.+$/i.test(tag[1] ?? ""),
    )?.[1] ?? null;
  const threadTags = event.tags.filter((tag) => tag[0] === "e");
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
    projectAddress,
    isThread: threadTags.some(
      (tag) => tag[3] === "root" || tag[3] === "reply" || tag[3] === "parent",
    ),
  };
}

export async function listInboxItems(
  ownerPubkey: string,
  agentPubkeys: string[] = [],
) {
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
    ...(agentPubkeys.length
      ? [{ kinds: INBOX_MENTION_KINDS, authors: agentPubkeys, limit: 100 }]
      : []),
  ]);
  return [
    ...new Map(events.map((event) => [event.id, inboxItem(event)])).values(),
  ].sort((left, right) => right.createdAt - left.createdAt);
}

export function subscribeInbox(
  ownerPubkey: string,
  agentPubkeys: string[],
  onItem: (item: InboxItem) => void,
) {
  const subscription = subscribeEvents(
    relayWsUrl(),
    [
      { kinds: INBOX_MENTION_KINDS, "#p": [ownerPubkey] },
      { kinds: INBOX_ACTION_KINDS, "#p": [ownerPubkey] },
      ...(agentPubkeys.length
        ? [{ kinds: INBOX_MENTION_KINDS, authors: agentPubkeys }]
        : []),
    ],
    (event) => onItem(inboxItem(event)),
    { requireNip07: true },
  );
  return subscription.close;
}
