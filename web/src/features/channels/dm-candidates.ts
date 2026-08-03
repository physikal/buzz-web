import type { ManagedAgent, RelayAgent } from "@/features/agents/agent-api";
import type { CommunityMember } from "@/features/settings/community-api";
import { truncatePubkey } from "@/shared/lib/pubkey";
import type { UserProfile } from "./channel-api";

export type DmCandidate = {
  pubkey: string;
  displayName: string;
  avatarUrl: string | null;
  isAgent: boolean;
};

export function buildDmCandidates({
  ownerPubkey,
  pubkeys,
  profiles,
  agents,
  relayAgents,
  members,
}: {
  ownerPubkey: string;
  pubkeys: string[];
  profiles: Map<string, UserProfile>;
  agents: ManagedAgent[];
  relayAgents: RelayAgent[];
  members: CommunityMember[];
}): DmCandidate[] {
  const candidates = new Map<string, DmCandidate>();
  const agentNames = new Map(
    relayAgents.map((agent) => [agent.pubkey, agent.name]),
  );
  for (const agent of agents) agentNames.set(agent.agent_pubkey, agent.name);
  for (const pubkey of new Set(pubkeys)) {
    if (pubkey === ownerPubkey) continue;
    const profile = profiles.get(pubkey);
    candidates.set(pubkey, {
      pubkey,
      displayName:
        agentNames.get(pubkey) ??
        profile?.displayName ??
        truncatePubkey(pubkey),
      avatarUrl: profile?.avatarUrl ?? null,
      isAgent: agentNames.has(pubkey),
    });
  }
  for (const member of members) {
    if (member.pubkey === ownerPubkey) continue;
    const existing = candidates.get(member.pubkey);
    candidates.set(member.pubkey, {
      pubkey: member.pubkey,
      displayName:
        agentNames.get(member.pubkey) ??
        member.profile?.displayName ??
        truncatePubkey(member.pubkey),
      avatarUrl: member.profile?.avatarUrl ?? existing?.avatarUrl ?? null,
      isAgent: agentNames.has(member.pubkey),
    });
  }
  for (const profile of profiles.values()) {
    if (profile.pubkey === ownerPubkey) continue;
    candidates.set(profile.pubkey, {
      pubkey: profile.pubkey,
      displayName: profile.displayName ?? truncatePubkey(profile.pubkey),
      avatarUrl: profile.avatarUrl,
      isAgent: agentNames.has(profile.pubkey),
    });
  }
  for (const agent of agents) {
    const existing = candidates.get(agent.agent_pubkey);
    candidates.set(agent.agent_pubkey, {
      pubkey: agent.agent_pubkey,
      displayName: agent.name,
      avatarUrl: existing?.avatarUrl ?? null,
      isAgent: true,
    });
  }
  for (const agent of relayAgents) {
    const existing = candidates.get(agent.pubkey);
    candidates.set(agent.pubkey, {
      pubkey: agent.pubkey,
      displayName: agentNames.get(agent.pubkey) ?? agent.name,
      avatarUrl: existing?.avatarUrl ?? null,
      isAgent: true,
    });
  }
  return [...candidates.values()].sort(
    (left, right) =>
      Number(right.isAgent) - Number(left.isAgent) ||
      left.displayName.localeCompare(right.displayName),
  );
}
