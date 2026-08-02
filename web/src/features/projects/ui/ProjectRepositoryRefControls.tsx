import { GitBranch, Loader2, Plus, RefreshCw, Trash2, X } from "lucide-react";
import { useEffect, useState } from "react";

import { useEscapeSurface } from "@/shared/hooks/use-escape-surface";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import {
  normalizeProjectBranchName,
  projectBranchNameError,
} from "../project-branches";

export type RepositoryRefControlsProps = {
  activeCommit: string | null;
  branches: string[];
  tags: string[];
  tagCommits: Record<string, string>;
  selectedValue: string;
  createPending: boolean;
  deletePending: boolean;
  deleteReason: string | null;
  isRefreshing: boolean;
  onSelect: (value: string) => void;
  onCreate: () => void;
  onDelete: () => void;
  onRefresh: () => void;
};

export function ProjectRepositoryRefControls({
  activeCommit,
  branches,
  tags,
  tagCommits,
  selectedValue,
  createPending,
  deletePending,
  deleteReason,
  isRefreshing,
  onSelect,
  onCreate,
  onDelete,
  onRefresh,
}: RepositoryRefControlsProps) {
  const tagSelected = selectedValue.startsWith("tag:");
  return (
    <div className="flex min-h-14 min-w-0 items-center gap-2 border-b py-3">
      <select
        aria-label="Repository branch or tag"
        className="h-8 min-w-0 max-w-64 rounded-md border bg-background px-2 font-mono text-sm"
        onChange={(event) => onSelect(event.target.value)}
        value={selectedValue}
      >
        <optgroup label="Branches">
          {branches.map((branch) => (
            <option key={branch} value={`branch:${branch}`}>
              {branch}
            </option>
          ))}
        </optgroup>
        {tags.length ? (
          <optgroup label="Tags">
            {tags.map((tagName) => (
              <option key={tagName} value={`tag:${tagName}`}>
                {tagName} ({tagCommits[tagName]?.slice(0, 7)})
              </option>
            ))}
          </optgroup>
        ) : null}
      </select>
      {!tagSelected ? (
        <>
          <Button
            aria-label="Create branch"
            disabled={createPending || !activeCommit}
            onClick={onCreate}
            size="icon"
            title={
              activeCommit
                ? "Create a remote branch"
                : "Refresh the repository before creating a branch"
            }
            variant="ghost"
          >
            <Plus />
          </Button>
          <Button
            aria-label="Delete branch"
            disabled={deletePending || Boolean(deleteReason)}
            onClick={onDelete}
            size="icon"
            title={deleteReason ?? "Delete this remote branch"}
            variant="ghost"
          >
            <Trash2 />
          </Button>
        </>
      ) : null}
      <Button
        aria-label="Refresh repository"
        className="ml-auto"
        disabled={isRefreshing}
        onClick={onRefresh}
        size="icon"
        title="Check for remote changes"
        variant="ghost"
      >
        <RefreshCw className={isRefreshing ? "animate-spin" : ""} />
      </Button>
    </div>
  );
}

export function CreateBranchDialog({
  activeBranch,
  activeCommit,
  branches,
  error,
  onClose,
  onCreate,
  open,
  pending,
}: {
  activeBranch: string;
  activeCommit: string | null;
  branches: string[];
  error: Error | null;
  onClose: () => void;
  onCreate: (branch: string) => Promise<unknown>;
  open: boolean;
  pending: boolean;
}) {
  const [branchName, setBranchName] = useState("");
  useEscapeSurface(open, onClose, pending);
  useEffect(() => {
    if (open) setBranchName("");
  }, [open]);
  if (!open) return null;
  const validationError = projectBranchNameError(branchName, branches);
  return (
    <div
      aria-label="Create branch"
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4"
      role="dialog"
    >
      <form
        className="w-full max-w-md rounded-lg bg-background p-5 shadow-2xl"
        onSubmit={(event) => {
          event.preventDefault();
          const branch = normalizeProjectBranchName(branchName);
          if (!branch || validationError || !activeCommit) return;
          void onCreate(branch).catch(() => {});
        }}
      >
        <header className="flex items-center gap-3">
          <GitBranch className="h-5 w-5 text-muted-foreground" />
          <h2 className="min-w-0 flex-1 text-lg font-semibold">
            Create branch
          </h2>
          <Button
            aria-label="Close"
            disabled={pending}
            onClick={onClose}
            size="icon"
            type="button"
            variant="ghost"
          >
            <X />
          </Button>
        </header>
        <p className="mt-3 text-sm text-muted-foreground">
          Create a remote branch from{" "}
          <span className="font-mono text-foreground">{activeBranch}</span>
          {activeCommit ? ` at ${activeCommit.slice(0, 7)}` : ""}.
        </p>
        <label className="mt-5 block text-sm font-medium" htmlFor="branch-name">
          Branch name
        </label>
        <Input
          autoFocus
          className="mt-2"
          disabled={pending}
          id="branch-name"
          onChange={(event) => setBranchName(event.target.value)}
          placeholder="feature/my-change"
          value={branchName}
        />
        {branchName && validationError ? (
          <p className="mt-2 text-sm text-destructive">{validationError}</p>
        ) : null}
        {error ? (
          <p className="mt-2 text-sm text-destructive">{error.message}</p>
        ) : null}
        <div className="mt-6 flex justify-end gap-2">
          <Button
            disabled={pending}
            onClick={onClose}
            type="button"
            variant="outline"
          >
            Cancel
          </Button>
          <Button
            disabled={pending || Boolean(validationError) || !activeCommit}
            type="submit"
          >
            {pending ? <Loader2 className="animate-spin" /> : <GitBranch />}
            {pending ? "Creating..." : "Create branch"}
          </Button>
        </div>
      </form>
    </div>
  );
}
