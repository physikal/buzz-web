import {
  safePersonaAvatarUrl,
  type AgentPersona,
  type PersonaInput,
} from "./persona-api";
import type { ManagedAgent } from "./agent-api";
import { listAgentMemory } from "./agent-memory-api";
import {
  encodeSnapshotPng,
  PNG_SIGNATURE,
  readSnapshotPng,
} from "./snapshot-codec";

const JSON_LIMIT = 5 * 1024 * 1024;
const PNG_LIMIT = 10 * 1024 * 1024;
const SNAPSHOT_KEYWORD = "buzz_agent_snapshot";
const LEGACY_SUFFIXES = [
  ".persona.md",
  ".persona.json",
  ".persona.png",
  ".zip",
];

export type SnapshotMemoryLevel = "none" | "core" | "everything";

export type AgentSnapshot = {
  format: "buzz-agent-snapshot";
  version: 1;
  definition: {
    name: string;
    sourceIsBuiltin?: boolean;
    systemPrompt?: string;
    runtime?: string;
    model?: string;
    provider?: string;
    parallelism?: number;
    respondTo?: string;
    respondToAllowlist?: string[];
    namePool?: string[];
    idleTimeoutSeconds?: number;
    maxTurnDurationSeconds?: number;
  };
  profile: {
    displayName: string;
    about?: string;
    avatarDataUrl?: string;
    avatarUrl?: string;
  };
  memory: {
    level: SnapshotMemoryLevel;
    entries?: Array<{ slug: string; body: string }>;
  };
};

export type DecodedAgentSnapshot = {
  snapshot: AgentSnapshot;
  source: "json" | "png";
};

function object(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function boundedString(
  value: unknown,
  maximum: number,
  required = false,
): string | undefined {
  if (value === undefined || value === null) {
    if (required) throw new Error("Snapshot is missing a required field.");
    return undefined;
  }
  if (typeof value !== "string" || value.length > maximum)
    throw new Error("Snapshot contains an invalid text field.");
  if (required && !value.trim())
    throw new Error("Snapshot contains an empty required field.");
  return value;
}

function optionalInteger(value: unknown, minimum: number, maximum: number) {
  if (value === undefined || value === null) return undefined;
  if (
    !Number.isSafeInteger(value) ||
    Number(value) < minimum ||
    Number(value) > maximum
  )
    throw new Error("Snapshot contains an invalid numeric field.");
  return Number(value);
}

function stringList(
  value: unknown,
  maximumItems: number,
  maximumLength: number,
) {
  if (value === undefined || value === null) return undefined;
  if (
    !Array.isArray(value) ||
    value.length > maximumItems ||
    value.some(
      (item) =>
        typeof item !== "string" || !item.length || item.length > maximumLength,
    )
  )
    throw new Error("Snapshot contains an invalid list.");
  return value as string[];
}

function validMemorySlug(slug: string): boolean {
  return (
    slug === "core" ||
    (new TextEncoder().encode(slug).length <= 255 &&
      /^mem\/[a-z0-9][a-z0-9_-]{0,63}(\/[a-z0-9][a-z0-9_-]{0,63})*$/u.test(
        slug,
      ))
  );
}

export function parseAgentSnapshot(value: unknown): AgentSnapshot {
  const root = object(value);
  const definition = object(root?.definition);
  const profile = object(root?.profile);
  const memory = object(root?.memory);
  if (
    root?.format !== "buzz-agent-snapshot" ||
    root.version !== 1 ||
    !definition ||
    !profile ||
    !memory
  )
    throw new Error("This is not a supported Buzz agent snapshot.");

  const name = boundedString(definition.name, 120, true) as string;
  const displayName = boundedString(profile.displayName, 120, true) as string;
  const respondToAllowlist =
    stringList(definition.respondToAllowlist, 100, 64) ?? [];
  if (respondToAllowlist.some((pubkey) => !/^[0-9a-f]{64}$/u.test(pubkey)))
    throw new Error("Snapshot contains an invalid respond-to public key.");
  const respondTo = boundedString(definition.respondTo, 32);
  if (respondTo && !["owner-only", "allowlist", "anyone"].includes(respondTo))
    throw new Error("Snapshot contains an unsupported respond-to mode.");
  if (respondTo === "allowlist" && !respondToAllowlist.length)
    throw new Error(
      "Snapshot uses allowlist mode without any allowed public keys.",
    );

  const level = memory.level;
  if (level !== "none" && level !== "core" && level !== "everything")
    throw new Error("Snapshot contains an unsupported memory level.");
  const rawEntries = memory.entries ?? [];
  if (!Array.isArray(rawEntries) || rawEntries.length > 500)
    throw new Error("Snapshot contains an invalid memory section.");
  const entries = rawEntries.map((entry) => {
    const row = object(entry);
    const slug = boundedString(row?.slug, 255, true);
    const body = boundedString(row?.body, 65_535);
    if (!slug || body === undefined || !validMemorySlug(slug))
      throw new Error("Snapshot contains an invalid memory entry.");
    return { slug, body };
  });
  if (new Set(entries.map((entry) => entry.slug)).size !== entries.length)
    throw new Error("Snapshot contains duplicate memory entries.");
  if (level === "none" && entries.length)
    throw new Error("Snapshot declares no memory but contains memory entries.");

  return {
    format: "buzz-agent-snapshot",
    version: 1,
    definition: {
      name,
      ...(definition.sourceIsBuiltin === true ? { sourceIsBuiltin: true } : {}),
      ...(boundedString(definition.systemPrompt, 128 * 1024) !== undefined
        ? { systemPrompt: definition.systemPrompt as string }
        : {}),
      ...(boundedString(definition.runtime, 64)
        ? { runtime: definition.runtime as string }
        : {}),
      ...(boundedString(definition.model, 255)
        ? { model: definition.model as string }
        : {}),
      ...(boundedString(definition.provider, 64)
        ? { provider: definition.provider as string }
        : {}),
      ...(optionalInteger(definition.parallelism, 1, 32)
        ? { parallelism: Number(definition.parallelism) }
        : {}),
      ...(respondTo ? { respondTo } : {}),
      ...(respondToAllowlist.length ? { respondToAllowlist } : {}),
      ...(stringList(definition.namePool, 100, 120)?.length
        ? { namePool: definition.namePool as string[] }
        : {}),
      ...(optionalInteger(definition.idleTimeoutSeconds, 0, 31_536_000) !==
      undefined
        ? { idleTimeoutSeconds: Number(definition.idleTimeoutSeconds) }
        : {}),
      ...(optionalInteger(definition.maxTurnDurationSeconds, 0, 31_536_000) !==
      undefined
        ? { maxTurnDurationSeconds: Number(definition.maxTurnDurationSeconds) }
        : {}),
    },
    profile: {
      displayName,
      ...(boundedString(profile.about, 10_000) !== undefined
        ? { about: profile.about as string }
        : {}),
      ...(boundedString(profile.avatarDataUrl, 2 * 1024 * 1024)
        ? { avatarDataUrl: profile.avatarDataUrl as string }
        : {}),
      ...(boundedString(profile.avatarUrl, 2_048)
        ? { avatarUrl: profile.avatarUrl as string }
        : {}),
    },
    memory: { level, ...(entries.length ? { entries } : {}) },
  };
}

export function snapshotFromPersona(persona: AgentPersona): AgentSnapshot {
  const avatar = safePersonaAvatarUrl(persona.avatarUrl);
  return {
    format: "buzz-agent-snapshot",
    version: 1,
    definition: {
      name: persona.displayName,
      ...(persona.systemPrompt ? { systemPrompt: persona.systemPrompt } : {}),
      ...(persona.runtime ? { runtime: persona.runtime } : {}),
      ...(persona.model ? { model: persona.model } : {}),
      ...(persona.provider ? { provider: persona.provider } : {}),
      ...(persona.parallelism ? { parallelism: persona.parallelism } : {}),
      ...(persona.respondTo ? { respondTo: persona.respondTo } : {}),
      ...(persona.respondToAllowlist.length
        ? { respondToAllowlist: persona.respondToAllowlist }
        : {}),
      ...(persona.namePool.length ? { namePool: persona.namePool } : {}),
    },
    profile: {
      displayName: persona.displayName,
      ...(avatar?.startsWith("data:")
        ? { avatarDataUrl: avatar }
        : avatar
          ? { avatarUrl: avatar }
          : {}),
    },
    memory: { level: "none" },
  };
}

export function snapshotFromManagedAgent(
  agent: ManagedAgent,
  memoryLevel: SnapshotMemoryLevel,
  memoryEntries: Array<{ slug: string; body: string }>,
): AgentSnapshot {
  return {
    format: "buzz-agent-snapshot",
    version: 1,
    definition: {
      name: agent.name,
      ...(agent.system_prompt ? { systemPrompt: agent.system_prompt } : {}),
      runtime: agent.runtime,
      ...(agent.model ? { model: agent.model } : {}),
      respondTo: agent.respond_to,
      ...(agent.respond_to_allowlist.length
        ? { respondToAllowlist: agent.respond_to_allowlist }
        : {}),
    },
    profile: { displayName: agent.name },
    memory: {
      level: memoryLevel,
      ...(memoryEntries.length ? { entries: memoryEntries } : {}),
    },
  };
}

async function downloadAgentSnapshot(
  snapshot: AgentSnapshot,
  displayName: string,
  format: "json" | "png",
) {
  const json = new TextEncoder().encode(JSON.stringify(snapshot, null, 2));
  if (json.length > JSON_LIMIT) throw new Error("Snapshot JSON is too large.");
  const bytes =
    format === "png"
      ? await encodeSnapshotPng(json, {
          keyword: SNAPSHOT_KEYWORD,
          pngLimit: PNG_LIMIT,
        })
      : json;
  const safeName =
    displayName
      .trim()
      .replace(/[^a-z0-9_-]+/giu, "-")
      .replace(/^-+|-+$/g, "") || "agent";
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
  anchor.download = `${safeName}.agent.${format}`;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

export async function exportAgentSnapshot(
  persona: AgentPersona,
  format: "json" | "png",
) {
  await downloadAgentSnapshot(
    snapshotFromPersona(persona),
    persona.displayName,
    format,
  );
}

export async function exportManagedAgentSnapshot(
  agent: ManagedAgent,
  ownerPubkey: string,
  memoryLevel: SnapshotMemoryLevel,
  format: "json" | "png",
) {
  let entries: Array<{ slug: string; body: string }> = [];
  if (memoryLevel !== "none") {
    const memory = await listAgentMemory(agent.agent_pubkey, ownerPubkey);
    if (memory.limitReached)
      throw new Error(
        "Memory listing reached the relay limit. Export a config-only snapshot or remove older memory first.",
      );
    entries = memory.entries
      .filter((entry) => memoryLevel === "everything" || entry.core)
      .map((entry) => ({ slug: entry.slug, body: entry.value }));
  }
  await downloadAgentSnapshot(
    snapshotFromManagedAgent(agent, memoryLevel, entries),
    agent.name,
    format,
  );
}

export async function decodeAgentSnapshot(
  file: File,
): Promise<DecodedAgentSnapshot> {
  const lowerName = file.name.toLowerCase();
  if (LEGACY_SUFFIXES.some((suffix) => lowerName.endsWith(suffix)))
    throw new Error(
      "Legacy persona files are not supported. Choose an .agent.json or .agent.png snapshot.",
    );
  const bytes = new Uint8Array(await file.arrayBuffer());
  const isPng = PNG_SIGNATURE.every((byte, index) => bytes[index] === byte);
  if (!isPng && bytes.length > JSON_LIMIT)
    throw new Error("JSON snapshots must be under 5 MiB.");
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
    throw new Error("Snapshot JSON is invalid.");
  }
  return {
    snapshot: parseAgentSnapshot(value),
    source: isPng ? "png" : "json",
  };
}

export function snapshotPersonaInput(
  snapshot: AgentSnapshot,
  keepAllowlist: boolean,
): PersonaInput {
  const sourceMode = snapshot.definition.respondTo;
  const sourceAllowlist = snapshot.definition.respondToAllowlist ?? [];
  const respondTo =
    sourceMode === "allowlist" && !keepAllowlist
      ? "owner-only"
      : sourceMode === "allowlist" ||
          sourceMode === "anyone" ||
          sourceMode === "owner-only"
        ? sourceMode
        : null;
  const runtime = ["buzz-agent", "codex", "claude"].includes(
    snapshot.definition.runtime ?? "",
  )
    ? (snapshot.definition.runtime as PersonaInput["runtime"])
    : null;
  const provider = [
    "anthropic",
    "openai",
    "openrouter",
    "databricks",
    "databricks_v2",
  ].includes(snapshot.definition.provider ?? "")
    ? (snapshot.definition.provider as PersonaInput["provider"])
    : null;
  return {
    displayName: snapshot.profile.displayName.trim(),
    systemPrompt: snapshot.definition.systemPrompt ?? "",
    avatarUrl: safePersonaAvatarUrl(
      snapshot.profile.avatarDataUrl ?? snapshot.profile.avatarUrl ?? null,
    ),
    runtime,
    model: snapshot.definition.model ?? null,
    provider,
    namePool: snapshot.definition.namePool ?? [],
    respondTo,
    respondToAllowlist: keepAllowlist ? sourceAllowlist : [],
    parallelism: snapshot.definition.parallelism ?? null,
    shared: false,
    catalogSource: null,
  };
}
