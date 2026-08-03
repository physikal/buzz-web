import {
  type NostrEvent,
  type NostrFilter,
  publishEphemeralEvent,
  queryEvents,
  queryEventsHttp,
} from "@/shared/lib/nostr-client";
import { submitEvent } from "@/shared/lib/relay-events";
import { relayHttpBaseUrl, relayWsUrl } from "@/shared/lib/relay-url";
import { signNostrEvent } from "@/shared/lib/nostr-signer";
import { findSpoileredAttachmentUrls } from "./attachment-markdown";
import { applyEditTagOverlay } from "./edit-tag-overlay";

export type ChannelType = "stream" | "forum" | "dm";

export type Channel = {
  id: string;
  name: string;
  description: string;
  topic: string | null;
  purpose: string | null;
  visibility: "open" | "private";
  channelType: ChannelType;
  isMember: boolean;
  memberCount: number;
  participantPubkeys: string[];
  archived: boolean;
};

export type MediaAttachment = {
  url: string;
  mimeType: string | null;
  name: string | null;
  size: number | null;
  dimensions: string | null;
  thumbnailUrl: string | null;
  sha256: string | null;
  spoilered: boolean;
};

export type MessageReaction = {
  emoji: string;
  count: number;
  pubkeys: string[];
  ownEventId: string | null;
};

export type ChannelMessage = {
  id: string;
  pubkey: string;
  content: string;
  createdAt: number;
  kind: number;
  tags: string[][];
  parentId: string | null;
  rootId: string | null;
  depth: number;
  edited: boolean;
  deleted: boolean;
  reactions: MessageReaction[];
  attachments: MediaAttachment[];
};

export type UserProfile = {
  pubkey: string;
  displayName: string | null;
  avatarUrl: string | null;
  about: string | null;
  nip05Handle: string | null;
};

export type ChannelMember = {
  pubkey: string;
  role: "owner" | "admin" | "member" | "guest" | "bot";
};

export type ChannelCanvas = {
  content: string;
  eventId: string | null;
  updatedAt: number | null;
  author: string | null;
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
const CONTENT_KINDS = [9, 40002, 40008, 40099, 45001, 45003];
const AUX_KINDS = [5, 7, 9005, 40003];

function tagValue(event: NostrEvent, name: string): string | undefined {
  return event.tags.find((tag) => tag[0] === name)?.[1];
}

function tagValues(event: NostrEvent, name: string): string[] {
  return event.tags
    .filter((tag) => tag[0] === name && tag[1])
    .map((tag) => tag[1]);
}

function canonicalChannelName(name: string): string {
  return name.replace(/^[#\s]+/, "").trim();
}

function parseThread(event: NostrEvent) {
  const refs = event.tags.filter((tag) => tag[0] === "e" && tag[1]);
  const root = refs.find((tag) => tag[3] === "root")?.[1] ?? null;
  const parent =
    refs.find((tag) => tag[3] === "reply")?.[1] ??
    (refs.length === 1 ? refs[0][1] : null);
  return { parentId: parent, rootId: root ?? parent };
}

function parseImeta(tags: string[][], content: string): MediaAttachment[] {
  const attachments = tags
    .filter((tag) => tag[0] === "imeta")
    .map((tag) => {
      const fields = new Map<string, string>();
      for (const part of tag.slice(1)) {
        const split = part.indexOf(" ");
        if (split > 0) fields.set(part.slice(0, split), part.slice(split + 1));
      }
      const size = Number(fields.get("size"));
      return {
        url: fields.get("url") ?? "",
        mimeType: fields.get("m") ?? null,
        name: fields.get("filename") ?? fields.get("name") ?? null,
        size: Number.isFinite(size) ? size : null,
        dimensions: fields.get("dim") ?? null,
        thumbnailUrl: fields.get("thumb") ?? null,
        sha256: fields.get("x") ?? null,
        spoilered: false,
      };
    })
    .filter((attachment) => attachment.url);
  const spoileredUrls = findSpoileredAttachmentUrls(content, attachments);
  return attachments.map((attachment) => ({
    ...attachment,
    spoilered: spoileredUrls.has(attachment.url),
  }));
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
      !["stream", "forum", "dm"].includes(channelType) ||
      event.tags.some((tag) => tag[0] === "hidden")
    )
      continue;
    const participants = tagValues(event, "p");
    channels.set(id, {
      id,
      name:
        tagValue(event, "name") ??
        (channelType === "dm" ? "Direct message" : "Unnamed channel"),
      description: tagValue(event, "about") ?? "",
      topic: tagValue(event, "topic") ?? null,
      purpose: tagValue(event, "purpose") ?? null,
      visibility:
        tagValue(event, "visibility") === "private" ||
        event.tags.some((tag) => tag[0] === "private")
          ? "private"
          : "open",
      channelType: channelType as ChannelType,
      isMember: memberships.has(id),
      memberCount:
        Number(tagValue(event, "member_count")) || participants.length,
      participantPubkeys: participants,
      archived: tagValue(event, "archived") === "true",
    });
  }
  return [...channels.values()].sort((a, b) => {
    if (a.channelType === "dm" && b.channelType !== "dm") return 1;
    if (b.channelType === "dm" && a.channelType !== "dm") return -1;
    return a.name.localeCompare(b.name);
  });
}

export async function createChannel(input: {
  id?: string;
  name: string;
  description?: string;
  visibility?: "open" | "private";
  channelType?: Exclude<ChannelType, "dm">;
}): Promise<string> {
  const id = input.id ?? crypto.randomUUID();
  const name = canonicalChannelName(input.name);
  if (!name || name.length > 80) throw new Error("Enter a valid channel name.");
  if ((input.description?.length ?? 0) > 500)
    throw new Error("Channel descriptions are limited to 500 characters.");
  await submitEvent({
    kind: 9007,
    content: "",
    tags: [
      ["h", id],
      ["name", name],
      ["visibility", input.visibility ?? "open"],
      ["channel_type", input.channelType ?? "stream"],
      ...(input.description ? [["about", input.description.trim()]] : []),
    ],
  });
  return id;
}

export async function getChannelCanvas(
  channelId: string,
): Promise<ChannelCanvas> {
  const events = await queryEvents(
    relayWsUrl(),
    { kinds: [40100], "#h": [channelId], limit: 100 },
    { requireNip07: true },
  );
  const latest = events
    .filter(
      (event) =>
        event.content.length <= 128 * 1024 &&
        event.tags.some(
          (tag) => tag.length === 2 && tag[0] === "h" && tag[1] === channelId,
        ),
    )
    .sort((a, b) => b.created_at - a.created_at || a.id.localeCompare(b.id))[0];
  return latest
    ? {
        content: latest.content,
        eventId: latest.id,
        updatedAt: latest.created_at,
        author: latest.pubkey,
      }
    : { content: "", eventId: null, updatedAt: null, author: null };
}

export async function setChannelCanvas(channelId: string, content: string) {
  if (!/^[0-9a-f-]{36}$/iu.test(channelId))
    throw new Error("The relay returned an invalid channel identifier.");
  if (content.length > 128 * 1024)
    throw new Error("Canvas content is limited to 128 KB.");
  await submitEvent({ kind: 40100, tags: [["h", channelId]], content });
}

export async function openDm(pubkeys: string[]): Promise<string> {
  const normalized = [
    ...new Set(pubkeys.map((value) => value.trim().toLowerCase())),
  ];
  if (!normalized.length || normalized.length > 8)
    throw new Error("Enter between one and eight participant public keys.");
  if (normalized.some((pubkey) => !/^[0-9a-f]{64}$/.test(pubkey)))
    throw new Error("Every participant must be a 64-character public key.");
  const { receipt } = await submitEvent({
    kind: 41010,
    content: "",
    tags: normalized.map((pubkey) => ["p", pubkey]),
  });
  const raw = receipt.message?.replace(/^response:/, "") ?? "{}";
  const parsed = JSON.parse(raw) as { channel_id?: string };
  if (!parsed.channel_id)
    throw new Error("The relay did not return the DM channel.");
  return parsed.channel_id;
}

export async function joinChannel(channelId: string): Promise<void> {
  await submitEvent({ kind: 9021, content: "", tags: [["h", channelId]] });
}

export async function leaveChannel(channelId: string): Promise<void> {
  await submitEvent({ kind: 9022, content: "", tags: [["h", channelId]] });
}

export async function updateChannel(input: {
  channelId: string;
  name?: string;
  description?: string;
  visibility?: "open" | "private";
  topic?: string;
  purpose?: string;
}): Promise<void> {
  const tags = [["h", input.channelId]];
  if (input.name !== undefined)
    tags.push(["name", canonicalChannelName(input.name)]);
  if (input.description !== undefined) tags.push(["about", input.description]);
  if (input.visibility !== undefined)
    tags.push(["visibility", input.visibility]);
  if (input.topic !== undefined) tags.push(["topic", input.topic]);
  if (input.purpose !== undefined) tags.push(["purpose", input.purpose]);
  await submitEvent({ kind: 9002, content: "", tags });
}

export async function archiveChannel(channelId: string): Promise<void> {
  await submitEvent({
    kind: 9002,
    content: "",
    tags: [
      ["h", channelId],
      ["archived", "true"],
    ],
  });
}

export async function restoreChannel(channelId: string): Promise<void> {
  await submitEvent({
    kind: 9002,
    content: "",
    tags: [
      ["h", channelId],
      ["archived", "false"],
    ],
  });
}

export async function deleteChannel(channelId: string): Promise<void> {
  await submitEvent({ kind: 9008, content: "", tags: [["h", channelId]] });
}

function calculateDepths(messages: ChannelMessage[]) {
  const byId = new Map(messages.map((message) => [message.id, message]));
  const visit = (message: ChannelMessage, seen = new Set<string>()): number => {
    if (!message.parentId || seen.has(message.id)) return 0;
    const parent = byId.get(message.parentId);
    if (!parent) return 1;
    seen.add(message.id);
    return Math.min(8, visit(parent, seen) + 1);
  };
  for (const message of messages) message.depth = visit(message);
}

function projectMessages(
  contentEvents: NostrEvent[],
  auxEvents: NostrEvent[],
  ownerPubkey: string,
): ChannelMessage[] {
  const deletedEventIds = new Set(
    auxEvents
      .filter((event) => event.kind === 5 || event.kind === 9005)
      .flatMap((event) => tagValues(event, "e")),
  );
  const edits = new Map<string, NostrEvent>();
  for (const event of auxEvents.filter((item) => item.kind === 40003)) {
    const target = tagValue(event, "e");
    const current = target ? edits.get(target) : null;
    if (target && (!current || current.created_at <= event.created_at))
      edits.set(target, event);
  }
  const reactionGroups = new Map<string, Map<string, NostrEvent[]>>();
  for (const event of auxEvents.filter(
    (item) => item.kind === 7 && !deletedEventIds.has(item.id),
  )) {
    const target = tagValue(event, "e");
    if (!target) continue;
    const byEmoji =
      reactionGroups.get(target) ?? new Map<string, NostrEvent[]>();
    const reactions = byEmoji.get(event.content) ?? [];
    if (!reactions.some((reaction) => reaction.pubkey === event.pubkey))
      reactions.push(event);
    byEmoji.set(event.content, reactions);
    reactionGroups.set(target, byEmoji);
  }
  const messages = contentEvents.map((event): ChannelMessage => {
    const thread = parseThread(event);
    const edit = edits.get(event.id);
    const effectiveTags = applyEditTagOverlay(event.tags, edit?.tags);
    const effectiveContent = edit?.content ?? event.content;
    const reactions = [...(reactionGroups.get(event.id)?.entries() ?? [])].map(
      ([emoji, events]) => ({
        emoji,
        count: events.length,
        pubkeys: events.map((reaction) => reaction.pubkey),
        ownEventId:
          events.find((reaction) => reaction.pubkey === ownerPubkey)?.id ??
          null,
      }),
    );
    return {
      id: event.id,
      pubkey: event.pubkey,
      content: effectiveContent,
      createdAt: event.created_at,
      kind: event.kind,
      tags: effectiveTags,
      ...thread,
      depth: 0,
      edited: Boolean(edit),
      deleted: deletedEventIds.has(event.id),
      reactions,
      attachments: parseImeta(effectiveTags, effectiveContent),
    };
  });
  calculateDepths(messages);
  return messages.sort(
    (a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id),
  );
}

export async function listChannelMessages(
  channelId: string,
  ownerPubkey: string,
  focusEventId?: string | null,
): Promise<ChannelMessage[]> {
  const content = await queryEvents(
    relayWsUrl(),
    [
      { kinds: CONTENT_KINDS, "#h": [channelId], limit: 500 },
      ...(focusEventId
        ? [
            {
              ids: [focusEventId],
              kinds: CONTENT_KINDS,
              "#h": [channelId],
              limit: 1,
            },
          ]
        : []),
    ],
    { requireNip07: true },
  );
  if (!content.length) return [];
  const ids = content.map((event) => event.id);
  const auxFilters: NostrFilter[] = [
    { kinds: AUX_KINDS, "#h": [channelId], limit: 1000 },
    { kinds: AUX_KINDS, "#e": ids, limit: 1000 },
  ];
  const firstAux = await queryEvents(relayWsUrl(), auxFilters, {
    requireNip07: true,
  });
  const reactionIds = firstAux
    .filter((event) => event.kind === 7)
    .map((event) => event.id);
  const reactionDeletes = reactionIds.length
    ? await queryEvents(
        relayWsUrl(),
        { kinds: [5], "#e": reactionIds, limit: 1000 },
        { requireNip07: true },
      )
    : [];
  const dedupedAux = [
    ...new Map(
      [...firstAux, ...reactionDeletes].map((e) => [e.id, e]),
    ).values(),
  ];
  return projectMessages(content, dedupedAux, ownerPubkey);
}

export async function sendChannelMessage(input: {
  channelId: string;
  content: string;
  mentionPubkeys?: string[];
  parentId?: string | null;
  rootId?: string | null;
  forumPost?: boolean;
  mediaTags?: string[][];
}): Promise<NostrEvent> {
  const content = input.content.trim();
  if (!content && !input.mediaTags?.length) throw new Error("Enter a message.");
  if (new TextEncoder().encode(content).length > 64 * 1024)
    throw new Error("Message is too long.");
  const tags: string[][] = [
    ["h", input.channelId],
    ...[...new Set(input.mentionPubkeys ?? [])].map((pubkey) => ["p", pubkey]),
  ];
  if (input.parentId) {
    if (input.rootId && input.rootId !== input.parentId)
      tags.push(["e", input.rootId, "", "root"]);
    tags.push(["e", input.parentId, "", "reply"]);
  }
  tags.push(...(input.mediaTags ?? []));
  const kind = input.forumPost ? 45001 : input.parentId ? 45003 : 9;
  return (await submitEvent({ kind, content, tags })).event;
}

export async function editMessage(input: {
  channelId: string;
  eventId: string;
  content: string;
  mediaTags: string[][];
  mentionPubkeys?: string[];
}): Promise<void> {
  const content = input.content.trim();
  if (!content && !input.mediaTags.length)
    throw new Error("A message cannot be empty.");
  if (new TextEncoder().encode(content).length > 64 * 1024)
    throw new Error("Message is too long.");
  await submitEvent({
    kind: 40003,
    content,
    tags: [
      ["h", input.channelId],
      ["e", input.eventId],
      ...[...new Set(input.mentionPubkeys ?? [])].map((pubkey) => [
        "p",
        pubkey,
      ]),
      ...input.mediaTags,
    ],
  });
}

export async function deleteMessage(
  channelId: string,
  eventId: string,
): Promise<void> {
  await submitEvent({
    kind: 9005,
    content: "",
    tags: [
      ["h", channelId],
      ["e", eventId],
    ],
  });
}

export async function addReaction(
  eventId: string,
  emoji: string,
  customEmojiUrl?: string,
): Promise<void> {
  const shortcode =
    emoji.startsWith(":") && emoji.endsWith(":") ? emoji.slice(1, -1) : null;
  await submitEvent({
    kind: 7,
    content: emoji,
    tags: [
      ["e", eventId],
      ...(shortcode && customEmojiUrl
        ? [["emoji", shortcode, customEmojiUrl]]
        : []),
    ],
  });
}

export async function removeReaction(reactionEventId: string): Promise<void> {
  await submitEvent({ kind: 5, content: "", tags: [["e", reactionEventId]] });
}

export async function searchMessages(input: {
  text: string;
  channelId?: string;
  authors?: string[];
  since?: number | null;
  until?: number | null;
}): Promise<NostrEvent[]> {
  const text = input.text.trim();
  if (text.length < 2) return [];
  return queryEventsHttp({
    kinds: [9, 40002, 45001, 45003],
    search: text,
    search_mode: "prefix",
    limit: 100,
    ...(input.channelId ? { "#h": [input.channelId] } : {}),
    ...(input.authors?.length ? { authors: input.authors } : {}),
    ...(input.since !== null && input.since !== undefined
      ? { since: input.since }
      : {}),
    ...(input.until !== null && input.until !== undefined
      ? { until: input.until }
      : {}),
  });
}

export async function listProfiles(pubkeys: string[]): Promise<UserProfile[]> {
  const authors = [...new Set(pubkeys.filter(Boolean))];
  if (!authors.length) return [];
  const events = await queryEvents(
    relayWsUrl(),
    { kinds: [0], authors, limit: authors.length * 2 },
    { requireNip07: true },
  );
  const latest = new Map<string, NostrEvent>();
  for (const event of events) {
    const current = latest.get(event.pubkey);
    if (!current || current.created_at < event.created_at)
      latest.set(event.pubkey, event);
  }
  return [...latest.values()].map((event) => {
    let profile: Record<string, unknown> = {};
    try {
      const value = JSON.parse(event.content) as unknown;
      if (value && typeof value === "object" && !Array.isArray(value)) {
        profile = value as Record<string, unknown>;
      }
    } catch {
      // Preserve a pubkey fallback for malformed legacy metadata.
    }
    return {
      pubkey: event.pubkey,
      displayName:
        typeof profile.display_name === "string"
          ? profile.display_name
          : typeof profile.name === "string"
            ? profile.name
            : null,
      avatarUrl: typeof profile.picture === "string" ? profile.picture : null,
      about: typeof profile.about === "string" ? profile.about : null,
      nip05Handle:
        typeof profile.nip05 === "string" && profile.nip05.length <= 320
          ? profile.nip05
          : null,
    };
  });
}

export async function listChannelMembers(
  channelId: string,
): Promise<ChannelMember[]> {
  const events = await queryEvents(
    relayWsUrl(),
    { kinds: [39002], "#d": [channelId], limit: 1 },
    { requireNip07: true },
  );
  const event = events.sort((a, b) => b.created_at - a.created_at)[0];
  return (event?.tags ?? []).flatMap((tag) => {
    if (tag[0] !== "p" || !/^[0-9a-f]{64}$/i.test(tag[1] ?? "")) return [];
    const rawRole = tag[3];
    const role = ["owner", "admin", "member", "guest", "bot"].includes(rawRole)
      ? (rawRole as ChannelMember["role"])
      : "member";
    return [{ pubkey: tag[1].toLowerCase(), role }];
  });
}

export async function addChannelMember(
  channelId: string,
  pubkey: string,
  role: Exclude<ChannelMember["role"], "owner"> = "member",
): Promise<void> {
  if (!/^[0-9a-f]{64}$/i.test(pubkey))
    throw new Error("Enter a 64-character public key.");
  await submitEvent({
    kind: 9000,
    content: "",
    tags: [
      ["h", channelId],
      ["p", pubkey.toLowerCase()],
      ...(role === "member" ? [] : [["role", role]]),
    ],
  });
}

export async function removeChannelMember(
  channelId: string,
  pubkey: string,
): Promise<void> {
  await submitEvent({
    kind: 9001,
    content: "",
    tags: [
      ["h", channelId],
      ["p", pubkey.toLowerCase()],
    ],
  });
}

export function changeChannelMemberRole(
  channelId: string,
  pubkey: string,
  role: Exclude<ChannelMember["role"], "owner">,
): Promise<void> {
  return addChannelMember(channelId, pubkey, role);
}

export async function sendTypingIndicator(
  channelId: string,
  parentId?: string | null,
  rootId?: string | null,
): Promise<void> {
  const tags: string[][] = [["h", channelId]];
  if (rootId) tags.push(["e", rootId, "", "root"]);
  if (parentId) tags.push(["e", parentId, "", "reply"]);
  await publishEphemeralEvent({ kind: 20002, content: "", tags });
}

export async function sendPresence(
  status: "online" | "away" | "offline",
): Promise<void> {
  await publishEphemeralEvent({ kind: 20001, content: status, tags: [] });
}

export type UploadedMedia = {
  url: string;
  sha256: string;
  size: number;
  type: string;
  dimensions?: string;
  thumbnailUrl?: string;
};

function base64Url(value: string): string {
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

export async function uploadMedia(file: File): Promise<UploadedMedia> {
  const bytes = await file.arrayBuffer();
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  const sha256 = [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
  const relay = new URL(relayHttpBaseUrl());
  const expiration =
    Math.floor(Date.now() / 1000) +
    (file.type.startsWith("video/") ? 3600 : 600);
  const auth = await signNostrEvent(
    {
      kind: 24242,
      content: "Upload buzz-media",
      tags: [
        ["t", "upload"],
        ["x", sha256],
        ["expiration", String(expiration)],
        ["server", relay.host],
      ],
    },
    { requireNip07: true },
  );
  const response = await fetch(`${relayHttpBaseUrl()}/upload`, {
    method: "PUT",
    headers: {
      Authorization: `Nostr ${base64Url(JSON.stringify(auth))}`,
      "Content-Type": file.type || "application/octet-stream",
      "X-SHA-256": sha256,
    },
    body: bytes,
  });
  const payload = (await response.json().catch(() => null)) as Record<
    string,
    unknown
  > | null;
  if (!response.ok || !payload)
    throw new Error(
      (payload?.error as string) || `Upload failed (${response.status}).`,
    );
  return {
    url: String(payload.url ?? ""),
    sha256: String(payload.sha256 ?? sha256),
    size: Number(payload.size ?? file.size),
    type: String(payload.type ?? payload.mime_type ?? file.type),
    dimensions: typeof payload.dim === "string" ? payload.dim : undefined,
    thumbnailUrl:
      typeof payload.thumb === "string"
        ? payload.thumb
        : typeof payload.thumbnail_url === "string"
          ? payload.thumbnail_url
          : undefined,
  };
}

export function mediaImetaTag(
  media: UploadedMedia,
  fileName: string,
): string[] {
  return [
    "imeta",
    `url ${media.url}`,
    `m ${media.type}`,
    ...(media.sha256 ? [`x ${media.sha256}`] : []),
    ...(media.size > 0 ? [`size ${media.size}`] : []),
    `filename ${fileName}`,
    ...(media.dimensions ? [`dim ${media.dimensions}`] : []),
    ...(media.thumbnailUrl ? [`thumb ${media.thumbnailUrl}`] : []),
  ];
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
    )
      continue;
    const id = await uuidV5(
      STARTER_NAMESPACE,
      `starter-channel:v1:${relayHttpBaseUrl().trim()}:${starter.slug}`,
    );
    try {
      await createChannel({ id, ...starter });
    } catch (error) {
      if (!(error instanceof Error) || !error.message.includes("duplicate"))
        throw error;
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
    )
      return channels;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  return channels;
}
