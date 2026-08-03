import { CircleCheck, CircleDot, CircleX, MessageSquare } from "lucide-react";
import type { ReactNode } from "react";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";

import { relativeTime } from "@/shared/lib/relative-time";
import { truncatePubkey } from "@/shared/lib/pubkey";
import { createProjectIssueComment } from "../project-comments-api";
import type { Project, ProjectIssue } from "../project-api";
import { ProjectCommentComposer } from "./ProjectCommentComposer";
import { ProjectRichContent } from "./ProjectRichContent";

function issueStatusVisual(status: ProjectIssue["status"]) {
  if (status === "merged") {
    return { className: "text-violet-500", icon: CircleCheck, label: "Done" };
  }
  if (status === "closed") {
    return { className: "text-destructive", icon: CircleX, label: "Closed" };
  }
  return {
    className: "text-emerald-600",
    icon: CircleDot,
    label: status === "draft" ? "Triage" : "Open",
  };
}

export function ProjectIssueDetail({
  issue,
  ownerPubkey,
  project,
  statusPending,
  onBack,
  onStatusChange,
  onUpdated,
}: {
  issue: ProjectIssue;
  ownerPubkey: string;
  project: Project;
  statusPending: boolean;
  onBack: () => void;
  onStatusChange: (status: ProjectIssue["status"]) => void;
  onUpdated: () => Promise<unknown>;
}) {
  const createComment = useMutation({
    mutationFn: (input: Parameters<typeof createProjectIssueComment>[2]) =>
      createProjectIssueComment(project, issue, input),
    onSuccess: async () => {
      await onUpdated();
      toast.success("Comment posted");
    },
    onError: (error) =>
      toast.error("Could not post comment", { description: error.message }),
  });
  return (
    <>
      <button
        className="text-sm text-muted-foreground hover:text-foreground"
        onClick={onBack}
        type="button"
      >
        ← Back to issues
      </button>
      <div className="mt-5 grid overflow-hidden rounded-md border xl:grid-cols-[minmax(0,1fr)_18rem]">
        <div className="min-w-0 divide-y">
          <header className="space-y-3 p-4">
            <div className="min-w-0">
              <p className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                <CircleDot className="h-3.5 w-3.5" />
                Issue from {truncatePubkey(issue.author)}
              </p>
              <h1 className="mt-1 text-xl font-semibold">
                {issue.title}{" "}
                <span className="font-normal text-muted-foreground">
                  #{issue.id.slice(0, 8)}
                </span>
              </h1>
            </div>
            {issue.content ? (
              <ProjectRichContent content={issue.content} tags={issue.tags} />
            ) : null}
          </header>
          <section className="space-y-4 p-4">
            <h2 className="flex items-center gap-1.5 text-sm font-semibold">
              <MessageSquare className="h-3.5 w-3.5" /> Add Your Comment
            </h2>
            {issue.comments.length ? (
              <div className="space-y-4">
                {issue.comments.map((item) => (
                  <article key={item.id}>
                    <p className="text-xs text-muted-foreground">
                      {truncatePubkey(item.author)} ·{" "}
                      {relativeTime(item.createdAt)}
                    </p>
                    <ProjectRichContent
                      className="mt-2 text-sm"
                      content={item.content}
                      tags={item.tags}
                    />
                  </article>
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">No comments yet.</p>
            )}
            <ProjectCommentComposer
              ownerPubkey={ownerPubkey}
              participants={[
                project.owner,
                issue.author,
                ...project.contributors,
                ...issue.recipients,
              ]}
              pending={createComment.isPending}
              workItemId={issue.id}
              onSubmit={(input) => createComment.mutateAsync(input)}
            />
          </section>
        </div>
        <IssueMetaRail
          canManage={
            ownerPubkey.toLowerCase() === issue.author.toLowerCase() ||
            ownerPubkey.toLowerCase() === project.owner.toLowerCase()
          }
          issue={issue}
          statusPending={statusPending}
          onStatusChange={onStatusChange}
        />
      </div>
    </>
  );
}

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

function IssueMetaRail({
  canManage,
  issue,
  statusPending,
  onStatusChange,
}: {
  canManage: boolean;
  issue: ProjectIssue;
  statusPending: boolean;
  onStatusChange: (status: ProjectIssue["status"]) => void;
}) {
  const status = issueStatusVisual(issue.status);
  const StatusIcon = status.icon;
  return (
    <aside
      aria-label="Issue metadata"
      className="space-y-6 border-t p-4 xl:border-l xl:border-t-0"
    >
      <RailSection title="Status">
        {canManage ? (
          <select
            aria-label={`Status for ${issue.title}`}
            className="h-9 w-full rounded-md border bg-background px-3 text-sm"
            disabled={statusPending}
            value={issue.status}
            onChange={(event) =>
              onStatusChange(event.target.value as ProjectIssue["status"])
            }
          >
            <option value="open">Open</option>
            <option value="draft">Triage</option>
            <option value="merged">Done</option>
            <option value="closed">Closed</option>
          </select>
        ) : (
          <span
            className={`inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs font-medium ${status.className}`}
          >
            <StatusIcon className="h-3.5 w-3.5" /> {status.label}
          </span>
        )}
      </RailSection>
      <RailSection title="Author">
        <p className="break-all font-mono text-xs text-muted-foreground">
          {truncatePubkey(issue.author)}
        </p>
      </RailSection>
      {issue.labels.length ? (
        <RailSection title="Labels">
          <div className="flex flex-wrap gap-1.5">
            {issue.labels.map((label) => (
              <span
                className="rounded-full border px-1.5 py-0.5 text-xs text-muted-foreground"
                key={label}
              >
                {label}
              </span>
            ))}
          </div>
        </RailSection>
      ) : null}
      <RailSection title="Activity">
        <dl className="space-y-1.5 text-xs text-muted-foreground">
          <div className="flex items-center justify-between gap-3">
            <dt>Created</dt>
            <dd className="font-medium text-foreground">
              {relativeTime(issue.createdAt)}
            </dd>
          </div>
          <div className="flex items-center justify-between gap-3">
            <dt>Updated</dt>
            <dd className="font-medium text-foreground">
              {relativeTime(issue.updatedAt)}
            </dd>
          </div>
        </dl>
      </RailSection>
    </aside>
  );
}
