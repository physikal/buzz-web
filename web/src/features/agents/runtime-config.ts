import type { AgentProvider, AgentRuntime } from "./agent-api";

export const AGENT_PROVIDERS: Array<{
  value: AgentProvider;
  label: string;
  credentialLabel: string;
  credentialRequired: boolean;
}> = [
  {
    value: "anthropic",
    label: "Anthropic",
    credentialLabel: "Anthropic API key",
    credentialRequired: true,
  },
  {
    value: "openai",
    label: "OpenAI compatible",
    credentialLabel: "OpenAI API key",
    credentialRequired: true,
  },
  {
    value: "openrouter",
    label: "OpenRouter",
    credentialLabel: "OpenRouter API key",
    credentialRequired: true,
  },
  {
    value: "databricks",
    label: "Databricks",
    credentialLabel: "Databricks token",
    credentialRequired: false,
  },
  {
    value: "databricks_v2",
    label: "Databricks AI Gateway",
    credentialLabel: "Databricks token",
    credentialRequired: false,
  },
];

export const THINKING_EFFORTS = [
  "none",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
] as const;

export type AdvancedRuntimeDraft = {
  agentArgsText: string;
  parallelism: string;
  idleTimeout: string;
  maxTurnDuration: string;
  thinkingEffort: string;
  maxRounds: string;
  maxOutputTokens: string;
  maxContextTokens: string;
  baseUrl: string;
  apiMode: string;
  apiVersion: string;
  databricksHost: string;
};

export const EMPTY_ADVANCED_RUNTIME_DRAFT: AdvancedRuntimeDraft = {
  agentArgsText: "",
  parallelism: "1",
  idleTimeout: "",
  maxTurnDuration: "",
  thinkingEffort: "",
  maxRounds: "",
  maxOutputTokens: "",
  maxContextTokens: "",
  baseUrl: "",
  apiMode: "",
  apiVersion: "",
  databricksHost: "",
};

export function providerMetadata(provider: AgentProvider) {
  const metadata = AGENT_PROVIDERS.find((entry) => entry.value === provider);
  if (!metadata) throw new Error(`Unsupported provider: ${provider}`);
  return metadata;
}

export function parseAgentArgs(value: string): string[] {
  return value
    .split(",")
    .map((argument) => argument.trim())
    .filter(Boolean);
}

function optionalPositiveInteger(
  value: string,
  minimum: number,
  maximum: number,
) {
  if (!value) return true;
  const number = Number(value);
  return Number.isSafeInteger(number) && number >= minimum && number <= maximum;
}

export function validateAdvancedRuntimeDraft(
  runtime: AgentRuntime,
  provider: AgentProvider,
  draft: AdvancedRuntimeDraft,
): string | null {
  const args = parseAgentArgs(draft.agentArgsText);
  if (
    args.length > 32 ||
    args.some((argument) => argument.length > 1024 || argument.includes("\0"))
  )
    return "Harness arguments are invalid.";
  if (!optionalPositiveInteger(draft.parallelism, 1, 32))
    return "Parallelism must be between 1 and 32.";
  if (!optionalPositiveInteger(draft.idleTimeout, 1, 604_799))
    return "Idle timeout must be between 1 second and 7 days.";
  if (!optionalPositiveInteger(draft.maxTurnDuration, 2, 604_800))
    return "Maximum turn duration must be between 2 seconds and 7 days.";
  if (
    draft.idleTimeout &&
    draft.maxTurnDuration &&
    Number(draft.idleTimeout) >= Number(draft.maxTurnDuration)
  )
    return "Idle timeout must be shorter than the maximum turn duration.";
  if (runtime !== "buzz-agent") return null;
  if (!optionalPositiveInteger(draft.maxRounds, 0, 4_294_967_295))
    return "Max rounds must be a non-negative whole number.";
  if (!optionalPositiveInteger(draft.maxOutputTokens, 1, 4_294_967_295))
    return "Max output tokens must be a positive whole number.";
  if (
    !optionalPositiveInteger(draft.maxContextTokens, 1, Number.MAX_SAFE_INTEGER)
  )
    return "Context limit must be a positive whole number.";
  if (
    draft.maxOutputTokens &&
    draft.maxContextTokens &&
    Number(draft.maxOutputTokens) >= Number(draft.maxContextTokens)
  )
    return "Context limit must exceed max output tokens.";
  const url = provider.startsWith("databricks")
    ? draft.databricksHost
    : draft.baseUrl;
  if (provider.startsWith("databricks") && !url)
    return "Databricks host is required.";
  if (url) {
    try {
      const parsed = new URL(url);
      if (!["http:", "https:"].includes(parsed.protocol)) throw new Error();
    } catch {
      return "Enter a valid provider URL.";
    }
  }
  return null;
}

export function buildRuntimeConfig(
  runtime: AgentRuntime,
  provider: AgentProvider,
  draft: AdvancedRuntimeDraft,
): Record<string, string> {
  if (runtime !== "buzz-agent") return {};
  return Object.fromEntries(
    [
      ["thinking_effort", draft.thinkingEffort],
      ["max_rounds", draft.maxRounds],
      ["max_output_tokens", draft.maxOutputTokens],
      ["max_context_tokens", draft.maxContextTokens],
      ["base_url", provider.startsWith("databricks") ? "" : draft.baseUrl],
      ["api_mode", provider === "openai" ? draft.apiMode : ""],
      ["api_version", provider === "anthropic" ? draft.apiVersion : ""],
      [
        "databricks_host",
        provider.startsWith("databricks") ? draft.databricksHost : "",
      ],
    ].filter((entry): entry is [string, string] => Boolean(entry[1])),
  );
}

export function buildCredentialSecrets(
  runtime: AgentRuntime,
  provider: AgentProvider,
  credential: string,
): Record<string, string> {
  if (!credential) return {};
  if (runtime === "codex") return { OPENAI_API_KEY: credential };
  if (runtime === "claude") return { ANTHROPIC_API_KEY: credential };
  return {
    [{
      anthropic: "ANTHROPIC_API_KEY",
      openai: "OPENAI_COMPAT_API_KEY",
      openrouter: "OPENROUTER_API_KEY",
      databricks: "DATABRICKS_TOKEN",
      databricks_v2: "DATABRICKS_TOKEN",
    }[provider]]: credential,
  };
}
