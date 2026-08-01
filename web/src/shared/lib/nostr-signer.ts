import {
  finalizeEvent,
  generateSecretKey,
  getPublicKey,
} from "nostr-tools/pure";
import {
  getUnlockedOwnerPublicKey,
  deriveMemoryAddressWithOwnerVault,
  hasUnlockedOwnerVault,
  nip44DecryptWithOwnerVault,
  nip44EncryptWithOwnerVault,
  signWithOwnerVault,
} from "@/features/owner-vault/lib/vault-worker-client";

export type UnsignedNostrEvent = {
  kind: number;
  created_at: number;
  tags: string[][];
  content: string;
};

export type SignedNostrEvent = UnsignedNostrEvent & {
  id: string;
  pubkey: string;
  sig: string;
};

type Nip07Provider = {
  getPublicKey(): Promise<string>;
  signEvent(event: UnsignedNostrEvent): Promise<SignedNostrEvent>;
  nip44?: {
    encrypt(pubkey: string, plaintext: string): Promise<string>;
    decrypt(pubkey: string, ciphertext: string): Promise<string>;
  };
};

declare global {
  interface Window {
    nostr?: Nip07Provider;
  }
}

export class Nip07UnavailableError extends Error {
  constructor() {
    super("A NIP-07 browser extension is required to join in the browser.");
    this.name = "Nip07UnavailableError";
  }
}

let ephemeralSecretKey: Uint8Array | null = null;

function getEphemeralSecretKey(): Uint8Array {
  if (!ephemeralSecretKey) {
    ephemeralSecretKey = generateSecretKey();
  }
  return ephemeralSecretKey;
}

export function hasNip07Provider(): boolean {
  return typeof window !== "undefined" && window.nostr != null;
}

/** Ask the browser signer for its active public key without exposing a secret. */
export async function getNip07PublicKey(): Promise<string> {
  const provider = typeof window === "undefined" ? undefined : window.nostr;
  if (!provider) throw new Nip07UnavailableError();
  const pubkey = await provider.getPublicKey();
  if (!/^[0-9a-f]{64}$/.test(pubkey)) {
    throw new Error("The NIP-07 extension returned an invalid public key.");
  }
  return pubkey;
}

/** Return the active first-party vault key, falling back to NIP-07. */
export async function getBrowserOwnerPublicKey(): Promise<string> {
  if (hasUnlockedOwnerVault()) return getUnlockedOwnerPublicKey();
  return getNip07PublicKey();
}

function sameUnsignedEvent(
  expected: UnsignedNostrEvent,
  actual: SignedNostrEvent,
): boolean {
  return (
    actual.kind === expected.kind &&
    actual.created_at === expected.created_at &&
    actual.content === expected.content &&
    JSON.stringify(actual.tags) === JSON.stringify(expected.tags)
  );
}

/**
 * Sign with NIP-07 when available, otherwise use a page-lifetime key.
 *
 * The ephemeral fallback preserves anonymous browsing on open relays. Flows
 * that create durable membership must set `requireNip07` so a reload cannot
 * orphan a relay-membership row.
 */
export async function signNostrEvent(
  template: Omit<UnsignedNostrEvent, "created_at"> & {
    created_at?: number;
  },
  options?: { requireNip07?: boolean },
): Promise<SignedNostrEvent> {
  const unsigned: UnsignedNostrEvent = {
    ...template,
    created_at: template.created_at ?? Math.floor(Date.now() / 1000),
  };
  const provider = typeof window === "undefined" ? undefined : window.nostr;

  if (hasUnlockedOwnerVault()) {
    const expectedPubkey = await getUnlockedOwnerPublicKey();
    const signed = await signWithOwnerVault(unsigned);
    if (
      signed.pubkey !== expectedPubkey ||
      !sameUnsignedEvent(unsigned, signed) ||
      typeof signed.id !== "string" ||
      typeof signed.sig !== "string"
    ) {
      throw new Error("The owner vault returned an invalid signed event.");
    }
    return signed;
  }

  if (provider) {
    const expectedPubkey = await provider.getPublicKey();
    const signed = await provider.signEvent(unsigned);
    if (
      signed.pubkey !== expectedPubkey ||
      !sameUnsignedEvent(unsigned, signed) ||
      typeof signed.id !== "string" ||
      typeof signed.sig !== "string"
    ) {
      throw new Error("The NIP-07 extension returned an invalid signed event.");
    }
    return signed;
  }

  if (options?.requireNip07) {
    throw new Nip07UnavailableError();
  }

  const secretKey = getEphemeralSecretKey();
  const signed = finalizeEvent(unsigned, secretKey);
  if (signed.pubkey !== getPublicKey(secretKey)) {
    throw new Error("Failed to create the ephemeral browser identity.");
  }
  return signed;
}

export async function nip44EncryptToSelf(plaintext: string): Promise<string> {
  if (new TextEncoder().encode(plaintext).length > 64 * 1024)
    throw new Error("Encrypted content is too large.");
  if (hasUnlockedOwnerVault()) return nip44EncryptWithOwnerVault(plaintext);
  const provider = typeof window === "undefined" ? undefined : window.nostr;
  if (!provider?.nip44)
    throw new Error("This browser signer does not support NIP-44 encryption.");
  const pubkey = await getNip07PublicKey();
  return provider.nip44.encrypt(pubkey, plaintext);
}

export async function nip44DecryptFromSelf(
  ciphertext: string,
): Promise<string> {
  if (ciphertext.length > 100 * 1024)
    throw new Error("Encrypted content is too large.");
  if (hasUnlockedOwnerVault()) return nip44DecryptWithOwnerVault(ciphertext);
  const provider = typeof window === "undefined" ? undefined : window.nostr;
  if (!provider?.nip44)
    throw new Error("This browser signer does not support NIP-44 decryption.");
  const pubkey = await getNip07PublicKey();
  return provider.nip44.decrypt(pubkey, ciphertext);
}

export async function nip44DecryptFromPeer(
  peerPubkey: string,
  ciphertext: string,
): Promise<string> {
  if (!/^[0-9a-f]{64}$/u.test(peerPubkey))
    throw new Error("The peer public key is invalid.");
  if (ciphertext.length > 100 * 1024)
    throw new Error("Encrypted content is too large.");
  if (hasUnlockedOwnerVault())
    return nip44DecryptWithOwnerVault(ciphertext, peerPubkey);
  const provider = typeof window === "undefined" ? undefined : window.nostr;
  if (!provider?.nip44)
    throw new Error("This browser signer does not support NIP-44 decryption.");
  return provider.nip44.decrypt(peerPubkey, ciphertext);
}

export async function deriveAgentMemoryAddress(
  agentPubkey: string,
  slug: string,
): Promise<string> {
  if (!hasUnlockedOwnerVault())
    throw new Error(
      "Memory address verification requires the first-party owner vault.",
    );
  return deriveMemoryAddressWithOwnerVault(agentPubkey, slug);
}
