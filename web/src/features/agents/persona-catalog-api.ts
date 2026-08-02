import { queryEvents, type NostrEvent } from "@/shared/lib/nostr-client";
import { relayWsUrl } from "@/shared/lib/relay-url";
import type { AgentPersona, PersonaInput } from "./persona-api";
import { PERSONA_KIND } from "./persona-api";

const PAGE_SIZE = 500;
const MAX_PAGES = 40;

export type CatalogPersona = AgentPersona & {
  sourceEventId: string;
  sourceIsOwn: boolean;
  sourceOwnerPubkey: string;
  sourcePersonaId: string;
};

function exactTag(event: NostrEvent, name: string) {
  const tags = event.tags.filter((tag) => tag[0] === name);
  return tags.length === 1 && tags[0].length === 2 ? tags[0][1] : undefined;
}

function isShared(event: NostrEvent) {
  const tags = event.tags.filter((tag) => tag[0] === "shared");
  return tags.length === 1 && tags[0].length === 2 && tags[0][1] === "true";
}

function optionalString(value: unknown, max: number) {
  return value === undefined || value === null
    ? null
    : typeof value === "string" && value.length <= max
      ? value
      : undefined;
}

function safeAvatar(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string") return null;
  if (value.startsWith("data:image/svg+xml,") && value.length <= 8_192)
    return value;
  if (
    value.length <= 256 * 1024 &&
    /^data:image\/(?:png|jpeg|gif|webp);base64,[A-Za-z0-9+/]+={0,2}$/u.test(
      value,
    )
  )
    return value;
  if (value.length > 2_048 || /[\s()]/u.test(value)) return null;
  try {
    const parsed = new URL(value);
    return parsed.protocol === "https:" || parsed.protocol === "http:"
      ? value
      : null;
  } catch {
    return null;
  }
}

function parseCatalogPersona(
  event: NostrEvent,
  currentOwnerPubkey: string,
): CatalogPersona | null {
  const sourcePersonaId = exactTag(event, "d");
  if (!sourcePersonaId || !/^[a-z0-9][a-z0-9_-]{0,63}$/u.test(sourcePersonaId))
    return null;
  if (!isShared(event) || event.content.length > 256 * 1024) return null;
  try {
    const content = JSON.parse(event.content) as Record<string, unknown>;
    if (!content || typeof content !== "object" || Array.isArray(content))
      return null;
    const displayName = optionalString(content.display_name, 120);
    const systemPrompt = optionalString(content.system_prompt, 128 * 1024);
    const runtime = optionalString(content.runtime, 64);
    const model = optionalString(content.model, 255);
    const provider = optionalString(content.provider, 64);
    const names = content.name_pool ?? [];
    const parallelism = content.parallelism ?? null;
    const respondTo = content.respond_to ?? null;
    if (
      !displayName?.trim() ||
      systemPrompt === undefined ||
      runtime === undefined ||
      model === undefined ||
      provider === undefined ||
      !Array.isArray(names) ||
      names.length > 100 ||
      names.some(
        (name) => typeof name !== "string" || !name.length || name.length > 120,
      ) ||
      (parallelism !== null &&
        (!Number.isSafeInteger(parallelism) ||
          Number(parallelism) < 1 ||
          Number(parallelism) > 32))
    )
      return null;
    const supportedRuntime =
      runtime && /^[a-z0-9][a-z0-9_-]{0,63}$/u.test(runtime)
        ? (runtime as AgentPersona["runtime"])
        : null;
    const safeProvider = [
      "anthropic",
      "openai",
      "openrouter",
      "databricks",
      "databricks_v2",
    ].includes(provider ?? "")
      ? (provider as AgentPersona["provider"])
      : null;
    const safeRespondTo =
      respondTo === "anyone" || respondTo === "owner-only"
        ? respondTo
        : "owner-only";
    return {
      id: `catalog:${event.pubkey}:${sourcePersonaId}`,
      eventId: event.id,
      sourceEventId: event.id,
      createdAt: event.created_at,
      sourceIsOwn: event.pubkey === currentOwnerPubkey,
      sourceOwnerPubkey: event.pubkey,
      sourcePersonaId,
      displayName: displayName.trim(),
      systemPrompt: systemPrompt ?? "",
      avatarUrl: safeAvatar(content.avatar_url),
      runtime: supportedRuntime,
      model,
      provider: safeProvider,
      namePool: names as string[],
      respondTo: safeRespondTo,
      respondToAllowlist: [],
      parallelism: parallelism as number | null,
      shared: true,
      catalogSource:
        event.pubkey === currentOwnerPubkey
          ? null
          : {
              ownerPubkey: event.pubkey,
              personaId: sourcePersonaId,
            },
    };
  } catch {
    return null;
  }
}

export async function listPersonaCatalog(
  currentOwnerPubkey: string,
): Promise<CatalogPersona[]> {
  const byId = new Map<string, NostrEvent>();
  let until: number | undefined;
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const events = await queryEvents(
      relayWsUrl(),
      {
        kinds: [PERSONA_KIND],
        limit: PAGE_SIZE,
        ...(until === undefined ? {} : { until }),
      },
      { requireNip07: true },
    );
    const before = byId.size;
    let oldest = Number.POSITIVE_INFINITY;
    for (const event of events) {
      byId.set(event.id, event);
      oldest = Math.min(oldest, event.created_at);
    }
    if (events.length < PAGE_SIZE || byId.size === before) break;
    until = oldest;
  }

  const heads = new Map<string, NostrEvent>();
  for (const event of byId.values()) {
    if (event.kind !== PERSONA_KIND) continue;
    const id = exactTag(event, "d");
    if (!id) continue;
    const coordinate = `${event.pubkey}:${id}`;
    const current = heads.get(coordinate);
    if (
      !current ||
      event.created_at > current.created_at ||
      (event.created_at === current.created_at && event.id < current.id)
    )
      heads.set(coordinate, event);
  }
  return [...heads.values()]
    .map((event) => parseCatalogPersona(event, currentOwnerPubkey))
    .filter((persona): persona is CatalogPersona => persona !== null)
    .sort((left, right) => left.displayName.localeCompare(right.displayName));
}

export function catalogPersonaInput(persona: CatalogPersona): PersonaInput {
  return {
    displayName: persona.displayName,
    systemPrompt: persona.systemPrompt,
    avatarUrl: persona.avatarUrl,
    runtime: persona.runtime,
    model: persona.model,
    provider: persona.provider,
    namePool: persona.namePool,
    respondTo: persona.respondTo === "anyone" ? "anyone" : "owner-only",
    respondToAllowlist: [],
    parallelism: persona.parallelism,
    shared: false,
    catalogSource: {
      ownerPubkey: persona.sourceOwnerPubkey,
      personaId: persona.sourcePersonaId,
    },
  };
}
