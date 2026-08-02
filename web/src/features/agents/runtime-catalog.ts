import { useQuery } from "@tanstack/react-query";

import {
  listAgentRuntimes,
  type AgentRuntime,
  type AgentRuntimeCatalogEntry,
} from "./agent-api";

export const BUILTIN_RUNTIME_CATALOG: AgentRuntimeCatalogEntry[] = [
  {
    id: "buzz-agent",
    label: "Buzz Agent",
    source: "built-in",
    supports_model: true,
    model_required: true,
    supports_subscription: false,
    supports_arguments: true,
    secret_fields: [],
  },
  {
    id: "codex",
    label: "Codex",
    source: "built-in",
    supports_model: true,
    model_required: false,
    supports_subscription: true,
    supports_arguments: true,
    secret_fields: [],
  },
  {
    id: "claude",
    label: "Claude Code",
    source: "built-in",
    supports_model: true,
    model_required: false,
    supports_subscription: true,
    supports_arguments: true,
    secret_fields: [],
  },
];

export function useAgentRuntimeCatalog() {
  const query = useQuery({
    queryKey: ["agent-runtime-catalog"],
    queryFn: listAgentRuntimes,
    staleTime: 5 * 60_000,
  });
  return {
    ...query,
    runtimes: query.data ?? BUILTIN_RUNTIME_CATALOG,
  };
}

export function runtimeCatalogEntry(
  runtimes: AgentRuntimeCatalogEntry[],
  runtime: AgentRuntime,
) {
  return runtimes.find((entry) => entry.id === runtime);
}

export function runtimeDisplayName(runtime: AgentRuntime) {
  const builtIn = BUILTIN_RUNTIME_CATALOG.find((entry) => entry.id === runtime);
  if (builtIn) return builtIn.label;
  return runtime
    .split(/[-_]/u)
    .filter(Boolean)
    .map((part) => part[0]?.toUpperCase() + part.slice(1))
    .join(" ");
}
