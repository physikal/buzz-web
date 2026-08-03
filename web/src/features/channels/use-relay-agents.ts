import { useQuery } from "@tanstack/react-query";

import {
  listRelayAgents,
  type ManagedAgent,
  type RelayAgent,
} from "@/features/agents/agent-api";

const EMPTY_RELAY_AGENTS: RelayAgent[] = [];

export function useRelayAgents(ownerPubkey: string) {
  const query = useQuery({
    queryKey: ["relay-agents", ownerPubkey],
    queryFn: listRelayAgents,
    staleTime: 30_000,
    refetchInterval: 5 * 60_000,
    refetchIntervalInBackground: false,
    retry: false,
  });
  return query.data ?? EMPTY_RELAY_AGENTS;
}

export function buildAgentNames(
  managedAgents: ManagedAgent[],
  relayAgents: RelayAgent[],
) {
  const names = new Map(relayAgents.map((agent) => [agent.pubkey, agent.name]));
  for (const agent of managedAgents) names.set(agent.agent_pubkey, agent.name);
  return names;
}
