import { makeNip98AuthHeader } from "@/shared/lib/nip98";
import { relayHttpBaseUrl } from "@/shared/lib/relay-url";

export type AgentRuntime = "buzz-agent" | "codex" | "claude";
export type RespondToMode = "owner-only" | "allowlist" | "anyone";

export type ManagedAgent = {
  id: string;
  owner_pubkey: string;
  agent_pubkey: string;
  name: string;
  system_prompt: string;
  runtime: AgentRuntime;
  model: string | null;
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
