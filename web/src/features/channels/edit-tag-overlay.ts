/**
 * Apply the desktop edit contract: an edit owns the complete attachment set,
 * while routing and thread metadata remain authoritative on the original.
 */
export function applyEditTagOverlay(
  originalTags: string[][],
  editTags?: string[][],
) {
  if (!editTags) return originalTags;
  const editEmoji = editTags.filter((tag) => tag[0] === "emoji");
  const base = originalTags.filter((tag) =>
    editEmoji.length
      ? tag[0] !== "imeta" && tag[0] !== "emoji"
      : tag[0] !== "imeta",
  );
  return [
    ...base,
    ...editTags.filter((tag) => tag[0] === "imeta"),
    ...editEmoji,
  ];
}
