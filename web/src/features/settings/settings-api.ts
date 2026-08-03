import { listProfiles, uploadMedia } from "@/features/channels/channel-api";
import { mergeOwnerProfileMetadata } from "@/features/profile/profile-metadata";
import { submitEvent } from "@/shared/lib/relay-events";
import { queryEvents } from "@/shared/lib/nostr-client";
import { relayWsUrl } from "@/shared/lib/relay-url";

export type ProfileInput = {
  displayName: string;
  about: string;
  avatarUrl: string;
  nip05Handle: string;
};

export type UserStatus = {
  text: string;
  emoji: string;
  updatedAt: number;
};

export async function getUserStatus(
  pubkey: string,
): Promise<UserStatus | null> {
  const events = await queryEvents(
    relayWsUrl(),
    { kinds: [30315], authors: [pubkey], "#d": ["general"], limit: 20 },
    { requireNip07: true },
  );
  const latest = events
    .filter(
      (event) =>
        event.pubkey === pubkey &&
        event.content.length <= 160 &&
        event.tags.filter((tag) => tag[0] === "d" && tag[1] === "general")
          .length === 1,
    )
    .sort((a, b) => b.created_at - a.created_at || a.id.localeCompare(b.id))[0];
  if (!latest) return null;
  const emoji = latest.tags.find(
    (tag) => tag.length === 2 && tag[0] === "emoji" && tag[1].length <= 64,
  )?.[1];
  if (!latest.content && !emoji) return null;
  return {
    text: latest.content,
    emoji: emoji ?? "",
    updatedAt: latest.created_at,
  };
}

export async function setUserStatus(text: string, emoji: string) {
  const normalizedText = text.trim();
  const normalizedEmoji = emoji.trim();
  if (normalizedText.length > 160)
    throw new Error("Status text is limited to 160 characters.");
  if (normalizedEmoji.length > 64)
    throw new Error("Status emoji is limited to 64 characters.");
  await submitEvent({
    kind: 30315,
    tags: [
      ["d", "general"],
      ...(normalizedEmoji ? [["emoji", normalizedEmoji]] : []),
    ],
    content: normalizedText,
  });
}

export async function getOwnerProfile(pubkey: string): Promise<ProfileInput> {
  const profile = (await listProfiles([pubkey]))[0];
  return {
    displayName: profile?.displayName ?? "",
    about: profile?.about ?? "",
    avatarUrl: profile?.avatarUrl ?? "",
    nip05Handle: profile?.nip05Handle ?? "",
  };
}

export async function updateOwnerProfile(
  ownerPubkey: string,
  input: ProfileInput,
): Promise<void> {
  if (!/^[0-9a-f]{64}$/i.test(ownerPubkey)) {
    throw new Error("Owner public key is invalid.");
  }
  if (!input.displayName.trim() || input.displayName.trim().length > 200) {
    throw new Error("Display name must be between 1 and 200 characters.");
  }
  if (input.about.trim().length > 5_000) {
    throw new Error("Profile description is limited to 5,000 characters.");
  }
  if (input.avatarUrl.trim().length > 8_192) {
    throw new Error("Avatar URL is too long.");
  }
  const events = await queryEvents(
    relayWsUrl(),
    { kinds: [0], authors: [ownerPubkey], limit: 20 },
    { requireNip07: true },
  );
  const current = events.sort(
    (left, right) =>
      right.created_at - left.created_at || right.id.localeCompare(left.id),
  )[0];
  await submitEvent({
    kind: 0,
    tags: [],
    content: JSON.stringify(
      mergeOwnerProfileMetadata(current?.content ?? "{}", input),
    ),
  });
}

export async function uploadAvatar(file: File): Promise<string> {
  if (!file.type.startsWith("image/")) throw new Error("Choose an image file.");
  return (await uploadMedia(file)).url;
}
