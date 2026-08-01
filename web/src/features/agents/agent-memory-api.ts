import { queryEvents, type NostrEvent } from "@/shared/lib/nostr-client";
import {
  deriveAgentMemoryAddress,
  nip44DecryptFromPeer,
} from "@/shared/lib/nostr-signer";
import { relayWsUrl } from "@/shared/lib/relay-url";

export type AgentMemoryEntry = {
  slug: string;
  value: string;
  eventId: string;
  createdAt: number;
  core: boolean;
};

export type AgentMemorySnapshot = {
  entries: AgentMemoryEntry[];
  rejected: number;
  limitReached: boolean;
};

type AgentMemoryRecord = Omit<AgentMemoryEntry, "value"> & {
  value: string | null;
};

function exactTag(event: NostrEvent, name: string): string | null {
  const tags = event.tags.filter((tag) => tag.length === 2 && tag[0] === name);
  return tags.length === 1 ? (tags[0][1] ?? null) : null;
}

function validSlug(value: string): boolean {
  return (
    value === "core" ||
    (new TextEncoder().encode(value).length <= 255 &&
      /^mem\/[a-z0-9][a-z0-9_-]{0,63}(\/[a-z0-9][a-z0-9_-]{0,63})*$/u.test(
        value,
      ))
  );
}

async function parseMemoryEvent(
  event: NostrEvent,
  agentPubkey: string,
  ownerPubkey: string,
): Promise<AgentMemoryRecord | null> {
  const address = exactTag(event, "d");
  const owner = exactTag(event, "p");
  if (
    event.kind !== 30174 ||
    event.pubkey !== agentPubkey ||
    owner !== ownerPubkey ||
    !address ||
    !/^[0-9a-f]{64}$/u.test(address)
  )
    return null;
  try {
    const plaintext = await nip44DecryptFromPeer(agentPubkey, event.content);
    if (new TextEncoder().encode(plaintext).length > 65_535) return null;
    const body = JSON.parse(plaintext) as Record<string, unknown>;
    if (!body || typeof body !== "object" || Array.isArray(body)) return null;
    const slug = body.slug;
    if (typeof slug !== "string" || !validSlug(slug)) return null;
    const derivedAddress = await deriveAgentMemoryAddress(agentPubkey, slug);
    if (derivedAddress !== address) return null;
    const core = slug === "core";
    const value = core ? body.profile : body.value;
    if (
      core
        ? typeof value !== "string"
        : value !== null && typeof value !== "string"
    )
      return null;
    return {
      slug,
      value: value as string | null,
      eventId: event.id,
      createdAt: event.created_at,
      core,
    };
  } catch {
    return null;
  }
}

export async function listAgentMemory(
  agentPubkey: string,
  ownerPubkey: string,
): Promise<AgentMemorySnapshot> {
  if (!/^[0-9a-f]{64}$/u.test(agentPubkey))
    throw new Error("The agent public key is invalid.");
  const limit = 500;
  const events = await queryEvents(
    relayWsUrl(),
    {
      kinds: [30174],
      authors: [agentPubkey],
      "#p": [ownerPubkey],
      limit,
    },
    { requireNip07: true },
  );
  const parsed = await Promise.all(
    events.map((event) => parseMemoryEvent(event, agentPubkey, ownerPubkey)),
  );
  const heads = new Map<string, AgentMemoryRecord>();
  for (const entry of parsed) {
    if (!entry) continue;
    const current = heads.get(entry.slug);
    if (
      !current ||
      entry.createdAt > current.createdAt ||
      (entry.createdAt === current.createdAt && entry.eventId < current.eventId)
    )
      heads.set(entry.slug, entry);
  }
  return {
    entries: [...heads.values()]
      .filter((entry): entry is AgentMemoryEntry => entry.value !== null)
      .sort((a, b) => {
        if (a.core) return -1;
        if (b.core) return 1;
        return a.slug.localeCompare(b.slug);
      }),
    rejected: parsed.filter((entry) => entry === null).length,
    limitReached: events.length >= limit,
  };
}
