import { useMutation, useQuery } from "@tanstack/react-query";
import { Check, Search, TriangleAlert, UserPlus, X } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";

import { getCommunityMembership } from "@/features/settings/community-api";
import { useEscapeSurface } from "@/shared/hooks/use-escape-surface";
import { truncatePubkey } from "@/shared/lib/pubkey";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import {
  canReviewProjectPullRequest,
  type Project,
  type ProjectPullRequest,
  requestProjectPullRequestReview,
  submitProjectPullRequestReview,
} from "../project-api";

export function PullRequestReviewControls({
  ownerPubkey,
  project,
  pullRequest,
  onUpdated,
}: {
  ownerPubkey: string;
  project: Project;
  pullRequest: ProjectPullRequest;
  onUpdated: () => Promise<unknown>;
}) {
  const [decision, setDecision] = useState<
    "approve" | "request-changes" | null
  >(null);
  const [summary, setSummary] = useState("");
  const [reviewerOpen, setReviewerOpen] = useState(false);
  const [reviewerSearch, setReviewerSearch] = useState("");
  const viewer = ownerPubkey.toLowerCase();
  const canRequestReview =
    viewer === project.owner.toLowerCase() ||
    viewer === pullRequest.author.toLowerCase();
  const canReview = canReviewProjectPullRequest(
    project,
    pullRequest,
    ownerPubkey,
  );
  const hasApproved = pullRequest.approvals.some(
    (approval) => approval.author.toLowerCase() === viewer,
  );
  const membershipQuery = useQuery({
    queryKey: ["community-membership", ownerPubkey],
    queryFn: () => getCommunityMembership(ownerPubkey),
    enabled: canRequestReview && reviewerOpen,
    staleTime: 30_000,
  });
  const existingReviewers = useMemo(
    () => new Set(pullRequest.reviewers.map((pubkey) => pubkey.toLowerCase())),
    [pullRequest.reviewers],
  );
  const candidates = useMemo(() => {
    const search = reviewerSearch.trim().toLowerCase();
    return (membershipQuery.data?.members ?? []).filter((member) => {
      const label = member.profile?.displayName?.trim() ?? "";
      return (
        member.pubkey !== pullRequest.author.toLowerCase() &&
        !existingReviewers.has(member.pubkey) &&
        (!search ||
          member.pubkey.includes(search) ||
          label.toLowerCase().includes(search))
      );
    });
  }, [
    existingReviewers,
    membershipQuery.data?.members,
    pullRequest.author,
    reviewerSearch,
  ]);
  const decisionMutation = useMutation({
    mutationFn: (input: {
      decision: "approve" | "request-changes";
      content: string;
    }) =>
      submitProjectPullRequestReview(
        project,
        pullRequest,
        ownerPubkey,
        input.decision,
        input.content,
      ),
    onSuccess: async (_, input) => {
      await onUpdated();
      setDecision(null);
      setSummary("");
      toast.success(
        input.decision === "approve"
          ? "Pull request approved"
          : "Changes requested",
      );
    },
    onError: (error) =>
      toast.error("Could not submit review", { description: error.message }),
  });
  const requestMutation = useMutation({
    mutationFn: (input: { pubkey: string; label: string }) =>
      requestProjectPullRequestReview(
        project,
        pullRequest,
        ownerPubkey,
        input.pubkey,
        input.label,
      ),
    onSuccess: async () => {
      await onUpdated();
      setReviewerOpen(false);
      setReviewerSearch("");
      toast.success("Review requested");
    },
    onError: (error) =>
      toast.error("Could not request review", { description: error.message }),
  });

  return (
    <>
      <section className="border-b py-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold">Review</h3>
            <p className="mt-1 text-sm text-muted-foreground">
              {reviewSummary(pullRequest)}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {canReview && !hasApproved ? (
              <Button onClick={() => setDecision("approve")} size="sm">
                <Check /> Approve
              </Button>
            ) : null}
            {canReview ? (
              <Button
                onClick={() => setDecision("request-changes")}
                size="sm"
                variant="outline"
              >
                <TriangleAlert /> Request changes
              </Button>
            ) : null}
          </div>
        </div>
        {pullRequest.reviewers.length || canRequestReview ? (
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <span className="text-xs font-medium text-muted-foreground">
              Reviewers
            </span>
            {pullRequest.reviewers.map((pubkey) => (
              <ReviewerBadge
                approvals={pullRequest.approvals.map((item) => item.author)}
                changeRequests={pullRequest.changeRequests.map(
                  (item) => item.author,
                )}
                key={pubkey}
                pubkey={pubkey}
              />
            ))}
            {canRequestReview ? (
              <Button
                onClick={() => setReviewerOpen(true)}
                size="sm"
                variant="ghost"
              >
                <UserPlus /> Add reviewer
              </Button>
            ) : null}
          </div>
        ) : null}
      </section>
      <DecisionDialog
        decision={decision}
        pending={decisionMutation.isPending}
        summary={summary}
        onClose={() => {
          setDecision(null);
          setSummary("");
        }}
        onSubmit={() => {
          if (decision) decisionMutation.mutate({ decision, content: summary });
        }}
        onSummaryChange={setSummary}
      />
      <ReviewerDialog
        candidates={candidates.map((member) => ({
          pubkey: member.pubkey,
          label:
            member.profile?.displayName?.trim() ||
            truncatePubkey(member.pubkey),
        }))}
        error={membershipQuery.error}
        loading={membershipQuery.isLoading}
        open={reviewerOpen}
        pending={requestMutation.isPending}
        search={reviewerSearch}
        onClose={() => setReviewerOpen(false)}
        onRequest={(candidate) => requestMutation.mutate(candidate)}
        onSearchChange={setReviewerSearch}
      />
    </>
  );
}

function reviewSummary(pullRequest: ProjectPullRequest): string {
  if (pullRequest.changeRequests.length) {
    const count = pullRequest.changeRequests.length;
    return `${count} reviewer${count === 1 ? "" : "s"} requested changes.`;
  }
  if (pullRequest.approvals.length) {
    const count = pullRequest.approvals.length;
    return `${count} approval${count === 1 ? "" : "s"}.`;
  }
  if (pullRequest.status === "draft") {
    return "This pull request is still a work in progress.";
  }
  return pullRequest.reviewers.length
    ? "Review requested - no approvals yet."
    : "No reviews yet.";
}

function ReviewerBadge({
  approvals,
  changeRequests,
  pubkey,
}: {
  approvals: string[];
  changeRequests: string[];
  pubkey: string;
}) {
  const approved = approvals.some(
    (author) => author.toLowerCase() === pubkey.toLowerCase(),
  );
  const changes = changeRequests.some(
    (author) => author.toLowerCase() === pubkey.toLowerCase(),
  );
  return (
    <span className="inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs">
      {approved ? (
        <Check className="h-3 w-3 text-green-600" />
      ) : changes ? (
        <TriangleAlert className="h-3 w-3 text-amber-600" />
      ) : null}
      {truncatePubkey(pubkey)}
    </span>
  );
}

function DecisionDialog({
  decision,
  pending,
  summary,
  onClose,
  onSubmit,
  onSummaryChange,
}: {
  decision: "approve" | "request-changes" | null;
  pending: boolean;
  summary: string;
  onClose: () => void;
  onSubmit: () => void;
  onSummaryChange: (value: string) => void;
}) {
  useEscapeSurface(decision !== null, onClose, pending);
  if (!decision) return null;
  const approving = decision === "approve";
  const title = approving ? "Approve pull request" : "Request changes";
  return (
    <div
      aria-label={title}
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4"
      role="dialog"
    >
      <div className="w-full max-w-md rounded-lg bg-background p-6 shadow-2xl">
        <header className="flex items-center gap-3">
          <h2 className="flex-1 text-lg font-semibold">{title}</h2>
          <Button
            aria-label="Close"
            disabled={pending}
            onClick={onClose}
            size="icon"
            variant="ghost"
          >
            <X />
          </Button>
        </header>
        <p className="mt-1 text-sm text-muted-foreground">
          {approving
            ? "Add an optional summary for the author and other reviewers."
            : "Describe what the author should change."}
        </p>
        <textarea
          aria-label={approving ? "Approval summary" : "Change request summary"}
          className="mt-4 min-h-28 w-full rounded-md border bg-background p-3 text-sm"
          disabled={pending}
          value={summary}
          onChange={(event) => onSummaryChange(event.target.value)}
        />
        <div className="mt-4 flex justify-end gap-2">
          <Button disabled={pending} onClick={onClose} variant="outline">
            Cancel
          </Button>
          <Button
            disabled={pending || (!approving && !summary.trim())}
            onClick={onSubmit}
          >
            {pending
              ? "Submitting..."
              : approving
                ? "Approve"
                : "Request changes"}
          </Button>
        </div>
      </div>
    </div>
  );
}

function ReviewerDialog({
  candidates,
  error,
  loading,
  open,
  pending,
  search,
  onClose,
  onRequest,
  onSearchChange,
}: {
  candidates: Array<{ pubkey: string; label: string }>;
  error: Error | null;
  loading: boolean;
  open: boolean;
  pending: boolean;
  search: string;
  onClose: () => void;
  onRequest: (candidate: { pubkey: string; label: string }) => void;
  onSearchChange: (value: string) => void;
}) {
  useEscapeSurface(open, onClose, pending);
  if (!open) return null;
  return (
    <div
      aria-label="Add reviewer"
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4"
      role="dialog"
    >
      <div className="w-full max-w-md rounded-lg bg-background p-6 shadow-2xl">
        <header className="flex items-center gap-3">
          <div className="flex-1">
            <h2 className="text-lg font-semibold">Add reviewer</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Choose a person or agent to review this pull request.
            </p>
          </div>
          <Button
            aria-label="Close"
            disabled={pending}
            onClick={onClose}
            size="icon"
            variant="ghost"
          >
            <X />
          </Button>
        </header>
        <div className="relative mt-4">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            aria-label="Search reviewers"
            className="pl-9"
            disabled={pending}
            placeholder="Search people and agents"
            value={search}
            onChange={(event) => onSearchChange(event.target.value)}
          />
        </div>
        <div className="mt-3 max-h-72 divide-y overflow-y-auto rounded-md border">
          {loading ? (
            <p className="p-4 text-sm text-muted-foreground">Searching...</p>
          ) : error ? (
            <p className="p-4 text-sm text-destructive">{error.message}</p>
          ) : candidates.length ? (
            candidates.map((candidate) => (
              <button
                className="block w-full px-3 py-3 text-left hover:bg-muted"
                disabled={pending}
                key={candidate.pubkey}
                onClick={() => onRequest(candidate)}
                type="button"
              >
                <span className="block text-sm font-medium">
                  {candidate.label}
                </span>
                <span className="block text-xs text-muted-foreground">
                  {truncatePubkey(candidate.pubkey)}
                </span>
              </button>
            ))
          ) : (
            <p className="p-4 text-sm text-muted-foreground">
              No available reviewers.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
