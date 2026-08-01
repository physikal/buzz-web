/**
 * The ONE canonical compact display form for a pubkey: `abcd1234…wxyz`.
 * Mirrors desktop's `@/shared/lib/pubkey`. A truncated pubkey is a
 * recognition aid, never an identity proof — security decisions need the
 * full npub.
 */
export function truncatePubkey(pubkey: string): string {
  if (pubkey.length <= 12) {
    return pubkey;
  }
  return `${pubkey.slice(0, 8)}…${pubkey.slice(-4)}`;
}

/** Parse a hex public key or NIP-19 npub into canonical lowercase hex. */
export function parsePubkey(value: string): string | null {
  const trimmed = value.trim().toLowerCase();
  if (/^[0-9a-f]{64}$/.test(trimmed)) return trimmed;
  try {
    const decoded = nip19.decode(trimmed);
    if (decoded.type !== "npub") return null;
    return typeof decoded.data === "string"
      ? decoded.data.toLowerCase()
      : Array.from(decoded.data as Uint8Array)
          .map((byte) => byte.toString(16).padStart(2, "0"))
          .join("");
  } catch {
    return null;
  }
}
import { nip19 } from "nostr-tools";
