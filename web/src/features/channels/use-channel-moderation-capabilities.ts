import { useQuery } from "@tanstack/react-query";

import {
  listChannelMembers,
  listProfiles,
} from "@/features/channels/channel-api";

export function useChannelModerationCapabilities(
  channelId: string | null,
  currentPubkey: string,
  enabled: boolean,
) {
  const membersQuery = useQuery({
    queryKey: ["channel-members", channelId],
    queryFn: () => listChannelMembers(channelId ?? ""),
    enabled: enabled && Boolean(channelId),
  });
  const normalizedCurrent = currentPubkey.toLowerCase();
  const selfRole = membersQuery.data?.find(
    (member) => member.pubkey === normalizedCurrent,
  )?.role;
  const ownerMemberPubkeys = (membersQuery.data ?? [])
    .filter(
      (member) =>
        member.role === "owner" && member.pubkey !== normalizedCurrent,
    )
    .map((member) => member.pubkey)
    .sort();
  const profilesQuery = useQuery({
    queryKey: ["profiles", ...ownerMemberPubkeys],
    queryFn: () => listProfiles(ownerMemberPubkeys),
    enabled: enabled && selfRole !== "owner" && ownerMemberPubkeys.length > 0,
    staleTime: 60_000,
  });
  const ownsChannelAgent = (profilesQuery.data ?? []).some(
    (profile) => profile.ownerPubkey === normalizedCurrent,
  );
  const resolvingAgentOwnership =
    enabled && selfRole !== "owner" && ownerMemberPubkeys.length > 0;

  return {
    canDeleteChannel: selfRole === "owner" || ownsChannelAgent,
    canManageChannel:
      selfRole === "owner" || selfRole === "admin" || ownsChannelAgent,
    error:
      membersQuery.error ??
      (resolvingAgentOwnership ? profilesQuery.error : null),
    isLoading:
      enabled &&
      (membersQuery.isLoading ||
        (resolvingAgentOwnership && profilesQuery.isLoading)),
    selfRole,
  };
}
