import { X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import type { RepoRefs } from "@/features/repos/use-repo-refs";
import { useEscapeSurface } from "@/shared/hooks/use-escape-surface";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import type { Project, ProjectPullRequest } from "../project-api";

const EMPTY_BRANCHES: string[] = [];

export type CreatePullRequestInput = {
  title: string;
  content: string;
  branch: string;
  targetBranch: string;
  commit: string;
};

export function CreatePullRequestDialog({
  existingPullRequests,
  open,
  pending,
  project,
  refs,
  refsError,
  refsLoading,
  onClose,
  onSubmit,
}: {
  existingPullRequests: ProjectPullRequest[];
  open: boolean;
  pending: boolean;
  project: Project;
  refs: RepoRefs | undefined;
  refsError: Error | null;
  refsLoading: boolean;
  onClose: () => void;
  onSubmit: (input: CreatePullRequestInput) => Promise<void>;
}) {
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [targetBranch, setTargetBranch] = useState("");
  const [sourceBranch, setSourceBranch] = useState("");
  const branches = refs?.branches ?? EMPTY_BRANCHES;

  useEffect(() => {
    if (!open) return;
    const target = refs?.head?.ref ?? branches[0] ?? "";
    setTargetBranch(target);
    setSourceBranch(branches.find((branch) => branch !== target) ?? "");
  }, [branches, open, refs?.head?.ref]);

  const sourceCommit = refs?.branchCommits[sourceBranch] ?? null;
  const selectionError = useMemo(() => {
    if (refsLoading) return "Loading verified branches...";
    if (refsError) return refsError.message;
    if (!targetBranch) return "Choose a base branch.";
    if (!sourceBranch)
      return "Push another branch before opening a pull request.";
    if (sourceBranch === targetBranch) {
      return "The base and compare branches must be different.";
    }
    if (!sourceCommit) return "The compare branch must be pushed first.";
    if (
      existingPullRequests.some(
        (pullRequest) =>
          (pullRequest.status === "open" || pullRequest.status === "draft") &&
          pullRequest.branchName === sourceBranch &&
          (pullRequest.targetBranch ?? refs?.head?.ref) === targetBranch,
      )
    ) {
      return "An open pull request already compares these branches.";
    }
    return null;
  }, [
    existingPullRequests,
    refs?.head?.ref,
    refsError,
    refsLoading,
    sourceBranch,
    sourceCommit,
    targetBranch,
  ]);

  useEscapeSurface(open, onClose, pending);
  if (!open) return null;
  return (
    <div
      aria-label="Open a pull request"
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4"
      role="dialog"
    >
      <div className="w-full max-w-lg rounded-lg bg-background p-6 shadow-2xl">
        <header className="mb-5 flex items-center">
          <div className="min-w-0 flex-1">
            <h2 className="text-lg font-semibold">Open a pull request</h2>
            <p className="mt-1 truncate text-xs text-muted-foreground">
              {project.name}
              {sourceBranch && targetBranch
                ? `: ${sourceBranch} → ${targetBranch}${sourceCommit ? ` at ${sourceCommit.slice(0, 7)}` : ""}`
                : ""}
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
        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            if (!selectionError && sourceCommit && title.trim()) {
              void onSubmit({
                title,
                content,
                branch: sourceBranch,
                targetBranch,
                commit: sourceCommit,
              });
            }
          }}
        >
          <div className="grid gap-3 sm:grid-cols-2">
            <BranchField
              disabled={pending || refsLoading}
              id="pull-request-base"
              label="Base"
              value={targetBranch}
              branches={branches}
              onChange={setTargetBranch}
            />
            <BranchField
              disabled={pending || refsLoading}
              id="pull-request-compare"
              label="Compare"
              value={sourceBranch}
              branches={branches}
              onChange={setSourceBranch}
            />
          </div>
          {selectionError ? (
            <p className="text-xs text-muted-foreground">{selectionError}</p>
          ) : null}
          <label
            className="block text-sm font-medium"
            htmlFor="pull-request-title"
          >
            Title
            <Input
              className="mt-2"
              disabled={pending}
              id="pull-request-title"
              maxLength={256}
              value={title}
              onChange={(event) => setTitle(event.target.value)}
            />
          </label>
          <label
            className="block text-sm font-medium"
            htmlFor="pull-request-description"
          >
            Description
            <textarea
              className="mt-2 min-h-28 w-full rounded-md border bg-background p-3 text-sm"
              disabled={pending}
              id="pull-request-description"
              placeholder="Add context for reviewers"
              value={content}
              onChange={(event) => setContent(event.target.value)}
            />
          </label>
          <div className="flex justify-end gap-2">
            <Button
              disabled={pending}
              onClick={onClose}
              type="button"
              variant="outline"
            >
              Cancel
            </Button>
            <Button
              disabled={pending || Boolean(selectionError) || !title.trim()}
              type="submit"
            >
              {pending ? "Creating..." : "Open pull request"}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}

function BranchField({
  branches,
  disabled,
  id,
  label,
  value,
  onChange,
}: {
  branches: string[];
  disabled: boolean;
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="text-sm font-medium" htmlFor={id}>
      {label}
      <select
        className="mt-2 h-10 w-full rounded-md border bg-background px-3 text-sm font-normal"
        disabled={disabled}
        id={id}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      >
        <option disabled value="">
          Select branch
        </option>
        {branches.map((branch) => (
          <option key={branch} value={branch}>
            {branch}
          </option>
        ))}
      </select>
    </label>
  );
}
