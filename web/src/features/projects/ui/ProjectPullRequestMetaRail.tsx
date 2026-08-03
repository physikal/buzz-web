import { GitMerge, GitPullRequest } from "lucide-react";
import type { ReactNode } from "react";

import { relativeTime } from "@/shared/lib/relative-time";
import type {
  Project,
  ProjectPullRequest,
  ProjectPullRequestLifecycleStatus,
} from "../project-api";
import { PullRequestReviewersControl } from "./PullRequestReviewControls";
import { ProjectProfileIdentity } from "./ProjectProfileIdentity";

function RailSection({
  children,
  title,
}: {
  children: ReactNode;
  title: string;
}) {
  return (
    <section className="space-y-2">
      <h3 className="text-sm font-semibold">{title}</h3>
      {children}
    </section>
  );
}

function statusLabel(status: ProjectPullRequest["status"]) {
  return `${status.slice(0, 1).toUpperCase()}${status.slice(1)}`;
}

export function ProjectPullRequestMetaRail({
  canManage,
  onStatusChange,
  onUpdated,
  ownerPubkey,
  project,
  pullRequest,
  statusPending,
}: {
  canManage: boolean;
  onStatusChange: (status: ProjectPullRequestLifecycleStatus) => void;
  onUpdated: () => Promise<unknown>;
  ownerPubkey: string;
  project: Project;
  pullRequest: ProjectPullRequest;
  statusPending: boolean;
}) {
  const StatusIcon =
    pullRequest.status === "merged" ? GitMerge : GitPullRequest;
  const commitCount = pullRequest.updates.length + 1;
  const canRequestReview =
    ownerPubkey.toLowerCase() === project.owner.toLowerCase() ||
    ownerPubkey.toLowerCase() === pullRequest.author.toLowerCase();
  return (
    <aside
      aria-label="Pull request metadata"
      className="min-w-0 space-y-6 border-t p-4 xl:border-l xl:border-t-0"
    >
      <RailSection title="Status">
        {canManage ? (
          <select
            aria-label={`Status for ${pullRequest.title}`}
            className="h-9 w-full rounded-md border bg-background px-3 text-sm"
            disabled={statusPending}
            value={pullRequest.status}
            onChange={(event) =>
              onStatusChange(
                event.target.value as ProjectPullRequestLifecycleStatus,
              )
            }
          >
            <option value="open">Open</option>
            <option value="draft">Draft</option>
            <option value="closed">Closed</option>
          </select>
        ) : (
          <span className="inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs font-medium">
            <StatusIcon className="h-3.5 w-3.5" />
            {statusLabel(pullRequest.status)}
          </span>
        )}
      </RailSection>
      {pullRequest.reviewers.length || canRequestReview ? (
        <RailSection title="Reviewers">
          <PullRequestReviewersControl
            onUpdated={onUpdated}
            ownerPubkey={ownerPubkey}
            project={project}
            pullRequest={pullRequest}
          />
        </RailSection>
      ) : null}
      <RailSection title="Author">
        <ProjectProfileIdentity pubkey={pullRequest.author} />
      </RailSection>
      <RailSection title="Branches">
        <div className="space-y-1.5 text-xs text-muted-foreground">
          <p>
            Merges {commitCount} commit{commitCount === 1 ? "" : "s"}
          </p>
          <p className="flex min-w-0 flex-wrap items-center gap-1.5">
            <code className="max-w-full truncate rounded-sm bg-muted px-1.5 py-0.5 text-[0.6875rem] text-foreground">
              {pullRequest.branchName ?? "unknown branch"}
            </code>
            <span aria-hidden>→</span>
            <code className="max-w-full truncate rounded-sm bg-muted px-1.5 py-0.5 text-[0.6875rem] text-foreground">
              {pullRequest.targetBranch ?? project.defaultBranch}
            </code>
          </p>
        </div>
      </RailSection>
      <RailSection title="Activity">
        <dl className="space-y-1.5 text-xs text-muted-foreground">
          <div className="flex items-center justify-between gap-3">
            <dt>Created</dt>
            <dd className="font-medium text-foreground">
              {relativeTime(pullRequest.createdAt)}
            </dd>
          </div>
          <div className="flex items-center justify-between gap-3">
            <dt>Updated</dt>
            <dd className="font-medium text-foreground">
              {relativeTime(pullRequest.updatedAt)}
            </dd>
          </div>
        </dl>
      </RailSection>
    </aside>
  );
}
