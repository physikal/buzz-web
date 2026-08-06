import { createFileRoute } from "@tanstack/react-router";
import { lazy } from "react";

import { usePreviewFeatureWarning } from "@/shared/features";

const WorkflowsPage = lazy(async () => {
  const module = await import("@/features/workflows/ui/WorkflowsPage");
  return { default: module.WorkflowsPage };
});

export const Route = createFileRoute("/workflows/$workflowId")({
  component: WorkflowDetailRoute,
});

function WorkflowDetailRoute() {
  usePreviewFeatureWarning("workflows");
  const { workflowId } = Route.useParams();
  return <WorkflowsPage initialWorkflowId={workflowId} />;
}
