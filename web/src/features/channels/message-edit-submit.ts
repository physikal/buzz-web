import type { ChannelMessage } from "./channel-api";

type EditPayload = {
  content: string;
  mediaTags: string[][];
  mentionPubkeys: string[];
};

type SendInput = EditPayload & {
  channelId: string;
  forumPost: boolean;
};

export function createMessageSubmitters({
  activeTargetId,
  cancelEdit,
  channel,
  onDelete,
  onEdit,
  onSend,
}: {
  activeTargetId: string | null;
  cancelEdit: () => void;
  channel: { channelType: string; id: string } | null;
  onDelete: (input: { channelId: string; eventId: string }) => Promise<unknown>;
  onEdit: Parameters<typeof submitMessageEdit>[0]["onEdit"];
  onSend: (input: SendInput) => Promise<unknown>;
}) {
  return {
    submitRoot: async (payload: EditPayload) => {
      if (!channel) return;
      await onSend({
        ...payload,
        channelId: channel.id,
        forumPost: channel.channelType === "forum",
      });
    },
    submitEdit: async (target: ChannelMessage, payload: EditPayload) => {
      const submitted = await submitMessageEdit({
        activeTargetId,
        channelId: channel?.id ?? null,
        onDelete,
        onEdit,
        payload,
        target,
      });
      if (submitted) cancelEdit();
    },
  };
}

export async function submitMessageEdit({
  activeTargetId,
  channelId,
  onDelete,
  onEdit,
  payload,
  target,
}: {
  activeTargetId: string | null;
  channelId: string | null;
  onDelete: (input: { channelId: string; eventId: string }) => Promise<unknown>;
  onEdit: (input: {
    channelId: string;
    eventId: string;
    content: string;
    mediaTags: string[][];
    mentionPubkeys: string[];
  }) => Promise<unknown>;
  payload: EditPayload;
  target: ChannelMessage;
}) {
  if (!channelId || activeTargetId !== target.id) return false;
  if (!payload.content.trim() && !payload.mediaTags.length) {
    await onDelete({ channelId, eventId: target.id });
  } else {
    await onEdit({
      channelId,
      eventId: target.id,
      content: payload.content,
      mediaTags: payload.mediaTags,
      mentionPubkeys: payload.mentionPubkeys,
    });
  }
  return true;
}
