import { useQuery } from "@tanstack/react-query";
import {
  ArrowLeft,
  Check,
  Copy,
  FileDiff,
  GitCommitHorizontal,
} from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import type { CommitInfo } from "@/features/repos/git-client";
import { cn } from "@/shared/lib/cn";
import { Button } from "@/shared/ui/button";
import { loadProjectCommitDiff, type ProjectDiffFile } from "../project-diff";
import type { Project } from "../project-api";

export function ProjectCommitDetail({
  commit,
  onBack,
  project,
  refName,
}: {
  commit: CommitInfo;
  onBack: () => void;
  project: Project;
  refName: string;
}) {
  const [copied, setCopied] = useState(false);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const diff = useQuery({
    queryKey: ["project-commit-diff", project.repoAddress, commit.oid],
    queryFn: () => loadProjectCommitDiff(project, refName, commit.oid),
  });
  const files = diff.data?.files ?? [];
  const selectedFile =
    files.find((file) => file.path === selectedPath) ?? files[0] ?? null;
  const [subject, ...bodyLines] = commit.message.split("\n");
  const body = bodyLines.join("\n").trim();
  return (
    <div className="space-y-4">
      <Button onClick={onBack} variant="ghost">
        <ArrowLeft /> Back to commits
      </Button>
      <header className="border p-4">
        <p className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
          <GitCommitHorizontal className="h-3.5 w-3.5" />
          Commit from {commit.author.name || commit.author.email}
        </p>
        <h3 className="mt-2 text-base font-semibold">{subject}</h3>
        <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <span className="font-mono">{commit.oid.slice(0, 7)}</span>
          <Button
            aria-label="Copy commit hash"
            onClick={() => {
              void navigator.clipboard
                .writeText(commit.oid)
                .then(() => {
                  setCopied(true);
                  setTimeout(() => setCopied(false), 2_000);
                })
                .catch(() => toast.error("Could not copy commit hash"));
            }}
            size="icon"
            title="Copy commit hash"
            variant="ghost"
          >
            {copied ? <Check /> : <Copy />}
          </Button>
          <span>·</span>
          <time
            dateTime={new Date(commit.author.timestamp * 1_000).toISOString()}
          >
            {new Date(commit.author.timestamp * 1_000).toLocaleString()}
          </time>
        </div>
        {body ? (
          <p className="mt-4 whitespace-pre-wrap text-sm">{body}</p>
        ) : null}
      </header>
      {diff.isLoading ? (
        <p className="p-4 text-sm text-muted-foreground">
          Loading commit changes...
        </p>
      ) : diff.error ? (
        <div className="space-y-1 p-4 text-sm text-muted-foreground">
          <p>Could not load changed files for this commit.</p>
          <p className="break-words font-mono text-xs">{diff.error.message}</p>
        </div>
      ) : selectedFile ? (
        <div className="grid min-h-0 overflow-hidden border lg:grid-cols-[17rem_minmax(0,1fr)]">
          <aside className="border-b lg:border-r lg:border-b-0">
            <div className="flex items-center gap-2 border-b p-3 text-xs text-muted-foreground">
              <FileDiff className="h-3.5 w-3.5" />
              {files.length} changed files
            </div>
            <nav className="max-h-72 overflow-auto py-1">
              {files.map((file) => (
                <button
                  className={cn(
                    "flex w-full items-center gap-2 px-3 py-2 text-left text-xs text-muted-foreground hover:bg-muted/40 hover:text-foreground",
                    selectedFile.path === file.path &&
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
          <section className="min-w-0 p-3">
            <CommitDiffFile file={selectedFile} />
          </section>
        </div>
      ) : (
        <p className="p-6 text-center text-sm text-muted-foreground">
          No changed files are available for this commit.
        </p>
      )}
    </div>
  );
}

function CommitDiffFile({ file }: { file: ProjectDiffFile }) {
  const occurrences = new Map<string, number>();
  const lines = file.patch
    .trimEnd()
    .split("\n")
    .map((line) => {
      const occurrence = (occurrences.get(line) ?? 0) + 1;
      occurrences.set(line, occurrence);
      return { key: `${line}\0${occurrence}`, line };
    });
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
      {file.patch ? (
        <pre className="overflow-x-auto text-xs leading-5">
          {lines.map(({ key, line }) => (
            <code
              className={cn(
                "block min-w-max whitespace-pre px-3",
                line.startsWith("+") &&
                  !line.startsWith("+++") &&
                  "bg-green-500/10 text-green-700",
                line.startsWith("-") &&
                  !line.startsWith("---") &&
                  "bg-destructive/10 text-destructive",
                line.startsWith("@@") && "bg-sky-500/10 text-sky-600",
              )}
              key={key}
            >
              {line || " "}
            </code>
          ))}
        </pre>
      ) : (
        <p className="p-4 text-sm text-muted-foreground">
          No textual diff is available for this file.
        </p>
      )}
    </article>
  );
}
