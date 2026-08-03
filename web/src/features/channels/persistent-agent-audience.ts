import { useCallback, useEffect, useMemo, useState } from "react";

import type { DraftMentionRef } from "./draft-store";
import { relayWsUrl } from "@/shared/lib/relay-url";

const CHANGE_EVENT = "buzz-web:persistent-agent-audience";
const MAX_AUDIENCES = 200;
const MAX_AUDIENCE_SIZE = 20;

type AudienceStore = {
  enabled: boolean;
  generation: number;
  audiences: Record<string, DraftMentionRef[]>;
  revisions: Record<string, number>;
};

const EMPTY_REFS: readonly DraftMentionRef[] = [];
const EMPTY_STORE: AudienceStore = {
  enabled: false,
  generation: 0,
  audiences: {},
  revisions: {},
};
const volatileStores = new Map<string, AudienceStore>();

function storeKey(ownerPubkey: string) {
  return `buzz-web:persistent-agent-audience.v1:${relayWsUrl().replace(/\/+$/, "")}:${ownerPubkey}`;
}

function validRef(value: unknown): value is DraftMentionRef {
  if (!value || typeof value !== "object") return false;
  const ref = value as Partial<DraftMentionRef>;
  return (
    typeof ref.displayName === "string" &&
    ref.displayName.trim().length > 0 &&
    ref.displayName.length <= 200 &&
    typeof ref.pubkey === "string" &&
    /^[0-9a-f]{64}$/i.test(ref.pubkey) &&
    ref.isAgent === true
  );
}

function normalizeRefs(values: Iterable<DraftMentionRef>) {
  const result: DraftMentionRef[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    const pubkey = value.pubkey.trim().toLowerCase();
    if (!validRef({ ...value, pubkey }) || seen.has(pubkey)) continue;
    seen.add(pubkey);
    result.push({
      displayName: value.displayName.trim(),
      pubkey,
      isAgent: true,
    });
    if (result.length === MAX_AUDIENCE_SIZE) break;
  }
  return result;
}

function readStore(ownerPubkey: string): AudienceStore {
  if (!/^[0-9a-f]{64}$/i.test(ownerPubkey)) return EMPTY_STORE;
  const key = storeKey(ownerPubkey);
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return volatileStores.get(key) ?? EMPTY_STORE;
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return volatileStores.get(key) ?? EMPTY_STORE;
    }
    const value = parsed as Partial<AudienceStore>;
    const entries =
      value.audiences && typeof value.audiences === "object"
        ? Object.entries(value.audiences).slice(-MAX_AUDIENCES)
        : [];
    const audiences: Record<string, DraftMentionRef[]> = {};
    const revisions: Record<string, number> = {};
    for (const [scope, refs] of entries) {
      if (scope.length > 500 || !Array.isArray(refs)) continue;
      audiences[scope] = normalizeRefs(refs.filter(validRef));
      const revision = value.revisions?.[scope];
      revisions[scope] =
        typeof revision === "number" &&
        Number.isSafeInteger(revision) &&
        revision >= 0
          ? revision
          : 0;
    }
    const store = {
      enabled: value.enabled === true,
      generation:
        typeof value.generation === "number" &&
        Number.isSafeInteger(value.generation) &&
        value.generation >= 0
          ? value.generation
          : 0,
      audiences,
      revisions,
    };
    volatileStores.set(key, store);
    return store;
  } catch {
    return volatileStores.get(key) ?? EMPTY_STORE;
  }
}

function writeStore(ownerPubkey: string, store: AudienceStore) {
  if (!/^[0-9a-f]{64}$/i.test(ownerPubkey)) return;
  const key = storeKey(ownerPubkey);
  volatileStores.set(key, store);
  try {
    localStorage.setItem(key, JSON.stringify(store));
  } catch {
    // Keep the live setting functional when storage is unavailable.
  }
  window.dispatchEvent(new CustomEvent(CHANGE_EVENT));
}

function updateStore(
  ownerPubkey: string,
  update: (current: AudienceStore) => AudienceStore,
) {
  const next = update(readStore(ownerPubkey));
  writeStore(ownerPubkey, next);
  return next;
}

function scopeKey(channelId: string, threadRootId: string | null) {
  if (
    !threadRootId ||
    !channelId ||
    channelId.length > 240 ||
    threadRootId.length > 240
  ) {
    return null;
  }
  return `${channelId}:thread:${threadRootId}`;
}

function useAudienceStore(ownerPubkey: string) {
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    const refresh = () => setRevision((current) => current + 1);
    const storage = (event: StorageEvent) => {
      if (event.key === storeKey(ownerPubkey)) refresh();
    };
    window.addEventListener(CHANGE_EVENT, refresh);
    window.addEventListener("storage", storage);
    return () => {
      window.removeEventListener(CHANGE_EVENT, refresh);
      window.removeEventListener("storage", storage);
    };
  }, [ownerPubkey]);
  return useMemo(() => {
    void revision;
    return readStore(ownerPubkey);
  }, [ownerPubkey, revision]);
}

export function usePersistentAgentAudienceSetting(ownerPubkey: string) {
  const store = useAudienceStore(ownerPubkey);
  return {
    enabled: store.enabled,
    setEnabled(enabled: boolean) {
      updateStore(ownerPubkey, (current) => ({
        enabled,
        generation:
          current.enabled && !enabled
            ? current.generation + 1
            : current.generation,
        audiences: enabled ? current.audiences : {},
        revisions: enabled ? current.revisions : {},
      }));
    },
  };
}

function setAudienceRefs(
  ownerPubkey: string,
  scope: string,
  refs: Iterable<DraftMentionRef>,
) {
  const normalized = normalizeRefs(refs);
  return (
    updateStore(ownerPubkey, (current) => {
      if (!current.enabled) return current;
      const { [scope]: _previous, ...remaining } = current.audiences;
      const entries = Object.entries({
        ...remaining,
        [scope]: normalized,
      }).slice(-MAX_AUDIENCES);
      const audiences = Object.fromEntries(entries);
      return {
        ...current,
        audiences,
        revisions: Object.fromEntries(
          Object.keys(audiences).map((key) => [
            key,
            key === scope
              ? (current.revisions[key] ?? 0) + 1
              : (current.revisions[key] ?? 0),
          ]),
        ),
      };
    }).audiences[scope] ?? EMPTY_REFS
  );
}

export function usePersistentAgentAudience({
  ownerPubkey,
  channelId,
  threadRootId,
  initialRefs = [],
}: {
  ownerPubkey: string;
  channelId: string;
  threadRootId: string | null;
  initialRefs?: readonly DraftMentionRef[];
}) {
  const store = useAudienceStore(ownerPubkey);
  const scope = scopeKey(channelId, threadRootId);
  const storedRefs = scope ? store.audiences[scope] : undefined;

  useEffect(() => {
    if (!store.enabled || !scope || storedRefs !== undefined) return;
    setAudienceRefs(ownerPubkey, scope, initialRefs);
  }, [initialRefs, ownerPubkey, scope, store.enabled, storedRefs]);

  const setRefs = useCallback(
    (refs: Iterable<DraftMentionRef>) => {
      if (!scope) return EMPTY_REFS;
      return setAudienceRefs(ownerPubkey, scope, refs);
    },
    [ownerPubkey, scope],
  );

  const promoteRefs = useCallback(
    ({
      expectedGeneration,
      expectedRevision,
      refs,
    }: {
      expectedGeneration: number;
      expectedRevision: number;
      refs: Iterable<DraftMentionRef>;
    }) => {
      if (!scope) return EMPTY_REFS;
      const explicitRefs = normalizeRefs(refs);
      let result: readonly DraftMentionRef[] = EMPTY_REFS;
      updateStore(ownerPubkey, (current) => {
        const currentRefs = current.audiences[scope] ?? EMPTY_REFS;
        result = current.enabled ? currentRefs : EMPTY_REFS;
        if (
          !current.enabled ||
          current.generation !== expectedGeneration ||
          (current.revisions[scope] ?? 0) !== expectedRevision
        ) {
          return current;
        }
        const normalized = normalizeRefs([...explicitRefs, ...currentRefs]);
        result = normalized;
        if (!explicitRefs.length) return current;
        const { [scope]: _previous, ...remaining } = current.audiences;
        const entries = Object.entries({
          ...remaining,
          [scope]: normalized,
        }).slice(-MAX_AUDIENCES);
        const audiences = Object.fromEntries(entries);
        return {
          ...current,
          audiences,
          revisions: Object.fromEntries(
            Object.keys(audiences).map((key) => [
              key,
              key === scope
                ? (current.revisions[key] ?? 0) + 1
                : (current.revisions[key] ?? 0),
            ]),
          ),
        };
      });
      return result;
    },
    [ownerPubkey, scope],
  );

  return {
    enabled: store.enabled && Boolean(scope),
    generation: store.generation,
    revision: scope ? (store.revisions[scope] ?? 0) : 0,
    refs: storedRefs ?? EMPTY_REFS,
    setRefs,
    promoteRefs,
  };
}
