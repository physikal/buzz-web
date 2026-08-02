import type { Channel, UserProfile } from "@/features/channels/channel-api";
import type { NostrEvent } from "@/shared/lib/nostr-client";
import { truncatePubkey } from "@/shared/lib/pubkey";

export type ParsedSearchOperators = {
  text: string;
  from: string | null;
  in: string | null;
  since: number | null;
  until: number | null;
};

const OPERATOR_RE = /(?:^|\s)(from|in|after|before):(\S+)/gi;
const HEX_PUBKEY_RE = /^[0-9a-f]{64}$/i;
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function parseLocalDayStart(value: string): number | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(year, month - 1, day);
  if (
    date.getFullYear() !== year ||
    date.getMonth() !== month - 1 ||
    date.getDate() !== day
  )
    return null;
  return Math.floor(date.getTime() / 1_000);
}

export function parseSearchOperators(raw: string): ParsedSearchOperators {
  let from: string | null = null;
  let inValue: string | null = null;
  let since: number | null = null;
  let until: number | null = null;
  const kept: string[] = [];
  let lastIndex = 0;

  for (const match of raw.matchAll(OPERATOR_RE)) {
    const index = match.index ?? 0;
    kept.push(raw.slice(lastIndex, index));
    lastIndex = index + match[0].length;
    const kind = match[1].toLowerCase();
    const value = match[2].replace(/[.,;:!?]+$/g, "");
    if (kind === "from") from = value;
    else if (kind === "in") inValue = value;
    else if (kind === "after") {
      const parsed = parseLocalDayStart(value);
      if (parsed === null) kept.push(match[0]);
      else since = parsed;
    } else {
      const parsed = parseLocalDayStart(value);
      if (parsed === null) kept.push(match[0]);
      else until = parsed - 1;
    }
  }
  kept.push(raw.slice(lastIndex));
  return {
    text: kept.join("").replace(/\s+/g, " ").trim(),
    from,
    in: inValue,
    since,
    until,
  };
}

export function normalizeFromHandle(value: string) {
  return value.startsWith("@") ? value.slice(1) : value;
}

export function normalizeInChannel(value: string) {
  return value.startsWith("#") ? value.slice(1) : value;
}

export function isHexPubkey(value: string) {
  return HEX_PUBKEY_RE.test(value);
}

export function isChannelUuid(value: string) {
  return UUID_RE.test(value);
}

export function resolveMessageSearchInput(
  raw: string,
  channels: Array<Pick<Channel, "id" | "name">>,
  authors: Array<{ pubkey: string; name: string | null }>,
) {
  const parsed = parseSearchOperators(raw);
  const channelValue = parsed.in
    ? normalizeInChannel(parsed.in).toLowerCase()
    : null;
  const channelId = channelValue
    ? isChannelUuid(channelValue)
      ? channelValue
      : channels.find((channel) => channel.name.toLowerCase() === channelValue)
          ?.id
    : undefined;
  const authorValue = parsed.from
    ? normalizeFromHandle(parsed.from).toLowerCase()
    : null;
  const author = authorValue
    ? isHexPubkey(authorValue)
      ? authorValue
      : authors.find(
          (candidate) => candidate.name?.trim().toLowerCase() === authorValue,
        )?.pubkey
    : undefined;
  if ((parsed.in && !channelId) || (parsed.from && !author)) return null;
  return {
    text: parsed.text,
    channelId,
    authors: author ? [author] : undefined,
    since: parsed.since,
    until: parsed.until,
  };
}

export function toMessageSearchResult(
  event: NostrEvent,
  channels: Array<Pick<Channel, "id" | "name">>,
  agentNames: ReadonlyMap<string, string>,
  profiles: ReadonlyMap<string, UserProfile>,
) {
  const channelId = event.tags.find((tag) => tag[0] === "h")?.[1] ?? "";
  const rootId =
    event.tags.find((tag) => tag[0] === "e" && tag[3] === "root")?.[1] ?? null;
  return {
    id: event.id,
    channelId,
    channelName:
      channels.find((channel) => channel.id === channelId)?.name ?? "unknown",
    author: event.pubkey,
    authorName:
      agentNames.get(event.pubkey) ||
      profiles.get(event.pubkey)?.displayName ||
      truncatePubkey(event.pubkey),
    content: event.content,
    createdAt: event.created_at,
    rootId,
  };
}
