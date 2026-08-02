import {
  queryEvents,
  subscribeEvents,
  type NostrEvent,
} from "@/shared/lib/nostr-client";
import { submitEvent } from "@/shared/lib/relay-events";
import { relayWsUrl } from "@/shared/lib/relay-url";
import {
  nip44DecryptFromSelf,
  nip44EncryptToSelf,
} from "@/shared/lib/nostr-signer";

const KIND_READ_STATE = 30078;
const D_TAG_PREFIX = "read-state:";
const HORIZON_SECONDS = 7 * 24 * 60 * 60;
const FETCH_LIMIT = 500;
const MAX_CONTEXTS = 10_000;
const MAX_PLAINTEXT_BYTES = 32_768;
const DEBOUNCE_MS = 5_000;

type ReadStateBlob = {
  v: 1;
  client_id: string;
  contexts: Record<string, number>;
};

function storageKey(pubkey: string, part: string) {
  return `buzz.nip-rs.web:${part}:${pubkey}`;
}

function randomHex(bytes: number): string {
  const value = new Uint8Array(bytes);
  crypto.getRandomValues(value);
  return [...value].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function persistedId(key: string, create: () => string): string {
  const existing = localStorage.getItem(key);
  if (existing) return existing;
  const value = create();
  try {
    localStorage.setItem(key, value);
  } catch {
    // The relay snapshot remains authoritative when storage is unavailable.
  }
  return value;
}

function validDTag(value: string | undefined): value is string {
  if (!value?.startsWith(D_TAG_PREFIX)) return false;
  const slot = value.slice(D_TAG_PREFIX.length);
  return (
    slot.length > 0 &&
    slot.length <= 64 &&
    [...slot].every((character) => character.charCodeAt(0) <= 0x7f)
  );
}

function sanitizeContexts(value: unknown): Record<string, number> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const entries = Object.entries(value);
  if (entries.length > MAX_CONTEXTS) return null;
  const contexts: Record<string, number> = {};
  for (const [contextId, timestamp] of entries) {
    if (new TextEncoder().encode(contextId).length > 256) continue;
    if (
      typeof timestamp !== "number" ||
      !Number.isInteger(timestamp) ||
      timestamp < 0 ||
      timestamp > 4_294_967_295
    )
      continue;
    contexts[contextId] = timestamp;
  }
  return contexts;
}

async function parseEvent(
  event: NostrEvent,
  pubkey: string,
): Promise<{ dTag: string; blob: ReadStateBlob } | null> {
  if (event.pubkey !== pubkey) return null;
  const dTags = event.tags.filter((tag) => tag[0] === "d");
  const readTags = event.tags.filter(
    (tag) => tag[0] === "t" && tag[1] === "read-state",
  );
  if (dTags.length !== 1 || readTags.length !== 1 || !validDTag(dTags[0]?.[1]))
    return null;
  try {
    const plaintext = await nip44DecryptFromSelf(event.content);
    const value = JSON.parse(plaintext) as Partial<ReadStateBlob>;
    if (
      value.v !== 1 ||
      typeof value.client_id !== "string" ||
      !value.client_id ||
      value.client_id.length > 64
    )
      return null;
    const contexts = sanitizeContexts(value.contexts);
    if (!contexts) return null;
    return {
      dTag: dTags[0][1],
      blob: { v: 1, client_id: value.client_id, contexts },
    };
  } catch {
    return null;
  }
}

function trimToBudget(blob: ReadStateBlob): ReadStateBlob | null {
  const encodedSize = () =>
    new TextEncoder().encode(JSON.stringify(blob)).byteLength;
  if (encodedSize() <= MAX_PLAINTEXT_BYTES) return blob;
  const removable = Object.entries(blob.contexts)
    .filter(([key]) => key.startsWith("msg:") || key.startsWith("thread:"))
    .sort((left, right) => {
      const leftTier = left[0].startsWith("msg:") ? 0 : 1;
      const rightTier = right[0].startsWith("msg:") ? 0 : 1;
      return leftTier - rightTier || left[1] - right[1];
    });
  for (const [contextId] of removable) {
    delete blob.contexts[contextId];
    if (encodedSize() <= MAX_PLAINTEXT_BYTES) return blob;
  }
  return null;
}

export class ReadStateManager {
  private contexts = new Map<string, number>();
  private listeners = new Set<() => void>();
  private subscription: { close: () => void } | null = null;
  private publishTimer: ReturnType<typeof setTimeout> | null = null;
  private destroyed = false;
  private maxCreatedAt = 0;
  private lastPublished = "";
  private readonly clientId: string;
  private slotId: string;

  constructor(private readonly pubkey: string) {
    this.clientId = persistedId(storageKey(pubkey, "client-id"), () =>
      crypto.randomUUID(),
    );
    this.slotId = persistedId(storageKey(pubkey, "slot-id"), () =>
      randomHex(16),
    );
    this.hydrate();
  }

  async initialize(): Promise<void> {
    try {
      const events = await queryEvents(
        relayWsUrl(),
        {
          kinds: [KIND_READ_STATE],
          authors: [this.pubkey],
          "#t": ["read-state"],
          since: Math.floor(Date.now() / 1000) - HORIZON_SECONDS,
          limit: FETCH_LIMIT,
        },
        { requireNip07: true },
      );
      await this.merge(events);
    } catch {
      // Local state still provides useful continuity while the relay is offline.
    }
    if (this.destroyed) return;
    this.subscription = subscribeEvents(
      relayWsUrl(),
      {
        kinds: [KIND_READ_STATE],
        authors: [this.pubkey],
        "#t": ["read-state"],
        limit: FETCH_LIMIT,
      },
      (event) => void this.merge([event]),
      { requireNip07: true },
    );
    this.notify();
  }

  getTimestamp(contextId: string): number | null {
    return this.contexts.get(contextId) ?? null;
  }

  snapshot(): Record<string, number> {
    return Object.fromEntries(this.contexts);
  }

  markRead(contextId: string, timestamp: number): void {
    const normalized = Math.max(0, Math.floor(timestamp));
    if (normalized <= (this.contexts.get(contextId) ?? 0)) return;
    this.contexts.set(contextId, normalized);
    this.persist();
    this.notify();
    this.schedulePublish();
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  destroy(): void {
    this.destroyed = true;
    this.subscription?.close();
    if (this.publishTimer) {
      clearTimeout(this.publishTimer);
      this.publishTimer = null;
      void this.publish();
    }
    this.listeners.clear();
  }

  private hydrate(): void {
    try {
      const raw = localStorage.getItem(storageKey(this.pubkey, "contexts"));
      const contexts = sanitizeContexts(raw ? JSON.parse(raw) : {});
      if (contexts) this.contexts = new Map(Object.entries(contexts));
    } catch {
      this.contexts.clear();
    }
  }

  private persist(): void {
    try {
      localStorage.setItem(
        storageKey(this.pubkey, "contexts"),
        JSON.stringify(Object.fromEntries(this.contexts)),
      );
    } catch {
      // Relay persistence still runs when local storage is full or disabled.
    }
  }

  private async merge(events: NostrEvent[]): Promise<void> {
    let advanced = false;
    let remoteAdvanced = false;
    for (const event of events) {
      const parsed = await parseEvent(event, this.pubkey);
      if (!parsed || this.destroyed) continue;
      this.maxCreatedAt = Math.max(this.maxCreatedAt, event.created_at);
      if (
        parsed.dTag === `${D_TAG_PREFIX}${this.slotId}` &&
        parsed.blob.client_id !== this.clientId
      ) {
        this.slotId = randomHex(16);
        try {
          localStorage.setItem(storageKey(this.pubkey, "slot-id"), this.slotId);
        } catch {
          // A page-lifetime slot still prevents overwriting the remote client.
        }
      }
      for (const [contextId, timestamp] of Object.entries(
        parsed.blob.contexts,
      )) {
        if (timestamp <= (this.contexts.get(contextId) ?? 0)) continue;
        this.contexts.set(contextId, timestamp);
        advanced = true;
        if (parsed.blob.client_id !== this.clientId) remoteAdvanced = true;
      }
      if (
        parsed.dTag === `${D_TAG_PREFIX}${this.slotId}` &&
        parsed.blob.client_id === this.clientId
      ) {
        this.lastPublished = JSON.stringify(parsed.blob.contexts);
      }
    }
    if (!advanced) return;
    this.persist();
    this.notify();
    if (remoteAdvanced) this.schedulePublish();
  }

  private schedulePublish(): void {
    if (this.publishTimer) clearTimeout(this.publishTimer);
    this.publishTimer = setTimeout(() => {
      this.publishTimer = null;
      void this.publish();
    }, DEBOUNCE_MS);
  }

  private async publish(): Promise<void> {
    if (this.destroyed && !this.contexts.size) return;
    const contexts = Object.fromEntries(this.contexts);
    const blob = trimToBudget({
      v: 1,
      client_id: this.clientId,
      contexts,
    });
    if (!blob) return;
    const serializedContexts = JSON.stringify(blob.contexts);
    if (serializedContexts === this.lastPublished) return;
    try {
      const content = await nip44EncryptToSelf(JSON.stringify(blob));
      const createdAt = Math.max(
        Math.floor(Date.now() / 1000),
        this.maxCreatedAt + 1,
      );
      const { event } = await submitEvent({
        kind: KIND_READ_STATE,
        content,
        created_at: createdAt,
        tags: [
          ["d", `${D_TAG_PREFIX}${this.slotId}`],
          ["t", "read-state"],
        ],
      });
      this.maxCreatedAt = Math.max(this.maxCreatedAt, event.created_at);
      this.lastPublished = serializedContexts;
    } catch {
      // The next local or remote advance retries convergence.
    }
  }

  private notify(): void {
    for (const listener of this.listeners) listener();
  }
}
