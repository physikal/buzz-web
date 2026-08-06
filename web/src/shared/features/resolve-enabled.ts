export function resolveEnabled(
  featureId: string,
  overrides: Record<string, boolean>,
  defaultEnabled = false,
): boolean {
  return overrides[featureId] ?? defaultEnabled;
}
