import { queryEvents, type NostrEvent } from "@/shared/lib/nostr-client";
import { submitEvent } from "@/shared/lib/relay-events";
import { relayHttpBaseUrl, relayWsUrl } from "@/shared/lib/relay-url";

export type Project = {
  id: string;
  dtag: string;
  name: string;
  description: string;
  owner: string;
  cloneUrls: string[];
  webUrl: string | null;
  createdAt: number;
  repoAddress: string;
};

export type ProjectIssue = {
  id: string;
  title: string;
  content: string;
  author: string;
  labels: string[];
  status: "open" | "draft" | "merged" | "closed";
  createdAt: number;
  updatedAt: number;
  comments: ProjectIssueComment[];
};

export type ProjectIssueComment = {
  id: string;
  content: string;
  author: string;
  createdAt: number;
};

export type ProjectPullRequest = {
  id: string;
  title: string;
  content: string;
  author: string;
  recipients: string[];
  labels: string[];
  status: "open" | "draft" | "merged" | "closed";
  branchName: string | null;
  targetBranch: string | null;
  commit: string | null;
  cloneUrls: string[];
  createdAt: number;
  updatedAt: number;
  statusCreatedAt: number | null;
  comments: ProjectIssueComment[];
};

export type ProjectPullRequestLifecycleStatus = Exclude<
  ProjectPullRequest["status"],
  "merged"
>;

function tag(event: NostrEvent, name: string) {
  return event.tags.find((item) => item[0] === name)?.[1];
}

function tags(event: NostrEvent, name: string) {
  return event.tags
    .filter((item) => item[0] === name && item[1])
    .flatMap((item) => item.slice(1).filter(Boolean));
}

function eventProject(event: NostrEvent): Project {
  const dtag = tag(event, "d") ?? event.id;
  const explicitClones = tags(event, "clone");
  const cloneUrls = explicitClones.length
    ? explicitClones
    : [
        `${relayHttpBaseUrl().replace(/\/+$/, "")}/git/${event.pubkey}/${encodeURIComponent(dtag)}.git`,
      ];
  return {
    id: `${event.pubkey}:${dtag}`,
    dtag,
    name: tag(event, "name") ?? dtag,
    description: tag(event, "description") ?? event.content,
    owner: event.pubkey,
    cloneUrls,
    webUrl: tag(event, "web") ?? null,
    createdAt: event.created_at,
    repoAddress: `30617:${event.pubkey}:${dtag}`,
  };
}

export async function listProjects(): Promise<Project[]> {
  const events = await queryEvents(
    relayWsUrl(),
    [
      { kinds: [30617], limit: 200 },
      { kinds: [5], limit: 500 },
    ],
    { requireNip07: true },
  );
  const latest = new Map<string, NostrEvent>();
  for (const event of events.filter((item) => item.kind === 30617)) {
    const dtag = tag(event, "d") ?? event.id;
    const key = `${event.pubkey}:${dtag}`;
    if (
      !latest.has(key) ||
      (latest.get(key)?.created_at ?? 0) < event.created_at
    )
      latest.set(key, event);
  }
  const deleted = new Set(
    events
      .filter((item) => item.kind === 5)
      .flatMap((item) =>
        item.tags
          .filter((value) => value[0] === "a" && value[1])
          .map((value) => `${item.pubkey}:${value[1]}`),
      ),
  );
  return [...latest.values()]
    .filter(
      (event) =>
        !deleted.has(
          `${event.pubkey}:30617:${event.pubkey}:${tag(event, "d") ?? event.id}`,
        ),
    )
    .map(eventProject)
    .sort((a, b) => b.createdAt - a.createdAt);
}

function projectSlug(name: string) {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export async function createProject(input: {
  name: string;
  description: string;
  cloneUrl?: string;
  webUrl?: string;
}): Promise<void> {
  const name = input.name.trim();
  const dtag = projectSlug(name);
  if (!dtag) throw new Error("Project name must include letters or numbers.");
  await submitEvent({
    kind: 30617,
    content: input.description.trim(),
    tags: [
      ["d", dtag],
      ["name", name],
      ...(input.description.trim()
        ? [["description", input.description.trim()]]
        : []),
      ...(input.cloneUrl?.trim() ? [["clone", input.cloneUrl.trim()]] : []),
      ...(input.webUrl?.trim() ? [["web", input.webUrl.trim()]] : []),
    ],
  });
}

export async function deleteProject(project: Project): Promise<void> {
  await submitEvent({
    kind: 5,
    content: `Delete project ${project.name}`,
    tags: [["a", project.repoAddress]],
  });
}

export async function listProjectIssues(
  project: Project,
): Promise<ProjectIssue[]> {
  const events = await queryEvents(
    relayWsUrl(),
    [
      { kinds: [1621], "#a": [project.repoAddress], limit: 500 },
      {
        kinds: [1630, 1631, 1632, 1633],
        "#a": [project.repoAddress],
        limit: 1000,
      },
      { kinds: [1], "#a": [project.repoAddress], limit: 1000 },
    ],
    { requireNip07: true },
  );
  const statusEvents = events.filter((event) => event.kind >= 1630);
  return events
    .filter((event) => event.kind === 1621)
    .map((event) => {
      const status = statusEvents
        .filter(
          (candidate) =>
            (candidate.pubkey === event.pubkey ||
              candidate.pubkey === project.owner) &&
            candidate.tags.some(
              (value) => value[0] === "e" && value[1] === event.id,
            ),
        )
        .sort((a, b) => b.created_at - a.created_at)[0];
      const state =
        ({ 1631: "merged", 1632: "closed", 1633: "draft" } as const)[
          status?.kind as 1631 | 1632 | 1633
        ] ?? "open";
      const comments = events
        .filter(
          (candidate) =>
            candidate.kind === 1 &&
            candidate.tags.some(
              (value) =>
                (value[0] === "e" || value[0] === "E") && value[1] === event.id,
            ),
        )
        .sort((a, b) => a.created_at - b.created_at)
        .map((comment) => ({
          id: comment.id,
          content: comment.content,
          author: comment.pubkey,
          createdAt: comment.created_at,
        }));
      return {
        id: event.id,
        title:
          tag(event, "subject") ??
          event.content.split("\n")[0] ??
          "Untitled issue",
        content: event.content,
        author: event.pubkey,
        labels: tags(event, "t"),
        status: state,
        createdAt: event.created_at,
        updatedAt: Math.max(
          event.created_at,
          status?.created_at ?? 0,
          ...comments.map((comment) => comment.createdAt),
        ),
        comments,
      };
    })
    .sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function createProjectIssue(
  project: Project,
  input: { title: string; content: string; labels: string[] },
): Promise<void> {
  if (!input.title.trim()) throw new Error("Issue title is required.");
  await submitEvent({
    kind: 1621,
    content: input.content.trim(),
    tags: [
      ["a", project.repoAddress],
      ["p", project.owner],
      ["subject", input.title.trim()],
      ...input.labels
        .map((label) => ["t", label.trim()])
        .filter((item) => item[1]),
    ],
  });
}

export async function setProjectIssueStatus(
  project: Project,
  issueId: string,
  status: ProjectIssue["status"],
): Promise<void> {
  const kind = { open: 1630, merged: 1631, closed: 1632, draft: 1633 }[status];
  await submitEvent({
    kind,
    content: "",
    tags: [
      ["e", issueId, "", "root"],
      ["a", project.repoAddress],
      ["p", project.owner],
    ],
  });
}

export async function createProjectIssueComment(
  project: Project,
  issue: ProjectIssue,
  content: string,
): Promise<void> {
  const body = content.trim();
  if (!body) throw new Error("Comment cannot be empty.");
  await submitEvent({
    kind: 1,
    content: body,
    tags: [
      ["e", issue.id, "", "root"],
      ["a", project.repoAddress],
      ...[...new Set([project.owner, issue.author])].map((pubkey) => [
        "p",
        pubkey.toLowerCase(),
      ]),
    ],
  });
}

export async function listProjectPullRequests(
  project: Project,
): Promise<ProjectPullRequest[]> {
  const events = await queryEvents(
    relayWsUrl(),
    [
      { kinds: [1618], "#a": [project.repoAddress], limit: 500 },
      { kinds: [1619], "#a": [project.repoAddress], limit: 1000 },
      {
        kinds: [1630, 1631, 1632, 1633],
        "#a": [project.repoAddress],
        limit: 1000,
      },
      { kinds: [1], "#a": [project.repoAddress], limit: 1000 },
    ],
    { requireNip07: true },
  );
  const updates = events.filter((event) => event.kind === 1619);
  const statuses = events.filter(
    (event) => event.kind >= 1630 && event.kind <= 1633,
  );
  return events
    .filter((event) => event.kind === 1618)
    .map((event) => {
      const allowedActors = new Set([
        event.pubkey.toLowerCase(),
        project.owner.toLowerCase(),
      ]);
      const latestUpdate = updates
        .filter(
          (candidate) =>
            allowedActors.has(candidate.pubkey.toLowerCase()) &&
            candidate.tags.some(
              (value) => value[0] === "E" && value[1] === event.id,
            ),
        )
        .sort((a, b) => b.created_at - a.created_at)[0];
      const latestStatus = statuses
        .filter(
          (candidate) =>
            allowedActors.has(candidate.pubkey.toLowerCase()) &&
            candidate.tags.some(
              (value) =>
                (value[0] === "e" || value[0] === "E") && value[1] === event.id,
            ),
        )
        .sort((a, b) => b.created_at - a.created_at)[0];
      const comments = events
        .filter(
          (candidate) =>
            candidate.kind === 1 &&
            candidate.tags.some(
              (value) =>
                (value[0] === "e" || value[0] === "E") && value[1] === event.id,
            ),
        )
        .sort((a, b) => a.created_at - b.created_at)
        .map((comment) => ({
          id: comment.id,
          content: comment.content,
          author: comment.pubkey,
          createdAt: comment.created_at,
        }));
      const source = latestUpdate ?? event;
      const status =
        (
          {
            1630: "open",
            1631: "merged",
            1632: "closed",
            1633: "draft",
          } as const
        )[latestStatus?.kind as 1630 | 1631 | 1632 | 1633] ??
        (tags(event, "t").some((label) => label.toLowerCase() === "draft")
          ? "draft"
          : "open");
      return {
        id: event.id,
        title:
          tag(event, "subject") ??
          event.content.split("\n")[0] ??
          "Untitled pull request",
        content: event.content,
        author: event.pubkey,
        recipients: tags(event, "p").map((pubkey) => pubkey.toLowerCase()),
        labels: tags(event, "t"),
        status,
        branchName: tag(event, "branch-name") ?? null,
        targetBranch: tag(event, "target-branch") ?? null,
        commit: tag(source, "c") ?? null,
        cloneUrls: tags(source, "clone"),
        createdAt: event.created_at,
        updatedAt: Math.max(
          event.created_at,
          latestUpdate?.created_at ?? 0,
          latestStatus?.created_at ?? 0,
          ...comments.map((comment) => comment.createdAt),
        ),
        statusCreatedAt: latestStatus?.created_at ?? null,
        comments,
      } satisfies ProjectPullRequest;
    })
    .sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function createProjectPullRequestComment(
  project: Project,
  pullRequest: ProjectPullRequest,
  content: string,
): Promise<void> {
  const body = content.trim();
  if (!body) throw new Error("Comment cannot be empty.");
  await submitEvent({
    kind: 1,
    content: body,
    tags: [
      ["e", pullRequest.id, "", "root"],
      ["a", project.repoAddress],
      ...[
        ...new Set([
          project.owner.toLowerCase(),
          pullRequest.author.toLowerCase(),
          ...pullRequest.recipients,
        ]),
      ].map((pubkey) => ["p", pubkey]),
    ],
  });
}

export async function createProjectPullRequest(
  project: Project,
  input: {
    title: string;
    content: string;
    branch: string;
    targetBranch: string;
    commit: string;
    mergeBase?: string | null;
    reviewers?: string[];
  },
): Promise<string> {
  const title = input.title.trim();
  if (!title) throw new Error("Pull request title cannot be empty.");
  if (title.length > 256) {
    throw new Error("Pull request title must be 256 characters or fewer.");
  }
  if (!project.cloneUrls.length) {
    throw new Error("This project has no clone URL.");
  }
  if (!input.branch || !input.targetBranch) {
    throw new Error("Pull request branches are incomplete.");
  }
  if (input.branch === input.targetBranch) {
    throw new Error("The base and compare branches must be different.");
  }
  if (!/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/iu.test(input.commit)) {
    throw new Error("The compare branch commit is invalid.");
  }
  if (
    input.mergeBase &&
    !/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/iu.test(input.mergeBase)
  ) {
    throw new Error("The merge-base commit is invalid.");
  }
  const recipients = [
    ...new Set(
      [project.owner, ...(input.reviewers ?? [])].map((pubkey) =>
        pubkey.toLowerCase(),
      ),
    ),
  ];
  const { event } = await submitEvent({
    kind: 1618,
    content: input.content.trim(),
    tags: [
      ["a", project.repoAddress],
      ...recipients.map((pubkey) => ["p", pubkey]),
      ["subject", title],
      ["c", input.commit.toLowerCase()],
      ["clone", ...project.cloneUrls],
      ["branch-name", input.branch],
      ["target-branch", input.targetBranch],
      ...(input.mergeBase
        ? [["merge-base", input.mergeBase.toLowerCase()]]
        : []),
    ],
  });
  return event.id;
}

export async function setProjectPullRequestStatus(
  project: Project,
  pullRequest: ProjectPullRequest,
  status: ProjectPullRequestLifecycleStatus,
): Promise<void> {
  const kind = { open: 1630, closed: 1632, draft: 1633 }[status];
  await submitEvent({
    kind,
    content: "",
    created_at: Math.max(
      Math.floor(Date.now() / 1000),
      (pullRequest.statusCreatedAt ?? 0) + 1,
    ),
    tags: [
      ["e", pullRequest.id, "", "root"],
      ["a", project.repoAddress],
      ...[...new Set([project.owner, pullRequest.author])].map((pubkey) => [
        "p",
        pubkey.toLowerCase(),
      ]),
    ],
  });
}
