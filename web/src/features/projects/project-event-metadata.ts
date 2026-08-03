import type { NostrEvent } from "@/shared/lib/nostr-client";

export function projectImetaTags(event: NostrEvent) {
  return event.tags
    .filter((item) => item[0] === "imeta")
    .slice(0, 32)
    .map((item) => item.slice(0, 32).filter((value) => value.length <= 4_096));
}
