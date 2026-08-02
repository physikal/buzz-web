import type { TranscriptItem } from "./agentSessionTypes";
import { asRecord, asString, titleCase } from "./agentSessionUtils";

export type TranscriptState = {
  items: TranscriptItem[];
  itemsById: Map<string, TranscriptItem>;
  activeMessageKey: Map<string, string>;
  sealedKeys: Set<string>;
  triggeringEventIdsByTurn: Map<string, string[]>;
  pendingPermissions: Map<
    string,
    { itemId: string; optionNames: Map<string, string> }
  >;
  continuationSeq: number;
  latestSessionId: string | null;
};

export type TranscriptDraft = TranscriptState & { changed: boolean };

export function createEmptyTranscriptState(): TranscriptState {
  return {
    items: [],
    itemsById: new Map(),
    activeMessageKey: new Map(),
    sealedKeys: new Set(),
    triggeringEventIdsByTurn: new Map(),
    pendingPermissions: new Map(),
    continuationSeq: 0,
    latestSessionId: null,
  };
}

export function draftFrom(state: TranscriptState): TranscriptDraft {
  return { ...state, changed: false };
}

export function ensureMutable(draft: TranscriptDraft) {
  if (!draft.changed) {
    draft.items = [...draft.items];
    draft.itemsById = new Map(draft.itemsById);
    draft.changed = true;
  }
}

export function replaceItem(
  draft: TranscriptDraft,
  id: string,
  updated: TranscriptItem,
) {
  ensureMutable(draft);
  const index = draft.items.findIndex((item) => item.id === id);
  if (index !== -1) draft.items[index] = updated;
  draft.itemsById.set(id, updated);
}

export function pushItem(draft: TranscriptDraft, item: TranscriptItem) {
  ensureMutable(draft);
  draft.items.push(item);
  draft.itemsById.set(item.id, item);
}

export function sealOpenMessages(draft: TranscriptDraft) {
  let copied = false;
  for (const [, currentKey] of draft.activeMessageKey) {
    if (!draft.sealedKeys.has(currentKey)) {
      if (!copied) {
        draft.sealedKeys = new Set(draft.sealedKeys);
        copied = true;
      }
      draft.sealedKeys.add(currentKey);
    }
  }
}

function turnMapKey(channelKey: string, turnKey: string | number | null) {
  return `${channelKey}:${turnKey ?? "unknown"}`;
}

export function rememberTriggeringEventIds(
  draft: TranscriptDraft,
  channelKey: string,
  turnKey: string | number | null,
  ids: string[],
) {
  if (!ids.length) return;
  draft.triggeringEventIdsByTurn = new Map(draft.triggeringEventIdsByTurn);
  draft.triggeringEventIdsByTurn.set(turnMapKey(channelKey, turnKey), ids);
}

export function getSingleTriggeringEventId(
  draft: TranscriptDraft,
  channelKey: string,
  turnKey: string | number | null,
) {
  const ids = draft.triggeringEventIdsByTurn.get(
    turnMapKey(channelKey, turnKey),
  );
  return ids?.length === 1 ? maybeNostrEventId(ids[0]) : null;
}

export function maybeNostrEventId(id: string | null | undefined) {
  return id && /^[0-9a-fA-F]{64}$/.test(id) ? id : null;
}

export function stringifyPayload(value: unknown) {
  try {
    return JSON.stringify(value, null, 2) ?? String(value);
  } catch {
    return String(value);
  }
}

export function describePermissionRequest(payload: Record<string, unknown>) {
  const params = asRecord(payload.params);
  const title =
    asString(params.title) ??
    asString(params.message) ??
    asString(params.reason) ??
    "Permission requested";
  const toolCallId =
    asString(params.toolCallId) ?? asString(params.tool_call_id);
  const options = Array.isArray(params.options)
    ? params.options
        .map((option) => {
          const record = asRecord(option);
          return (
            asString(record.name) ??
            asString(record.kind) ??
            asString(record.optionId)
          );
        })
        .filter((option): option is string => Boolean(option))
    : [];
  const detail: string[] = [];
  if (title !== "Permission requested") detail.push(title);
  if (toolCallId) detail.push(`Tool call: ${toolCallId}`);
  if (options.length) detail.push(`Options: ${options.join(", ")}`);

  const optionNames = new Map<string, string>();
  if (Array.isArray(params.options)) {
    for (const option of params.options) {
      const record = asRecord(option);
      const optionId = asString(record.optionId);
      const kind = asString(record.kind);
      if (optionId && kind) optionNames.set(optionId, kind);
    }
  }

  return {
    title,
    text: detail.join("\n"),
    optionNames,
    descriptor: {
      renderClass: "permission" as const,
      label: "Permission requested",
      preview: title,
      action: { verb: "Requested", object: title },
      tone: "admin" as const,
      operation: "session/request_permission",
      object: title,
      source: "acp" as const,
      groupKey: "permission:request",
    },
  };
}

export function describePermissionOutcome(
  outcome: string,
  optionId: string | null,
  optionNames: Map<string, string>,
): string {
  if (outcome === "cancelled") return "Cancelled";
  if (outcome === "selected" && optionId) {
    const kind = optionNames.get(optionId) ?? optionId;
    const verb = kind.startsWith("reject") ? "Denied" : "Approved";
    return `${verb} (${kind})`;
  }
  return outcome;
}

export function jsonRpcId(value: unknown): string | null {
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number" && Number.isFinite(value))
    return JSON.stringify(value);
  return null;
}

export function describeFreeformStatus(payload: Record<string, unknown>) {
  const statusType = asString(payload.type) ?? asString(payload.status);
  const title =
    asString(payload.title) ?? (statusType ? titleCase(statusType) : null);
  const text = asString(payload.text) ?? asString(payload.message);
  if (!title || !text) return null;
  return { statusType: statusType ?? title.toLowerCase(), title, text };
}

export function rawPayloadTitle(payload: unknown) {
  const record = asRecord(payload);
  return asString(record.method) ?? asString(record.type) ?? "raw_json_rpc";
}
