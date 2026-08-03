import type { CustomEmoji } from "@/features/settings/custom-emoji-api";

const SHORTCODE_SCAN = /:([a-z0-9_-]+):/giu;

export function buildCustomEmojiTags(
  content: string,
  customEmoji: readonly CustomEmoji[],
): string[][] {
  if (!customEmoji.length) return [];
  const urlByShortcode = new Map(
    customEmoji.map((emoji) => [emoji.shortcode, emoji.url]),
  );
  const emitted = new Set<string>();
  const tags: string[][] = [];
  SHORTCODE_SCAN.lastIndex = 0;
  for (let match = SHORTCODE_SCAN.exec(content); match; ) {
    const shortcode = match[1].toLowerCase();
    const url = urlByShortcode.get(shortcode);
    if (url && !emitted.has(shortcode)) {
      emitted.add(shortcode);
      tags.push(["emoji", shortcode, url]);
    }
    match = SHORTCODE_SCAN.exec(content);
  }
  return tags;
}
