import { useMutation } from "@tanstack/react-query";
import { GitMerge, X } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { useEscapeSurface } from "@/shared/hooks/use-escape-surface";
import { Button } from "@/shared/ui/button";
import {
  publishProjectPullRequestMergedStatus,
  type Project,
  type ProjectPullRequest,
} from "../project-api";
import { mergeProjectPullRequest } from "../project-merge";

export function MergePullRequestControl({
  onUpdated,
  ownerPubkey,
  project,
  pullRequest,
}: {
  onUpdated: () => Promise<unknown>;
  ownerPubkey: string;
  project: Project;
  pullRequest: ProjectPullRequest;
}) {
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [unpublishedMergeCommit, setUnpublishedMergeCommit] = useState<
    string | null
  >(null);
  const mutation = useMutation({
    mutationFn: async () => {
      const mergeCommit = await mergeProjectPullRequest(
        project,
        pullRequest,
        ownerPubkey,
      );
      try {
        await publishProjectPullRequestMergedStatus(
          project,
          pullRequest,
          ownerPubkey,
          mergeCommit,
        );
        return { mergeCommit, statusPublished: true };
      } catch {
        return { mergeCommit, statusPublished: false };
      }
    },
    onSuccess: async (result) => {
      setConfirmOpen(false);
      if (result.statusPublished) {
        setUnpublishedMergeCommit(null);
        await onUpdated();
        toast.success("Pull request merged");
      } else {
        setUnpublishedMergeCommit(result.mergeCommit);
        toast.warning(
          "The branch was merged, but merged status was not published.",
        );
      }
    },
    onError: (error) =>
      toast.error("Could not merge pull request", {
        description: error.message,
      }),
  });
  const retryMutation = useMutation({
    mutationFn: async () => {
      if (!unpublishedMergeCommit)
        throw new Error("No merge status to publish.");
      await publishProjectPullRequestMergedStatus(
        project,
        pullRequest,
        ownerPubkey,
        unpublishedMergeCommit,
      );
    },
    onSuccess: async () => {
      setUnpublishedMergeCommit(null);
      await onUpdated();
      toast.success("Published merged pull request status");
    },
    onError: (error) =>
      toast.error("Could not publish merged status", {
        description: error.message,
      }),
  });
  const pending = mutation.isPending || retryMutation.isPending;
  useEscapeSurface(confirmOpen, () => setConfirmOpen(false), pending);

  if (
    ownerPubkey.toLowerCase() !== project.owner.toLowerCase() ||
    pullRequest.status !== "open" ||
    !pullRequest.branchName ||
    !pullRequest.commit
  ) {
    return null;
  }

  return (
    <>
      <Button
        disabled={pending}
        onClick={() => {
          if (unpublishedMergeCommit) retryMutation.mutate();
          else setConfirmOpen(true);
        }}
        size="sm"
      >
        <GitMerge />
        {retryMutation.isPending
          ? "Publishing..."
          : unpublishedMergeCommit
            ? "Publish merged status"
            : "Merge"}
      </Button>
      {confirmOpen ? (
        <div
          aria-label="Merge pull request"
          aria-modal="true"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4"
          role="dialog"
        >
          <div className="w-full max-w-md rounded-lg bg-background p-6 shadow-2xl">
            <header className="flex items-center gap-3">
              <h2 className="flex-1 text-lg font-semibold">
                Merge pull request?
              </h2>
              <Button
                aria-label="Close"
                disabled={pending}
                onClick={() => setConfirmOpen(false)}
                size="icon"
                variant="ghost"
              >
                <X />
              </Button>
            </header>
            <p className="mt-2 text-sm text-muted-foreground">
              Merge {pullRequest.branchName} into{" "}
              {pullRequest.targetBranch ?? project.defaultBranch} and push the
              result to the repository. The relay will reject the operation if
              the branch changed or repository policy does not allow it.
            </p>
            <div className="mt-5 flex justify-end gap-2">
              <Button
                disabled={pending}
                onClick={() => setConfirmOpen(false)}
                variant="outline"
              >
                Cancel
              </Button>
              <Button disabled={pending} onClick={() => mutation.mutate()}>
                {mutation.isPending ? "Merging..." : "Merge pull request"}
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
