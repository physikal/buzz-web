import { makeNip98AuthHeader } from "@/shared/lib/nip98";
import { relayHttpBaseUrl } from "@/shared/lib/relay-url";
import type { EncryptedWrapper } from "./vault-worker-client";

export type OwnerVaultStatus = {
  claimed: boolean;
  vault_ready: boolean;
  owner_pubkey: string | null;
  claim_enabled: boolean;
};

export type OwnerVaultCredential = EncryptedWrapper & {
  owner_pubkey: string;
  prf_input: string;
};

export type OwnerVaultRecovery = EncryptedWrapper & {
  owner_pubkey: string;
};

export type CredentialPayload = EncryptedWrapper & {
  credential_id: string;
  label: string;
  prf_input: string;
};

async function readJson<T>(response: Response): Promise<T> {
  const payload = (await response.json().catch(() => null)) as
    | T
    | { error?: string }
    | null;
  if (!response.ok) {
    const errorPayload =
      payload && typeof payload === "object"
        ? (payload as { error?: string })
        : null;
    throw new Error(
      errorPayload?.error
        ? errorPayload.error
        : `Request failed (${response.status})`,
    );
  }
  return payload as T;
}

export async function getOwnerVaultStatus(): Promise<OwnerVaultStatus> {
  const response = await fetch(`${relayHttpBaseUrl()}/api/owner/status`, {
    headers: { Accept: "application/json" },
    cache: "no-store",
  });
  return readJson(response);
}

export async function claimOwnerVault(input: {
  token: string;
  credential: CredentialPayload;
  recovery: EncryptedWrapper;
}): Promise<{ owner_pubkey: string }> {
  const url = `${relayHttpBaseUrl()}/api/owner/claim`;
  const body = JSON.stringify(input);
  const authorization = await makeNip98AuthHeader(url, "POST", {
    body,
    requireNip07: true,
  });
  const response = await fetch(url, {
    method: "POST",
    headers: {
      Accept: "application/json",
      Authorization: authorization,
      "Content-Type": "application/json",
    },
    body,
  });
  return readJson(response);
}

export async function getPasskeyWrapper(
  credentialId: string,
): Promise<OwnerVaultCredential> {
  const response = await fetch(`${relayHttpBaseUrl()}/api/owner/vault/unlock`, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ credential_id: credentialId }),
  });
  return readJson(response);
}

export async function getRecoveryWrapper(): Promise<OwnerVaultRecovery> {
  const response = await fetch(
    `${relayHttpBaseUrl()}/api/owner/vault/recovery`,
    { headers: { Accept: "application/json" }, cache: "no-store" },
  );
  return readJson(response);
}

export async function addOwnerCredential(
  credential: CredentialPayload,
): Promise<void> {
  const url = `${relayHttpBaseUrl()}/api/owner/credentials`;
  const body = JSON.stringify({ credential });
  const authorization = await makeNip98AuthHeader(url, "POST", {
    body,
    requireNip07: true,
  });
  const response = await fetch(url, {
    method: "POST",
    headers: {
      Accept: "application/json",
      Authorization: authorization,
      "Content-Type": "application/json",
    },
    body,
  });
  await readJson(response);
}
