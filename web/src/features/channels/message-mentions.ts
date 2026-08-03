import type { ChannelMessage, UserProfile } from "./channel-api";

export type ResolvedMessageMentions = {
  agentPubkeysByName: ReadonlyMap<string, string>;
  names: string[];
  pubkeysByName: ReadonlyMap<string, string>;
};

function profileAliases(profile: UserProfile | undefined): string[] {
  if (!profile) return [];
  const nip05Local = profile.nip05Handle?.trim().split("@")[0]?.trim();
  return [
    profile.displayName,
    profile.name,
    nip05Local === "_" ? null : nip05Local,
  ]
    .map((name) => name?.trim())
    .filter((name): name is string => Boolean(name));
}

export function resolveMessageMentions(
  message: Pick<ChannelMessage, "tags">,
  profiles: ReadonlyMap<string, UserProfile>,
  agentNames: ReadonlyMap<string, string>,
): ResolvedMessageMentions {
  const pubkeysByName = new Map<string, string>();
  const agentPubkeysByName = new Map<string, string>();
  const names = new Set<string>();
  for (const tag of message.tags) {
    if ((tag[0] !== "p" && tag[0] !== "mention") || !tag[1]) continue;
    const pubkey = tag[1].toLowerCase();
    const aliases = profileAliases(profiles.get(pubkey));
    const agentName = agentNames.get(pubkey)?.trim();
    if (agentName) aliases.push(agentName);
    for (const alias of aliases) {
      names.add(alias);
      pubkeysByName.set(alias.toLowerCase(), pubkey);
      if (agentNames.has(pubkey))
        agentPubkeysByName.set(alias.toLowerCase(), pubkey);
    }
  }
  return {
    agentPubkeysByName,
    names: [...names],
    pubkeysByName,
  };
}
