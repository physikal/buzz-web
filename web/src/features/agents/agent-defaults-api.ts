import { queryEvents, type NostrEvent } from "@/shared/lib/nostr-client";
import {
  nip44DecryptFromSelf,
  nip44EncryptToSelf,
} from "@/shared/lib/nostr-signer";
import { submitEvent } from "@/shared/lib/relay-events";
import { relayWsUrl } from "@/shared/lib/relay-url";
import type { AgentCredentialMode, AgentRuntime } from "./agent-api";

const AGENT_DEFAULTS_KIND = 30078;
const AGENT_DEFAULTS_COORDINATE = "buzz-web:agent-defaults:v1";
const MAX_API_KEY_BYTES = 16 * 1024;

export type AgentDefaults = {
  createdAt: number | null;
  runtime: AgentRuntime;
  provider: "anthropic" | "openai";
  model: string;
  credentialMode: AgentCredentialMode;
  apiKey: string;
};

export const EMPTY_AGENT_DEFAULTS: AgentDefaults = {
  createdAt: null,
  runtime: "buzz-agent",
  provider: "anthropic",
  model: "",
  credentialMode: "api-key",
  apiKey: "",
};

function exactTag(event: NostrEvent, name: string) {
  const tags = event.tags.filter((tag) => tag.length === 2 && tag[0] === name);
  return tags.length === 1 ? tags[0][1] : undefined;
}

function validRuntime(value: unknown): value is AgentRuntime {
  return ["buzz-agent", "codex", "claude"].includes(value as string);
}

async function parseDefaults(event: NostrEvent): Promise<AgentDefaults | null> {
  try {
    if (event.content.length > 40 * 1024) return null;
    const plaintext = await nip44DecryptFromSelf(event.content);
    if (new TextEncoder().encode(plaintext).length > 24 * 1024) return null;
    const value = JSON.parse(plaintext) as Record<string, unknown>;
    if (!value || typeof value !== "object" || Array.isArray(value))
      return null;
    const keys = Object.keys(value).sort();
    if (
      keys.join(",") !==
      "api_key,credential_mode,model,provider,runtime,version"
    )
      return null;
    if (
      value.version !== 1 ||
      !validRuntime(value.runtime) ||
      !["anthropic", "openai"].includes(value.provider as string) ||
      !["api-key", "subscription"].includes(value.credential_mode as string) ||
      typeof value.model !== "string" ||
      value.model.length > 255 ||
      typeof value.api_key !== "string" ||
      new TextEncoder().encode(value.api_key).length > MAX_API_KEY_BYTES ||
      (value.runtime === "buzz-agent" && value.credential_mode !== "api-key")
    )
      return null;
    return {
      createdAt: event.created_at,
      runtime: value.runtime,
      provider: value.provider as AgentDefaults["provider"],
      model: value.model,
      credentialMode: value.credential_mode as AgentCredentialMode,
      apiKey: value.api_key,
    };
  } catch {
    return null;
  }
}

export async function getAgentDefaults(
  ownerPubkey: string,
): Promise<AgentDefaults> {
  const events = await queryEvents(
    relayWsUrl(),
    {
      kinds: [AGENT_DEFAULTS_KIND],
      authors: [ownerPubkey],
      "#d": [AGENT_DEFAULTS_COORDINATE],
      limit: 20,
    },
    { requireNip07: true },
  );
  const head = events
    .filter(
      (event) =>
        event.pubkey === ownerPubkey &&
        exactTag(event, "d") === AGENT_DEFAULTS_COORDINATE,
    )
    .sort(
      (left, right) =>
        right.created_at - left.created_at || left.id.localeCompare(right.id),
    )[0];
  if (!head) return EMPTY_AGENT_DEFAULTS;
  return (
    (await parseDefaults(head)) ?? {
      ...EMPTY_AGENT_DEFAULTS,
      createdAt: head.created_at,
    }
  );
}

export async function saveAgentDefaults(input: AgentDefaults): Promise<void> {
  if (!validRuntime(input.runtime)) throw new Error("Choose a valid harness.");
  if (!["anthropic", "openai"].includes(input.provider))
    throw new Error("Choose a valid provider.");
  if (input.model.length > 255) throw new Error("Model is too long.");
  if (new TextEncoder().encode(input.apiKey).length > MAX_API_KEY_BYTES)
    throw new Error("API key is too long.");
  if (input.runtime === "buzz-agent" && input.credentialMode !== "api-key")
    throw new Error("Buzz Agent requires an API key.");
  const plaintext = JSON.stringify({
    version: 1,
    runtime: input.runtime,
    provider: input.provider,
    model: input.model.trim(),
    credential_mode: input.credentialMode,
    api_key: input.apiKey,
  });
  const content = await nip44EncryptToSelf(plaintext);
  await submitEvent({
    kind: AGENT_DEFAULTS_KIND,
    created_at:
      input.createdAt === null
        ? undefined
        : Math.max(Math.floor(Date.now() / 1000), input.createdAt + 1),
    tags: [
      ["d", AGENT_DEFAULTS_COORDINATE],
      ["alt", "encrypted agent defaults"],
    ],
    content,
  });
}
