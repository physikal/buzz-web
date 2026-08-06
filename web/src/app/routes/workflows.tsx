import { createFileRoute } from "@tanstack/react-router";
import { lazy } from "react";

import { usePreviewFeatureWarning } from "@/shared/features";

const WorkflowsPage = lazy(async () => {
  const module = await import("@/features/workflows/ui/WorkflowsPage");
  return { default: module.WorkflowsPage };
});

export const Route = createFileRoute("/workflows")({
  component: WorkflowsRoute,
});

function WorkflowsRoute() {
  usePreviewFeatureWarning("workflows");
  return <WorkflowsPage />;
}
