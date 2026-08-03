import { createFileRoute } from "@tanstack/react-router";
import { lazy } from "react";

const ProjectsPage = lazy(async () => {
  const module = await import("@/features/projects/ui/ProjectsPage");
  return { default: module.ProjectsPage };
});

export const Route = createFileRoute("/projects/$projectId")({
  validateSearch: (search: Record<string, unknown>) => ({
    ...(typeof search.commit === "string" &&
    /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/iu.test(search.commit)
      ? { commit: search.commit.toLowerCase() }
      : {}),
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
      initialCommitOid={search.commit}
      initialPullRequestId={search.pullRequest}
      projectId={projectId}
    />
  );
}
