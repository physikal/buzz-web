import { relayHttpBaseUrl } from "@/shared/lib/relay-url";
import type { Project, ProjectIssue, ProjectPullRequest } from "./project-api";

export function isRelayHostedProject(project: Project) {
  const expected = `${relayHttpBaseUrl().replace(/\/+$/u, "")}/git/${project.owner}/${encodeURIComponent(project.dtag)}.git`;
  return project.cloneUrls.some((cloneUrl) => cloneUrl === expected);
}

export function projectUpdatedAt(
  project: Project,
  issues: Array<{ project: Project; issue: ProjectIssue }>,
  pullRequests: Array<{
    project: Project;
    pullRequest: ProjectPullRequest;
  }>,
) {
  return Math.max(
    project.createdAt,
    ...issues
      .filter((item) => item.project.repoAddress === project.repoAddress)
      .map((item) => item.issue.updatedAt),
    ...pullRequests
      .filter((item) => item.project.repoAddress === project.repoAddress)
      .map((item) => item.pullRequest.updatedAt),
  );
}
