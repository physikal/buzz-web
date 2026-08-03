import type { ManagedAgent } from "@/features/agents/agent-api";

import type { ChannelMessage } from "./channel-api";
import { canManageChannelMessage } from "./message-management";
import { messageSubtree } from "./message-tree";
import type { MessageActions } from "./ui/MessageTimeline";

export function createChannelMessageActions({
  deleteMessage,
  deletePending,
  isMessageUnread,
  managedAgents,
  markMessagesRead,
  markMessagesUnread,
  messages,
  onOpenMessage,
  onOpenProfile,
  onReact,
  onReport,
  onRemind,
  onStartEdit,
  ownerPubkey,
  selectedChannelId,
}: {
  deleteMessage: (input: {
    channelId: string;
    eventId: string;
  }) => Promise<unknown>;
  deletePending: boolean;
  isMessageUnread: (channelId: string, message: ChannelMessage) => boolean;
  managedAgents: readonly ManagedAgent[];
  markMessagesRead: (messages: ChannelMessage[]) => unknown;
  markMessagesUnread: (messageIds: string[]) => unknown;
  messages: ChannelMessage[];
  onOpenMessage: (
    channelId: string,
    rootId: string,
    messageId: string,
  ) => unknown;
  onOpenProfile: (pubkey: string) => unknown;
  onReact: (input: {
    customEmojiUrl?: string;
    emoji: string;
    eventId: string;
    ownEventId: string | null;
  }) => unknown;
  onReport: (message: ChannelMessage) => unknown;
  onRemind: (message: ChannelMessage) => unknown;
  onStartEdit: MessageActions["onEdit"];
  ownerPubkey: string;
  selectedChannelId: string | null;
}): MessageActions {
  const normalizedOwner = ownerPubkey.toLowerCase();
  const managedAgentPubkeys = new Set(
    managedAgents
      .filter(
        (agent) =>
          agent.owner_pubkey.toLowerCase() === normalizedOwner &&
          /^[0-9a-f]{64}$/u.test(agent.agent_pubkey),
      )
      .map((agent) => agent.agent_pubkey.toLowerCase()),
  );
  return {
    canManage: (message) =>
      canManageChannelMessage(message, ownerPubkey, managedAgentPubkeys),
    deletePending,
    onReply: (message) =>
      selectedChannelId &&
      onOpenMessage(
        selectedChannelId,
        message.rootId ?? message.id,
        message.id,
      ),
    onEdit: onStartEdit,
    onDelete: async (message) => {
      if (!selectedChannelId) return;
      await deleteMessage({
        channelId: selectedChannelId,
        eventId: message.id,
      });
    },
    onReport,
    onRemind,
    isUnread: (message) =>
      selectedChannelId ? isMessageUnread(selectedChannelId, message) : false,
    onMarkRead: (message) =>
      void markMessagesRead(messageSubtree(message, messages)),
    onMarkUnread: (message) =>
      void markMessagesUnread(
        messageSubtree(message, messages).map(({ id }) => id),
      ),
    onOpenProfile: (pubkey) => void onOpenProfile(pubkey),
    onReact: (message, emoji, ownEventId, customEmojiUrl) =>
      void onReact({
        eventId: message.id,
        emoji,
        ownEventId,
        customEmojiUrl,
      }),
  };
}
