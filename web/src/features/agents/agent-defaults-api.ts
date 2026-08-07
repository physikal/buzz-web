import { queryEvents, type NostrEvent } from "@/shared/lib/nostr-client";
import {
  nip44DecryptFromSelf,
  nip44EncryptToSelf,
} from "@/shared/lib/nostr-signer";
import { submitEvent } from "@/shared/lib/relay-events";
import { relayWsUrl } from "@/shared/lib/relay-url";
import type {
  AgentCredentialMode,
  AgentProvider,
  AgentRuntime,
} from "./agent-api";
import { validateAdvancedRuntimeDraft } from "./runtime-config";

const AGENT_DEFAULTS_KIND = 30078;
const AGENT_DEFAULTS_COORDINATE = "buzz-web:agent-defaults:v1";
const MAX_API_KEY_BYTES = 16 * 1024;

export type AgentDefaults = {
  createdAt: number | null;
  runtime: AgentRuntime;
  provider: AgentProvider;
  model: string;
  credentialMode: AgentCredentialMode;
  apiKey: string;
  agentArgs: string[];
  parallelism: number;
  idleTimeoutSeconds: number | null;
  maxTurnDurationSeconds: number | null;
  runtimeConfig: Record<string, string>;
};

export const EMPTY_AGENT_DEFAULTS: AgentDefaults = {
  createdAt: null,
  runtime: "buzz-agent",
  provider: "anthropic",
  model: "",
  credentialMode: "api-key",
  apiKey: "",
  agentArgs: [],
  parallelism: 1,
  idleTimeoutSeconds: null,
  maxTurnDurationSeconds: null,
  runtimeConfig: {},
};

function exactTag(event: NostrEvent, name: string) {
  const tags = event.tags.filter((tag) => tag.length === 2 && tag[0] === name);
  return tags.length === 1 ? tags[0][1] : undefined;
}

function validRuntime(value: unknown): value is AgentRuntime {
  return typeof value === "string" && /^[a-z0-9][a-z0-9_-]{0,63}$/u.test(value);
}

async function parseDefaults(event: NostrEvent): Promise<AgentDefaults | null> {
  try {
    if (event.content.length > 40 * 1024) return null;
    const plaintext = await nip44DecryptFromSelf(event.content);
    if (new TextEncoder().encode(plaintext).length > 24 * 1024) return null;
    const value = JSON.parse(plaintext) as Record<string, unknown>;
    if (!value || typeof value !== "object" || Array.isArray(value))
      return null;
    const version = value.version;
    const keys = Object.keys(value).sort().join(",");
    const v1Keys = "api_key,credential_mode,model,provider,runtime,version";
    const v2Keys =
      "agent_args,api_key,credential_mode,idle_timeout_seconds,max_turn_duration_seconds,model,parallelism,provider,runtime,runtime_config,version";
    if (
      (version !== 1 || keys !== v1Keys) &&
      (version !== 2 || keys !== v2Keys)
    )
      return null;
    if (
      !validRuntime(value.runtime) ||
      ![
        "anthropic",
        "openai",
        "openrouter",
        "databricks",
        "databricks_v2",
        "relay-mesh",
      ].includes(value.provider as string) ||
      !["api-key", "subscription"].includes(value.credential_mode as string) ||
      typeof value.model !== "string" ||
      value.model.length > 255 ||
      typeof value.api_key !== "string" ||
      new TextEncoder().encode(value.api_key).length > MAX_API_KEY_BYTES ||
      (value.runtime === "buzz-agent" && value.credential_mode !== "api-key")
    )
      return null;
    const agentArgs = version === 2 ? value.agent_args : [];
    const parallelism = version === 2 ? value.parallelism : 1;
    const idleTimeout = version === 2 ? value.idle_timeout_seconds : null;
    const maxTurnDuration =
      version === 2 ? value.max_turn_duration_seconds : null;
    const runtimeConfig = version === 2 ? value.runtime_config : {};
    if (
      !Array.isArray(agentArgs) ||
      agentArgs.length > 32 ||
      agentArgs.some(
        (argument) =>
          typeof argument !== "string" ||
          !argument ||
          argument.length > 1024 ||
          argument.includes("\0"),
      ) ||
      !Number.isSafeInteger(parallelism) ||
      Number(parallelism) < 1 ||
      Number(parallelism) > 32 ||
      !optionalInteger(idleTimeout, 1, 604_799) ||
      !optionalInteger(maxTurnDuration, 2, 604_800) ||
      !runtimeConfig ||
      typeof runtimeConfig !== "object" ||
      Array.isArray(runtimeConfig) ||
      Object.keys(runtimeConfig).length > 16 ||
      Object.entries(runtimeConfig).some(
        ([key, entry]) =>
          !/^[a-z_]{1,64}$/u.test(key) ||
          typeof entry !== "string" ||
          !entry ||
          entry.length > 2048,
      )
    )
      return null;
    return {
      createdAt: event.created_at,
      runtime: value.runtime,
      provider: value.provider as AgentDefaults["provider"],
      model: value.model,
      credentialMode: value.credential_mode as AgentCredentialMode,
      apiKey: value.api_key,
      agentArgs: agentArgs as string[],
      parallelism: Number(parallelism),
      idleTimeoutSeconds: idleTimeout as number | null,
      maxTurnDurationSeconds: maxTurnDuration as number | null,
      runtimeConfig: runtimeConfig as Record<string, string>,
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
  if (
    ![
      "anthropic",
      "openai",
      "openrouter",
      "databricks",
      "databricks_v2",
      "relay-mesh",
    ].includes(input.provider)
  )
    throw new Error("Choose a valid provider.");
  if (input.model.length > 255) throw new Error("Model is too long.");
  if (new TextEncoder().encode(input.apiKey).length > MAX_API_KEY_BYTES)
    throw new Error("API key is too long.");
  if (input.runtime === "buzz-agent" && input.credentialMode !== "api-key")
    throw new Error("Buzz Agent requires an API key.");
  const advancedError = validateAdvancedRuntimeDraft(
    input.runtime,
    input.provider,
    {
      agentArgsText: input.agentArgs.join(", "),
      parallelism: String(input.parallelism),
      idleTimeout: input.idleTimeoutSeconds?.toString() ?? "",
      maxTurnDuration: input.maxTurnDurationSeconds?.toString() ?? "",
      thinkingEffort: input.runtimeConfig.thinking_effort ?? "",
      maxRounds: input.runtimeConfig.max_rounds ?? "",
      maxOutputTokens: input.runtimeConfig.max_output_tokens ?? "",
      maxContextTokens: input.runtimeConfig.max_context_tokens ?? "",
      baseUrl: input.runtimeConfig.base_url ?? "",
      apiMode: input.runtimeConfig.api_mode ?? "",
      apiVersion: input.runtimeConfig.api_version ?? "",
      databricksHost: input.runtimeConfig.databricks_host ?? "",
    },
  );
  if (advancedError) throw new Error(advancedError);
  const plaintext = JSON.stringify({
    version: 2,
    runtime: input.runtime,
    provider: input.provider,
    model: input.model.trim(),
    credential_mode: input.credentialMode,
    api_key: input.apiKey,
    agent_args: input.agentArgs,
    parallelism: input.parallelism,
    idle_timeout_seconds: input.idleTimeoutSeconds,
    max_turn_duration_seconds: input.maxTurnDurationSeconds,
    runtime_config: input.runtimeConfig,
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

function optionalInteger(value: unknown, minimum: number, maximum: number) {
  return (
    value === null ||
    (Number.isSafeInteger(value) &&
      Number(value) >= minimum &&
      Number(value) <= maximum)
  );
}
