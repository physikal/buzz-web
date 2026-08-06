import manifestJson from "../../../../preview-features.json";
import type { FeatureDefinition, FeaturesManifest } from "./types";

const EMPTY_MANIFEST: FeaturesManifest = { version: 1, features: [] };
const PLATFORMS = new Set(["desktop", "mobile"]);

function isFeatureDefinition(value: unknown): value is FeatureDefinition {
  if (!value || typeof value !== "object") return false;
  const feature = value as Record<string, unknown>;
  return (
    typeof feature.id === "string" &&
    feature.id.length > 0 &&
    typeof feature.name === "string" &&
    feature.name.length > 0 &&
    typeof feature.description === "string" &&
    (feature.defaultEnabled === undefined ||
      typeof feature.defaultEnabled === "boolean") &&
    (feature.platforms === undefined ||
      (Array.isArray(feature.platforms) &&
        feature.platforms.every(
          (platform) => typeof platform === "string" && PLATFORMS.has(platform),
        )))
  );
}

function loadManifest(): FeaturesManifest {
  if (
    !manifestJson ||
    typeof manifestJson !== "object" ||
    !Number.isInteger(manifestJson.version) ||
    manifestJson.version < 0 ||
    !Array.isArray(manifestJson.features) ||
    !manifestJson.features.every(isFeatureDefinition)
  ) {
    console.warn(
      "[FeatureFlags] preview-features.json failed validation; falling back to an empty manifest.",
    );
    return EMPTY_MANIFEST;
  }
  return manifestJson as FeaturesManifest;
}

export const manifest = loadManifest();
export const allFeatures = manifest.features;
export const desktopFeatures = manifest.features.filter(
  (feature) =>
    (!feature.platforms || feature.platforms.includes("desktop")) &&
    feature.id !== "agentManagedProfiles",
);

export function getFeature(id: string): FeatureDefinition | undefined {
  return manifest.features.find((feature) => feature.id === id);
}
