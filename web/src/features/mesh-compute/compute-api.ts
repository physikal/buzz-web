import { makeNip98AuthHeader } from "@/shared/lib/nip98";
import { relayHttpBaseUrl } from "@/shared/lib/relay-url";

export type ComputeState = "off" | "starting" | "running" | "failed";
export type ComputeHealth = {
  status: "ok" | "degraded" | "failed";
  reason: string | null;
};

export type ComputeDownloadProgress = {
  label: string;
  file: string | null;
  downloadedBytes: number | null;
  totalBytes: number | null;
  status: "preparing" | "downloading" | "done";
  done: boolean;
};

export type ComputeStatus = {
  state: ComputeState;
  mode: "serve" | "client" | null;
  health: ComputeHealth;
  apiBaseUrl: null;
  consoleUrl: null;
  modelId: string | null;
  modelName: string | null;
  maxVramGb: number | null;
  endpointId: string | null;
  deviceId: string | null;
  deviceName: string | null;
  desiredEnabled: boolean;
  progress: ComputeDownloadProgress | null;
};

export type ComputeCatalogEntry = {
  name: string;
  size: string;
  sizeGb: number;
  description: string;
  fit: "comfortable" | "tight" | "tradeoff" | "too_large";
  installed: boolean;
  recommended: boolean;
  curated: boolean;
};

export type ComputeCatalog = {
  gpuName: string | null;
  vramDisplay: string;
  vramGb: number;
  recommended: string | null;
  entries: ComputeCatalogEntry[];
};

export type ComputeModel = { id: string; name: string | null };

export type ComputeUsage = {
  inflight: number;
  peakInflight: number;
  requestsServed: number;
  tokensServed: number;
  tokensPerSecond: number;
  localAttempts: number;
  remoteAttempts: number;
  endpointAttempts: number;
  peers: number;
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
  return (await response.json()) as T;
}

export function getComputeStatus(): Promise<ComputeStatus> {
  return signedRequest("/api/compute/status");
}

export function getComputeCatalog(): Promise<ComputeCatalog> {
  return signedRequest("/api/compute/catalog");
}

export async function getComputeModels(): Promise<ComputeModel[]> {
  const response = await signedRequest<{ models: ComputeModel[] }>(
    "/api/compute/models",
  );
  return response.models;
}

export function getComputeUsage(): Promise<ComputeUsage> {
  return signedRequest("/api/compute/usage");
}

export function startCompute(input: {
  modelId: string;
  maxVramGb?: number;
}): Promise<ComputeStatus> {
  return signedRequest("/api/compute/start", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function stopCompute(): Promise<ComputeStatus> {
  return signedRequest("/api/compute/stop", { method: "POST" });
}
