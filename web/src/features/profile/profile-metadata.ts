export type EditableProfileFields = {
  displayName: string;
  about: string;
  avatarUrl: string;
};

function metadataRecord(content: string): Record<string, unknown> {
  try {
    const value = JSON.parse(content) as unknown;
    return value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

export function mergeOwnerProfileMetadata(
  currentContent: string,
  input: EditableProfileFields,
) {
  const current = metadataRecord(currentContent);
  const displayName = input.displayName.trim();
  return {
    ...current,
    display_name: displayName,
    name:
      typeof current.name === "string" && current.name.trim()
        ? current.name
        : displayName,
    about: input.about.trim(),
    picture: input.avatarUrl.trim(),
  };
}
