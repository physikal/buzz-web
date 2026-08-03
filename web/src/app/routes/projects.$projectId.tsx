import { createFileRoute } from "@tanstack/react-router";
import { lazy } from "react";

const ProjectsPage = lazy(async () => {
  const module = await import("@/features/projects/ui/ProjectsPage");
  return { default: module.ProjectsPage };
});

export const Route = createFileRoute("/projects/$projectId")({
  validateSearch: (search: Record<string, unknown>) => ({
    ...(typeof search.issue === "string" ? { issue: search.issue } : {}),
    ...(typeof search.pullRequest === "string"
      ? { pullRequest: search.pullRequest }
      : {}),
  }),
  component: ProjectRoute,
});

function ProjectRoute() {
  const { projectId } = Route.useParams();
  const search = Route.useSearch();
  return (
    <ProjectsPage
      initialIssueId={search.issue}
      initialPullRequestId={search.pullRequest}
      projectId={projectId}
    />
  );
}
