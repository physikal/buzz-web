import type { ChannelMessage } from "./channel-api";

export function messageSubtree(
  root: ChannelMessage,
  messages: ChannelMessage[],
) {
  const result: ChannelMessage[] = [root];
  const pendingIds = [root.id];
  for (let index = 0; index < pendingIds.length; index += 1) {
    const parentId = pendingIds[index];
    for (const message of messages) {
      if (message.parentId !== parentId || result.includes(message)) continue;
      result.push(message);
      pendingIds.push(message.id);
    }
  }
  return result;
}
