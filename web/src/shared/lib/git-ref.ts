const REF_CHARACTERS = /^[a-z0-9/_.-]+$/iu;

function normalizeGitRefLabel(value: string) {
  const ref = value.trim();
  if (
    !ref ||
    ref.length > 240 ||
    ref.startsWith("-") ||
    ref.startsWith("/") ||
    ref.endsWith("/") ||
    ref.endsWith(".") ||
    ref.endsWith(".lock") ||
    ref.includes("..") ||
    ref.includes("//") ||
    !REF_CHARACTERS.test(ref) ||
    ref.split("/").some((component) => component.startsWith("."))
  ) {
    return null;
  }
  return ref;
}

export function normalizeGitBranchName(value: string): string | null {
  const trimmed = value.trim();
  if (trimmed.startsWith("refs/") && !trimmed.startsWith("refs/heads/")) {
    return null;
  }
  return normalizeGitRefLabel(trimmed.replace(/^refs\/heads\//u, ""));
}

export function normalizeGitTagName(value: string): string | null {
  const trimmed = value.trim();
  if (trimmed.startsWith("refs/") && !trimmed.startsWith("refs/tags/")) {
    return null;
  }
  return normalizeGitRefLabel(trimmed.replace(/^refs\/tags\//u, ""));
}
