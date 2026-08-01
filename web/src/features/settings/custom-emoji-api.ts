import { uploadMedia } from "@/features/channels/channel-api";
import { queryEvents, type NostrEvent } from "@/shared/lib/nostr-client";
import { submitEvent } from "@/shared/lib/relay-events";
import { relayWsUrl } from "@/shared/lib/relay-url";

export type CustomEmoji = { shortcode: string; url: string };

const EMOJI_SET_KIND = 30030;
const EMOJI_SET_TAG = "buzz:custom-emoji";
const SHORTCODE = /^[a-z0-9_-]+$/;

export function normalizeShortcode(value: string): string | null {
  const normalized = value
    .trim()
    .replace(/^:+|:+$/g, "")
    .toLowerCase();
  return SHORTCODE.test(normalized) ? normalized : null;
}

export function suggestShortcode(filename: string): string | null {
  return normalizeShortcode(
    filename
      .replace(/^.*[/\\]/, "")
      .replace(/\.[^.]*$/, "")
      .toLowerCase()
      .replace(/[^a-z0-9_-]+/g, "_")
      .replace(/_+/g, "_")
      .replace(/^[_-]+|[_-]+$/g, ""),
  );
}

function emojiFromEvent(event: NostrEvent | undefined): CustomEmoji[] {
  const seen = new Set<string>();
  return (event?.tags ?? []).flatMap((tag) => {
    if (tag[0] !== "emoji" || !tag[1] || !tag[2]) return [];
    const shortcode = normalizeShortcode(tag[1]);
    if (!shortcode || seen.has(shortcode)) return [];
    seen.add(shortcode);
    return [{ shortcode, url: tag[2] }];
  });
}

function unionEmoji(events: NostrEvent[]): CustomEmoji[] {
  const palette = new Map<string, { url: string; createdAt: number }>();
  for (const event of events) {
    for (const emoji of emojiFromEvent(event)) {
      const current = palette.get(emoji.shortcode);
      if (
        !current ||
        event.created_at > current.createdAt ||
        (event.created_at === current.createdAt && emoji.url < current.url)
      ) {
        palette.set(emoji.shortcode, {
          url: emoji.url,
          createdAt: event.created_at,
        });
      }
    }
  }
  return [...palette.entries()]
    .map(([shortcode, value]) => ({ shortcode, url: value.url }))
    .sort((left, right) => left.shortcode.localeCompare(right.shortcode));
}

async function emojiEvents(ownerPubkey?: string): Promise<NostrEvent[]> {
  return queryEvents(
    relayWsUrl(),
    {
      kinds: [EMOJI_SET_KIND],
      "#d": [EMOJI_SET_TAG],
      ...(ownerPubkey ? { authors: [ownerPubkey] } : {}),
      limit: ownerPubkey ? 1 : 500,
    },
    { requireNip07: true },
  );
}

export async function getCustomEmoji(ownerPubkey: string): Promise<{
  own: CustomEmoji[];
  community: CustomEmoji[];
}> {
  const communityEvents = await emojiEvents();
  const ownEvent = communityEvents
    .filter((event) => event.pubkey === ownerPubkey)
    .sort((a, b) => b.created_at - a.created_at)[0];
  return {
    own: emojiFromEvent(ownEvent),
    community: unionEmoji(communityEvents),
  };
}

async function publishOwnEmoji(emoji: CustomEmoji[]): Promise<void> {
  await submitEvent({
    kind: EMOJI_SET_KIND,
    content: "",
    tags: [
      ["d", EMOJI_SET_TAG],
      ...emoji.map((item) => ["emoji", item.shortcode, item.url]),
    ],
  });
}

export async function saveCustomEmoji(
  ownerPubkey: string,
  shortcode: string,
  url: string,
): Promise<string> {
  const normalized = normalizeShortcode(shortcode);
  if (!normalized)
    throw new Error("Use only letters, numbers, hyphen, or underscore.");
  const events = await emojiEvents(ownerPubkey);
  const own = emojiFromEvent(
    events.sort((a, b) => b.created_at - a.created_at)[0],
  );
  await publishOwnEmoji([
    ...own.filter((emoji) => emoji.shortcode !== normalized),
    { shortcode: normalized, url },
  ]);
  return normalized;
}

export async function removeCustomEmoji(
  ownerPubkey: string,
  shortcode: string,
): Promise<void> {
  const normalized = normalizeShortcode(shortcode);
  if (!normalized) return;
  const events = await emojiEvents(ownerPubkey);
  const own = emojiFromEvent(
    events.sort((a, b) => b.created_at - a.created_at)[0],
  );
  await publishOwnEmoji(own.filter((emoji) => emoji.shortcode !== normalized));
}

export async function uploadEmoji(
  file: File,
): Promise<{ url: string; name: string }> {
  if (!file.type.startsWith("image/")) throw new Error("Choose an image file.");
  const result = await uploadMedia(file);
  return { url: result.url, name: suggestShortcode(file.name) ?? "" };
}
