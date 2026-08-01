import { queryEvents, type NostrEvent } from "@/shared/lib/nostr-client";
import { submitEvent } from "@/shared/lib/relay-events";
import { relayWsUrl } from "@/shared/lib/relay-url";
import type { AgentRuntime, RespondToMode } from "./agent-api";

export const PERSONA_KIND = 30175;

export type AgentPersona = {
  id: string;
  eventId: string;
  createdAt: number;
  displayName: string;
  systemPrompt: string;
  avatarUrl: string | null;
  runtime: AgentRuntime | null;
  model: string | null;
  provider: string | null;
  namePool: string[];
  respondTo: RespondToMode | null;
  respondToAllowlist: string[];
  parallelism: number | null;
  shared: boolean;
};

export type PersonaInput = Omit<AgentPersona, "id" | "eventId" | "createdAt">;

type PersonaContent = {
  display_name: string;
  system_prompt?: string;
  avatar_url?: string;
  runtime?: string;
  model?: string;
  provider?: string;
  name_pool?: string[];
  respond_to?: string;
  respond_to_allowlist?: string[];
  parallelism?: number;
};

function firstTag(event: NostrEvent, name: string) {
  const tags = event.tags.filter((tag) => tag[0] === name);
  return tags.length === 1 ? tags[0][1] : undefined;
}

function optionalString(value: unknown, maxLength: number) {
  return typeof value === "string" && value.length <= maxLength
    ? value
    : value === null || value === undefined
      ? null
      : undefined;
}

function parsePersona(event: NostrEvent): AgentPersona | null {
  const id = firstTag(event, "d");
  if (!id || !/^[a-z0-9][a-z0-9_-]{0,63}$/.test(id)) return null;
  try {
    const content = JSON.parse(event.content) as Record<string, unknown>;
    if (!content || typeof content !== "object" || Array.isArray(content))
      return null;
    const displayName = optionalString(content.display_name, 120);
    const systemPrompt = optionalString(content.system_prompt, 128 * 1024);
    const avatarUrl = optionalString(content.avatar_url, 2048);
    const runtime = optionalString(content.runtime, 64);
    const model = optionalString(content.model, 255);
    const provider = optionalString(content.provider, 64);
    const namePool = content.name_pool ?? [];
    const respondTo = content.respond_to ?? null;
    const allowlist = content.respond_to_allowlist ?? [];
    const parallelism = content.parallelism ?? null;
    if (
      typeof displayName !== "string" ||
      displayName.trim().length === 0 ||
      systemPrompt === undefined ||
      avatarUrl === undefined ||
      runtime === undefined ||
      model === undefined ||
      provider === undefined ||
      !Array.isArray(namePool) ||
      namePool.length > 100 ||
      namePool.some(
        (name) =>
          typeof name !== "string" || name.length === 0 || name.length > 120,
      ) ||
      ![null, "owner-only", "allowlist", "anyone"].includes(
        respondTo as null | string,
      ) ||
      !Array.isArray(allowlist) ||
      allowlist.some(
        (pubkey) =>
          typeof pubkey !== "string" || !/^[0-9a-f]{64}$/.test(pubkey),
      ) ||
      (parallelism !== null &&
        (!Number.isSafeInteger(parallelism) ||
          Number(parallelism) < 1 ||
          Number(parallelism) > 32))
    )
      return null;
    const supportedRuntime = ["buzz-agent", "codex", "claude"].includes(
      runtime ?? "",
    )
      ? (runtime as AgentRuntime)
      : null;
    return {
      id,
      eventId: event.id,
      createdAt: event.created_at,
      displayName: displayName.trim(),
      systemPrompt: systemPrompt ?? "",
      avatarUrl,
      runtime: supportedRuntime,
      model,
      provider,
      namePool,
      respondTo: respondTo as RespondToMode | null,
      respondToAllowlist: allowlist as string[],
      parallelism: parallelism as number | null,
      shared: event.tags.some(
        (tag) => tag.length === 2 && tag[0] === "shared" && tag[1] === "true",
      ),
    };
  } catch {
    return null;
  }
}

export async function listPersonas(ownerPubkey: string) {
  const events = await queryEvents(
    relayWsUrl(),
    { kinds: [PERSONA_KIND], authors: [ownerPubkey], limit: 500 },
    { requireNip07: true },
  );
  const heads = new Map<string, NostrEvent>();
  for (const event of events) {
    if (event.pubkey !== ownerPubkey) continue;
    const id = firstTag(event, "d");
    if (!id) continue;
    const current = heads.get(id);
    if (
      !current ||
      event.created_at > current.created_at ||
      (event.created_at === current.created_at && event.id < current.id)
    )
      heads.set(id, event);
  }
  return [...heads.values()]
    .map(parsePersona)
    .filter((persona): persona is AgentPersona => persona !== null)
    .sort((a, b) => a.displayName.localeCompare(b.displayName));
}

function personaContent(input: PersonaInput): PersonaContent {
  return {
    display_name: input.displayName.trim(),
    system_prompt: input.systemPrompt,
    ...(input.avatarUrl ? { avatar_url: input.avatarUrl } : {}),
    ...(input.runtime ? { runtime: input.runtime } : {}),
    ...(input.model ? { model: input.model } : {}),
    ...(input.provider ? { provider: input.provider } : {}),
    ...(input.namePool.length ? { name_pool: input.namePool } : {}),
    ...(input.respondTo ? { respond_to: input.respondTo } : {}),
    ...(input.respondToAllowlist.length
      ? { respond_to_allowlist: input.respondToAllowlist }
      : {}),
    ...(input.parallelism ? { parallelism: input.parallelism } : {}),
  };
}

export async function savePersona(
  input: PersonaInput,
  existing?: AgentPersona,
) {
  if (!input.displayName.trim() || input.displayName.length > 120)
    throw new Error("Enter a persona name.");
  const id = existing?.id ?? crypto.randomUUID().replace(/-/g, "");
  const content = JSON.stringify(personaContent(input));
  if (new TextEncoder().encode(content).length > 65_535)
    throw new Error("Persona configuration is too large.");
  await submitEvent({
    kind: PERSONA_KIND,
    created_at: existing
      ? Math.max(Math.floor(Date.now() / 1000), existing.createdAt + 1)
      : undefined,
    tags: [
      ["d", id],
      ["alt", "agent persona definition"],
      ...(input.shared ? [["shared", "true"]] : []),
    ],
    content,
  });
}

export async function deletePersona(
  ownerPubkey: string,
  persona: AgentPersona,
) {
  await submitEvent({
    kind: 5,
    tags: [
      ["a", `${PERSONA_KIND}:${ownerPubkey}:${persona.id}`],
      ["k", String(PERSONA_KIND)],
    ],
    content: "",
  });
}
