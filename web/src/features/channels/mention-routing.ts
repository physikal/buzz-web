import type { DraftMentionRef } from "./draft-store";
import type { DmCandidate } from "./dm-candidates";

export type MentionQuery = {
  query: string;
  start: number;
};

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function hasNamedMention(content: string, displayName: string) {
  const name = displayName.trim();
  if (!name) return false;
  return new RegExp(
    `(^|[^\\p{L}\\p{N}_])@${escapeRegExp(name)}(?=$|[^\\p{L}\\p{N}_])`,
    "iu",
  ).test(content);
}

export function findMentionQuery(
  content: string,
  selection: number,
): MentionQuery | null {
  const prefix = content.slice(0, selection);
  const match = /(^|\s)@([^@\n]{0,200})$/u.exec(prefix);
  if (!match) return null;
  return {
    query: match[2],
    start: match.index + match[1].length,
  };
}

export function reconcileMentionRefs(
  content: string,
  current: DraftMentionRef[],
  selected?: DmCandidate,
) {
  const selectedName = selected?.displayName.trim().toLowerCase();
  const retained = current.filter(
    (ref) =>
      hasNamedMention(content, ref.displayName) &&
      (!selectedName || ref.displayName.trim().toLowerCase() !== selectedName),
  );
  if (!selected || !hasNamedMention(content, selected.displayName)) {
    return retained;
  }
  return [
    ...retained,
    {
      displayName: selected.displayName.trim(),
      pubkey: selected.pubkey,
      isAgent: selected.isAgent,
    },
  ];
}

export function resolveMentionPubkeys(
  content: string,
  refs: DraftMentionRef[],
  candidates: DmCandidate[],
) {
  const selectedNames = new Set(
    refs.map((ref) => ref.displayName.trim().toLowerCase()),
  );
  const pubkeys = refs
    .filter((ref) => hasNamedMention(content, ref.displayName))
    .map((ref) => ref.pubkey);

  for (const candidate of candidates) {
    if (selectedNames.has(candidate.displayName.trim().toLowerCase())) continue;
    if (hasNamedMention(content, candidate.displayName)) {
      pubkeys.push(candidate.pubkey);
    }
  }
  return [...new Set(pubkeys)];
}
