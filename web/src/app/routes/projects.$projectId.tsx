import { createFileRoute } from "@tanstack/react-router";

import { ProjectsPage } from "@/features/projects/ui/ProjectsPage";

export const Route = createFileRoute("/projects/$projectId")({
  component: ProjectRoute,
});

function ProjectRoute() {
  const { projectId } = Route.useParams();
  return <ProjectsPage projectId={projectId} />;
}
