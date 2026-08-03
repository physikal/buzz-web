import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { GitBranch, Tag, Users } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import type { CommitInfo } from "@/features/repos/git-client";
import { useGitLog, useGitReadme } from "@/features/repos/use-git-browse";
import { useRepoRefs } from "@/features/repos/use-repo-refs";
import { RepoCommitsSection } from "@/features/repos/ui/RepoCommitsSection";
import { RepoReadmeSection } from "@/features/repos/ui/RepoReadmeSection";
import { truncatePubkey } from "@/shared/lib/pubkey";
import { DestructiveConfirmDialog } from "@/shared/ui/destructive-confirm-dialog";
import {
  createProjectRemoteBranch,
  deleteProjectRemoteBranch,
} from "../project-branches";
import { listProjectPullRequests, type Project } from "../project-api";
import { useProjectRepositoryMetadata } from "../project-repository-metadata";
import { ProjectCommitDetail } from "./ProjectCommitDetail";
import {
  CreateBranchDialog,
  ProjectRepositoryRefControls,
  type RepositoryRefControlsProps,
} from "./ProjectRepositoryRefControls";
import { ProjectFilesBrowser } from "./ProjectFilesBrowser";
import { ProjectOverviewRail } from "./ProjectOverviewRail";

export type ProjectRepositoryView =
  | "overview"
  | "files"
  | "commits"
  | "contributors";

export function ProjectRepositoryPanel({
  initialCommitOid,
  onViewChange,
  project,
  view,
}: {
  initialCommitOid?: string;
  onViewChange?: (view: ProjectRepositoryView) => void;
  project: Project;
  view: ProjectRepositoryView;
}) {
  const queryClient = useQueryClient();
  const refsQuery = useRepoRefs(project.dtag);
  const pullRequestsQuery = useQuery({
    queryKey: ["project-pull-requests", project.repoAddress],
    queryFn: () => listProjectPullRequests(project),
  });
  const [selectedRef, setSelectedRef] = useState<{
    type: "branch" | "tag";
    name: string;
  } | null>(null);
  const [localBranchCommits, setLocalBranchCommits] = useState<
    Record<string, string>
  >({});
  const [hiddenBranches, setHiddenBranches] = useState<string[]>([]);
  const [createOpen, setCreateOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);

  const branchCommits = {
    ...(refsQuery.data?.branchCommits ?? {}),
    ...localBranchCommits,
  };
  for (const branch of hiddenBranches) delete branchCommits[branch];
  const defaultBranch = refsQuery.data?.head?.ref ?? project.defaultBranch;
  const branches = [...new Set([...Object.keys(branchCommits), defaultBranch])]
    .filter(Boolean)
    .sort();
  const activeBranch =
    selectedRef?.type === "branch" ? selectedRef.name : defaultBranch;
  const refName = selectedRef?.name ?? defaultBranch;
  const activeCommit = branchCommits[activeBranch] ?? null;
  const hasOpenPullRequest = (pullRequestsQuery.data ?? []).some(
    (pullRequest) =>
      pullRequest.branchName === activeBranch &&
      (pullRequest.status === "open" || pullRequest.status === "draft"),
  );
  const deleteReason =
    activeBranch === defaultBranch
      ? "The repository's default branch cannot be deleted."
      : !activeCommit
        ? "Only a published remote branch can be deleted."
        : hasOpenPullRequest
          ? "Close the branch's pull request before deleting it."
          : null;
  const refreshRefs = () =>
    queryClient.invalidateQueries({ queryKey: ["repo-refs", project.dtag] });

  const createMutation = useMutation({
    mutationFn: (newBranch: string) => {
      if (!activeCommit) {
        throw new Error("Refresh the source branch before creating a branch.");
      }
      return createProjectRemoteBranch(project, {
        sourceBranch: activeBranch,
        expectedCommit: activeCommit,
        newBranch,
      });
    },
    onSuccess: async (result) => {
      setLocalBranchCommits((current) => ({
        ...current,
        [result.branch]: result.commit,
      }));
      setHiddenBranches((current) =>
        current.filter((branch) => branch !== result.branch),
      );
      setSelectedRef({ type: "branch", name: result.branch });
      setCreateOpen(false);
      await refreshRefs();
      toast.success(result.message);
    },
  });
  const deleteMutation = useMutation({
    mutationFn: () => {
      if (!activeCommit || deleteReason) {
        throw new Error(deleteReason ?? "Choose a remote branch.");
      }
      return deleteProjectRemoteBranch(project, {
        branch: activeBranch,
        expectedCommit: activeCommit,
      });
    },
    onSuccess: async (result) => {
      setLocalBranchCommits((current) => {
        const next = { ...current };
        delete next[result.branch];
        return next;
      });
      setHiddenBranches((current) => [...new Set([...current, result.branch])]);
      setSelectedRef({ type: "branch", name: defaultBranch });
      setDeleteOpen(false);
      await refreshRefs();
      toast.success(result.message);
    },
    onError: (error) =>
      toast.error("Could not delete branch", { description: error.message }),
  });

  const refControls: RepositoryRefControlsProps = {
    activeCommit,
    branches,
    createPending: createMutation.isPending,
    deletePending: deleteMutation.isPending,
    deleteReason,
    isRefreshing: refsQuery.isFetching,
    onCreate: () => {
      createMutation.reset();
      setCreateOpen(true);
    },
    onDelete: () => setDeleteOpen(true),
    onRefresh: () => void refsQuery.refetch(),
    onSelect: (value) => {
      const separator = value.indexOf(":");
      const type = value.slice(0, separator);
      const name = value.slice(separator + 1);
      if ((type === "branch" || type === "tag") && name) {
        setSelectedRef({ type, name });
      }
    },
    selectedValue: `${selectedRef?.type ?? "branch"}:${refName}`,
    tagCommits: refsQuery.data?.tagCommits ?? {},
    tags: refsQuery.data?.tags ?? [],
  };

  return (
    <>
      <section className="mt-6">
        {view === "overview" ? (
          <ProjectOverview
            project={project}
            onViewChange={onViewChange}
            pullRequestCount={pullRequestsQuery.data?.length ?? 0}
            refControls={refControls}
            refName={refName}
            refsQuery={refsQuery}
          />
        ) : view === "files" ? (
          <ProjectFiles
            project={project}
            refControls={refControls}
            refName={refName}
            refsQuery={refsQuery}
          />
        ) : view === "commits" ? (
          <ProjectCommits
            initialCommitOid={initialCommitOid}
            project={project}
            refName={refName}
            refType={selectedRef?.type ?? "branch"}
            refsQuery={refsQuery}
          />
        ) : (
          <ProjectContributors project={project} />
        )}
      </section>
      <CreateBranchDialog
        activeBranch={activeBranch}
        activeCommit={activeCommit}
        branches={branches}
        error={createMutation.error}
        onClose={() => setCreateOpen(false)}
        onCreate={(branch) => createMutation.mutateAsync(branch)}
        open={createOpen}
        pending={createMutation.isPending}
      />
      <DestructiveConfirmDialog
        confirmLabel="Delete branch"
        description={
          <>
            Delete the remote branch{" "}
            <span className="font-mono text-foreground">{activeBranch}</span>.
            This cannot be undone and may be rejected by repository protection
            rules.
          </>
        }
        onClose={() => setDeleteOpen(false)}
        onConfirm={() => deleteMutation.mutate()}
        open={deleteOpen}
        pending={deleteMutation.isPending}
        pendingLabel="Deleting..."
        title="Delete branch?"
      />
    </>
  );
}

type RefsQuery = ReturnType<typeof useRepoRefs>;

function ProjectOverview({
  onViewChange,
  project,
  pullRequestCount,
  refControls,
  refName,
  refsQuery,
}: {
  onViewChange?: (view: ProjectRepositoryView) => void;
  project: Project;
  pullRequestCount: number;
  refControls: RepositoryRefControlsProps;
  refName: string;
  refsQuery: RefsQuery;
}) {
  const readme = useGitReadme(project.owner, project.dtag, refName, 100);
  const metadata = useProjectRepositoryMetadata(project, refName);
  return (
    <>
      <ProjectRepositoryRefControls {...refControls} />
      <div className="mt-4 grid overflow-hidden rounded-md border xl:grid-cols-[minmax(0,1fr)_18rem]">
        <div className="min-w-0 p-4">
          <RepositoryError
            error={refsQuery.error ?? readme.error ?? metadata.error}
          />
          <RepoReadmeSection
            isLoading={readme.isLoading}
            readme={readme.data}
          />
          {!readme.isLoading && !readme.error && !readme.data ? (
            <p className="mt-4 text-sm text-muted-foreground">
              This repository does not have a README on {refName}.
            </p>
          ) : null}
        </div>
        <ProjectOverviewRail
          branch={refName}
          metadata={metadata.data}
          onViewContributors={() => onViewChange?.("contributors")}
          project={project}
          pullRequestCount={pullRequestCount}
        />
      </div>
    </>
  );
}

function ProjectFiles({
  project,
  refControls,
  refName,
  refsQuery,
}: {
  project: Project;
  refControls: RepositoryRefControlsProps;
  refName: string;
  refsQuery: RefsQuery;
}) {
  return (
    <>
      <ProjectRepositoryRefControls {...refControls} />
      <RepositoryError error={refsQuery.error} />
      <ProjectFilesBrowser key={refName} project={project} refName={refName} />
    </>
  );
}

function ProjectCommits({
  initialCommitOid,
  project,
  refName,
  refType,
  refsQuery,
}: {
  initialCommitOid?: string;
  project: Project;
  refName: string;
  refType: "branch" | "tag";
  refsQuery: RefsQuery;
}) {
  const navigate = useNavigate();
  const [selectedCommit, setSelectedCommit] = useState<CommitInfo | null>(null);
  const appliedInitialCommit = useRef(false);
  const commits = useGitLog(project.owner, project.dtag, refName);
  const RefIcon = refType === "tag" ? Tag : GitBranch;
  useEffect(() => {
    if (appliedInitialCommit.current || !initialCommitOid || !commits.data) {
      return;
    }
    appliedInitialCommit.current = true;
    setSelectedCommit(
      commits.data.find((commit) => commit.oid === initialCommitOid) ?? null,
    );
  }, [commits.data, initialCommitOid]);
  function selectCommit(commit: CommitInfo | null) {
    setSelectedCommit(commit);
    void navigate({
      params: { projectId: project.id },
      search: commit ? { commit: commit.oid } : {},
      to: "/projects/$projectId",
      replace: true,
    });
  }
  if (selectedCommit) {
    return (
      <ProjectCommitDetail
        commit={selectedCommit}
        onBack={() => selectCommit(null)}
        project={project}
        refName={refName}
      />
    );
  }
  return (
    <>
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <RefIcon className="h-4 w-4" />
        {refName}
      </div>
      <RepositoryError error={refsQuery.error ?? commits.error} />
      <RepoCommitsSection
        commits={commits.data}
        isLoading={commits.isLoading}
        onSelect={selectCommit}
      />
      {!commits.isLoading && !commits.error && !commits.data?.length ? (
        <p className="mt-8 text-sm text-muted-foreground">
          No commits are available on {refName}.
        </p>
      ) : null}
    </>
  );
}

function ProjectContributors({ project }: { project: Project }) {
  const contributors = [
    ...new Set([project.owner.toLowerCase(), ...project.contributors]),
  ];
  return (
    <div className="divide-y rounded-md border">
      {contributors.map((pubkey) => (
        <article className="flex items-center gap-3 p-4" key={pubkey}>
          <Users className="h-4 w-4 text-muted-foreground" />
          <div className="min-w-0">
            <p className="text-sm font-medium">
              {pubkey === project.owner.toLowerCase()
                ? "Repository owner"
                : "Contributor"}
            </p>
            <p className="mt-1 font-mono text-xs text-muted-foreground">
              {truncatePubkey(pubkey)}
            </p>
          </div>
        </article>
      ))}
    </div>
  );
}

function RepositoryError({ error }: { error: Error | null }) {
  if (!error) return null;
  return (
    <div className="mt-5 border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
      Could not load repository contents: {error.message}
    </div>
  );
}
