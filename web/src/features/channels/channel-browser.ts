import type { Channel } from "./channel-api";

export type ChannelBrowserSort = "alpha" | "recent" | "members";
export type ChannelBrowserView = "all" | "joined" | "archived";

const WORD_SEPARATORS = /[\s\-_./]+/;

export function canonicalChannelName(name: string): string {
  return name.replace(/^[#\s]+/u, "").trimEnd();
}

export function channelNamesMatch(left: string, right: string): boolean {
  return (
    canonicalChannelName(left).toLowerCase() ===
    canonicalChannelName(right).toLowerCase()
  );
}

function collapseSeparators(value: string): string {
  return value.replace(/[\s\-_./]+/g, "");
}

function isSubsequence(query: string, text: string): boolean {
  if (!query) return true;
  let queryIndex = 0;
  for (const char of text) {
    if (char !== query[queryIndex]) continue;
    queryIndex += 1;
    if (queryIndex === query.length) return true;
  }
  return false;
}

export function scoreChannelName(
  name: string,
  lowerQuery: string,
): number | null {
  if (!lowerQuery) return 0;
  const lower = name.toLowerCase();
  if (lower === lowerQuery) return 0;
  if (lower.startsWith(lowerQuery)) return 1;

  const words = lower.split(WORD_SEPARATORS).filter(Boolean);
  if (words.some((word) => word === lowerQuery)) return 2;
  if (words.some((word) => word.startsWith(lowerQuery))) return 3;
  if (lower.includes(lowerQuery)) return 4;

  const collapsedName = collapseSeparators(lower);
  const collapsedQuery = collapseSeparators(lowerQuery);
  if (collapsedQuery && collapsedName.includes(collapsedQuery)) return 5;
  if (collapsedQuery.length >= 2 && isSubsequence(collapsedQuery, lower))
    return 6;
  return null;
}

export function scoreChannelMatch(
  channel: Pick<Channel, "name" | "description">,
  lowerQuery: string,
): number | null {
  if (!lowerQuery) return 0;
  const nameScore = scoreChannelName(channel.name, lowerQuery);
  if (nameScore !== null) return nameScore;
  return channel.description.toLowerCase().includes(lowerQuery) ? 7 : null;
}

export function isBrowsableChannel(channel: Channel): boolean {
  return (
    channel.channelType === "stream" &&
    (channel.archived
      ? channel.isMember
      : channel.visibility === "open" || channel.isMember)
  );
}

export function filterBrowserChannels(
  channels: Channel[],
  view: ChannelBrowserView,
  lowerQuery: string,
): { channels: Channel[]; scores: Map<string, number> } {
  const scores = new Map<string, number>();
  const eligible = channels.filter(isBrowsableChannel).filter((channel) => {
    const matchesView =
      view === "archived"
        ? channel.archived
        : view === "joined"
          ? !channel.archived && channel.isMember
          : true;
    if (!matchesView) return false;
    const score = scoreChannelMatch(channel, lowerQuery);
    if (score === null) return false;
    scores.set(channel.id, score);
    return true;
  });
  return { channels: eligible, scores };
}

export function sortBrowserChannels(
  channels: Channel[],
  sort: ChannelBrowserSort,
  lastActivity: Record<string, number>,
  scores?: Map<string, number>,
): Channel[] {
  return [...channels].sort((left, right) => {
    if (scores) {
      const relevance =
        (scores.get(left.id) ?? Number.POSITIVE_INFINITY) -
        (scores.get(right.id) ?? Number.POSITIVE_INFINITY);
      if (relevance) return relevance;
    }
    if (sort === "members" && left.memberCount !== right.memberCount)
      return right.memberCount - left.memberCount;
    if (sort === "recent") {
      const recency =
        (lastActivity[right.id] ?? 0) - (lastActivity[left.id] ?? 0);
      if (recency) return recency;
    }
    return (
      left.name.localeCompare(right.name) || left.id.localeCompare(right.id)
    );
  });
}
