import { schnorr } from "@noble/curves/secp256k1.js";

import type { NostrEvent } from "@/shared/lib/nostr-client";

const PUBKEY_PATTERN = /^[0-9a-f]{64}$/u;
const SIGNATURE_PATTERN = /^[0-9a-f]{128}$/u;

function hexBytes(value: string): Uint8Array {
  const bytes = new Uint8Array(value.length / 2);
  for (let index = 0; index < value.length; index += 2) {
    bytes[index / 2] = Number.parseInt(value.slice(index, index + 2), 16);
  }
  return bytes;
}

function validCanonicalInteger(value: string, maximum: number): boolean {
  if (!/^(?:0|[1-9][0-9]*)$/u.test(value)) return false;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed <= maximum;
}

function validConditions(conditions: string): boolean {
  if (!conditions) return true;
  if (/\s/u.test(conditions)) return false;
  return conditions.split("&").every((clause) => {
    if (clause.startsWith("kind=")) {
      return validCanonicalInteger(clause.slice(5), 65_535);
    }
    if (clause.startsWith("created_at<") || clause.startsWith("created_at>")) {
      return validCanonicalInteger(clause.slice(11), 4_294_967_295);
    }
    return false;
  });
}

/** Verify the NIP-OA owner attestation published on an agent's kind-0 event. */
export async function verifiedAgentOwnerPubkey(
  event: NostrEvent,
): Promise<string | null> {
  if (!PUBKEY_PATTERN.test(event.pubkey)) return null;
  for (const tag of event.tags) {
    if (tag[0] !== "auth" || tag.length !== 4) continue;
    const ownerPubkey = tag[1] ?? "";
    const conditions = tag[2] ?? "";
    const signature = tag[3] ?? "";
    if (
      !PUBKEY_PATTERN.test(ownerPubkey) ||
      ownerPubkey === event.pubkey ||
      !SIGNATURE_PATTERN.test(signature) ||
      !validConditions(conditions)
    ) {
      continue;
    }
    const preimage = new TextEncoder().encode(
      `nostr:agent-auth:${event.pubkey}:${conditions}`,
    );
    const digest = new Uint8Array(
      await crypto.subtle.digest("SHA-256", preimage),
    );
    if (schnorr.verify(hexBytes(signature), digest, hexBytes(ownerPubkey))) {
      return ownerPubkey;
    }
  }
  return null;
}
