import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";

import type { ManagedAgent } from "@/features/agents/agent-api";
import { useWorkspacePresence } from "@/features/presence/use-presence";
import type { CommunityMember } from "@/features/settings/community-api";
import { listProfiles, type ChannelMessage } from "./channel-api";
import { buildDmCandidates } from "./dm-candidates";
import { buildAgentNames, useRelayAgents } from "./use-relay-agents";

const EMPTY_PUBKEYS: string[] = [];
const EMPTY_AGENTS: ManagedAgent[] = [];
const EMPTY_MEMBERS: CommunityMember[] = [];

export function useChannelDirectory({
  ownerPubkey,
  messages,
  participantPubkeys = EMPTY_PUBKEYS,
  huddleParticipantPubkeys = EMPTY_PUBKEYS,
  managedAgents = EMPTY_AGENTS,
  members = EMPTY_MEMBERS,
  profileTarget,
}: {
  ownerPubkey: string;
  messages: ChannelMessage[];
  participantPubkeys?: string[];
  huddleParticipantPubkeys?: string[];
  managedAgents?: ManagedAgent[];
  members?: CommunityMember[];
  profileTarget: string | null;
}) {
  const relayAgents = useRelayAgents(ownerPubkey);
  const allPubkeys = useMemo(
    () => [
      ownerPubkey,
      ...messages.map((message) => message.pubkey),
      ...participantPubkeys,
      ...huddleParticipantPubkeys,
      ...managedAgents.map((agent) => agent.agent_pubkey),
      ...relayAgents.map((agent) => agent.pubkey),
      ...(profileTarget ? [profileTarget] : []),
    ],
    [
      huddleParticipantPubkeys,
      managedAgents,
      messages,
      ownerPubkey,
      participantPubkeys,
      profileTarget,
      relayAgents,
    ],
  );
  const uniquePubkeys = useMemo(
    () =>
      [...new Set(allPubkeys.map((pubkey) => pubkey.toLowerCase()))].filter(
        (pubkey) => /^[0-9a-f]{64}$/.test(pubkey),
      ),
    [allPubkeys],
  );
  const profileKey = [...uniquePubkeys].sort().join(",");
  const { presence, userStatuses } = useWorkspacePresence(uniquePubkeys);
  const profilesQuery = useQuery({
    queryKey: ["profiles", profileKey],
    queryFn: () => listProfiles(uniquePubkeys),
    enabled: Boolean(profileKey),
    staleTime: 60_000,
  });
  const profiles = useMemo(
    () =>
      new Map(
        (profilesQuery.data ?? []).map((profile) => [profile.pubkey, profile]),
      ),
    [profilesQuery.data],
  );
  const agentNames = useMemo(
    () => buildAgentNames(managedAgents, relayAgents),
    [managedAgents, relayAgents],
  );
  const dmCandidates = useMemo(
    () =>
      buildDmCandidates({
        ownerPubkey,
        pubkeys: uniquePubkeys,
        profiles,
        agents: managedAgents,
        relayAgents,
        members,
      }),
    [managedAgents, members, ownerPubkey, profiles, relayAgents, uniquePubkeys],
  );
  return { agentNames, dmCandidates, presence, profiles, userStatuses };
}
