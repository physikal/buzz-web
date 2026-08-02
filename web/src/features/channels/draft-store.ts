import { relayWsUrl } from "@/shared/lib/relay-url";

export type WebDraft = {
  key: string;
  content: string;
  channelId: string;
  parentId: string | null;
  createdAt: string;
  updatedAt: string;
};

type StoredDraft = {
  content: string;
  selectionStart: number;
  selectionEnd: number;
  channelId: string;
  createdAt: string;
  updatedAt: string;
  pendingImeta: unknown[];
  mentionRefs: unknown[];
  spoileredAttachmentUrls: string[];
  status: "active";
};

const PREFIX = "buzz-drafts.v2";
const MAX_DRAFTS = 100;
const CHANGE_EVENT = "buzz-web:drafts-changed";

export function draftKey(channelId: string, parentId?: string | null) {
  return parentId ? `thread:${parentId}` : channelId;
}

function storeKey(ownerPubkey: string) {
  return `${PREFIX}:${relayWsUrl().replace(/\/+$/, "")}:${ownerPubkey}`;
}

function readStore(ownerPubkey: string): Record<string, StoredDraft> {
  try {
    const value = JSON.parse(
      localStorage.getItem(storeKey(ownerPubkey)) ?? "{}",
    ) as Record<string, unknown>;
    if (!value || typeof value !== "object" || Array.isArray(value)) return {};
    return Object.fromEntries(
      Object.entries(value).filter((entry): entry is [string, StoredDraft] =>
        validDraft(entry[1]),
      ),
    );
  } catch {
    return {};
  }
}

function validDraft(value: unknown): value is StoredDraft {
  if (!value || typeof value !== "object") return false;
  const draft = value as Partial<StoredDraft>;
  return (
    typeof draft.content === "string" &&
    typeof draft.channelId === "string" &&
    typeof draft.createdAt === "string" &&
    typeof draft.updatedAt === "string" &&
    Array.isArray(draft.pendingImeta) &&
    Array.isArray(draft.spoileredAttachmentUrls) &&
    (draft.status === undefined || draft.status === "active")
  );
}

function writeStore(ownerPubkey: string, store: Record<string, StoredDraft>) {
  const entries = Object.entries(store)
    .sort((left, right) => right[1].updatedAt.localeCompare(left[1].updatedAt))
    .slice(0, MAX_DRAFTS);
  try {
    localStorage.setItem(
      storeKey(ownerPubkey),
      JSON.stringify(Object.fromEntries(entries)),
    );
    window.dispatchEvent(new CustomEvent(CHANGE_EVENT));
    return true;
  } catch {
    return false;
  }
}

export function loadDraft(
  ownerPubkey: string,
  channelId: string,
  parentId?: string | null,
) {
  const key = draftKey(channelId, parentId);
  const stored = readStore(ownerPubkey)[key];
  if (stored) return stored.content;
  const legacyKey = `buzz-web:draft:${channelId}:${parentId ?? "root"}`;
  const legacy = localStorage.getItem(legacyKey);
  if (legacy) {
    saveDraft(ownerPubkey, channelId, parentId, legacy, legacy.length);
    localStorage.removeItem(legacyKey);
  }
  return legacy ?? "";
}

export function saveDraft(
  ownerPubkey: string,
  channelId: string,
  parentId: string | null | undefined,
  content: string,
  selection: number,
) {
  const key = draftKey(channelId, parentId);
  const store = readStore(ownerPubkey);
  if (!content.trim()) {
    delete store[key];
    writeStore(ownerPubkey, store);
    return;
  }
  const now = new Date().toISOString();
  store[key] = {
    content,
    selectionStart: selection,
    selectionEnd: selection,
    channelId,
    createdAt: store[key]?.createdAt ?? now,
    updatedAt: now,
    pendingImeta: [],
    mentionRefs: [],
    spoileredAttachmentUrls: [],
    status: "active",
  };
  writeStore(ownerPubkey, store);
}

export function deleteDraft(ownerPubkey: string, key: string) {
  const store = readStore(ownerPubkey);
  delete store[key];
  writeStore(ownerPubkey, store);
}

export function listDrafts(ownerPubkey: string): WebDraft[] {
  return Object.entries(readStore(ownerPubkey))
    .map(([key, draft]) => ({
      key,
      content: draft.content,
      channelId: draft.channelId,
      parentId: key.startsWith("thread:") ? key.slice("thread:".length) : null,
      createdAt: draft.createdAt,
      updatedAt: draft.updatedAt,
    }))
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
}

export function subscribeDrafts(listener: () => void) {
  window.addEventListener(CHANGE_EVENT, listener);
  const onStorage = (event: StorageEvent) => {
    if (event.key?.startsWith(`${PREFIX}:`)) listener();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    window.removeEventListener(CHANGE_EVENT, listener);
    window.removeEventListener("storage", onStorage);
  };
}
