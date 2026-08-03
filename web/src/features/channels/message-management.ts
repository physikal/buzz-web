import type { ChannelMessage } from "./channel-api";

export function canManageChannelMessage(
  message: ChannelMessage,
  ownerPubkey: string,
  managedAgentPubkeys: ReadonlySet<string>,
): boolean {
  if (message.deleted || message.kind === 40099) return false;
  const author = message.pubkey.toLowerCase();
  return (
    author === ownerPubkey.toLowerCase() || managedAgentPubkeys.has(author)
  );
}

export function findLastOwnEditableMessage(
  messages: readonly ChannelMessage[],
  ownerPubkey: string,
): ChannelMessage | null {
  const normalizedOwner = ownerPubkey.toLowerCase();
  let latest: ChannelMessage | null = null;
  for (const message of messages) {
    if (
      message.deleted ||
      message.kind === 40099 ||
      message.pubkey.toLowerCase() !== normalizedOwner
    )
      continue;
    if (!latest || message.createdAt >= latest.createdAt) latest = message;
  }
  return latest;
}

export function editLastOwnMessage(
  messages: readonly ChannelMessage[],
  ownerPubkey: string,
  onEdit: (message: ChannelMessage) => void,
): boolean {
  const target = findLastOwnEditableMessage(messages, ownerPubkey);
  if (!target) return false;
  onEdit(target);
  return true;
}
