import { nip19 } from "nostr-tools";

import {
  mediaImetaTag,
  uploadMedia,
  type UserProfile,
  listProfiles,
} from "@/features/channels/channel-api";
import { queryEvents, type NostrEvent } from "@/shared/lib/nostr-client";
import { submitEvent } from "@/shared/lib/relay-events";
import { relayWsUrl } from "@/shared/lib/relay-url";

export type PulseNote = {
  id: string;
  pubkey: string;
  content: string;
  createdAt: number;
  tags: string[][];
  replyTo: string | null;
  attachments: Array<{ url: string; type: string | null; name: string | null }>;
  reactionCount: number;
  ownReactionId: string | null;
};

export type PulseData = {
  notes: PulseNote[];
  contacts: Set<string>;
  agents: Map<string, string>;
  profiles: Map<string, UserProfile>;
};

function imeta(event: NostrEvent) {
  return event.tags
    .filter((value) => value[0] === "imeta")
    .map((value) => {
      const fields = new Map<string, string>();
      for (const item of value.slice(1)) {
        const split = item.indexOf(" ");
        if (split > 0) fields.set(item.slice(0, split), item.slice(split + 1));
      }
      const rawUrl = fields.get("url") ?? "";
      let url = "";
      try {
        const parsed = new URL(rawUrl);
        if (parsed.protocol === "https:" || parsed.protocol === "http:")
          url = parsed.toString();
      } catch {
        // Ignore malformed and active-content attachment URLs.
      }
      return {
        url,
        type: fields.get("m") ?? null,
        name: fields.get("name") ?? null,
      };
    })
    .filter((value) => value.url);
}

function deletionTargets(events: NostrEvent[]) {
  const targets = new Set<string>();
  for (const event of events.filter((value) => value.kind === 5)) {
    for (const value of event.tags) {
      if (value[0] === "e" && value[1])
        targets.add(`${event.pubkey}:${value[1]}`);
    }
  }
  return targets;
}

export async function getPulseData(ownerPubkey: string): Promise<PulseData> {
  const events = await queryEvents(
    relayWsUrl(),
    [
      { kinds: [1], limit: 500 },
      { kinds: [7], limit: 2000 },
      { kinds: [5], limit: 2000 },
      { kinds: [3], authors: [ownerPubkey], limit: 1 },
      { kinds: [10100], limit: 500 },
    ],
    { requireNip07: true },
  );
  const deleted = deletionTargets(events);
  const noteEvents = events.filter(
    (event) =>
      event.kind === 1 &&
      !deleted.has(`${event.pubkey}:${event.id}`) &&
      !event.tags.some(
        (value) => value[0] === "a" && value[1]?.startsWith("30617:"),
      ),
  );
  const noteIds = new Set(noteEvents.map((event) => event.id));
  const reactions = events.filter(
    (event) =>
      event.kind === 7 &&
      (event.content === "+" || event.content === "") &&
      !deleted.has(`${event.pubkey}:${event.id}`) &&
      event.tags.some((value) => value[0] === "e" && noteIds.has(value[1])),
  );
  const reactionsByNote = new Map<string, NostrEvent[]>();
  for (const event of reactions) {
    const noteId = [...event.tags]
      .reverse()
      .find((value) => value[0] === "e" && noteIds.has(value[1]))?.[1];
    if (!noteId) continue;
    const current = reactionsByNote.get(noteId) ?? [];
    if (!current.some((value) => value.pubkey === event.pubkey))
      current.push(event);
    reactionsByNote.set(noteId, current);
  }
  const notes: PulseNote[] = noteEvents
    .map((event) => {
      const noteReactions = reactionsByNote.get(event.id) ?? [];
      return {
        id: event.id,
        pubkey: event.pubkey,
        content: event.content,
        createdAt: event.created_at,
        tags: event.tags,
        replyTo:
          [...event.tags].reverse().find((value) => value[0] === "e")?.[1] ??
          null,
        attachments: imeta(event),
        reactionCount: noteReactions.length,
        ownReactionId:
          noteReactions.find((value) => value.pubkey === ownerPubkey)?.id ??
          null,
      };
    })
    .sort((a, b) => b.createdAt - a.createdAt || b.id.localeCompare(a.id));

  const contactEvent = events
    .filter((event) => event.kind === 3 && event.pubkey === ownerPubkey)
    .sort((a, b) => b.created_at - a.created_at)[0];
  const contacts = new Set(
    (contactEvent?.tags ?? [])
      .filter((value) => value[0] === "p" && /^[0-9a-f]{64}$/i.test(value[1]))
      .map((value) => value[1].toLowerCase()),
  );
  const agents = new Map<string, string>();
  for (const event of events.filter((value) => value.kind === 10100)) {
    let content: Record<string, unknown> = {};
    try {
      content = JSON.parse(event.content) as Record<string, unknown>;
    } catch {
      // The author pubkey remains authoritative even for malformed metadata.
    }
    const name =
      (typeof content.name === "string" && content.name.trim()) ||
      (typeof content.display_name === "string" &&
        content.display_name.trim()) ||
      nip19.npubEncode(event.pubkey);
    agents.set(event.pubkey, name);
  }
  const authors = [...new Set(notes.map((note) => note.pubkey))];
  const profileRows = await listProfiles(authors);
  const profiles = new Map(
    profileRows.map((profile) => [profile.pubkey, profile]),
  );
  return { notes, contacts, agents, profiles };
}

export async function publishPulseNote(input: {
  content: string;
  replyTo?: PulseNote;
  mentionPubkeys?: string[];
  files?: File[];
}) {
  const content = input.content.trim();
  if (!content && !input.files?.length)
    throw new Error("Write a note or attach a file.");
  if (content.length > 64 * 1024) throw new Error("This note is too long.");
  const mediaTags: string[][] = [];
  for (const file of input.files ?? []) {
    const uploaded = await uploadMedia(file);
    mediaTags.push(mediaImetaTag(uploaded, file.name));
  }
  const mentions = new Set(input.mentionPubkeys ?? []);
  if (input.replyTo) mentions.add(input.replyTo.pubkey);
  await submitEvent({
    kind: 1,
    content,
    tags: [
      ...(input.replyTo ? [["e", input.replyTo.id, "", "reply"]] : []),
      ...[...mentions].map((pubkey) => ["p", pubkey]),
      ...mediaTags,
    ],
  });
}

export async function likePulseNote(note: PulseNote) {
  await submitEvent({ kind: 7, content: "+", tags: [["e", note.id]] });
}

export async function unlikePulseNote(note: PulseNote) {
  if (!note.ownReactionId) return;
  await submitEvent({
    kind: 5,
    content: "",
    tags: [["e", note.ownReactionId]],
  });
}

export function pulseShareUri(note: PulseNote) {
  return `nostr:${nip19.neventEncode({ id: note.id, author: note.pubkey })}`;
}
