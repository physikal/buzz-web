import type {
  SignedNostrEvent,
  UnsignedNostrEvent,
} from "@/shared/lib/nostr-signer";

export type EncryptedWrapper = {
  kdf_salt: string;
  nonce: string;
  ciphertext: string;
};

export type CreatedOwnerVault = {
  pubkey: string;
  credential: EncryptedWrapper;
  recovery: EncryptedWrapper;
};

type WorkerResponse = {
  id: number;
  ok: boolean;
  result?: unknown;
  error?: string;
};

let worker: Worker | null = null;
let nextId = 1;
let activePubkey: string | null = null;
let autoLockTimer: ReturnType<typeof setTimeout> | null = null;
const AUTO_LOCK_MS = 15 * 60 * 1000;
const pending = new Map<
  number,
  { resolve: (value: unknown) => void; reject: (reason: Error) => void }
>();

function signerWorker(): Worker {
  if (worker) return worker;
  worker = new Worker(new URL("./owner-signer.worker.ts", import.meta.url), {
    type: "module",
    name: "buzz-owner-signer",
  });
  worker.addEventListener(
    "message",
    (message: MessageEvent<WorkerResponse>) => {
      const request = pending.get(message.data.id);
      if (!request) return;
      pending.delete(message.data.id);
      if (message.data.ok) request.resolve(message.data.result);
      else
        request.reject(new Error(message.data.error ?? "Owner signer failed."));
    },
  );
  worker.addEventListener("error", () => {
    for (const request of pending.values()) {
      request.reject(
        new Error("The owner signing worker stopped unexpectedly."),
      );
    }
    pending.clear();
    if (autoLockTimer) clearTimeout(autoLockTimer);
    autoLockTimer = null;
    activePubkey = null;
    worker = null;
    window.dispatchEvent(new Event("buzz-web:owner-disconnected"));
  });
  return worker;
}

function request<T>(
  payload: Record<string, unknown>,
  transfers: Transferable[] = [],
): Promise<T> {
  const id = nextId++;
  return new Promise<T>((resolve, reject) => {
    pending.set(id, {
      resolve: (value) => resolve(value as T),
      reject,
    });
    signerWorker().postMessage({ id, ...payload }, transfers);
  });
}

function armAutoLock(): void {
  if (autoLockTimer) clearTimeout(autoLockTimer);
  autoLockTimer = setTimeout(() => {
    void lockOwnerVault();
  }, AUTO_LOCK_MS);
}

export function hasUnlockedOwnerVault(): boolean {
  return activePubkey !== null;
}

export async function getUnlockedOwnerPublicKey(): Promise<string> {
  const result = await request<{ pubkey: string }>({ action: "public-key" });
  activePubkey = result.pubkey;
  armAutoLock();
  return result.pubkey;
}

export async function createOwnerVault(input: {
  nsec?: string;
  ncryptsec?: string;
  backupPassword?: string;
  passkeyMaterial: ArrayBuffer;
  passkeyKdfSalt: string;
  recoveryMaterial: ArrayBuffer;
  recoveryKdfSalt: string;
}): Promise<CreatedOwnerVault> {
  const result = await request<CreatedOwnerVault>(
    {
      action: input.nsec ? "import" : "create",
      ...(input.ncryptsec ? { action: "import-nip49" } : {}),
      ...input,
    },
    [input.passkeyMaterial, input.recoveryMaterial],
  );
  activePubkey = result.pubkey;
  armAutoLock();
  return result;
}

export async function unlockOwnerVault(input: {
  material: ArrayBuffer;
  expectedPubkey: string;
  wrapper: EncryptedWrapper;
}): Promise<string> {
  const result = await request<{ pubkey: string }>(
    { action: "unlock", ...input },
    [input.material],
  );
  activePubkey = result.pubkey;
  armAutoLock();
  return result.pubkey;
}

export async function wrapOwnerVault(
  material: ArrayBuffer,
  kdfSalt: string,
): Promise<EncryptedWrapper> {
  return request<EncryptedWrapper>({ action: "wrap", material, kdfSalt }, [
    material,
  ]);
}

export async function signWithOwnerVault(
  event: UnsignedNostrEvent,
): Promise<SignedNostrEvent> {
  const signed = await request<SignedNostrEvent>({ action: "sign", event });
  armAutoLock();
  return signed;
}

export async function nip44EncryptWithOwnerVault(
  plaintext: string,
  peerPubkey?: string,
): Promise<string> {
  const ciphertext = await request<string>({
    action: peerPubkey ? "nip44-encrypt-peer" : "nip44-encrypt",
    plaintext,
    ...(peerPubkey ? { peerPubkey } : {}),
  });
  armAutoLock();
  return ciphertext;
}

export async function nip44DecryptWithOwnerVault(
  ciphertext: string,
  peerPubkey?: string,
): Promise<string> {
  const plaintext = await request<string>({
    action: "nip44-decrypt-peer",
    ciphertext,
    peerPubkey: peerPubkey ?? activePubkey,
  });
  armAutoLock();
  return plaintext;
}

export async function deriveMemoryAddressWithOwnerVault(
  peerPubkey: string,
  slug: string,
): Promise<string> {
  const address = await request<string>({
    action: "nip44-memory-address",
    peerPubkey,
    slug,
  });
  armAutoLock();
  return address;
}

export async function exportOwnerNip49Backup(
  password: string,
): Promise<string> {
  const backup = await request<string>({
    action: "nip49-export",
    password,
  });
  armAutoLock();
  return backup;
}

export async function lockOwnerVault(): Promise<void> {
  if (autoLockTimer) clearTimeout(autoLockTimer);
  autoLockTimer = null;
  if (!worker) {
    window.dispatchEvent(new Event("buzz-web:owner-disconnected"));
    return;
  }
  try {
    await request({ action: "lock" });
  } finally {
    activePubkey = null;
    window.dispatchEvent(new Event("buzz-web:owner-disconnected"));
  }
}
