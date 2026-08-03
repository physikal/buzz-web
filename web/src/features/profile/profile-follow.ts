import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { queryEvents } from "@/shared/lib/nostr-client";
import { submitEvent } from "@/shared/lib/relay-events";
import { relayWsUrl } from "@/shared/lib/relay-url";

const MAX_CONTACTS = 10_000;
const PUBKEY_PATTERN = /^[0-9a-f]{64}$/;

export type ProfileFollows = {
  contacts: Set<string>;
  tags: string[][];
};

export const profileFollowsQueryKey = (ownerPubkey: string) =>
  ["profile-follows", ownerPubkey] as const;

function normalizedPubkey(value: string, label: string) {
  const normalized = value.trim().toLowerCase();
  if (!PUBKEY_PATTERN.test(normalized))
    throw new Error(`Choose a valid ${label}.`);
  return normalized;
}

export async function getProfileFollows(
  ownerPubkey: string,
): Promise<ProfileFollows> {
  const owner = normalizedPubkey(ownerPubkey, "identity");
  const events = await queryEvents(
    relayWsUrl(),
    { kinds: [3], authors: [owner], limit: 1 },
    { requireNip07: true },
  );
  const latest = events
    .filter((event) => event.kind === 3 && event.pubkey === owner)
    .sort(
      (left, right) =>
        right.created_at - left.created_at || right.id.localeCompare(left.id),
    )[0];
  const tags: string[][] = [];
  const seen = new Set<string>();
  for (const tag of latest?.tags ?? []) {
    const pubkey = tag[1]?.toLowerCase();
    if (
      tag[0] !== "p" ||
      !pubkey ||
      !PUBKEY_PATTERN.test(pubkey) ||
      seen.has(pubkey)
    )
      continue;
    seen.add(pubkey);
    tags.push(["p", pubkey, ...tag.slice(2, 4)]);
    if (tags.length === MAX_CONTACTS) break;
  }
  return {
    contacts: new Set(tags.map((tag) => tag[1])),
    tags,
  };
}

export async function setProfileFollowing(
  ownerPubkey: string,
  targetPubkey: string,
  following: boolean,
): Promise<ProfileFollows> {
  const target = normalizedPubkey(targetPubkey, "profile");
  const current = await getProfileFollows(ownerPubkey);
  const tags = current.tags.filter((tag) => tag[1] !== target);
  if (following) {
    if (tags.length >= MAX_CONTACTS)
      throw new Error(`Contact list is limited to ${MAX_CONTACTS} profiles.`);
    tags.push(["p", target]);
  }
  await submitEvent({ kind: 3, content: "", tags });
  return {
    contacts: new Set(tags.map((tag) => tag[1])),
    tags,
  };
}

export function useProfileFollow(
  ownerPubkey: string,
  targetPubkey: string | null,
) {
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: profileFollowsQueryKey(ownerPubkey),
    queryFn: () => getProfileFollows(ownerPubkey),
    staleTime: 60_000,
  });
  const following = Boolean(
    targetPubkey && query.data?.contacts.has(targetPubkey.toLowerCase()),
  );
  const mutation = useMutation({
    mutationFn: ({ pubkey, value }: { pubkey: string; value: boolean }) =>
      setProfileFollowing(ownerPubkey, pubkey, value),
    onSuccess: async (result) => {
      queryClient.setQueryData(profileFollowsQueryKey(ownerPubkey), result);
      await queryClient.invalidateQueries({
        queryKey: ["pulse", ownerPubkey],
      });
    },
    onError: (error) =>
      toast.error("Could not update follow", { description: error.message }),
  });
  return {
    following,
    pending: query.isPending || mutation.isPending,
    toggle: () => {
      if (!targetPubkey) return;
      mutation.mutate({ pubkey: targetPubkey, value: !following });
    },
  };
}
