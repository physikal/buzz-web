import {
  safePersonaAvatarUrl,
  type AgentPersona,
  type PersonaInput,
} from "./persona-api";

const JSON_LIMIT = 5 * 1024 * 1024;
const PNG_LIMIT = 10 * 1024 * 1024;
const PNG_SIGNATURE = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
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

function parseSnapshot(value: unknown): AgentSnapshot {
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

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 32_768)
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 32_768));
  return btoa(binary);
}

function bytesToLatin1(bytes: Uint8Array): string {
  let value = "";
  for (let offset = 0; offset < bytes.length; offset += 32_768)
    value += String.fromCharCode(...bytes.subarray(offset, offset + 32_768));
  return value;
}

function base64ToBytes(value: string): Uint8Array {
  if (!/^[A-Za-z0-9+/]*={0,2}$/u.test(value) || value.length % 4 !== 0)
    throw new Error("Snapshot PNG contains invalid base64 metadata.");
  const binary = atob(value);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1)
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, data: Uint8Array): Uint8Array {
  const typeBytes = new TextEncoder().encode(type);
  const result = new Uint8Array(12 + data.length);
  const view = new DataView(result.buffer);
  view.setUint32(0, data.length);
  result.set(typeBytes, 4);
  result.set(data, 8);
  view.setUint32(8 + data.length, crc32(result.subarray(4, 8 + data.length)));
  return result;
}

function readPngSnapshot(bytes: Uint8Array): Uint8Array {
  if (bytes.length > PNG_LIMIT)
    throw new Error("PNG snapshots must be under 10 MiB.");
  if (!PNG_SIGNATURE.every((byte, index) => bytes[index] === byte))
    throw new Error("Snapshot PNG signature is invalid.");
  let offset = PNG_SIGNATURE.length;
  let manifest: Uint8Array | null = null;
  let ended = false;
  while (offset + 12 <= bytes.length) {
    const view = new DataView(bytes.buffer, bytes.byteOffset + offset);
    const length = view.getUint32(0);
    if (length > bytes.length - offset - 12)
      throw new Error("Snapshot PNG is truncated.");
    const typeBytes = bytes.subarray(offset + 4, offset + 8);
    const type = String.fromCharCode(...typeBytes);
    const data = bytes.subarray(offset + 8, offset + 8 + length);
    const expected = view.getUint32(8 + length);
    const actual = crc32(bytes.subarray(offset + 4, offset + 8 + length));
    if (expected !== actual)
      throw new Error("Snapshot PNG failed its integrity check.");
    if (type === "tEXt") {
      const separator = data.indexOf(0);
      if (separator === SNAPSHOT_KEYWORD.length) {
        const keywordMatches = [...SNAPSHOT_KEYWORD].every(
          (character, index) => data[index] === character.charCodeAt(0),
        );
        if (keywordMatches) {
          if (manifest)
            throw new Error("Snapshot PNG contains duplicate manifests.");
          const encoded = bytesToLatin1(data.subarray(separator + 1)).trim();
          manifest = base64ToBytes(encoded);
        }
      }
    }
    offset += 12 + length;
    if (type === "IEND") {
      ended = true;
      break;
    }
  }
  if (!ended || offset !== bytes.length)
    throw new Error("Snapshot PNG has an invalid structure.");
  if (!manifest) throw new Error("PNG does not contain a Buzz agent snapshot.");
  if (manifest.length > JSON_LIMIT)
    throw new Error("Embedded snapshot metadata is too large.");
  return manifest;
}

async function transparentPng(): Promise<Uint8Array> {
  const canvas = document.createElement("canvas");
  canvas.width = 1;
  canvas.height = 1;
  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, "image/png"),
  );
  if (!blob) throw new Error("Could not create snapshot PNG.");
  return new Uint8Array(await blob.arrayBuffer());
}

async function encodePng(snapshotBytes: Uint8Array): Promise<Uint8Array> {
  const source = await transparentPng();
  const encoded = new TextEncoder().encode(bytesToBase64(snapshotBytes));
  const keyword = new TextEncoder().encode(SNAPSHOT_KEYWORD);
  const text = new Uint8Array(keyword.length + 1 + encoded.length);
  text.set(keyword);
  text[keyword.length] = 0;
  text.set(encoded, keyword.length + 1);
  const chunk = pngChunk("tEXt", text);
  const ihdrLength = new DataView(
    source.buffer,
    source.byteOffset + 8,
  ).getUint32(0);
  const insertAt = 8 + 12 + ihdrLength;
  const result = new Uint8Array(source.length + chunk.length);
  result.set(source.subarray(0, insertAt));
  result.set(chunk, insertAt);
  result.set(source.subarray(insertAt), insertAt + chunk.length);
  if (result.length > PNG_LIMIT) throw new Error("Snapshot PNG is too large.");
  return result;
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

export async function exportAgentSnapshot(
  persona: AgentPersona,
  format: "json" | "png",
) {
  const snapshot = snapshotFromPersona(persona);
  const json = new TextEncoder().encode(JSON.stringify(snapshot, null, 2));
  if (json.length > JSON_LIMIT) throw new Error("Snapshot JSON is too large.");
  const bytes = format === "png" ? await encodePng(json) : json;
  const safeName =
    persona.displayName
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
  const jsonBytes = isPng ? readPngSnapshot(bytes) : bytes;
  let value: unknown;
  try {
    value = JSON.parse(
      new TextDecoder("utf-8", { fatal: true }).decode(jsonBytes),
    );
  } catch {
    throw new Error("Snapshot JSON is invalid.");
  }
  return { snapshot: parseSnapshot(value), source: isPng ? "png" : "json" };
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
  const provider = ["anthropic", "openai"].includes(
    snapshot.definition.provider ?? "",
  )
    ? (snapshot.definition.provider ?? null)
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
