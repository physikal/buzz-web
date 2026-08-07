import { makeNip98AuthHeader } from "@/shared/lib/nip98";
import { queryEvents, type NostrEvent } from "@/shared/lib/nostr-client";
import { relayHttpBaseUrl, relayWsUrl } from "@/shared/lib/relay-url";
import { truncatePubkey } from "@/shared/lib/pubkey";

export type AgentRuntime = string;
export type AgentProvider =
  | "anthropic"
  | "openai"
  | "openrouter"
  | "databricks"
  | "databricks_v2"
  | "relay-mesh";
export type RespondToMode = "owner-only" | "allowlist" | "anyone";
export type AgentCredentialMode = "api-key" | "subscription";

export type ManagedAgent = {
  id: string;
  owner_pubkey: string;
  agent_pubkey: string;
  persona_id: string | null;
  name: string;
  system_prompt: string;
  runtime: AgentRuntime;
  model: string | null;
  provider: AgentProvider | null;
  agent_args: string[];
  parallelism: number;
  idle_timeout_seconds: number | null;
  max_turn_duration_seconds: number | null;
  runtime_config: Record<string, string>;
  credential_mode: AgentCredentialMode;
  respond_to: RespondToMode;
  respond_to_allowlist: string[];
  desired_state: "running" | "stopped";
  observed_state:
    | "pending"
    | "starting"
    | "running"
    | "stopping"
    | "stopped"
    | "error";
  last_error: string | null;
  created_at: string;
  updated_at: string;
};

export type RelayAgent = {
  pubkey: string;
  name: string;
};

export type CreateAgentInput = {
  name: string;
  persona_id?: string;
  system_prompt: string;
  runtime: AgentRuntime;
  model?: string;
  provider?: AgentProvider;
  agent_args?: string[];
  parallelism?: number;
  idle_timeout_seconds?: number;
  max_turn_duration_seconds?: number;
  runtime_config?: Record<string, string>;
  respond_to: RespondToMode;
  respond_to_allowlist: string[];
  secrets: Record<string, string>;
  credential_mode: AgentCredentialMode;
  start_immediately?: boolean;
};

export type UpdateAgentInput = Partial<
  Omit<
    CreateAgentInput,
    | "model"
    | "provider"
    | "idle_timeout_seconds"
    | "max_turn_duration_seconds"
    | "secrets"
  >
> & {
  model?: string | null;
  provider?: AgentProvider | null;
  idle_timeout_seconds?: number | null;
  max_turn_duration_seconds?: number | null;
  secrets?: Record<string, string>;
};

export type AgentAuthStatus = {
  state: "disconnected" | "waiting" | "connected" | "failed" | "cancelled";
  connected: boolean;
  needs_input: boolean;
  output: string;
  error: string | null;
};

export type AgentRuntimeLog = {
  output: string;
  truncated: boolean;
};

export type AgentRuntimeSecretField = {
  env: string;
  label: string;
  required: boolean;
};

export type AgentRuntimeCatalogEntry = {
  id: AgentRuntime;
  label: string;
  source: "built-in" | "operator";
  supports_model: boolean;
  model_required: boolean;
  supports_subscription: boolean;
  supports_arguments: boolean;
  secret_fields: AgentRuntimeSecretField[];
};

async function signedRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const method = init?.method ?? "GET";
  const body = typeof init?.body === "string" ? init.body : undefined;
  const url = `${relayHttpBaseUrl()}${path}`;
  const authorization = await makeNip98AuthHeader(url, method, {
    body,
    requireNip07: true,
  });
  const response = await fetch(url, {
    ...init,
    headers: {
      Accept: "application/json",
      Authorization: authorization,
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      ...init?.headers,
    },
  });
  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as {
      error?: string;
    } | null;
    throw new Error(payload?.error ?? `Request failed (${response.status})`);
  }
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

export async function listAgents(): Promise<ManagedAgent[]> {
  const result = await signedRequest<{ agents: ManagedAgent[] }>("/api/agents");
  return result.agents;
}

export async function listRelayAgents(): Promise<RelayAgent[]> {
  const events = await queryEvents(
    relayWsUrl(),
    { kinds: [10100], limit: 500 },
    { requireNip07: true },
  );
  const latest = new Map<string, NostrEvent>();
  for (const event of events) {
    if (event.kind !== 10100) continue;
    const previous = latest.get(event.pubkey);
    if (
      !previous ||
      event.created_at > previous.created_at ||
      (event.created_at === previous.created_at && event.id > previous.id)
    ) {
      latest.set(event.pubkey, event);
    }
  }
  return [...latest.values()]
    .map((event) => {
      let metadata: Record<string, unknown> = {};
      try {
        const value = JSON.parse(event.content) as unknown;
        if (value && typeof value === "object" && !Array.isArray(value)) {
          metadata = value as Record<string, unknown>;
        }
      } catch {
        // A signed profile still identifies an agent when metadata is malformed.
      }
      const rawName =
        (typeof metadata.name === "string" && metadata.name) ||
        (typeof metadata.display_name === "string" && metadata.display_name) ||
        "";
      return {
        pubkey: event.pubkey,
        name: rawName.trim().slice(0, 200) || truncatePubkey(event.pubkey),
      };
    })
    .sort((left, right) => left.name.localeCompare(right.name));
}

export async function listAgentRuntimes(): Promise<AgentRuntimeCatalogEntry[]> {
  const result = await signedRequest<{ runtimes: AgentRuntimeCatalogEntry[] }>(
    "/api/agents/runtimes",
    { cache: "no-store" },
  );
  return result.runtimes;
}

export async function createAgent(
  input: CreateAgentInput,
): Promise<ManagedAgent> {
  const result = await signedRequest<{ agent: ManagedAgent }>("/api/agents", {
    method: "POST",
    body: JSON.stringify(input),
  });
  return result.agent;
}

export async function updateAgent(
  id: string,
  input: UpdateAgentInput,
): Promise<ManagedAgent> {
  const result = await signedRequest<{ agent: ManagedAgent }>(
    `/api/agents/${encodeURIComponent(id)}`,
    { method: "PATCH", body: JSON.stringify(input) },
  );
  return result.agent;
}

export async function setAgentRunning(
  id: string,
  running: boolean,
): Promise<ManagedAgent> {
  const action = running ? "start" : "stop";
  const result = await signedRequest<{ agent: ManagedAgent }>(
    `/api/agents/${encodeURIComponent(id)}/${action}`,
    { method: "POST", body: "" },
  );
  return result.agent;
}

export async function deleteAgent(id: string): Promise<void> {
  await signedRequest<void>(`/api/agents/${encodeURIComponent(id)}`, {
    method: "DELETE",
    body: "",
  });
}

export async function getAgentAuthStatus(id: string): Promise<AgentAuthStatus> {
  return signedRequest<AgentAuthStatus>(
    `/api/agents/${encodeURIComponent(id)}/auth`,
  );
}

export async function startAgentAuth(id: string): Promise<AgentAuthStatus> {
  return signedRequest<AgentAuthStatus>(
    `/api/agents/${encodeURIComponent(id)}/auth/start`,
    { method: "POST", body: "" },
  );
}

export async function sendAgentAuthInput(
  id: string,
  value: string,
): Promise<AgentAuthStatus> {
  return signedRequest<AgentAuthStatus>(
    `/api/agents/${encodeURIComponent(id)}/auth/input`,
    { method: "POST", body: JSON.stringify({ value }) },
  );
}

export async function cancelAgentAuth(id: string): Promise<AgentAuthStatus> {
  return signedRequest<AgentAuthStatus>(
    `/api/agents/${encodeURIComponent(id)}/auth`,
    { method: "DELETE", body: "" },
  );
}

export async function getAgentRuntimeLog(id: string): Promise<AgentRuntimeLog> {
  return signedRequest<AgentRuntimeLog>(
    `/api/agents/${encodeURIComponent(id)}/logs`,
    { cache: "no-store" },
  );
}

export async function getAgentActivity(id: string): Promise<NostrEvent[]> {
  const result = await signedRequest<{ events: NostrEvent[] }>(
    `/api/agents/${encodeURIComponent(id)}/activity`,
    { cache: "no-store" },
  );
  return result.events;
}

export async function restoreAgentMemory(
  id: string,
  entry: { slug: string; body: string },
): Promise<{ event_id: string }> {
  return signedRequest<{ event_id: string }>(
    `/api/agents/${encodeURIComponent(id)}/memory`,
    { method: "POST", body: JSON.stringify(entry) },
  );
}
