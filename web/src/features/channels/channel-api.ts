import { makeNip98AuthHeader } from "@/shared/lib/nip98";
import { type NostrEvent, queryEvents } from "@/shared/lib/nostr-client";
import { signNostrEvent } from "@/shared/lib/nostr-signer";
import { relayHttpBaseUrl, relayWsUrl } from "@/shared/lib/relay-url";

export type Channel = {
  id: string;
  name: string;
  description: string;
  visibility: "open" | "private";
  channelType: "stream" | "forum";
  isMember: boolean;
};

export type ChannelMessage = {
  id: string;
  pubkey: string;
  content: string;
  createdAt: number;
};

const STARTER_NAMESPACE = "3ce33bea-8f09-5f1b-9c85-8a7d2659e6b0";
const STARTER_CHANNELS = [
  {
    slug: "general",
    name: "general",
    description: "General conversation and community updates.",
  },
  {
    slug: "welcome-everyone",
    name: "welcome-everyone",
    description: "Say hi, ask a question, or share what brought you here.",
  },
] as const;

type RelaySubmitResponse = { accepted: boolean; message?: string };

function tagValue(event: NostrEvent, name: string): string | undefined {
  return event.tags.find((tag) => tag[0] === name)?.[1];
}

function canonicalChannelName(name: string): string {
  return name.replace(/^[#\s]+/, "").trim();
}

async function submitEvent(
  template: Parameters<typeof signNostrEvent>[0],
): Promise<NostrEvent> {
  const event = await signNostrEvent(template, { requireNip07: true });
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
    throw new Error(error ?? `Relay request failed (${response.status})`);
  }
  if (!payload || !("accepted" in payload) || !payload.accepted) {
    const message = payload && "message" in payload ? payload.message : null;
    throw new Error(message || "The relay did not accept the event.");
  }
  return event;
}

export async function listChannels(ownerPubkey: string): Promise<Channel[]> {
  const events = await queryEvents(
    relayWsUrl(),
    [
      { kinds: [39000], limit: 1000 },
      { kinds: [39002], "#p": [ownerPubkey], limit: 1000 },
    ],
    { requireNip07: true },
  );
  const memberships = new Set(
    events
      .filter((event) => event.kind === 39002)
      .map((event) => tagValue(event, "d"))
      .filter((id): id is string => Boolean(id)),
  );
  const channels = new Map<string, Channel>();
  for (const event of events) {
    if (event.kind !== 39000) continue;
    const id = tagValue(event, "d");
    const channelType = tagValue(event, "t") ?? "stream";
    if (
      !id ||
      (channelType !== "stream" && channelType !== "forum") ||
      event.tags.some((tag) => tag[0] === "hidden") ||
      tagValue(event, "archived") === "true"
    ) {
      continue;
    }
    channels.set(id, {
      id,
      name: tagValue(event, "name") ?? "Unnamed channel",
      description: tagValue(event, "about") ?? "",
      visibility: event.tags.some((tag) => tag[0] === "private")
        ? "private"
        : "open",
      channelType,
      isMember: memberships.has(id),
    });
  }
  return [...channels.values()].sort((a, b) => a.name.localeCompare(b.name));
}

export async function createChannel(input: {
  id?: string;
  name: string;
  description?: string;
  visibility?: "open" | "private";
}): Promise<string> {
  const id = input.id ?? crypto.randomUUID();
  const name = canonicalChannelName(input.name);
  if (!name || name.length > 80) throw new Error("Enter a valid channel name.");
  if ((input.description?.length ?? 0) > 500) {
    throw new Error("Channel descriptions are limited to 500 characters.");
  }
  await submitEvent({
    kind: 9007,
    content: "",
    tags: [
      ["h", id],
      ["name", name],
      ["visibility", input.visibility ?? "open"],
      ["channel_type", "stream"],
      ...(input.description ? [["about", input.description.trim()]] : []),
    ],
  });
  return id;
}

export async function joinChannel(channelId: string): Promise<void> {
  await submitEvent({ kind: 9021, content: "", tags: [["h", channelId]] });
}

export async function listChannelMessages(
  channelId: string,
): Promise<ChannelMessage[]> {
  const events = await queryEvents(
    relayWsUrl(),
    { kinds: [9, 40002, 40008], "#h": [channelId], limit: 200 },
    { requireNip07: true },
  );
  return events
    .map((event) => ({
      id: event.id,
      pubkey: event.pubkey,
      content: event.content,
      createdAt: event.created_at,
    }))
    .sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id));
}

export async function sendChannelMessage(input: {
  channelId: string;
  content: string;
  mentionPubkeys?: string[];
}): Promise<ChannelMessage> {
  const content = input.content.trim();
  if (!content) throw new Error("Enter a message.");
  if (new TextEncoder().encode(content).length > 64 * 1024) {
    throw new Error("Message is too long.");
  }
  const event = await submitEvent({
    kind: 9,
    content,
    tags: [
      ["h", input.channelId],
      ...[...new Set(input.mentionPubkeys ?? [])].map((pubkey) => [
        "p",
        pubkey,
      ]),
    ],
  });
  return {
    id: event.id,
    pubkey: event.pubkey,
    content: event.content,
    createdAt: event.created_at,
  };
}

async function uuidV5(namespace: string, value: string): Promise<string> {
  const namespaceBytes = Uint8Array.from(
    namespace.replace(/-/g, "").match(/.{2}/g) ?? [],
    (hex) => Number.parseInt(hex, 16),
  );
  const valueBytes = new TextEncoder().encode(value);
  const input = new Uint8Array(namespaceBytes.length + valueBytes.length);
  input.set(namespaceBytes);
  input.set(valueBytes, namespaceBytes.length);
  const bytes = new Uint8Array(await crypto.subtle.digest("SHA-1", input));
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = [...bytes.slice(0, 16)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export async function ensureStarterChannels(
  ownerPubkey: string,
): Promise<Channel[]> {
  let channels = await listChannels(ownerPubkey);
  for (const starter of STARTER_CHANNELS) {
    if (
      channels.some(
        (channel) =>
          canonicalChannelName(channel.name).toLowerCase() === starter.name,
      )
    ) {
      continue;
    }
    const relayScope = relayHttpBaseUrl().trim();
    const id = await uuidV5(
      STARTER_NAMESPACE,
      `starter-channel:v1:${relayScope}:${starter.slug}`,
    );
    try {
      await createChannel({ id, ...starter });
    } catch (error) {
      if (!(error instanceof Error) || !error.message.includes("duplicate")) {
        throw error;
      }
    }
  }
  for (let attempt = 0; attempt < 4; attempt += 1) {
    channels = await listChannels(ownerPubkey);
    if (
      STARTER_CHANNELS.every((starter) =>
        channels.some(
          (channel) =>
            canonicalChannelName(channel.name).toLowerCase() === starter.name,
        ),
      )
    ) {
      return channels;
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  return channels;
}
