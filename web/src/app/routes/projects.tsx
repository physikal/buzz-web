import { createFileRoute } from "@tanstack/react-router";
import { lazy } from "react";

import { usePreviewFeatureWarning } from "@/shared/features";

const ProjectsPage = lazy(async () => {
  const module = await import("@/features/projects/ui/ProjectsPage");
  return { default: module.ProjectsPage };
});

export const Route = createFileRoute("/projects")({
  component: ProjectsRoute,
});

function ProjectsRoute() {
  usePreviewFeatureWarning("projects");
  return <ProjectsPage />;
}
