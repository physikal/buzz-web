import { useEffect, useState } from "react";

import type { PresenceStatus } from "@/features/presence/presence-api";
import type { CustomEmoji } from "@/features/settings/custom-emoji-api";
import { Button } from "@/shared/ui/button";
import type { Channel, ChannelMessage, UserProfile } from "../channel-api";
import type { DmCandidate } from "../dm-candidates";
import type { MessageEditScope } from "../use-message-edit-session";
import { MessageComposer, type ComposerPayload } from "./MessageComposer";
import {
  type MessageActions,
  MessageTimeline,
  ThreadPanel,
} from "./MessageTimeline";

export function ForumView({
  actions,
  agentNames,
  channel,
  customEmoji,
  editScope,
  editTarget,
  loading,
  matchingMessageIds,
  mentionCandidates,
  messages,
  onCloseThread,
  onCancelEdit,
  onEditSubmit,
  onSubmitPost,
  onSubmitReply,
  ownerPubkey,
  pending,
  presence,
  profiles,
  selectedMessageId,
  threadRoot,
}: {
  actions: MessageActions;
  agentNames: Map<string, string>;
  channel: Channel;
  customEmoji: CustomEmoji[];
  editScope: MessageEditScope | null;
  editTarget: ChannelMessage | null;
  loading: boolean;
  matchingMessageIds?: ReadonlySet<string>;
  mentionCandidates: DmCandidate[];
  messages: ChannelMessage[];
  onCloseThread: () => void;
  onCancelEdit: () => void;
  onEditSubmit: (
    target: ChannelMessage,
    payload: ComposerPayload,
  ) => Promise<void>;
  onSubmitPost: (payload: ComposerPayload) => Promise<void>;
  onSubmitReply: (
    root: ChannelMessage,
    payload: ComposerPayload,
  ) => Promise<void>;
  ownerPubkey: string;
  pending: boolean;
  presence: Map<string, PresenceStatus>;
  profiles: Map<string, UserProfile>;
  selectedMessageId?: string | null;
  threadRoot: ChannelMessage | null;
}) {
  const [composerOpen, setComposerOpen] = useState(false);
  useEffect(() => {
    if (editScope === "main" && editTarget) setComposerOpen(true);
  }, [editScope, editTarget]);

  if (threadRoot) {
    return (
      <ThreadPanel
        actions={actions}
        agentNames={agentNames}
        channel={channel}
        customEmoji={customEmoji}
        editTarget={editScope === "thread" ? editTarget : null}
        followed={false}
        forum
        matchingMessageIds={matchingMessageIds}
        mentionCandidates={mentionCandidates}
        messages={messages}
        onClose={onCloseThread}
        onCancelEdit={onCancelEdit}
        onEditSubmit={onEditSubmit}
        onFollow={() => undefined}
        onSubmit={(payload) => onSubmitReply(threadRoot, payload)}
        onTyping={() => undefined}
        onUnfollow={() => undefined}
        ownerPubkey={ownerPubkey}
        pending={pending}
        presence={presence}
        profiles={profiles}
        root={threadRoot}
        selectedMessageId={selectedMessageId}
        typingPubkeys={[]}
      />
    );
  }

  return (
    <>
      <div className="border-b p-4">
        {composerOpen ? (
          <div className="rounded-md border bg-background">
            <MessageComposer
              channel={channel}
              customEmoji={customEmoji}
              editTarget={editScope === "main" ? editTarget : null}
              mentionCandidates={mentionCandidates}
              ownerPubkey={ownerPubkey}
              onCancelEdit={onCancelEdit}
              onEditSubmit={onEditSubmit}
              pending={pending}
              onSubmit={async (payload) => {
                await onSubmitPost(payload);
                setComposerOpen(false);
              }}
              onTyping={() => undefined}
            />
            <div className="flex justify-end border-t px-3 py-2">
              <Button
                onClick={() => setComposerOpen(false)}
                size="sm"
                variant="ghost"
              >
                Cancel
              </Button>
            </div>
          </div>
        ) : (
          <button
            className="w-full rounded-md border border-dashed px-4 py-3 text-left text-sm text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-50"
            disabled={!channel.isMember || channel.archived}
            onClick={() => setComposerOpen(true)}
            type="button"
          >
            {channel.archived
              ? "This forum is archived."
              : !channel.isMember
                ? "Join this forum to create posts."
                : "Start a new post..."}
          </button>
        )}
      </div>
      <div className="px-0 py-3 sm:px-3">
        <MessageTimeline
          actions={actions}
          agentNames={agentNames}
          channel={channel}
          customEmoji={customEmoji}
          loading={loading}
          matchingMessageIds={matchingMessageIds}
          messages={messages}
          ownerPubkey={ownerPubkey}
          presence={presence}
          profiles={profiles}
          selectedMessageId={selectedMessageId}
        />
      </div>
    </>
  );
}
