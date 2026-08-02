import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { GitPullRequest, MessageSquare, Plus } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { truncatePubkey } from "@/shared/lib/pubkey";
import { useRepoRefs } from "@/features/repos/use-repo-refs";
import { Button } from "@/shared/ui/button";
import {
  createProjectPullRequestComment,
  createProjectPullRequest,
  listProjectPullRequests,
  type Project,
  type ProjectPullRequest,
  type ProjectPullRequestLifecycleStatus,
  setProjectPullRequestStatus,
} from "../project-api";
import {
  CreatePullRequestDialog,
  type CreatePullRequestInput,
} from "./CreatePullRequestDialog";
import { PullRequestReviewControls } from "./PullRequestReviewControls";

export function ProjectPullRequestsPanel({
  ownerPubkey,
  project,
}: {
  ownerPubkey: string;
  project: Project;
}) {
  const queryClient = useQueryClient();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const queryKey = ["project-pull-requests", project.repoAddress];
  const query = useQuery({
    queryKey,
    queryFn: () => listProjectPullRequests(project),
  });
  const refsQuery = useRepoRefs(project.dtag);
  const refresh = () => queryClient.invalidateQueries({ queryKey });
  const createMutation = useMutation({
    mutationFn: (input: CreatePullRequestInput) =>
      createProjectPullRequest(project, input),
    onSuccess: async (pullRequestId) => {
      await refresh();
      setCreateOpen(false);
      setSelectedId(pullRequestId);
      toast.success("Pull request created");
    },
    onError: (error) =>
      toast.error("Could not create pull request", {
        description: error.message,
      }),
  });
  const selected = (query.data ?? []).find((item) => item.id === selectedId);
  if (selected) {
    return (
      <PullRequestDetail
        ownerPubkey={ownerPubkey}
        project={project}
        pullRequest={selected}
        onBack={() => setSelectedId(null)}
        onUpdated={refresh}
      />
    );
  }
  return (
    <>
      <section className="mt-8">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-lg font-semibold">Pull requests</h2>
          <Button onClick={() => setCreateOpen(true)}>
            <Plus /> Open pull request
          </Button>
        </div>
        <div className="mt-3 divide-y overflow-hidden rounded-md border">
          {query.isLoading ? (
            <p className="p-4 text-sm text-muted-foreground">
              Loading pull requests...
            </p>
          ) : query.error ? (
            <p className="p-4 text-sm text-destructive">
              Could not load pull requests.
            </p>
          ) : query.data?.length ? (
            query.data.map((item) => (
              <article className="flex items-start gap-3 p-4" key={item.id}>
                <GitPullRequest className="mt-0.5 h-4 w-4 text-muted-foreground" />
                <div className="min-w-0 flex-1">
                  <h3 className="font-medium">
                    <button
                      className="text-left hover:underline"
                      onClick={() => setSelectedId(item.id)}
                      type="button"
                    >
                      {item.title}
                    </button>
                  </h3>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {item.branchName ?? "unknown"} →{" "}
                    {item.targetBranch ?? "main"}
                  </p>
                  <p className="mt-2 flex items-center gap-2 text-xs text-muted-foreground">
                    <span>{item.status}</span>
                    <span>· {truncatePubkey(item.author)}</span>
                    {item.comments.length ? (
                      <span className="inline-flex items-center gap-1">
                        <MessageSquare className="h-3 w-3" />
                        {item.comments.length}
                      </span>
                    ) : null}
                  </p>
                </div>
              </article>
            ))
          ) : (
            <p className="p-6 text-center text-sm text-muted-foreground">
              No pull requests yet.
            </p>
          )}
        </div>
      </section>
      <CreatePullRequestDialog
        existingPullRequests={query.data ?? []}
        open={createOpen}
        pending={createMutation.isPending}
        project={project}
        refs={refsQuery.data}
        refsError={refsQuery.error}
        refsLoading={refsQuery.isLoading}
        onClose={() => setCreateOpen(false)}
        onSubmit={(input) => createMutation.mutateAsync(input).then(() => {})}
      />
    </>
  );
}

function PullRequestDetail({
  ownerPubkey,
  project,
  pullRequest,
  onBack,
  onUpdated,
}: {
  ownerPubkey: string;
  project: Project;
  pullRequest: ProjectPullRequest;
  onBack: () => void;
  onUpdated: () => Promise<unknown>;
}) {
  const [comment, setComment] = useState("");
  const commentMutation = useMutation({
    mutationFn: () =>
      createProjectPullRequestComment(project, pullRequest, comment),
    onSuccess: async () => {
      setComment("");
      await onUpdated();
      toast.success("Comment posted");
    },
    onError: (error) =>
      toast.error("Could not post comment", { description: error.message }),
  });
  const statusMutation = useMutation({
    mutationFn: (status: ProjectPullRequestLifecycleStatus) =>
      setProjectPullRequestStatus(project, pullRequest, status),
    onSuccess: onUpdated,
    onError: (error) =>
      toast.error("Could not update pull request", {
        description: error.message,
      }),
  });
  const canManage =
    pullRequest.status !== "merged" &&
    (ownerPubkey.toLowerCase() === project.owner.toLowerCase() ||
      ownerPubkey.toLowerCase() === pullRequest.author.toLowerCase());
  return (
    <section className="mt-8">
      <button
        className="text-sm text-muted-foreground hover:text-foreground"
        onClick={onBack}
        type="button"
      >
        ← Back to pull requests
      </button>
      <header className="mt-5 border-b pb-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-xs text-muted-foreground">
              Pull request · #{pullRequest.id.slice(0, 8)}
            </p>
            <h2 className="mt-1 text-2xl font-semibold">{pullRequest.title}</h2>
          </div>
          {canManage ? (
            <select
              aria-label={`Status for ${pullRequest.title}`}
              className="h-9 rounded-md border bg-background px-3 text-sm"
              disabled={statusMutation.isPending}
              value={pullRequest.status}
              onChange={(event) =>
                statusMutation.mutate(
                  event.target.value as ProjectPullRequestLifecycleStatus,
                )
              }
            >
              <option value="open">Open</option>
              <option value="draft">Draft</option>
              <option value="closed">Closed</option>
            </select>
          ) : null}
        </div>
        <p className="mt-3 text-sm text-muted-foreground">
          {pullRequest.branchName ?? "unknown"} →{" "}
          {pullRequest.targetBranch ?? "main"}
          {pullRequest.commit ? ` · ${pullRequest.commit.slice(0, 7)}` : ""}
        </p>
        {pullRequest.content ? (
          <p className="mt-5 whitespace-pre-wrap text-sm leading-6">
            {pullRequest.content}
          </p>
        ) : null}
      </header>
      <PullRequestReviewControls
        onUpdated={onUpdated}
        ownerPubkey={ownerPubkey}
        project={project}
        pullRequest={pullRequest}
      />
      <div className="py-6">
        <h3 className="text-lg font-semibold">
          {pullRequest.comments.length}{" "}
          {pullRequest.comments.length === 1 ? "comment" : "comments"}
        </h3>
        <div className="mt-4 divide-y rounded-md border">
          {pullRequest.comments.length ? (
            pullRequest.comments.map((item) => (
              <article className="p-4" key={item.id}>
                <p className="text-xs text-muted-foreground">
                  {truncatePubkey(item.author)} ·{" "}
                  {new Date(item.createdAt * 1000).toLocaleString()}
                </p>
                {item.reviewDecisionStatus ? (
                  <p className="mt-2 text-xs font-medium">
                    {item.reviewDecision === "approved"
                      ? item.reviewDecisionStatus === "current"
                        ? "Approved these changes"
                        : "Approved an earlier commit"
                      : item.reviewDecisionStatus === "current"
                        ? "Requested changes"
                        : "Requested changes on an earlier commit"}
                  </p>
                ) : item.isTrustedReviewRequest ? (
                  <p className="mt-2 text-xs font-medium">Requested a review</p>
                ) : null}
                <p className="mt-2 whitespace-pre-wrap text-sm leading-6">
                  {item.content}
                </p>
              </article>
            ))
          ) : (
            <p className="p-4 text-sm text-muted-foreground">
              No comments yet.
            </p>
          )}
        </div>
        <form
          className="mt-5"
          onSubmit={(event) => {
            event.preventDefault();
            if (comment.trim()) commentMutation.mutate();
          }}
        >
          <label className="text-sm font-medium" htmlFor="pull-request-comment">
            Add pull request comment
          </label>
          <textarea
            className="mt-2 min-h-28 w-full rounded-md border bg-background p-3 text-sm"
            disabled={commentMutation.isPending}
            id="pull-request-comment"
            placeholder="Add a comment..."
            value={comment}
            onChange={(event) => setComment(event.target.value)}
          />
          <div className="mt-2 flex justify-end">
            <Button
              disabled={!comment.trim() || commentMutation.isPending}
              type="submit"
            >
              {commentMutation.isPending ? "Posting..." : "Comment"}
            </Button>
          </div>
        </form>
      </div>
    </section>
  );
}
