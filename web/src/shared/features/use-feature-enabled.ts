import { useCallback, useEffect, useSyncExternalStore } from "react";
import { toast } from "sonner";
import { getFeature } from "./manifest";
import { resolveEnabled } from "./resolve-enabled";
import { getOverrides, OVERRIDES_KEY, setOverride } from "./store";

type Listener = () => void;
const listeners = new Set<Listener>();
let cachedRaw: string | null = null;
let cachedParsed: Record<string, boolean> | null = null;
const emptyOverrides = Object.freeze({}) as Record<string, boolean>;

function emitChange(): void {
  cachedRaw = null;
  cachedParsed = null;
  for (const listener of listeners) listener();
}

function subscribe(listener: Listener): () => void {
  listeners.add(listener);
  const handleStorage = (event: StorageEvent) => {
    if (event.key === OVERRIDES_KEY) emitChange();
  };
  window.addEventListener("storage", handleStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", handleStorage);
  };
}

function getSnapshot(): string {
  const raw = JSON.stringify(getOverrides());
  if (raw !== cachedRaw) {
    cachedRaw = raw;
    cachedParsed = JSON.parse(raw) as Record<string, boolean>;
  }
  return raw;
}

function getParsedSnapshot(): Record<string, boolean> {
  getSnapshot();
  return cachedParsed ?? emptyOverrides;
}

export function useFeatureSnapshot(): Record<string, boolean> {
  useSyncExternalStore(subscribe, getSnapshot, () => "{}");
  return getParsedSnapshot();
}

export function useFeatureEnabled(featureId: string): boolean {
  const overrides = useFeatureSnapshot();
  const feature = getFeature(featureId);
  if (!feature) return true;
  return resolveEnabled(featureId, overrides, feature.defaultEnabled);
}

export function useFeatureToggle(
  featureId: string,
): [boolean, (enabled: boolean) => void] {
  const enabled = useFeatureEnabled(featureId);
  const toggle = useCallback(
    (value: boolean) => {
      setOverride(featureId, value);
      emitChange();
    },
    [featureId],
  );
  return [enabled, toggle];
}

export function usePreviewFeatureWarning(featureId: string): void {
  const enabled = useFeatureEnabled(featureId);
  const feature = getFeature(featureId);
  useEffect(() => {
    if (!feature || enabled) return;
    toast.warning(
      `${feature.name} is a preview feature. Enable it in Settings → Experiments to surface it in your sidebar.`,
    );
  }, [feature, enabled]);
}

export { resolveEnabled } from "./resolve-enabled";
