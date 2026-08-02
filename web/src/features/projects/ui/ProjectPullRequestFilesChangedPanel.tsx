import { useMutation } from "@tanstack/react-query";
import {
  FileDiff,
  Files,
  GitCommitHorizontal,
  MessageSquarePlus,
  Search,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import { cn } from "@/shared/lib/cn";
import { truncatePubkey } from "@/shared/lib/pubkey";
import { Button } from "@/shared/ui/button";
import {
  canReviewProjectPullRequest,
  createProjectPullRequestInlineComment,
  type Project,
  type ProjectPullRequest,
  type ProjectPullRequestCommentAnchor,
} from "../project-api";
import type { ProjectDiff, ProjectDiffFile } from "../project-diff";

type DiffRow = {
  content: string;
  key: string;
  newLine: number | null;
  oldLine: number | null;
  type: "add" | "context" | "delete" | "hunk";
};

function diffRows(file: ProjectDiffFile): DiffRow[] {
  let oldLine = 0;
  let newLine = 0;
  return file.patch
    .trimEnd()
    .split("\n")
    .filter(
      (line) =>
        !line.startsWith("diff --git ") &&
        !line.startsWith("index ") &&
        !line.startsWith("--- ") &&
        !line.startsWith("+++ "),
    )
    .map((line, index) => {
      const hunk = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/u.exec(line);
      if (hunk) {
        oldLine = Number(hunk[1]);
        newLine = Number(hunk[2]);
        return {
          content: line,
          key: `${file.path}:${index}`,
          oldLine: null,
          newLine: null,
          type: "hunk" as const,
        };
      }
      if (line.startsWith("+")) {
        return {
          content: line.slice(1),
          key: `${file.path}:${index}`,
          oldLine: null,
          newLine: newLine++,
          type: "add" as const,
        };
      }
      if (line.startsWith("-")) {
        return {
          content: line.slice(1),
          key: `${file.path}:${index}`,
          oldLine: oldLine++,
          newLine: null,
          type: "delete" as const,
        };
      }
      return {
        content: line.startsWith(" ") ? line.slice(1) : line,
        key: `${file.path}:${index}`,
        oldLine: oldLine++,
        newLine: newLine++,
        type: "context" as const,
      };
    });
}

function anchorForRow(
  file: ProjectDiffFile,
  row: DiffRow,
): ProjectPullRequestCommentAnchor | null {
  if (row.type === "hunk") return null;
  const side = row.type === "delete" ? "old" : "new";
  const line = side === "old" ? row.oldLine : row.newLine;
  return line ? { path: file.path, side, line } : null;
}

function sameAnchor(
  left: ProjectPullRequestCommentAnchor | null,
  right: ProjectPullRequestCommentAnchor | null,
) {
  return Boolean(
    left &&
      right &&
      left.path === right.path &&
      left.side === right.side &&
      left.line === right.line,
  );
}

export function ProjectPullRequestFilesChangedPanel({
  diff,
  error,
  focusedAnchor,
  isLoading,
  ownerPubkey,
  project,
  pullRequest,
  onUpdated,
}: {
  diff: ProjectDiff | undefined;
  error: Error | null;
  focusedAnchor: ProjectPullRequestCommentAnchor | null;
  isLoading: boolean;
  ownerPubkey: string;
  project: Project;
  pullRequest: ProjectPullRequest;
  onUpdated: () => Promise<unknown>;
}) {
  const [query, setQuery] = useState("");
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [activeAnchor, setActiveAnchor] =
    useState<ProjectPullRequestCommentAnchor | null>(null);
  const [comment, setComment] = useState("");
  const files = diff?.files ?? [];
  const filteredFiles = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return needle
      ? files.filter((file) => file.path.toLowerCase().includes(needle))
      : files;
  }, [files, query]);
  const selectedFile =
    filteredFiles.find((file) => file.path === selectedPath) ??
    filteredFiles[0] ??
    null;
  const canRequestChanges = canReviewProjectPullRequest(
    project,
    pullRequest,
    ownerPubkey,
  );
  const mutation = useMutation({
    mutationFn: (decision?: "request-changes") => {
      if (!activeAnchor) throw new Error("No diff line is selected.");
      return createProjectPullRequestInlineComment(
        project,
        pullRequest,
        ownerPubkey,
        comment,
        activeAnchor,
        decision,
      );
    },
    onSuccess: async (_, decision) => {
      setActiveAnchor(null);
      setComment("");
      await onUpdated();
      toast.success(decision ? "Changes requested" : "Line comment posted");
    },
    onError: (mutationError) =>
      toast.error("Could not post line comment", {
        description: mutationError.message,
      }),
  });

  useEffect(() => {
    if (!selectedFile) setSelectedPath(null);
    else if (selectedPath !== selectedFile.path)
      setSelectedPath(selectedFile.path);
  }, [selectedFile, selectedPath]);

  useEffect(() => {
    if (!focusedAnchor) return;
    setQuery("");
    setSelectedPath(focusedAnchor.path);
  }, [focusedAnchor]);

  if (isLoading) {
    return (
      <p className="p-4 text-sm text-muted-foreground">
        Loading changed files...
      </p>
    );
  }
  if (error) {
    return (
      <div className="space-y-1 p-4 text-sm text-muted-foreground">
        <p>Could not load changed files for this pull request.</p>
        <p className="break-words font-mono text-xs">{error.message}</p>
      </div>
    );
  }
  if (!files.length) {
    return (
      <p className="p-6 text-center text-sm text-muted-foreground">
        No changed files are available for this pull request yet.
      </p>
    );
  }

  return (
    <div className="grid min-h-0 overflow-hidden lg:grid-cols-[17rem_minmax(0,1fr)]">
      <aside className="border-b bg-background/30 lg:border-r lg:border-b-0">
        <div className="space-y-3 p-3">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Files className="h-3.5 w-3.5" />
            <span>{files.length} changed files</span>
          </div>
          <label className="flex h-8 items-center gap-2 border bg-background px-2 text-xs text-muted-foreground">
            <Search className="h-3.5 w-3.5" />
            <input
              aria-label="Filter changed files"
              className="min-w-0 flex-1 bg-transparent text-foreground outline-none"
              placeholder="Filter files..."
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </label>
        </div>
        <nav className="max-h-56 overflow-auto border-t py-1 lg:max-h-96">
          {filteredFiles.map((file) => (
            <button
              className={cn(
                "flex w-full items-center gap-2 px-3 py-2 text-left text-xs text-muted-foreground hover:bg-muted/40 hover:text-foreground",
                selectedFile?.path === file.path &&
                  "bg-muted/50 text-foreground",
              )}
              key={file.path}
              onClick={() => setSelectedPath(file.path)}
              type="button"
            >
              <FileDiff className="h-3.5 w-3.5 shrink-0" />
              <span className="min-w-0 flex-1 truncate">{file.path}</span>
            </button>
          ))}
        </nav>
      </aside>
      <section className="min-w-0">
        <header className="flex min-h-12 flex-wrap items-center justify-between gap-2 border-b bg-background/30 px-4 py-2 text-xs text-muted-foreground">
          <span className="flex min-w-0 items-center gap-2">
            <GitCommitHorizontal className="h-3.5 w-3.5 shrink-0" />
            <span className="truncate">
              {pullRequest.title} · {pullRequest.commit?.slice(0, 7) ?? "PR"}
            </span>
          </span>
          <span className="flex items-center gap-3">
            <span>{files.length} files changed</span>
            <span className="text-green-600">+{diff?.additions ?? 0}</span>
            <span className="text-destructive">-{diff?.deletions ?? 0}</span>
          </span>
        </header>
        <div className="p-3">
          {selectedFile ? (
            <DiffFile
              activeAnchor={activeAnchor}
              comment={comment}
              comments={pullRequest.comments.filter(
                (item) => item.anchor && item.inlineCommentStatus === "current",
              )}
              file={selectedFile}
              focusedAnchor={focusedAnchor}
              pending={mutation.isPending}
              canRequestChanges={canRequestChanges}
              onAnchorChange={(anchor) => {
                setActiveAnchor(anchor);
                setComment("");
              }}
              onCommentChange={setComment}
              onSubmit={(decision) => mutation.mutate(decision)}
            />
          ) : (
            <p className="p-4 text-sm text-muted-foreground">
              No files match this filter.
            </p>
          )}
        </div>
      </section>
    </div>
  );
}

function DiffFile({
  activeAnchor,
  canRequestChanges,
  comment,
  comments,
  file,
  focusedAnchor,
  pending,
  onAnchorChange,
  onCommentChange,
  onSubmit,
}: {
  activeAnchor: ProjectPullRequestCommentAnchor | null;
  canRequestChanges: boolean;
  comment: string;
  comments: ProjectPullRequest["comments"];
  file: ProjectDiffFile;
  focusedAnchor: ProjectPullRequestCommentAnchor | null;
  pending: boolean;
  onAnchorChange: (anchor: ProjectPullRequestCommentAnchor | null) => void;
  onCommentChange: (value: string) => void;
  onSubmit: (decision?: "request-changes") => void;
}) {
  const rows = diffRows(file);
  return (
    <article className="overflow-hidden border bg-background">
      <header className="flex min-h-10 items-center justify-between gap-3 border-b bg-muted/20 px-3 text-xs">
        <span className="min-w-0 truncate font-medium">{file.path}</span>
        <span className="flex shrink-0 gap-2 text-muted-foreground">
          <span className="text-green-600">+{file.additions}</span>
          <span className="text-destructive">-{file.deletions}</span>
        </span>
      </header>
      {file.truncated ? (
        <p className="border-b bg-amber-500/10 px-4 py-2 text-xs text-amber-700">
          Large diff truncated. Use a local checkout to review the full change.
        </p>
      ) : null}
      {rows.length ? (
        <div className="overflow-x-auto font-mono text-xs leading-5">
          <div className="min-w-[44rem]">
            {rows.map((row) => {
              const anchor = anchorForRow(file, row);
              const lineComments = comments.filter((item) =>
                sameAnchor(item.anchor, anchor),
              );
              const active = sameAnchor(activeAnchor, anchor);
              const focused = sameAnchor(focusedAnchor, anchor);
              return (
                <div key={row.key}>
                  <div
                    className={cn(
                      "group grid min-h-5 grid-cols-[3rem_3rem_2rem_1.5rem_minmax(0,1fr)]",
                      row.type === "add" && "bg-green-500/10",
                      row.type === "delete" && "bg-destructive/10",
                      row.type === "hunk" && "bg-sky-500/10 text-sky-600",
                      focused &&
                        "bg-primary/10 ring-1 ring-inset ring-primary/40",
                    )}
                  >
                    <span className="select-none border-r px-2 text-right text-muted-foreground">
                      {row.oldLine ?? " "}
                    </span>
                    <span className="select-none border-r px-2 text-right text-muted-foreground">
                      {row.newLine ?? " "}
                    </span>
                    <span className="flex items-center justify-center">
                      {anchor ? (
                        <button
                          aria-label={`Comment on ${anchor.path} ${anchor.side} line ${anchor.line}`}
                          className={cn(
                            "flex h-5 w-5 items-center justify-center text-muted-foreground opacity-0 hover:bg-primary hover:text-primary-foreground focus-visible:opacity-100 group-hover:opacity-100",
                            (lineComments.length > 0 || active) &&
                              "opacity-100",
                          )}
                          title="Add line comment"
                          type="button"
                          onClick={() => onAnchorChange(anchor)}
                        >
                          <MessageSquarePlus className="h-3.5 w-3.5" />
                        </button>
                      ) : null}
                    </span>
                    <span
                      className={cn(
                        "select-none px-2",
                        row.type === "add" && "text-green-600",
                        row.type === "delete" && "text-destructive",
                      )}
                    >
                      {row.type === "add"
                        ? "+"
                        : row.type === "delete"
                          ? "-"
                          : " "}
                    </span>
                    <code className="whitespace-pre pr-3">
                      {row.content || " "}
                    </code>
                  </div>
                  {anchor && (lineComments.length > 0 || active) ? (
                    <div className="border-y bg-background px-3 py-2 font-sans">
                      {lineComments.map((item) => (
                        <article
                          className="border-b py-2 last:border-b-0"
                          key={item.id}
                        >
                          <p className="text-xs text-muted-foreground">
                            {truncatePubkey(item.author)} ·{" "}
                            {new Date(item.createdAt * 1000).toLocaleString()}
                          </p>
                          <p className="mt-1 whitespace-pre-wrap text-sm">
                            {item.content}
                          </p>
                        </article>
                      ))}
                      {active ? (
                        <form
                          className="mt-2"
                          onSubmit={(event) => {
                            event.preventDefault();
                            if (comment.trim()) onSubmit();
                          }}
                        >
                          <textarea
                            aria-label={`Comment on ${anchor.path} ${anchor.side} line ${anchor.line}`}
                            className="min-h-20 w-full border bg-background p-2 text-sm"
                            disabled={pending}
                            placeholder="Leave a comment on this line..."
                            value={comment}
                            onChange={(event) =>
                              onCommentChange(event.target.value)
                            }
                          />
                          <div className="mt-2 flex flex-wrap justify-end gap-2">
                            <Button
                              disabled={pending}
                              size="sm"
                              type="button"
                              variant="ghost"
                              onClick={() => onAnchorChange(null)}
                            >
                              Cancel
                            </Button>
                            {canRequestChanges ? (
                              <Button
                                disabled={!comment.trim() || pending}
                                size="sm"
                                type="button"
                                variant="outline"
                                onClick={() => onSubmit("request-changes")}
                              >
                                Request changes
                              </Button>
                            ) : null}
                            <Button
                              disabled={!comment.trim() || pending}
                              size="sm"
                              type="submit"
                            >
                              Comment
                            </Button>
                          </div>
                        </form>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        </div>
      ) : (
        <p className="p-4 text-sm text-muted-foreground">
          No textual diff is available for this file.
        </p>
      )}
    </article>
  );
}
