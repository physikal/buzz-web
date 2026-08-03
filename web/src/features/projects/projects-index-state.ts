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
