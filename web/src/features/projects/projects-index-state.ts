export const PROJECTS_INDEX_STORAGE = {
  filter: "buzz.projects.filter",
  issueScope: "buzz.projects.issueScope",
  pullRequestScope: "buzz.projects.pullRequestScope",
  repositoryScope: "buzz.projects.repositoryScope",
  sort: "buzz.projects.sort",
  viewMode: "buzz.projects.viewMode",
} as const;

export function readProjectsIndexState<T extends string>(
  key: string,
  allowed: readonly T[],
  fallback: T,
) {
  try {
    const value = globalThis.localStorage.getItem(key) as T | null;
    return value && allowed.includes(value) ? value : fallback;
  } catch {
    return fallback;
  }
}

export function writeProjectsIndexState(key: string, value: string) {
  try {
    globalThis.localStorage.setItem(key, value);
  } catch {
    // The in-memory control remains usable when storage is unavailable.
  }
}

export function projectsRelativeTime(timestamp: number) {
  const seconds = Math.max(1, Math.floor(Date.now() / 1_000) - timestamp);
  if (seconds >= 7 * 86_400) {
    return new Date(timestamp * 1_000).toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
      ...(seconds >= 31_536_000 ? { year: "numeric" } : {}),
    });
  }
  const units = [
    [86_400, "day"],
    [3_600, "hour"],
    [60, "minute"],
    [1, "second"],
  ] as const;
  for (const [size, label] of units) {
    const count = Math.floor(seconds / size);
    if (count > 0) return `${count} ${label}${count === 1 ? "" : "s"} ago`;
  }
  return "just now";
}
