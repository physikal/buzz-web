import { queryEvents, type NostrEvent } from "@/shared/lib/nostr-client";
import { truncatePubkey } from "@/shared/lib/pubkey";
import { submitEvent } from "@/shared/lib/relay-events";
import { relayHttpBaseUrl, relayWsUrl } from "@/shared/lib/relay-url";

export type Project = {
  id: string;
  dtag: string;
  name: string;
  description: string;
  owner: string;
  defaultBranch: string;
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

export type ProjectPullRequestReviewDecision = {
  id: string;
  author: string;
  createdAt: number;
  commit: string;
  decision: "approved" | "changes-requested";
};

export type ProjectPullRequestUpdate = {
  id: string;
  content: string;
  author: string;
  createdAt: number;
  commit: string | null;
  cloneUrls: string[];
};

export type ProjectPullRequestCommentAnchor = {
  path: string;
  side: "old" | "new";
  line: number;
};

export type ProjectPullRequestComment = ProjectIssueComment & {
  commit: string | null;
  anchor: ProjectPullRequestCommentAnchor | null;
  isInlineComment: boolean;
  inlineCommentStatus: "current" | "outdated" | null;
  isReviewRequest: boolean;
  isTrustedReviewRequest: boolean;
  reviewerPubkeys: string[];
  reviewDecision: "approved" | "changes-requested" | null;
  reviewDecisionStatus: "current" | "historical" | null;
};

export type ProjectPullRequest = {
  id: string;
  title: string;
  content: string;
  author: string;
  recipients: string[];
  reviewers: string[];
  approvals: ProjectPullRequestReviewDecision[];
  changeRequests: ProjectPullRequestReviewDecision[];
  labels: string[];
  status: "open" | "draft" | "merged" | "closed";
  branchName: string | null;
  targetBranch: string | null;
  initialCommit: string | null;
  commit: string | null;
  cloneUrls: string[];
  createdAt: number;
  updatedAt: number;
  statusCreatedAt: number | null;
  updates: ProjectPullRequestUpdate[];
  comments: ProjectPullRequestComment[];
};

export type ProjectPullRequestLifecycleStatus = Exclude<
  ProjectPullRequest["status"],
  "merged"
>;

export const PR_REVIEW_REQUEST_LABEL = "review-request";
export const PR_APPROVAL_LABEL = "approval";
export const PR_CHANGES_REQUESTED_LABEL = "changes-requested";
export const PR_INLINE_COMMENT_LABEL = "inline-comment";

export function normalizeProjectPullRequestCommentAnchor(
  anchor: Partial<ProjectPullRequestCommentAnchor> | null | undefined,
): ProjectPullRequestCommentAnchor | null {
  if (!anchor || typeof anchor.path !== "string") return null;
  const path = anchor.path;
  if (
    path.length === 0 ||
    path.length > 4_096 ||
    path.startsWith("/") ||
    path.includes("\\") ||
    path.includes("\0") ||
    path
      .split("/")
      .some((segment) => !segment || segment === "." || segment === "..")
  ) {
    return null;
  }
  if (anchor.side !== "old" && anchor.side !== "new") return null;
  if (!Number.isSafeInteger(anchor.line) || (anchor.line ?? 0) < 1) return null;
  return { path, side: anchor.side, line: anchor.line as number };
}

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
    defaultBranch: tag(event, "default-branch") ?? "main",
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
      const trustedUpdates = updates
        .filter(
          (candidate) =>
            allowedActors.has(candidate.pubkey.toLowerCase()) &&
            candidate.tags.some(
              (value) => value[0] === "E" && value[1] === event.id,
            ),
        )
        .sort(
          (a, b) => a.created_at - b.created_at || a.id.localeCompare(b.id),
        );
      const latestUpdate = trustedUpdates[trustedUpdates.length - 1];
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
      const parsedComments = events
        .filter(
          (candidate) =>
            candidate.kind === 1 &&
            candidate.tags.some(
              (value) =>
                (value[0] === "e" || value[0] === "E") && value[1] === event.id,
            ),
        )
        .sort((a, b) => a.created_at - b.created_at)
        .map((comment) => {
          const labels = tags(comment, "t").map((label) => label.toLowerCase());
          const isReviewRequest = labels.includes(PR_REVIEW_REQUEST_LABEL);
          const isApproval = labels.includes(PR_APPROVAL_LABEL);
          const isChangeRequest = labels.includes(PR_CHANGES_REQUESTED_LABEL);
          const line = tag(comment, "line");
          const anchor =
            isReviewRequest || isApproval
              ? null
              : normalizeProjectPullRequestCommentAnchor({
                  path: tag(comment, "file"),
                  side: tag(comment, "side") as "old" | "new" | undefined,
                  line:
                    line && /^[1-9]\d*$/u.test(line)
                      ? Number(line)
                      : Number.NaN,
                });
          return {
            id: comment.id,
            content: comment.content,
            author: comment.pubkey,
            createdAt: comment.created_at,
            commit: tag(comment, "c") ?? null,
            anchor,
            isInlineComment:
              Boolean(anchor) || labels.includes(PR_INLINE_COMMENT_LABEL),
            inlineCommentStatus: null,
            isReviewRequest,
            isTrustedReviewRequest: false,
            reviewerPubkeys: tags(comment, "p").map((pubkey) =>
              pubkey.toLowerCase(),
            ),
            reviewDecision:
              isApproval === isChangeRequest
                ? null
                : isApproval
                  ? ("approved" as const)
                  : ("changes-requested" as const),
            reviewDecisionStatus: null,
          };
        });
      const source = latestUpdate ?? event;
      const initialCommit = tag(event, "c") ?? null;
      const currentCommit = tag(source, "c") ?? null;
      const reviewers = new Set(
        tags(event, "p").map((pubkey) => pubkey.toLowerCase()),
      );
      for (const comment of parsedComments) {
        if (
          comment.isReviewRequest &&
          allowedActors.has(comment.author.toLowerCase())
        ) {
          for (const reviewer of comment.reviewerPubkeys) {
            reviewers.add(reviewer);
          }
        }
      }
      reviewers.delete(event.pubkey.toLowerCase());
      const trustedReviewActors = new Set(reviewers);
      for (const actor of allowedActors) {
        if (actor !== event.pubkey.toLowerCase())
          trustedReviewActors.add(actor);
      }
      const comments = parsedComments.map((comment) => {
        const trustedDecision = Boolean(
          comment.reviewDecision &&
            trustedReviewActors.has(comment.author.toLowerCase()),
        );
        const decisionCommit = comment.commit ?? initialCommit;
        return {
          ...comment,
          isTrustedReviewRequest:
            comment.isReviewRequest &&
            allowedActors.has(comment.author.toLowerCase()),
          inlineCommentStatus: comment.anchor
            ? currentCommit && decisionCommit === currentCommit
              ? ("current" as const)
              : ("outdated" as const)
            : null,
          reviewDecisionStatus: trustedDecision
            ? currentCommit && decisionCommit === currentCommit
              ? ("current" as const)
              : ("historical" as const)
            : null,
        };
      });
      const effectiveDecisions = new Map<
        string,
        ProjectPullRequestReviewDecision
      >();
      for (const comment of comments) {
        const decisionCommit = comment.commit ?? initialCommit;
        if (
          !comment.reviewDecision ||
          comment.reviewDecisionStatus !== "current" ||
          !decisionCommit
        )
          continue;
        const key = comment.author.toLowerCase();
        const existing = effectiveDecisions.get(key);
        if (
          !existing ||
          comment.createdAt > existing.createdAt ||
          (comment.createdAt === existing.createdAt && comment.id > existing.id)
        ) {
          effectiveDecisions.set(key, {
            id: comment.id,
            author: comment.author,
            createdAt: comment.createdAt,
            commit: decisionCommit,
            decision: comment.reviewDecision,
          });
        }
      }
      const decisions = [...effectiveDecisions.values()].sort(
        (a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id),
      );
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
        reviewers: [...reviewers],
        approvals: decisions.filter(
          (decision) => decision.decision === "approved",
        ),
        changeRequests: decisions.filter(
          (decision) => decision.decision === "changes-requested",
        ),
        labels: tags(event, "t"),
        status,
        branchName: tag(event, "branch-name") ?? null,
        targetBranch: tag(event, "target-branch") ?? null,
        initialCommit,
        commit: currentCommit,
        cloneUrls: tags(source, "clone"),
        createdAt: event.created_at,
        updatedAt: Math.max(
          event.created_at,
          latestUpdate?.created_at ?? 0,
          latestStatus?.created_at ?? 0,
          ...comments.map((comment) => comment.createdAt),
        ),
        statusCreatedAt: latestStatus?.created_at ?? null,
        updates: trustedUpdates.map((update) => ({
          id: update.id,
          content: update.content,
          author: update.pubkey,
          createdAt: update.created_at,
          commit: tag(update, "c") ?? null,
          cloneUrls: tags(update, "clone"),
        })),
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

export async function createProjectPullRequestInlineComment(
  project: Project,
  pullRequest: ProjectPullRequest,
  viewerPubkey: string,
  content: string,
  anchor: ProjectPullRequestCommentAnchor,
  decision?: "request-changes",
): Promise<void> {
  const body = content.trim();
  if (!body) throw new Error("Comment cannot be empty.");
  const location = normalizeProjectPullRequestCommentAnchor(anchor);
  if (!location) throw new Error("Comment location is invalid.");
  if (!pullRequest.commit) {
    throw new Error("Pull request commit is required for review comments.");
  }
  if (
    decision &&
    !canReviewProjectPullRequest(project, pullRequest, viewerPubkey)
  ) {
    throw new Error("You are not a requested reviewer for this pull request.");
  }
  const latestDecisionCreatedAt = [
    ...pullRequest.approvals,
    ...pullRequest.changeRequests,
  ].reduce((latest, item) => Math.max(latest, item.createdAt), 0);
  await submitEvent({
    kind: 1,
    content: body,
    ...(decision
      ? {
          created_at: Math.max(
            Math.floor(Date.now() / 1000),
            latestDecisionCreatedAt + 1,
          ),
        }
      : {}),
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
      ["t", PR_INLINE_COMMENT_LABEL],
      ["c", pullRequest.commit],
      ["file", location.path],
      ["side", location.side],
      ["line", String(location.line)],
      ...(decision ? [["t", PR_CHANGES_REQUESTED_LABEL]] : []),
    ],
  });
}

export async function updateProjectPullRequest(
  project: Project,
  pullRequest: ProjectPullRequest,
  viewerPubkey: string,
  commit: string,
  mergeBase?: string | null,
): Promise<void> {
  const viewer = viewerPubkey.toLowerCase();
  if (
    viewer !== project.owner.toLowerCase() &&
    viewer !== pullRequest.author.toLowerCase()
  ) {
    throw new Error(
      "Only the pull request author or repository owner can publish its update.",
    );
  }
  if (!/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/iu.test(commit)) {
    throw new Error("The branch commit is invalid.");
  }
  if (pullRequest.commit?.toLowerCase() === commit.toLowerCase()) return;
  const latestUpdateCreatedAt = pullRequest.updates.reduce(
    (latest, update) => Math.max(latest, update.createdAt),
    pullRequest.createdAt,
  );
  await submitEvent({
    kind: 1619,
    content: "",
    created_at: Math.max(
      Math.floor(Date.now() / 1000),
      latestUpdateCreatedAt + 1,
    ),
    tags: [
      ["a", project.repoAddress],
      ...[
        ...new Set([
          project.owner.toLowerCase(),
          pullRequest.author.toLowerCase(),
        ]),
      ].map((pubkey) => ["p", pubkey]),
      ["E", pullRequest.id],
      ["P", pullRequest.author.toLowerCase()],
      ["c", commit.toLowerCase()],
      [
        "clone",
        ...(pullRequest.cloneUrls.length
          ? pullRequest.cloneUrls
          : project.cloneUrls),
      ],
      ...(mergeBase ? [["merge-base", mergeBase.toLowerCase()]] : []),
    ],
  });
}

export function canReviewProjectPullRequest(
  project: Project,
  pullRequest: ProjectPullRequest,
  viewerPubkey: string,
): boolean {
  const viewer = viewerPubkey.toLowerCase();
  if (
    !pullRequest.commit ||
    (pullRequest.status !== "open" && pullRequest.status !== "draft") ||
    viewer === pullRequest.author.toLowerCase()
  ) {
    return false;
  }
  return (
    viewer === project.owner.toLowerCase() ||
    pullRequest.reviewers.includes(viewer)
  );
}

export async function requestProjectPullRequestReview(
  project: Project,
  pullRequest: ProjectPullRequest,
  viewerPubkey: string,
  reviewerPubkey: string,
  reviewerLabel: string,
): Promise<void> {
  const viewer = viewerPubkey.toLowerCase();
  if (
    viewer !== project.owner.toLowerCase() &&
    viewer !== pullRequest.author.toLowerCase()
  ) {
    throw new Error("Only the author or repository owner can request reviews.");
  }
  const reviewer = reviewerPubkey.toLowerCase();
  if (!/^[0-9a-f]{64}$/u.test(reviewer)) {
    throw new Error("Reviewer public key is invalid.");
  }
  if (reviewer === pullRequest.author.toLowerCase()) {
    throw new Error("The pull request author cannot review their own change.");
  }
  await submitEvent({
    kind: 1,
    content: `Requested a review from ${reviewerLabel.trim() || truncatePubkey(reviewer)}`,
    tags: [
      ["e", pullRequest.id, "", "root"],
      ["a", project.repoAddress],
      ["p", reviewer],
      ["t", PR_REVIEW_REQUEST_LABEL],
    ],
  });
}

export async function submitProjectPullRequestReview(
  project: Project,
  pullRequest: ProjectPullRequest,
  viewerPubkey: string,
  decision: "approve" | "request-changes",
  content?: string,
): Promise<void> {
  if (!canReviewProjectPullRequest(project, pullRequest, viewerPubkey)) {
    throw new Error(
      "You are not an authorized reviewer for this pull request.",
    );
  }
  if (!pullRequest.commit) {
    throw new Error("The pull request has no commit to review.");
  }
  const body =
    content?.trim() ||
    (decision === "approve" ? "Approved these changes" : "Requested changes");
  const latestDecisionCreatedAt = [
    ...pullRequest.approvals,
    ...pullRequest.changeRequests,
  ].reduce((latest, item) => Math.max(latest, item.createdAt), 0);
  await submitEvent({
    kind: 1,
    content: body,
    created_at: Math.max(
      Math.floor(Date.now() / 1000),
      latestDecisionCreatedAt + 1,
    ),
    tags: [
      ["e", pullRequest.id, "", "root"],
      ["a", project.repoAddress],
      ...[
        ...new Set([
          project.owner.toLowerCase(),
          pullRequest.author.toLowerCase(),
        ]),
      ].map((pubkey) => ["p", pubkey]),
      [
        "t",
        decision === "approve" ? PR_APPROVAL_LABEL : PR_CHANGES_REQUESTED_LABEL,
      ],
      ["c", pullRequest.commit],
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
