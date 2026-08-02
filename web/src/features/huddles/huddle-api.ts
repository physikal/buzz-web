import {
  publishEphemeralEvent,
  queryEvents,
  subscribeEvents,
  type NostrEvent,
} from "@/shared/lib/nostr-client";
import { submitEvent } from "@/shared/lib/relay-events";
import { relayWsUrl } from "@/shared/lib/relay-url";
import {
  addChannelMember,
  archiveChannel,
  leaveChannel,
  listChannelMembers,
} from "@/features/channels/channel-api";

export const HUDDLE_KINDS = [48100, 48101, 48102, 48103] as const;
export const HUDDLE_REACTION_KIND = 24810;
const JOINABLE_WINDOW_SECONDS = 60 * 60;

export type ActiveHuddle = {
  ephemeralChannelId: string;
  creatorPubkey: string;
  createdAt: number;
  participants: string[];
};

function ephemeralId(event: NostrEvent): string | null {
  try {
    const value = JSON.parse(event.content) as {
      ephemeral_channel_id?: unknown;
    };
    return typeof value.ephemeral_channel_id === "string"
      ? value.ephemeral_channel_id
      : null;
  } catch {
    return null;
  }
}

export function reconstructActiveHuddle(
  events: Iterable<NostrEvent>,
  now = Math.floor(Date.now() / 1000),
): ActiveHuddle | null {
  let active: ActiveHuddle | null = null;
  const ended = new Set<string>();
  const sorted = [...events].sort(
    (left, right) =>
      left.created_at - right.created_at ||
      left.kind - right.kind ||
      left.id.localeCompare(right.id),
  );
  for (const event of sorted) {
    const id = ephemeralId(event);
    if (!id) continue;
    if (event.kind === 48100) {
      ended.delete(id);
      active = {
        ephemeralChannelId: id,
        creatorPubkey: event.pubkey,
        createdAt: event.created_at,
        participants: [event.pubkey],
      };
      continue;
    }
    if (event.kind === 48103) {
      ended.add(id);
      if (active?.ephemeralChannelId === id) active = null;
      continue;
    }
    if (ended.has(id)) continue;
    if (!active || active.ephemeralChannelId !== id) {
      active = {
        ephemeralChannelId: id,
        creatorPubkey: event.pubkey,
        createdAt: event.created_at,
        participants: [],
      };
    }
    const participant =
      event.tags.find((tag) => tag[0] === "p")?.[1] ?? event.pubkey;
    const participants: Set<string> = new Set(active.participants);
    if (event.kind === 48101) participants.add(participant);
    if (event.kind === 48102) participants.delete(participant);
    active = { ...active, participants: [...participants] };
  }
  if (active && now - active.createdAt > JOINABLE_WINDOW_SECONDS) return null;
  return active;
}

export async function getHuddleEvents(channelId: string) {
  return queryEvents(
    relayWsUrl(),
    { kinds: [...HUDDLE_KINDS], "#h": [channelId], limit: 100 },
    { requireNip07: true },
  );
}

export function subscribeHuddleEvents(
  channelId: string,
  onEvent: (event: NostrEvent) => void,
) {
  return subscribeEvents(
    relayWsUrl(),
    { kinds: [...HUDDLE_KINDS], "#h": [channelId], limit: 100 },
    onEvent,
    { requireNip07: true },
  );
}

export async function createHuddle(input: {
  parentChannelId: string;
  parentChannelName: string;
  agentPubkeys: string[];
}): Promise<string> {
  if (input.agentPubkeys.length > 20)
    throw new Error("A huddle can include up to 20 agents.");
  const ephemeralChannelId = crypto.randomUUID();
  const shortId = ephemeralChannelId.slice(0, 8);
  await submitEvent({
    kind: 9007,
    content: "",
    tags: [
      ["h", ephemeralChannelId],
      ["name", `${input.parentChannelName}-huddle-${shortId}`],
      ["visibility", "private"],
      ["channel_type", "stream"],
      ["ttl", "3600"],
    ],
  });
  try {
    await submitEvent({
      kind: 48106,
      content: `You are in a live voice huddle attached to channel ${input.parentChannelId}. Keep spoken responses concise and conversational.`,
      tags: [["h", ephemeralChannelId]],
    }).catch(() => {});
    for (const pubkey of [...new Set(input.agentPubkeys)]) {
      await addChannelMember(ephemeralChannelId, pubkey, "bot").catch(() => {});
    }
    await submitEvent({
      kind: 48100,
      content: JSON.stringify({ ephemeral_channel_id: ephemeralChannelId }),
      tags: [["h", input.parentChannelId]],
    });
    return ephemeralChannelId;
  } catch (error) {
    await archiveChannel(ephemeralChannelId).catch(() => {});
    throw error;
  }
}

export async function leaveHuddleChannel(
  parentChannelId: string,
  ephemeralChannelId: string,
  isCreator: boolean,
): Promise<void> {
  if (!isCreator) {
    await leaveChannel(ephemeralChannelId);
    return;
  }
  await submitEvent({
    kind: 48103,
    content: JSON.stringify({ ephemeral_channel_id: ephemeralChannelId }),
    tags: [["h", parentChannelId]],
  });
  await archiveChannel(ephemeralChannelId).catch((error) => {
    if (!(error instanceof Error) || !error.message.includes("archived"))
      throw error;
  });
}

export type HuddleReaction = {
  id: string;
  pubkey: string;
  emoji: string;
  emojiUrl: string | null;
  senderName: string;
};

export function parseHuddleReaction(event: NostrEvent): HuddleReaction | null {
  if (event.kind !== HUDDLE_REACTION_KIND) return null;
  const emoji =
    event.tags.find((tag) => tag[0] === "reaction")?.[1]?.trim() ||
    event.content.trim();
  if (!emoji || emoji.length > 128) return null;
  const senderName =
    event.tags.find((tag) => tag[0] === "sender_name")?.[1]?.trim() ||
    "Participant";
  const emojiUrl =
    event.tags.find(
      (tag) =>
        tag[0] === "emoji" &&
        tag.length === 3 &&
        /^https?:\/\//.test(tag[2] ?? ""),
    )?.[2] ?? null;
  return {
    id: event.id,
    pubkey: event.pubkey,
    emoji,
    emojiUrl,
    senderName: senderName.slice(0, 80),
  };
}

export function subscribeHuddleReactions(
  ephemeralChannelId: string,
  onReaction: (reaction: HuddleReaction) => void,
) {
  return subscribeEvents(
    relayWsUrl(),
    {
      kinds: [HUDDLE_REACTION_KIND],
      "#h": [ephemeralChannelId],
      since: Math.floor(Date.now() / 1_000),
    },
    (event) => {
      const reaction = parseHuddleReaction(event);
      if (reaction) onReaction(reaction);
    },
    { requireNip07: true },
  );
}

export async function sendHuddleReaction(input: {
  ephemeralChannelId: string;
  emoji: string;
  senderName: string;
  emojiUrl?: string;
}) {
  const emoji = input.emoji.trim();
  if (!emoji || emoji.length > 128) throw new Error("Choose a valid reaction.");
  const tags = [
    ["h", input.ephemeralChannelId],
    ["reaction", emoji],
    ["sender_name", input.senderName.trim().slice(0, 80)],
  ];
  const shortcode =
    emoji.startsWith(":") && emoji.endsWith(":")
      ? emoji.slice(1, -1).trim().toLowerCase()
      : "";
  if (shortcode && input.emojiUrl)
    tags.push(["emoji", shortcode, input.emojiUrl]);
  const event = await publishEphemeralEvent({
    kind: HUDDLE_REACTION_KIND,
    content: emoji,
    tags,
  });
  return parseHuddleReaction(event);
}

export async function addAgentToHuddle(
  parentChannelId: string,
  ephemeralChannelId: string,
  pubkey: string,
) {
  await addChannelMember(ephemeralChannelId, pubkey, "bot");
  let parentWarning: string | null = null;
  const alreadyInParent = await listChannelMembers(parentChannelId)
    .then((members) => members.some((member) => member.pubkey === pubkey))
    .catch(() => false);
  if (!alreadyInParent)
    await addChannelMember(parentChannelId, pubkey, "bot").catch(
      async (error) => {
        const activeAfterError = await listChannelMembers(parentChannelId)
          .then((members) => members.some((member) => member.pubkey === pubkey))
          .catch(() => false);
        if (!activeAfterError)
          parentWarning =
            error instanceof Error
              ? error.message
              : "Could not add the agent to the parent channel.";
      },
    );
  return { parentWarning };
}

export async function listHuddleAgentPubkeys(ephemeralChannelId: string) {
  return listChannelMembers(ephemeralChannelId).then((members) =>
    members
      .filter((member) => member.role === "bot")
      .map((member) => member.pubkey),
  );
}
