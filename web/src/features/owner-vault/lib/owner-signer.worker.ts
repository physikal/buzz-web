/// <reference lib="webworker" />

import { nip19 } from "nostr-tools";
import { v2 as nip44 } from "nostr-tools/nip44";
import {
  decrypt as decryptNip49,
  encrypt as encryptNip49,
} from "nostr-tools/nip49";
import { finalizeEvent, getPublicKey } from "nostr-tools/pure";
import type { Event } from "nostr-tools/pure";

import { decodeBase64Url, encodeBase64Url, randomBytes } from "./encoding";
import {
  SourcePairingSession,
  type PairingEventResult,
} from "./pairing-session.worker";

type UnsignedEvent = {
  kind: number;
  created_at: number;
  tags: string[][];
  content: string;
};

type Wrapper = {
  kdf_salt: string;
  nonce: string;
  ciphertext: string;
};

type WorkerRequest =
  | {
      id: number;
      action: "create" | "import" | "import-nip49";
      nsec?: string;
      ncryptsec?: string;
      backupPassword?: string;
      passkeyMaterial: ArrayBuffer;
      passkeyKdfSalt: string;
      recoveryMaterial: ArrayBuffer;
      recoveryKdfSalt: string;
    }
  | {
      id: number;
      action: "unlock";
      material: ArrayBuffer;
      expectedPubkey: string;
      wrapper: Wrapper;
    }
  | {
      id: number;
      action: "wrap";
      material: ArrayBuffer;
      kdfSalt: string;
    }
  | { id: number; action: "sign"; event: UnsignedEvent }
  | { id: number; action: "nip44-encrypt"; plaintext: string }
  | {
      id: number;
      action: "nip44-encrypt-peer";
      plaintext: string;
      peerPubkey: string;
    }
  | {
      id: number;
      action: "nip44-decrypt-peer";
      ciphertext: string;
      peerPubkey: string;
    }
  | {
      id: number;
      action: "nip44-memory-address";
      peerPubkey: string;
      slug: string;
    }
  | { id: number; action: "nip49-export"; password: string }
  | { id: number; action: "pairing-create"; pairingRelayUrl: string }
  | {
      id: number;
      action: "pairing-sign-auth";
      challenge: string;
      relayUrl: string;
    }
  | { id: number; action: "pairing-handle-event"; event: Event }
  | { id: number; action: "pairing-confirm"; relayHttpUrl: string }
  | { id: number; action: "pairing-abort"; reason?: string }
  | { id: number; action: "public-key" | "lock" };

let secretKey: Uint8Array<ArrayBuffer> | null = null;
let pairingSession: SourcePairingSession | null = null;

function resetPairingSession(): void {
  pairingSession?.destroy();
  pairingSession = null;
}

function requirePairingSession(): SourcePairingSession {
  if (!pairingSession) throw new Error("There is no active pairing session.");
  return pairingSession;
}

function setSecret(next: Uint8Array<ArrayBuffer>): void {
  resetPairingSession();
  secretKey?.fill(0);
  secretKey = new Uint8Array(next);
}

function requireSecret(): Uint8Array<ArrayBuffer> {
  if (!secretKey) throw new Error("The owner vault is locked.");
  return secretKey;
}

function requirePeerPubkey(value: string): string {
  if (!/^[0-9a-f]{64}$/u.test(value))
    throw new Error("The peer public key is invalid.");
  return value;
}

function toHex(value: ArrayBuffer): string {
  return [...new Uint8Array(value)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function validMemorySlug(value: string): boolean {
  return (
    value === "core" ||
    (new TextEncoder().encode(value).length <= 255 &&
      /^mem\/[a-z0-9][a-z0-9_-]{0,63}(\/[a-z0-9][a-z0-9_-]{0,63})*$/u.test(
        value,
      ))
  );
}

function parseSecret(value: string): Uint8Array<ArrayBuffer> {
  const trimmed = value.trim();
  if (/^[0-9a-fA-F]{64}$/.test(trimmed)) {
    return Uint8Array.from(
      trimmed.match(/.{2}/g)?.map((pair) => Number.parseInt(pair, 16)) ?? [],
    );
  }
  const decoded = nip19.decode(trimmed);
  if (decoded.type !== "nsec" || !(decoded.data instanceof Uint8Array)) {
    throw new Error("Enter a valid nsec owner key.");
  }
  return new Uint8Array(decoded.data);
}

function parseEncryptedSecret(
  value: string,
  password: string,
): Uint8Array<ArrayBuffer> {
  const backup = value.trim();
  if (!backup.startsWith("ncryptsec1") || backup.length > 5_000)
    throw new Error("Choose a valid NIP-49 owner backup.");
  if (!password || [...password].length > 256)
    throw new Error("Enter the password for this owner backup.");
  try {
    return new Uint8Array(decryptNip49(backup, password));
  } catch {
    throw new Error("The owner backup or its password is invalid.");
  }
}

async function deriveWrappingKey(
  material: ArrayBuffer,
  salt: Uint8Array<ArrayBuffer>,
): Promise<CryptoKey> {
  const input = await crypto.subtle.importKey("raw", material, "HKDF", false, [
    "deriveKey",
  ]);
  return crypto.subtle.deriveKey(
    {
      name: "HKDF",
      hash: "SHA-256",
      salt,
      info: new TextEncoder().encode("Buzz owner vault wrapping key v1"),
    },
    input,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

function additionalData(pubkey: string): Uint8Array<ArrayBuffer> {
  return new TextEncoder().encode(`buzz-owner-vault-v1\0${pubkey}`);
}

async function wrapSecret(
  material: ArrayBuffer,
  kdfSalt: Uint8Array<ArrayBuffer>,
): Promise<Wrapper> {
  const current = requireSecret();
  const pubkey = getPublicKey(current);
  const nonce = randomBytes(12);
  const key = await deriveWrappingKey(material, kdfSalt);
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: nonce, additionalData: additionalData(pubkey) },
    key,
    current,
  );
  return {
    kdf_salt: encodeBase64Url(kdfSalt),
    nonce: encodeBase64Url(nonce),
    ciphertext: encodeBase64Url(ciphertext),
  };
}

async function unlockSecret(
  material: ArrayBuffer,
  expectedPubkey: string,
  wrapper: Wrapper,
): Promise<void> {
  const key = await deriveWrappingKey(
    material,
    decodeBase64Url(wrapper.kdf_salt),
  );
  let plaintext: ArrayBuffer;
  try {
    plaintext = await crypto.subtle.decrypt(
      {
        name: "AES-GCM",
        iv: decodeBase64Url(wrapper.nonce),
        additionalData: additionalData(expectedPubkey),
      },
      key,
      decodeBase64Url(wrapper.ciphertext),
    );
  } catch {
    throw new Error(
      "This passkey or recovery code cannot unlock the owner vault.",
    );
  }
  const candidate = new Uint8Array(plaintext);
  if (candidate.length !== 32 || getPublicKey(candidate) !== expectedPubkey) {
    candidate.fill(0);
    throw new Error("The owner vault did not match this Buzz server.");
  }
  setSecret(candidate);
  candidate.fill(0);
}

self.onmessage = async (message: MessageEvent<WorkerRequest>) => {
  const request = message.data;
  try {
    let result: unknown;
    switch (request.action) {
      case "create":
      case "import":
      case "import-nip49": {
        const candidate =
          request.action === "create"
            ? randomBytes(32)
            : request.action === "import"
              ? parseSecret(request.nsec ?? "")
              : parseEncryptedSecret(
                  request.ncryptsec ?? "",
                  request.backupPassword ?? "",
                );
        setSecret(candidate);
        candidate.fill(0);
        const pubkey = getPublicKey(requireSecret());
        const credential = await wrapSecret(
          request.passkeyMaterial,
          decodeBase64Url(request.passkeyKdfSalt),
        );
        const recovery = await wrapSecret(
          request.recoveryMaterial,
          decodeBase64Url(request.recoveryKdfSalt),
        );
        result = { pubkey, credential, recovery };
        break;
      }
      case "unlock":
        await unlockSecret(
          request.material,
          request.expectedPubkey,
          request.wrapper,
        );
        result = { pubkey: request.expectedPubkey };
        break;
      case "wrap":
        result = await wrapSecret(
          request.material,
          decodeBase64Url(request.kdfSalt),
        );
        break;
      case "sign":
        result = finalizeEvent(request.event, requireSecret());
        break;
      case "nip44-encrypt": {
        if (new TextEncoder().encode(request.plaintext).length > 64 * 1024)
          throw new Error("NIP-44 plaintext is too large.");
        const current = requireSecret();
        const conversationKey = nip44.utils.getConversationKey(
          current,
          getPublicKey(current),
        );
        try {
          result = nip44.encrypt(request.plaintext, conversationKey);
        } finally {
          conversationKey.fill(0);
        }
        break;
      }
      case "nip44-encrypt-peer": {
        if (new TextEncoder().encode(request.plaintext).length > 64 * 1024)
          throw new Error("NIP-44 plaintext is too large.");
        const conversationKey = nip44.utils.getConversationKey(
          requireSecret(),
          requirePeerPubkey(request.peerPubkey),
        );
        try {
          result = nip44.encrypt(request.plaintext, conversationKey);
        } finally {
          conversationKey.fill(0);
        }
        break;
      }
      case "nip44-decrypt-peer": {
        if (request.ciphertext.length > 100 * 1024)
          throw new Error("NIP-44 ciphertext is too large.");
        const current = requireSecret();
        const conversationKey = nip44.utils.getConversationKey(
          current,
          requirePeerPubkey(request.peerPubkey),
        );
        try {
          result = nip44.decrypt(request.ciphertext, conversationKey);
        } finally {
          conversationKey.fill(0);
        }
        break;
      }
      case "nip44-memory-address": {
        if (!validMemorySlug(request.slug))
          throw new Error("The memory slug is invalid.");
        const conversationKey = nip44.utils.getConversationKey(
          requireSecret(),
          requirePeerPubkey(request.peerPubkey),
        );
        const hmacMaterial = new Uint8Array(conversationKey);
        try {
          const key = await crypto.subtle.importKey(
            "raw",
            hmacMaterial,
            { name: "HMAC", hash: "SHA-256" },
            false,
            ["sign"],
          );
          const prefix = new TextEncoder().encode(
            `agent-memory/v1/d-tag\0${request.slug}`,
          );
          result = toHex(await crypto.subtle.sign("HMAC", key, prefix));
        } finally {
          hmacMaterial.fill(0);
          conversationKey.fill(0);
        }
        break;
      }
      case "nip49-export": {
        const passwordLength = [...request.password].length;
        if (passwordLength < 12 || passwordLength > 256)
          throw new Error(
            "Use a backup password between 12 and 256 characters.",
          );
        result = encryptNip49(requireSecret(), request.password);
        break;
      }
      case "pairing-create": {
        requireSecret();
        resetPairingSession();
        pairingSession = await SourcePairingSession.create(
          request.pairingRelayUrl,
        );
        result = {
          pubkey: pairingSession.publicKey,
          qrUri: pairingSession.qrUri,
        };
        break;
      }
      case "pairing-sign-auth":
        result = requirePairingSession().signAuth(
          request.challenge,
          request.relayUrl,
        );
        break;
      case "pairing-handle-event": {
        const handled: PairingEventResult =
          await requirePairingSession().handleEvent(request.event);
        result = handled;
        if (
          handled.type === "complete" ||
          handled.type === "failed" ||
          handled.type === "aborted"
        ) {
          resetPairingSession();
        }
        break;
      }
      case "pairing-confirm":
        result = await requirePairingSession().confirm(
          requireSecret(),
          request.relayHttpUrl,
        );
        break;
      case "pairing-abort": {
        const session = requirePairingSession();
        result = { event: session.abort(request.reason) };
        resetPairingSession();
        break;
      }
      case "public-key":
        result = { pubkey: getPublicKey(requireSecret()) };
        break;
      case "lock":
        resetPairingSession();
        secretKey?.fill(0);
        secretKey = null;
        result = { locked: true };
        break;
    }
    self.postMessage({ id: request.id, ok: true, result });
  } catch (cause) {
    self.postMessage({
      id: request.id,
      ok: false,
      error: cause instanceof Error ? cause.message : "Owner signer failed.",
    });
  }
};
