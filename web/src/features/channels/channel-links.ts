import type { Channel } from "./channel-api";

export type ChannelSuggestion = Pick<Channel, "channelType" | "id" | "name">;
type ChannelLinkSource = Pick<Channel, "channelType" | "id" | "name">;

export type ChannelQuery = {
  query: string;
  start: number;
};

export function findChannelQuery(
  content: string,
  selection: number,
  channels: readonly ChannelLinkSource[],
): ChannelQuery | null {
  const beforeCursor = content.slice(0, selection);
  const simpleMatch = /(?:^|[\s([{])#([^\s]*)$/u.exec(beforeCursor);
  if (simpleMatch) {
    return {
      query: simpleMatch[1],
      start: beforeCursor.length - simpleMatch[1].length - 1,
    };
  }

  const knownNames = channels
    .filter((channel) => channel.channelType !== "dm")
    .map((channel) => channel.name.toLowerCase());
  const scanStart = Math.max(0, beforeCursor.length - 80);
  for (let index = beforeCursor.length - 1; index >= scanStart; index -= 1) {
    const character = beforeCursor[index];
    if (character === "#") {
      if (index > 0 && !/[\s([{]/u.test(beforeCursor[index - 1])) continue;
      const query = beforeCursor.slice(index + 1);
      if (!query) break;
      const lowerQuery = query.toLowerCase();
      if (lowerQuery.endsWith(" ") && knownNames.includes(lowerQuery.trimEnd()))
        break;
      if (knownNames.some((name) => name.startsWith(lowerQuery)))
        return { query, start: index };
      break;
    }
    if (character === "\n") break;
  }
  return null;
}

export function channelSuggestions(
  channels: readonly ChannelLinkSource[],
  query: string,
): ChannelSuggestion[] {
  const normalizedQuery = query.trim().toLowerCase();
  return channels
    .filter(
      (channel) =>
        channel.channelType !== "dm" &&
        channel.name.toLowerCase().includes(normalizedQuery),
    )
    .slice(0, 8);
}
