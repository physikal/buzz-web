import {
  listProfiles,
  type UserProfile,
} from "@/features/channels/channel-api";
import { makeNip98AuthHeader } from "@/shared/lib/nip98";
import { queryEvents } from "@/shared/lib/nostr-client";
import { fetchRelaySelf } from "@/shared/lib/relay-info";
import { submitEvent } from "@/shared/lib/relay-events";
import { relayHttpBaseUrl, relayWsUrl } from "@/shared/lib/relay-url";
import { parsePubkey } from "@/shared/lib/pubkey";

export type CommunityRole = "owner" | "admin" | "member";

export type CommunityMember = {
  pubkey: string;
  role: CommunityRole;
  addedAt: number;
  profile: UserProfile | null;
};

export type CommunityMembership = {
  members: CommunityMember[];
  currentRole: CommunityRole | null;
};

function isRole(value: string | undefined): value is CommunityRole {
  return value === "owner" || value === "admin" || value === "member";
}

export function parseMemberPubkey(value: string): string | null {
  return parsePubkey(value);
}

export async function getCommunityMembership(
  currentPubkey: string,
): Promise<CommunityMembership> {
  const relaySelf = await fetchRelaySelf();
  const events = await queryEvents(
    relayWsUrl(),
    { kinds: [13534], authors: [relaySelf], limit: 1 },
    { requireNip07: true },
  );
  const snapshot = events
    .filter(
      (event) =>
        event.kind === 13534 && event.pubkey.toLowerCase() === relaySelf,
    )
    .sort((a, b) => b.created_at - a.created_at)[0];
  if (!snapshot) return { members: [], currentRole: null };

  const seen = new Set<string>();
  const rows = snapshot.tags.flatMap((tag) => {
    if ((tag[0] !== "member" && tag[0] !== "p") || !tag[1]) return [];
    const pubkey = tag[1].toLowerCase();
    if (!/^[0-9a-f]{64}$/.test(pubkey) || seen.has(pubkey)) return [];
    seen.add(pubkey);
    const roleValue = tag[0] === "member" ? tag[2] : tag[3];
    return [
      {
        pubkey,
        role: isRole(roleValue) ? roleValue : "member",
        addedAt: snapshot.created_at,
      },
    ];
  });
  const profiles = await listProfiles(rows.map((row) => row.pubkey));
  const profileByPubkey = new Map(
    profiles.map((profile) => [profile.pubkey, profile]),
  );
  const members = rows.map((row) => ({
    ...row,
    profile: profileByPubkey.get(row.pubkey) ?? null,
  }));
  return {
    members,
    currentRole:
      members.find((member) => member.pubkey === currentPubkey.toLowerCase())
        ?.role ?? null,
  };
}

async function submitMemberCommand(
  kind: 9030 | 9031 | 9032,
  pubkey: string,
  role?: CommunityRole,
): Promise<void> {
  const normalized = parseMemberPubkey(pubkey);
  if (!normalized)
    throw new Error("Enter a valid npub or 64-character public key.");
  await submitEvent({
    kind,
    content: "",
    tags: [["p", normalized], ...(role ? [["role", role]] : [])],
  });
}

export function addCommunityMember(pubkey: string, role: CommunityRole) {
  return submitMemberCommand(9030, pubkey, role);
}

export function removeCommunityMember(pubkey: string) {
  return submitMemberCommand(9031, pubkey);
}

export function changeCommunityMemberRole(pubkey: string, role: CommunityRole) {
  return submitMemberCommand(9032, pubkey, role);
}

export type MintedInvite = {
  url: string;
  expiresAt: number;
  usesRemaining: number | null;
};

export async function mintCommunityInvite(input: {
  ttlSecs: number;
  maxUses: number | null;
}): Promise<MintedInvite> {
  const url = `${relayHttpBaseUrl().replace(/\/+$/, "")}/api/invites`;
  const body = JSON.stringify({
    ttl_secs: input.ttlSecs,
    ...(input.maxUses === null ? {} : { max_uses: input.maxUses }),
  });
  const authorization = await makeNip98AuthHeader(url, "POST", {
    body,
    requireNip07: true,
  });
  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: authorization,
      "Content-Type": "application/json",
    },
    body,
    signal: AbortSignal.timeout(15_000),
  });
  const payload = (await response.json().catch(() => ({}))) as Record<
    string,
    unknown
  >;
  if (!response.ok) {
    throw new Error(
      typeof payload.error === "string"
        ? payload.error
        : `HTTP ${response.status}`,
    );
  }
  return {
    url: String(payload.url),
    expiresAt: Number(payload.expires_at),
    usesRemaining:
      payload.uses_remaining == null ? null : Number(payload.uses_remaining),
  };
}
