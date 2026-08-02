import { makeNip98AuthHeader } from "@/shared/lib/nip98";
import { relayHttpBaseUrl } from "@/shared/lib/relay-url";

export type AgentRuntime = "buzz-agent" | "codex" | "claude";
export type RespondToMode = "owner-only" | "allowlist" | "anyone";
export type AgentCredentialMode = "api-key" | "subscription";

export type ManagedAgent = {
  id: string;
  owner_pubkey: string;
  agent_pubkey: string;
  name: string;
  system_prompt: string;
  runtime: AgentRuntime;
  model: string | null;
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

export type CreateAgentInput = {
  name: string;
  system_prompt: string;
  runtime: AgentRuntime;
  model?: string;
  respond_to: RespondToMode;
  respond_to_allowlist: string[];
  secrets: Record<string, string>;
  credential_mode: AgentCredentialMode;
  start_immediately?: boolean;
};

export type UpdateAgentInput = Partial<
  Omit<CreateAgentInput, "model" | "secrets">
> & {
  model?: string | null;
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

export async function restoreAgentMemory(
  id: string,
  entry: { slug: string; body: string },
): Promise<{ event_id: string }> {
  return signedRequest<{ event_id: string }>(
    `/api/agents/${encodeURIComponent(id)}/memory`,
    { method: "POST", body: JSON.stringify(entry) },
  );
}
