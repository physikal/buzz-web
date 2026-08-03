import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";

import { listProfiles, type Channel } from "@/features/channels/channel-api";
import type { ComposerPayload } from "@/features/channels/ui/MessageComposer";
import { MessageComposer } from "@/features/channels/ui/MessageComposer";
import type { CustomEmoji } from "@/features/settings/custom-emoji-api";
import { truncatePubkey } from "@/shared/lib/pubkey";

const NO_CUSTOM_EMOJI: CustomEmoji[] = [];

export function ProjectCommentComposer({
  ownerPubkey,
  participants,
  pending,
  workItemId,
  onSubmit,
}: {
  ownerPubkey: string;
  participants: string[];
  pending: boolean;
  workItemId: string;
  onSubmit: (payload: ComposerPayload) => Promise<void>;
}) {
  const participantPubkeys = useMemo(
    () =>
      [...new Set(participants.map((pubkey) => pubkey.toLowerCase()))]
        .filter(
          (pubkey) =>
            /^[0-9a-f]{64}$/u.test(pubkey) &&
            pubkey !== ownerPubkey.toLowerCase(),
        )
        .sort(),
    [ownerPubkey, participants],
  );
  const profilesQuery = useQuery({
    queryKey: ["project-comment-profiles", participantPubkeys],
    queryFn: () => listProfiles(participantPubkeys),
    enabled: participantPubkeys.length > 0,
    staleTime: 60_000,
  });
  const profiles = new Map(
    (profilesQuery.data ?? []).map((profile) => [profile.pubkey, profile]),
  );
  const mentionCandidates = participantPubkeys.map((pubkey) => ({
    pubkey,
    displayName: profiles.get(pubkey)?.displayName ?? truncatePubkey(pubkey),
    avatarUrl: profiles.get(pubkey)?.avatarUrl ?? null,
    isAgent: false,
  }));
  const channel: Channel = {
    id: `project-comment:${workItemId}`,
    name: "project comment",
    description: "",
    topic: null,
    purpose: null,
    visibility: "private",
    channelType: "stream",
    isMember: true,
    memberCount: participantPubkeys.length + 1,
    participantPubkeys,
    archived: false,
  };
  return (
    <MessageComposer
      channel={channel}
      className="p-0"
      customEmoji={NO_CUSTOM_EMOJI}
      mentionCandidates={mentionCandidates}
      ownerPubkey={ownerPubkey}
      pending={pending}
      placeholder="Add a comment..."
      submitLabel="Comment"
      onSubmit={onSubmit}
    />
  );
}
