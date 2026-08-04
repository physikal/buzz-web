import type { NostrEvent } from "@/shared/lib/nostr-client";
import { queryEvents, validNostrEvent } from "@/shared/lib/nostr-client";
import { fetchRelaySelf } from "@/shared/lib/relay-info";
import { submitEvent } from "@/shared/lib/relay-events";
import { relayWsUrl } from "@/shared/lib/relay-url";

export type ArchivedIdentitiesSnapshot = {
  archived: string[];
};

const PUBKEY_PATTERN = /^[0-9a-f]{64}$/;

export function archivedPubkeysFromSnapshot(
  snapshot: NostrEvent | undefined,
  relaySelf: string,
): string[] {
  const reverifiedSnapshot = snapshot
    ? {
        id: snapshot.id,
        pubkey: snapshot.pubkey,
        created_at: snapshot.created_at,
        kind: snapshot.kind,
        tags: snapshot.tags.map((tag) => [...tag]),
        content: snapshot.content,
        sig: snapshot.sig,
      }
    : undefined;
  if (
    snapshot?.kind !== 13535 ||
    !validNostrEvent(reverifiedSnapshot) ||
    snapshot.tags.filter((tag) => tag.length === 1 && tag[0] === "-").length !==
      1 ||
    snapshot.pubkey.toLowerCase() !== relaySelf.toLowerCase()
  )
    return [];
  const archived = new Set<string>();
  for (const tag of snapshot.tags) {
    const pubkey = tag[0] === "p" ? tag[1]?.toLowerCase() : undefined;
    if (pubkey && PUBKEY_PATTERN.test(pubkey)) archived.add(pubkey);
  }
  return [...archived];
}

export async function listArchivedIdentities(): Promise<ArchivedIdentitiesSnapshot> {
  let relaySelf: string;
  try {
    relaySelf = await fetchRelaySelf();
  } catch {
    // A relay without a stable signing identity cannot assert archive state.
    return { archived: [] };
  }
  const events = await queryEvents(
    relayWsUrl(),
    { kinds: [13535], authors: [relaySelf], limit: 1 },
    { requireNip07: true },
  );
  const snapshot = events
    .filter(
      (event) =>
        event.kind === 13535 &&
        event.pubkey.toLowerCase() === relaySelf.toLowerCase(),
    )
    .sort(
      (left, right) =>
        right.created_at - left.created_at || left.id.localeCompare(right.id),
    )[0];
  return { archived: archivedPubkeysFromSnapshot(snapshot, relaySelf) };
}

async function submitIdentityArchiveRequest(
  kind: 9035 | 9036,
  targetPubkey: string,
): Promise<void> {
  const normalized = targetPubkey.trim().toLowerCase();
  if (!PUBKEY_PATTERN.test(normalized))
    throw new Error("The identity public key is invalid.");
  await submitEvent({
    kind,
    content: "",
    tags: [["-"], ["p", normalized]],
  });
}

export function archiveIdentity(targetPubkey: string): Promise<void> {
  return submitIdentityArchiveRequest(9035, targetPubkey);
}

export function unarchiveIdentity(targetPubkey: string): Promise<void> {
  return submitIdentityArchiveRequest(9036, targetPubkey);
}
