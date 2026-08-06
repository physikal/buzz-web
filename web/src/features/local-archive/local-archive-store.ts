import { type NostrEvent, validNostrEvent } from "@/shared/lib/nostr-client";

export type ArchiveScopeType = "channel_h" | "owner_p" | "referenced_e";

export type ArchiveSubscription = {
  key: string;
  ownerPubkey: string;
  relayUrl: string;
  scopeType: ArchiveScopeType;
  scopeValue: string;
  kinds: number[];
  createdAt: number;
};

export type ArchiveCandidate = {
  event: NostrEvent;
  scopeType: ArchiveScopeType;
  scopeValue: string;
  storedJson?: string;
};

const DATABASE_NAME = "buzz-web-local-archive";
const DATABASE_VERSION = 1;
const SUBSCRIPTIONS_STORE = "subscriptions";
const EVENTS_STORE = "events";
const SCOPES_STORE = "event-scopes";
const CONTEXT_INDEX = "by-context";
const SCOPE_INDEX = "by-scope";
const CHANGE_EVENT = "buzz-web:local-archive-subscriptions";
const PUBKEY_PATTERN = /^[0-9a-f]{64}$/u;
const MAX_KINDS = 128;
const MAX_EVENT_BYTES = 256 * 1024;

type ArchivedEventRecord = {
  key: string;
  ownerPubkey: string;
  relayUrl: string;
  eventId: string;
  kind: number;
  author: string;
  createdAt: number;
  archivedAt: number;
  rawJson: string;
};

type ArchivedScopeRecord = {
  key: string;
  eventKey: string;
  ownerPubkey: string;
  relayUrl: string;
  scopeType: ArchiveScopeType;
  scopeValue: string;
  createdAt: number;
  eventId: string;
};

function requestResult<T>(request: IDBRequest<T>) {
  return new Promise<T>((resolve, reject) => {
    request.addEventListener("success", () => resolve(request.result));
    request.addEventListener("error", () =>
      reject(request.error ?? new Error("Local archive request failed.")),
    );
  });
}

function transactionDone(transaction: IDBTransaction) {
  return new Promise<void>((resolve, reject) => {
    transaction.addEventListener("complete", () => resolve());
    transaction.addEventListener("abort", () =>
      reject(
        transaction.error ?? new Error("Local archive transaction aborted."),
      ),
    );
    transaction.addEventListener("error", () =>
      reject(
        transaction.error ?? new Error("Local archive transaction failed."),
      ),
    );
  });
}

function openDatabase() {
  if (!("indexedDB" in globalThis)) {
    return Promise.reject(
      new Error("This browser does not support local archive storage."),
    );
  }
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    request.addEventListener("upgradeneeded", () => {
      const database = request.result;
      const subscriptions = database.createObjectStore(SUBSCRIPTIONS_STORE, {
        keyPath: "key",
      });
      subscriptions.createIndex(CONTEXT_INDEX, ["ownerPubkey", "relayUrl"]);
      database.createObjectStore(EVENTS_STORE, { keyPath: "key" });
      const scopes = database.createObjectStore(SCOPES_STORE, {
        keyPath: "key",
      });
      scopes.createIndex(SCOPE_INDEX, [
        "ownerPubkey",
        "relayUrl",
        "scopeType",
        "scopeValue",
        "createdAt",
        "eventId",
      ]);
    });
    request.addEventListener("success", () => resolve(request.result));
    request.addEventListener("blocked", () =>
      reject(new Error("Local archive upgrade is blocked by another tab.")),
    );
    request.addEventListener("error", () =>
      reject(request.error ?? new Error("Could not open the local archive.")),
    );
  });
}

function normalizeContext(ownerPubkey: string, relayUrl: string) {
  const owner = ownerPubkey.toLowerCase();
  if (!PUBKEY_PATTERN.test(owner)) throw new Error("Invalid archive owner.");
  const relay = new URL(relayUrl);
  if (!new Set(["ws:", "wss:"]).has(relay.protocol)) {
    throw new Error("Invalid archive relay URL.");
  }
  relay.hash = "";
  return { owner, relay: relay.toString() };
}

function normalizeScope(
  owner: string,
  scopeType: ArchiveScopeType,
  scopeValue: string,
) {
  const value = scopeValue.trim();
  const hasControlCharacter = [...value].some((character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    return codePoint < 32 || codePoint === 127;
  });
  if (!value || value.length > 256 || hasControlCharacter) {
    throw new Error("Invalid archive scope.");
  }
  if (scopeType === "owner_p" && value.toLowerCase() !== owner) {
    throw new Error("Owner archives must target the active owner.");
  }
  if (scopeType === "referenced_e" && !PUBKEY_PATTERN.test(value)) {
    throw new Error("Invalid referenced event ID.");
  }
  return scopeType === "owner_p" ? value.toLowerCase() : value;
}

function normalizeKinds(kinds: number[]) {
  const normalized = [...new Set(kinds)].sort((left, right) => left - right);
  if (
    normalized.length === 0 ||
    normalized.length > MAX_KINDS ||
    normalized.some(
      (kind) => !Number.isSafeInteger(kind) || kind < 0 || kind > 65_535,
    )
  ) {
    throw new Error("Select between 1 and 128 valid event kinds.");
  }
  return normalized;
}

function subscriptionKey(
  owner: string,
  relay: string,
  scopeType: ArchiveScopeType,
  scopeValue: string,
) {
  return JSON.stringify([owner, relay, scopeType, scopeValue]);
}

function notifySubscriptionChange() {
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

export function onArchiveSubscriptionChange(listener: () => void) {
  window.addEventListener(CHANGE_EVENT, listener);
  return () => window.removeEventListener(CHANGE_EVENT, listener);
}

export async function listArchiveSubscriptions(
  ownerPubkey: string,
  relayUrl: string,
) {
  const { owner, relay } = normalizeContext(ownerPubkey, relayUrl);
  const database = await openDatabase();
  try {
    const transaction = database.transaction(SUBSCRIPTIONS_STORE, "readonly");
    const index = transaction
      .objectStore(SUBSCRIPTIONS_STORE)
      .index(CONTEXT_INDEX);
    const rows = await requestResult(
      index.getAll(IDBKeyRange.only([owner, relay])) as IDBRequest<
        ArchiveSubscription[]
      >,
    );
    await transactionDone(transaction);
    return rows.sort((left, right) => left.createdAt - right.createdAt);
  } finally {
    database.close();
  }
}

export async function saveArchiveSubscription(input: {
  ownerPubkey: string;
  relayUrl: string;
  scopeType: ArchiveScopeType;
  scopeValue: string;
  kinds: number[];
}) {
  const { owner, relay } = normalizeContext(input.ownerPubkey, input.relayUrl);
  const scopeValue = normalizeScope(owner, input.scopeType, input.scopeValue);
  const kinds = normalizeKinds(input.kinds);
  const key = subscriptionKey(owner, relay, input.scopeType, scopeValue);
  const database = await openDatabase();
  try {
    const transaction = database.transaction(SUBSCRIPTIONS_STORE, "readwrite");
    const store = transaction.objectStore(SUBSCRIPTIONS_STORE);
    const existing = await requestResult(
      store.get(key) as IDBRequest<ArchiveSubscription | undefined>,
    );
    store.put({
      key,
      ownerPubkey: owner,
      relayUrl: relay,
      scopeType: input.scopeType,
      scopeValue,
      kinds,
      createdAt: existing?.createdAt ?? Math.floor(Date.now() / 1_000),
    } satisfies ArchiveSubscription);
    await transactionDone(transaction);
  } finally {
    database.close();
  }
  notifySubscriptionChange();
}

export async function setOwnerArchiveKind(input: {
  ownerPubkey: string;
  relayUrl: string;
  kind: number;
  enabled: boolean;
}) {
  const { owner, relay } = normalizeContext(input.ownerPubkey, input.relayUrl);
  const kinds = normalizeKinds([input.kind]);
  const scopeType = "owner_p" as const;
  const key = subscriptionKey(owner, relay, scopeType, owner);
  const database = await openDatabase();
  try {
    const transaction = database.transaction(SUBSCRIPTIONS_STORE, "readwrite");
    const store = transaction.objectStore(SUBSCRIPTIONS_STORE);
    const existing = await requestResult(
      store.get(key) as IDBRequest<ArchiveSubscription | undefined>,
    );
    const nextKinds = new Set(existing?.kinds ?? []);
    if (input.enabled) nextKinds.add(kinds[0]);
    else nextKinds.delete(kinds[0]);
    if (nextKinds.size === 0) store.delete(key);
    else {
      store.put({
        key,
        ownerPubkey: owner,
        relayUrl: relay,
        scopeType,
        scopeValue: owner,
        kinds: [...nextKinds].sort((left, right) => left - right),
        createdAt: existing?.createdAt ?? Math.floor(Date.now() / 1_000),
      } satisfies ArchiveSubscription);
    }
    await transactionDone(transaction);
  } finally {
    database.close();
  }
  notifySubscriptionChange();
}

export async function deleteArchiveSubscription(input: {
  ownerPubkey: string;
  relayUrl: string;
  scopeType: ArchiveScopeType;
  scopeValue: string;
}) {
  const { owner, relay } = normalizeContext(input.ownerPubkey, input.relayUrl);
  const scopeValue = normalizeScope(owner, input.scopeType, input.scopeValue);
  const database = await openDatabase();
  try {
    const transaction = database.transaction(SUBSCRIPTIONS_STORE, "readwrite");
    transaction
      .objectStore(SUBSCRIPTIONS_STORE)
      .delete(subscriptionKey(owner, relay, input.scopeType, scopeValue));
    await transactionDone(transaction);
  } finally {
    database.close();
  }
  notifySubscriptionChange();
}

export async function archiveVerifiedEvents(input: {
  ownerPubkey: string;
  relayUrl: string;
  candidates: ArchiveCandidate[];
}) {
  if (input.candidates.length === 0) return;
  if (input.candidates.length > 25)
    throw new Error("Archive batch is too large.");
  const { owner, relay } = normalizeContext(input.ownerPubkey, input.relayUrl);
  const records = input.candidates.flatMap((candidate) => {
    try {
      const scopeValue = normalizeScope(
        owner,
        candidate.scopeType,
        candidate.scopeValue,
      );
      if (!validNostrEvent(candidate.event)) return [];
      const scopeTag =
        candidate.scopeType === "channel_h"
          ? "h"
          : candidate.scopeType === "owner_p"
            ? "p"
            : "e";
      if (
        !candidate.event.tags.some(
          (tag) =>
            tag[0] === scopeTag &&
            (candidate.scopeType === "owner_p"
              ? tag[1]?.toLowerCase() === scopeValue
              : tag[1] === scopeValue),
        )
      ) {
        return [];
      }
      if (candidate.event.kind === 24_200) {
        const agents = candidate.event.tags.filter((tag) => tag[0] === "agent");
        const frames = candidate.event.tags.filter((tag) => tag[0] === "frame");
        if (
          candidate.scopeType !== "owner_p" ||
          agents.length !== 1 ||
          agents[0]?.[1]?.toLowerCase() !== candidate.event.pubkey ||
          frames.length !== 1 ||
          frames[0]?.[1] !== "telemetry"
        ) {
          return [];
        }
      }
      if (candidate.event.kind === 44_200) {
        const agents = candidate.event.tags.filter((tag) => tag[0] === "agent");
        const recipients = candidate.event.tags.filter((tag) => tag[0] === "p");
        if (
          candidate.scopeType !== "owner_p" ||
          !candidate.storedJson ||
          agents.length !== 1 ||
          agents[0]?.[1]?.toLowerCase() !== candidate.event.pubkey ||
          recipients.length !== 1 ||
          recipients[0]?.[1]?.toLowerCase() !== owner
        ) {
          return [];
        }
      }
      const rawJson =
        candidate.event.kind === 44_200
          ? (candidate.storedJson as string)
          : JSON.stringify(candidate.event);
      if (new TextEncoder().encode(rawJson).byteLength > MAX_EVENT_BYTES) {
        return [];
      }
      const eventKey = JSON.stringify([owner, relay, candidate.event.id]);
      return [
        {
          subscriptionKey: subscriptionKey(
            owner,
            relay,
            candidate.scopeType,
            scopeValue,
          ),
          eventKind: candidate.event.kind,
          event: {
            key: eventKey,
            ownerPubkey: owner,
            relayUrl: relay,
            eventId: candidate.event.id,
            kind: candidate.event.kind,
            author: candidate.event.pubkey,
            createdAt: candidate.event.created_at,
            archivedAt: Math.floor(Date.now() / 1_000),
            rawJson,
          } satisfies ArchivedEventRecord,
          scope: {
            key: JSON.stringify([eventKey, candidate.scopeType, scopeValue]),
            eventKey,
            ownerPubkey: owner,
            relayUrl: relay,
            scopeType: candidate.scopeType,
            scopeValue,
            createdAt: candidate.event.created_at,
            eventId: candidate.event.id,
          } satisfies ArchivedScopeRecord,
        },
      ];
    } catch {
      return [];
    }
  });
  if (records.length === 0) return;
  const database = await openDatabase();
  try {
    const transaction = database.transaction(
      [SUBSCRIPTIONS_STORE, EVENTS_STORE, SCOPES_STORE],
      "readwrite",
    );
    const subscriptions = transaction.objectStore(SUBSCRIPTIONS_STORE);
    const events = transaction.objectStore(EVENTS_STORE);
    const scopes = transaction.objectStore(SCOPES_STORE);
    for (const record of records) {
      const subscription = await requestResult(
        subscriptions.get(record.subscriptionKey) as IDBRequest<
          ArchiveSubscription | undefined
        >,
      );
      if (!subscription?.kinds.includes(record.eventKind)) continue;
      events.put(record.event);
      scopes.put(record.scope);
    }
    await transactionDone(transaction);
  } finally {
    database.close();
  }
}
