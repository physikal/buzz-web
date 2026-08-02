import type { ManagedAgent } from "./agent-api";
import { listAgentMemory } from "./agent-memory-api";
import {
  type AgentSnapshot,
  parseAgentSnapshot,
  snapshotFromPersona,
  snapshotPersonaInput,
  type SnapshotMemoryLevel,
} from "./agent-snapshot";
import type { AgentPersona, PersonaInput } from "./persona-api";
import {
  encodeSnapshotPng,
  PNG_SIGNATURE,
  readSnapshotPng,
} from "./snapshot-codec";
import type { AgentTeam, TeamInput } from "./team-api";

const JSON_LIMIT = 25 * 1024 * 1024;
const PNG_LIMIT = 50 * 1024 * 1024;
const SNAPSHOT_KEYWORD = "buzz_team_snapshot";

export type TeamSnapshot = {
  format: "buzz-team-snapshot";
  version: 1;
  team: {
    name: string;
    description?: string;
    instructions?: string;
  };
  members: AgentSnapshot[];
};

export type DecodedTeamSnapshot = {
  snapshot: TeamSnapshot;
  source: "json" | "png";
  hasSourceAllowlist: boolean;
  memoryCount: number;
};

function object(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function optionalText(value: unknown, maximum: number): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "string" || value.length > maximum)
    throw new Error("Team snapshot contains an invalid text field.");
  return value;
}

export function parseTeamSnapshot(value: unknown): TeamSnapshot {
  const root = object(value);
  const team = object(root?.team);
  if (
    root?.format !== "buzz-team-snapshot" ||
    root.version !== 1 ||
    !team ||
    !Array.isArray(root.members)
  )
    throw new Error("This is not a supported Buzz team snapshot.");
  if (root.members.length < 1 || root.members.length > 100)
    throw new Error("Team snapshots must contain between 1 and 100 members.");
  const name = optionalText(team.name, 120);
  if (!name?.trim()) throw new Error("Team snapshot is missing its name.");
  const description = optionalText(team.description, 2_000);
  const instructions = optionalText(team.instructions, 128 * 1024);
  return {
    format: "buzz-team-snapshot",
    version: 1,
    team: {
      name: name.trim(),
      ...(description ? { description } : {}),
      ...(instructions ? { instructions } : {}),
    },
    members: root.members.map(parseAgentSnapshot),
  };
}

export async function decodeTeamSnapshot(
  file: File,
): Promise<DecodedTeamSnapshot> {
  const lowerName = file.name.toLowerCase();
  if (!lowerName.endsWith(".team.json") && !lowerName.endsWith(".team.png"))
    throw new Error("Choose a .team.json or .team.png snapshot.");
  const bytes = new Uint8Array(await file.arrayBuffer());
  const isPng = PNG_SIGNATURE.every((byte, index) => bytes[index] === byte);
  if (lowerName.endsWith(".team.png") !== isPng)
    throw new Error("Team snapshot contents do not match the file extension.");
  if (!isPng && bytes.length > JSON_LIMIT)
    throw new Error("Team JSON snapshots must be under 25 MiB.");
  const jsonBytes = isPng
    ? readSnapshotPng(bytes, {
        keyword: SNAPSHOT_KEYWORD,
        pngLimit: PNG_LIMIT,
        jsonLimit: JSON_LIMIT,
      })
    : bytes;
  let value: unknown;
  try {
    value = JSON.parse(
      new TextDecoder("utf-8", { fatal: true }).decode(jsonBytes),
    );
  } catch {
    throw new Error("Team snapshot JSON is invalid.");
  }
  const snapshot = parseTeamSnapshot(value);
  return {
    snapshot,
    source: isPng ? "png" : "json",
    hasSourceAllowlist: snapshot.members.some(
      (member) =>
        member.definition.respondTo === "allowlist" &&
        Boolean(member.definition.respondToAllowlist?.length),
    ),
    memoryCount: snapshot.members.reduce(
      (total, member) => total + (member.memory.entries?.length ?? 0),
      0,
    ),
  };
}

export function teamSnapshotPersonaInputs(
  snapshot: TeamSnapshot,
  keepAllowlist: boolean,
): PersonaInput[] {
  return snapshot.members.map((member) =>
    snapshotPersonaInput(member, keepAllowlist),
  );
}

export function teamSnapshotInput(
  snapshot: TeamSnapshot,
  personaIds: string[],
): TeamInput {
  return {
    name: snapshot.team.name,
    description: snapshot.team.description ?? null,
    instructions: snapshot.team.instructions ?? null,
    personaIds,
  };
}

export function teamSnapshotMemoryByPersona(
  snapshot: TeamSnapshot,
  personas: AgentPersona[],
): Record<string, Array<{ slug: string; body: string }>> {
  return Object.fromEntries(
    personas.map((persona, index) => [
      persona.id,
      snapshot.members[index]?.memory.entries ?? [],
    ]),
  );
}

async function snapshotMember(
  persona: AgentPersona,
  linkedAgent: ManagedAgent | undefined,
  ownerPubkey: string,
  memoryLevel: SnapshotMemoryLevel,
): Promise<AgentSnapshot> {
  const snapshot = snapshotFromPersona(persona);
  if (memoryLevel === "none" || !linkedAgent) return snapshot;
  const memory = await listAgentMemory(linkedAgent.agent_pubkey, ownerPubkey);
  if (memory.limitReached)
    throw new Error(
      `${persona.displayName} memory reached the relay listing limit.`,
    );
  const entries = memory.entries
    .filter((entry) => memoryLevel === "everything" || entry.core)
    .map((entry) => ({ slug: entry.slug, body: entry.value }));
  return { ...snapshot, memory: { level: memoryLevel, entries } };
}

export async function exportTeamSnapshot(
  team: AgentTeam,
  personas: AgentPersona[],
  agents: ManagedAgent[],
  ownerPubkey: string,
  memoryLevel: SnapshotMemoryLevel,
  format: "json" | "png",
) {
  const members = team.personaIds.map((id) =>
    personas.find((persona) => persona.id === id),
  );
  if (members.some((member) => !member))
    throw new Error("One or more team personas are missing.");
  const snapshots = await Promise.all(
    members.map((member) => {
      const persona = member as AgentPersona;
      const linked = agents
        .filter((agent) => agent.persona_id === persona.id)
        .sort((a, b) => b.updated_at.localeCompare(a.updated_at))[0];
      return snapshotMember(persona, linked, ownerPubkey, memoryLevel);
    }),
  );
  const snapshot: TeamSnapshot = {
    format: "buzz-team-snapshot",
    version: 1,
    team: {
      name: team.name,
      ...(team.description ? { description: team.description } : {}),
      ...(team.instructions ? { instructions: team.instructions } : {}),
    },
    members: snapshots,
  };
  const json = new TextEncoder().encode(JSON.stringify(snapshot, null, 2));
  if (json.length > JSON_LIMIT)
    throw new Error("Team snapshot JSON is too large.");
  const bytes =
    format === "png"
      ? await encodeSnapshotPng(json, {
          keyword: SNAPSHOT_KEYWORD,
          pngLimit: PNG_LIMIT,
        })
      : json;
  const safeName =
    team.name
      .trim()
      .replace(/[^a-z0-9_-]+/giu, "-")
      .replace(/^-+|-+$/g, "") || "team";
  const blob = new Blob(
    [
      bytes.buffer.slice(
        bytes.byteOffset,
        bytes.byteOffset + bytes.byteLength,
      ) as ArrayBuffer,
    ],
    { type: format === "png" ? "image/png" : "application/json" },
  );
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `${safeName}.team.${format}`;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
