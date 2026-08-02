import { queryEvents, type NostrEvent } from "@/shared/lib/nostr-client";
import { submitEvent } from "@/shared/lib/relay-events";
import { relayWsUrl } from "@/shared/lib/relay-url";

export const TEAM_KIND = 30176;

export type AgentTeam = {
  id: string;
  eventId: string;
  createdAt: number;
  name: string;
  description: string | null;
  instructions: string | null;
  personaIds: string[];
};

export type TeamInput = Pick<
  AgentTeam,
  "name" | "description" | "instructions" | "personaIds"
>;

function firstTag(event: NostrEvent, name: string) {
  const tags = event.tags.filter((tag) => tag[0] === name);
  return tags.length === 1 ? tags[0][1] : undefined;
}

function optionalString(value: unknown, max: number) {
  return value === undefined || value === null
    ? null
    : typeof value === "string" && value.length <= max
      ? value
      : undefined;
}

function parseTeam(event: NostrEvent): AgentTeam | null {
  const id = firstTag(event, "d");
  if (
    !id ||
    id.length > 64 ||
    /\s/u.test(id) ||
    [...id].some((value) => /\p{Cc}/u.test(value))
  )
    return null;
  try {
    const content = JSON.parse(event.content) as Record<string, unknown>;
    if (!content || typeof content !== "object" || Array.isArray(content))
      return null;
    const name = optionalString(content.name, 120);
    const description = optionalString(content.description, 2_000);
    const instructions = optionalString(content.instructions, 128 * 1024);
    const personaIds = content.persona_ids;
    if (
      typeof name !== "string" ||
      !name.trim() ||
      description === undefined ||
      instructions === undefined ||
      !Array.isArray(personaIds) ||
      personaIds.length > 100 ||
      personaIds.some(
        (id) =>
          typeof id !== "string" || !/^[a-z0-9][a-z0-9_-]{0,63}$/.test(id),
      )
    )
      return null;
    return {
      id,
      eventId: event.id,
      createdAt: event.created_at,
      name: name.trim(),
      description,
      instructions,
      personaIds: personaIds as string[],
    };
  } catch {
    return null;
  }
}

export async function listTeams(ownerPubkey: string) {
  const events = await queryEvents(
    relayWsUrl(),
    { kinds: [TEAM_KIND], authors: [ownerPubkey], limit: 500 },
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
    .map(parseTeam)
    .filter((team): team is AgentTeam => team !== null)
    .sort((a, b) => a.name.localeCompare(b.name));
}

export async function saveTeam(input: TeamInput, existing?: AgentTeam) {
  if (!input.name.trim() || input.name.length > 120)
    throw new Error("Enter a team name.");
  const id = existing?.id ?? crypto.randomUUID();
  const content = JSON.stringify({
    name: input.name.trim(),
    description: input.description?.trim() || null,
    instructions: input.instructions?.trim() || null,
    persona_ids: input.personaIds,
  });
  if (new TextEncoder().encode(content).length > 160 * 1024)
    throw new Error("Team configuration is too large.");
  const { event } = await submitEvent({
    kind: TEAM_KIND,
    created_at: existing
      ? Math.max(Math.floor(Date.now() / 1000), existing.createdAt + 1)
      : undefined,
    tags: [
      ["d", id],
      ["alt", "agent team definition"],
    ],
    content,
  });
  const team = parseTeam(event);
  if (!team) throw new Error("The saved team could not be read back.");
  return team;
}

export async function deleteTeam(ownerPubkey: string, team: AgentTeam) {
  await submitEvent({
    kind: 5,
    tags: [
      ["a", `${TEAM_KIND}:${ownerPubkey}:${team.id}`],
      ["k", String(TEAM_KIND)],
    ],
    content: "",
  });
}
