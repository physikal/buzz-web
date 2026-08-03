import { useSyncExternalStore } from "react";

export type ThreadViewMode = "focus" | "split";

const STORAGE_KEY = "buzz.channels.threadViewMode";
const listeners = new Set<() => void>();

function readStored(): ThreadViewMode {
  try {
    return globalThis.localStorage?.getItem(STORAGE_KEY) === "focus"
      ? "focus"
      : "split";
  } catch {
    return "split";
  }
}

let current = readStored();

export function setThreadViewMode(mode: ThreadViewMode) {
  current = mode;
  try {
    globalThis.localStorage?.setItem(STORAGE_KEY, mode);
  } catch {
    // The in-memory preference still applies when storage is unavailable.
  }
  for (const listener of listeners) listener();
}

export function useThreadViewMode() {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => current,
    () => "split" as const,
  );
}
