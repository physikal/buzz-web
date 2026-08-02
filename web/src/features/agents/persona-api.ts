import { queryEvents, type NostrEvent } from "@/shared/lib/nostr-client";
import { submitEvent } from "@/shared/lib/relay-events";
import { relayWsUrl } from "@/shared/lib/relay-url";
import {
  deleteAgent,
  listAgents,
  type AgentProvider,
  type AgentRuntime,
  type ManagedAgent,
  type RespondToMode,
  setAgentRunning,
} from "./agent-api";

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
  provider: AgentProvider | null;
  namePool: string[];
  respondTo: RespondToMode | null;
  respondToAllowlist: string[];
  parallelism: number | null;
  shared: boolean;
  catalogSource: { ownerPubkey: string; personaId: string } | null;
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
  const tags = event.tags.filter((tag) => tag.length === 2 && tag[0] === name);
  return tags.length === 1 ? tags[0][1] : undefined;
}

function optionalString(value: unknown, maxLength: number) {
  return typeof value === "string" && value.length <= maxLength
    ? value
    : value === null || value === undefined
      ? null
      : undefined;
}

export function safePersonaAvatarUrl(value: string | null): string | null {
  if (!value) return null;
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

function parsePersona(event: NostrEvent): AgentPersona | null {
  const id = firstTag(event, "d");
  if (!id || !/^[a-z0-9][a-z0-9_-]{0,63}$/.test(id)) return null;
  try {
    const content = JSON.parse(event.content) as Record<string, unknown>;
    if (!content || typeof content !== "object" || Array.isArray(content))
      return null;
    const displayName = optionalString(content.display_name, 120);
    const systemPrompt = optionalString(content.system_prompt, 128 * 1024);
    const avatarUrl = optionalString(content.avatar_url, 256 * 1024);
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
    const supportedRuntime =
      runtime && /^[a-z0-9][a-z0-9_-]{0,63}$/u.test(runtime)
        ? (runtime as AgentRuntime)
        : null;
    const supportedProvider = [
      "anthropic",
      "openai",
      "openrouter",
      "databricks",
      "databricks_v2",
    ].includes(provider ?? "")
      ? (provider as AgentProvider)
      : null;
    return {
      id,
      eventId: event.id,
      createdAt: event.created_at,
      displayName: displayName.trim(),
      systemPrompt: systemPrompt ?? "",
      avatarUrl: safePersonaAvatarUrl(avatarUrl),
      runtime: supportedRuntime,
      model,
      provider: supportedProvider,
      namePool,
      respondTo: respondTo as RespondToMode | null,
      respondToAllowlist: allowlist as string[],
      parallelism: parallelism as number | null,
      shared:
        event.tags.filter((tag) => tag[0] === "shared").length === 1 &&
        event.tags.some(
          (tag) => tag.length === 2 && tag[0] === "shared" && tag[1] === "true",
        ),
      catalogSource: catalogSource(event),
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

function catalogSource(event: NostrEvent): AgentPersona["catalogSource"] {
  const references = event.tags.filter(
    (tag) => tag.length === 2 && tag[0] === "a" && tag[1].startsWith("30175:"),
  );
  if (references.length !== 1) return null;
  const match = /^30175:([0-9a-f]{64}):([a-z0-9][a-z0-9_-]{0,63})$/u.exec(
    references[0][1],
  );
  return match ? { ownerPubkey: match[1], personaId: match[2] } : null;
}

export async function savePersona(
  input: PersonaInput,
  existing?: AgentPersona,
) {
  if (!input.displayName.trim() || input.displayName.length > 120)
    throw new Error("Enter a persona name.");
  if (
    input.catalogSource &&
    (!/^[0-9a-f]{64}$/u.test(input.catalogSource.ownerPubkey) ||
      !/^[a-z0-9][a-z0-9_-]{0,63}$/u.test(input.catalogSource.personaId))
  )
    throw new Error("Invalid catalog source.");
  const id = existing?.id ?? crypto.randomUUID().replace(/-/g, "");
  const content = JSON.stringify(personaContent(input));
  if (new TextEncoder().encode(content).length > 65_535)
    throw new Error("Persona configuration is too large.");
  const { event } = await submitEvent({
    kind: PERSONA_KIND,
    created_at: existing
      ? Math.max(Math.floor(Date.now() / 1000), existing.createdAt + 1)
      : undefined,
    tags: [
      ["d", id],
      ["alt", "agent persona definition"],
      ...(input.catalogSource
        ? [
            [
              "a",
              `30175:${input.catalogSource.ownerPubkey}:${input.catalogSource.personaId}`,
            ],
          ]
        : []),
      ...(input.shared ? [["shared", "true"]] : []),
    ],
    content,
  });
  const persona = parsePersona(event);
  if (!persona) throw new Error("The saved persona could not be read back.");
  return persona;
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

const PERSONA_DELETE_TIMEOUT_MS = 30_000;
const PERSONA_DELETE_POLL_MS = 500;

export async function deletePersonaCascade(
  ownerPubkey: string,
  persona: AgentPersona,
  linkedAgents: ManagedAgent[],
) {
  for (const agent of linkedAgents) {
    if (
      agent.desired_state !== "stopped" ||
      !["stopped", "error"].includes(agent.observed_state)
    ) {
      await setAgentRunning(agent.id, false);
    }
  }

  const remaining = new Set(linkedAgents.map((agent) => agent.id));
  const deadline = Date.now() + PERSONA_DELETE_TIMEOUT_MS;
  let lastDeleteError: Error | null = null;

  while (remaining.size > 0) {
    const current = new Map(
      (await listAgents()).map((agent) => [agent.id, agent] as const),
    );
    for (const id of [...remaining]) {
      const agent = current.get(id);
      if (!agent) {
        remaining.delete(id);
        continue;
      }
      if (
        agent.desired_state !== "stopped" ||
        !["stopped", "error"].includes(agent.observed_state)
      ) {
        continue;
      }
      try {
        await deleteAgent(id);
        remaining.delete(id);
        lastDeleteError = null;
      } catch (error) {
        lastDeleteError =
          error instanceof Error ? error : new Error("Agent deletion failed.");
      }
    }
    if (remaining.size === 0) break;
    if (Date.now() >= deadline) {
      throw new Error(
        lastDeleteError?.message ??
          "The linked agents did not stop in time. Try deleting the persona again.",
      );
    }
    await new Promise((resolve) => setTimeout(resolve, PERSONA_DELETE_POLL_MS));
  }

  await deletePersona(ownerPubkey, persona);
}
