import type { ReactNode } from "react";
import { useFeatureEnabled } from "./use-feature-enabled";

export function FeatureGate({
  feature,
  children,
  fallback = null,
}: {
  feature: string;
  children: ReactNode;
  fallback?: ReactNode;
}): ReactNode {
  return useFeatureEnabled(feature) ? children : fallback;
}
