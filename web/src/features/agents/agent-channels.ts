import { makeNip98AuthHeader } from "@/shared/lib/nip98";
import { type NostrEvent, queryEvents } from "@/shared/lib/nostr-client";
import { signNostrEvent } from "@/shared/lib/nostr-signer";
import { relayHttpBaseUrl, relayWsUrl } from "@/shared/lib/relay-url";

export type AgentChannelRole = "bot" | "member" | "guest" | "admin";

export type AgentChannel = {
  id: string;
  name: string;
  visibility: "public" | "private";
  channelType: string;
  alreadyMember: boolean;
};

type RelaySubmitResponse = {
  accepted: boolean;
  message?: string;
};

function tagValue(event: NostrEvent, name: string): string | undefined {
  return event.tags.find((tag) => tag[0] === name)?.[1];
}

function hasTag(event: NostrEvent, name: string): boolean {
  return event.tags.some((tag) => tag[0] === name);
}

/** Load the same owner-accessible, non-DM channel set shown by desktop. */
export async function listAgentChannels(
  agentPubkey: string,
): Promise<AgentChannel[]> {
  const events = await queryEvents(
    relayWsUrl(),
    [
      { kinds: [39000], limit: 1000 },
      { kinds: [39002], "#p": [agentPubkey], limit: 1000 },
    ],
    { requireNip07: true },
  );
  const memberships = new Set(
    events
      .filter((event) => event.kind === 39002)
      .map((event) => tagValue(event, "d"))
      .filter((id): id is string => id != null),
  );

  const channels = new Map<string, AgentChannel>();
  for (const event of events) {
    if (event.kind !== 39000) continue;
    const id = tagValue(event, "d");
    const channelType = tagValue(event, "t") ?? "stream";
    if (
      !id ||
      channelType === "dm" ||
      hasTag(event, "hidden") ||
      tagValue(event, "archived") === "true"
    ) {
      continue;
    }
    channels.set(id, {
      id,
      name: tagValue(event, "name") ?? "Unnamed channel",
      visibility: hasTag(event, "private") ? "private" : "public",
      channelType,
      alreadyMember: memberships.has(id),
    });
  }

  return [...channels.values()].sort((a, b) =>
    a.name.localeCompare(b.name, undefined, { sensitivity: "base" }),
  );
}

/** Publish the standard NIP-29 membership event used by desktop clients. */
export async function addAgentToChannel(input: {
  channelId: string;
  agentPubkey: string;
  role: AgentChannelRole;
}): Promise<void> {
  const event = await signNostrEvent(
    {
      kind: 9000,
      content: "",
      tags: [
        ["h", input.channelId],
        ["p", input.agentPubkey],
        ["role", input.role],
      ],
    },
    { requireNip07: true },
  );
  const body = JSON.stringify(event);
  const url = `${relayHttpBaseUrl()}/events`;
  const authorization = await makeNip98AuthHeader(url, "POST", {
    body,
    requireNip07: true,
  });
  const response = await fetch(url, {
    method: "POST",
    headers: {
      Accept: "application/json",
      Authorization: authorization,
      "Content-Type": "application/json",
    },
    body,
  });
  const payload = (await response.json().catch(() => null)) as
    | RelaySubmitResponse
    | { error?: string }
    | null;
  if (!response.ok) {
    const error = payload && "error" in payload ? payload.error : undefined;
    throw new Error(error ?? `Could not add agent (${response.status})`);
  }
  if (!payload || !("accepted" in payload) || !payload.accepted) {
    const message = payload && "message" in payload ? payload.message : null;
    throw new Error(
      message || "The relay did not accept the membership event.",
    );
  }
}
