export type FeaturePlatform = "desktop" | "mobile";

export interface FeatureDefinition {
  id: string;
  name: string;
  description: string;
  defaultEnabled?: boolean;
  platforms?: FeaturePlatform[];
}

export interface FeaturesManifest {
  version: number;
  features: FeatureDefinition[];
}
