import { queryEvents, type NostrEvent } from "@/shared/lib/nostr-client";
import { relayWsUrl } from "@/shared/lib/relay-url";
import {
  listProjectIssues,
  listProjectPullRequests,
  type Project,
  type ProjectIssue,
  type ProjectPullRequest,
} from "./project-api";

export type ProjectsWorkItems = {
  issues: Array<{ project: Project; issue: ProjectIssue }>;
  pullRequests: Array<{
    project: Project;
    pullRequest: ProjectPullRequest;
  }>;
};

function eventReferencesProject(event: NostrEvent, repoAddress: string) {
  return event.tags.some(
    (value) => value[0] === "a" && value[1] === repoAddress,
  );
}

/** Loads every project's work items through one authenticated relay query. */
export async function listProjectsWorkItems(
  projects: Project[],
): Promise<ProjectsWorkItems> {
  const repoAddresses = [
    ...new Set(projects.map((project) => project.repoAddress)),
  ];
  if (repoAddresses.length === 0) {
    return { issues: [], pullRequests: [] };
  }

  const events = await queryEvents(
    relayWsUrl(),
    [
      {
        kinds: [1618, 1621],
        "#a": repoAddresses,
        limit: 2_000,
      },
      { kinds: [1619], "#a": repoAddresses, limit: 2_000 },
      { kinds: [1], "#a": repoAddresses, limit: 2_000 },
      {
        kinds: [1630, 1631, 1632, 1633],
        "#a": repoAddresses,
        limit: 2_000,
      },
    ],
    { requireNip07: true },
  );

  const parsed = await Promise.all(
    projects.map(async (project) => {
      const projectEvents = events.filter((event) =>
        eventReferencesProject(event, project.repoAddress),
      );
      const [issues, pullRequests] = await Promise.all([
        listProjectIssues(project, projectEvents),
        listProjectPullRequests(project, projectEvents),
      ]);
      return { project, issues, pullRequests };
    }),
  );

  return {
    issues: parsed
      .flatMap(({ project, issues }) =>
        issues.map((issue) => ({ project, issue })),
      )
      .sort((left, right) => right.issue.updatedAt - left.issue.updatedAt),
    pullRequests: parsed
      .flatMap(({ project, pullRequests }) =>
        pullRequests.map((pullRequest) => ({ project, pullRequest })),
      )
      .sort(
        (left, right) =>
          right.pullRequest.updatedAt - left.pullRequest.updatedAt,
      ),
  };
}
