export const KIND_AGENT_OBSERVER_FRAME = 24_200;
export const KIND_AGENT_TURN_METRIC = 44_200;

export type KindGroup = {
  label: string;
  items: ReadonlyArray<{ kind: number; label: string }>;
};

export const KIND_GROUPS: ReadonlyArray<KindGroup> = [
  {
    label: "Messages & posts",
    items: [
      { kind: 9, label: "Stream messages (kind 9)" },
      { kind: 40_002, label: "Stream messages v2 (kind 40002)" },
      { kind: 45_001, label: "Forum posts (kind 45001)" },
      { kind: 45_003, label: "Forum comments (kind 45003)" },
      { kind: 40_008, label: "Message diffs (kind 40008)" },
    ],
  },
  {
    label: "Reactions, edits & deletions",
    items: [
      { kind: 5, label: "Event deletions (kind 5)" },
      { kind: 7, label: "Reactions (kind 7)" },
      { kind: 9_005, label: "Buzz-native deletions (kind 9005)" },
      { kind: 40_003, label: "Message edits (kind 40003)" },
    ],
  },
  {
    label: "Huddle events",
    items: [
      { kind: 48_100, label: "Huddle started" },
      { kind: 48_101, label: "Participant joined" },
      { kind: 48_102, label: "Participant left" },
      { kind: 48_103, label: "Huddle ended" },
    ],
  },
  {
    label: "System messages",
    items: [{ kind: 40_099, label: "System messages (kind 40099)" }],
  },
];

const GROUPED_KINDS = new Set(
  KIND_GROUPS.flatMap((group) => group.items.map((item) => item.kind)),
);

export function parseCustomKinds(raw: string) {
  const valid: number[] = [];
  const invalid: string[] = [];
  const seen = new Set<number>();
  for (const token of raw.split(/[\s,]+/u).filter(Boolean)) {
    if (!/^\d+$/u.test(token)) {
      invalid.push(token);
      continue;
    }
    const kind = Number.parseInt(token, 10);
    if (!Number.isSafeInteger(kind) || kind < 0 || kind > 65_535) {
      invalid.push(token);
      continue;
    }
    if (GROUPED_KINDS.has(kind) || seen.has(kind)) continue;
    seen.add(kind);
    valid.push(kind);
  }
  return { invalid, valid };
}

export function toggleKind(kind: number, selected: ReadonlySet<number>) {
  const next = new Set(selected);
  if (next.has(kind)) next.delete(kind);
  else next.add(kind);
  return next;
}

export function isGroupFullyChecked(
  group: KindGroup,
  selected: ReadonlySet<number>,
) {
  return group.items.every((item) => selected.has(item.kind));
}

export function isGroupIndeterminate(
  group: KindGroup,
  selected: ReadonlySet<number>,
) {
  const count = group.items.filter((item) => selected.has(item.kind)).length;
  return count > 0 && count < group.items.length;
}

export function toggleGroup(group: KindGroup, selected: ReadonlySet<number>) {
  const next = new Set(selected);
  const remove = isGroupFullyChecked(group, selected);
  for (const item of group.items) {
    if (remove) next.delete(item.kind);
    else next.add(item.kind);
  }
  return next;
}

export function selectedArchiveKinds(
  selected: ReadonlySet<number>,
  custom: ReadonlyArray<number>,
) {
  return [...new Set([...selected, ...custom])].sort(
    (left, right) => left - right,
  );
}
