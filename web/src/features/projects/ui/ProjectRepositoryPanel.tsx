import { GitBranch, Users } from "lucide-react";

import {
  useGitLog,
  useGitReadme,
  useGitTree,
} from "@/features/repos/use-git-browse";
import { useRepoRefs } from "@/features/repos/use-repo-refs";
import { RepoCommitsSection } from "@/features/repos/ui/RepoCommitsSection";
import { RepoReadmeSection } from "@/features/repos/ui/RepoReadmeSection";
import { RepoRefsSection } from "@/features/repos/ui/RepoRefsSection";
import { RepoTreeSection } from "@/features/repos/ui/RepoTreeSection";
import { truncatePubkey } from "@/shared/lib/pubkey";
import type { Project } from "../project-api";

export type ProjectRepositoryView =
  | "overview"
  | "files"
  | "commits"
  | "contributors";

export function ProjectRepositoryPanel({
  project,
  view,
}: {
  project: Project;
  view: ProjectRepositoryView;
}) {
  const refsQuery = useRepoRefs(project.dtag);
  const ref = refsQuery.data?.head?.ref ?? project.defaultBranch;
  return (
    <section className="mt-6">
      {view === "overview" ? (
        <ProjectOverview
          project={project}
          refName={ref}
          refsQuery={refsQuery}
        />
      ) : view === "files" ? (
        <ProjectFiles project={project} refName={ref} refsQuery={refsQuery} />
      ) : view === "commits" ? (
        <ProjectCommits project={project} refName={ref} refsQuery={refsQuery} />
      ) : (
        <ProjectContributors project={project} />
      )}
    </section>
  );
}

type RefsQuery = ReturnType<typeof useRepoRefs>;

function ProjectOverview({
  project,
  refName,
  refsQuery,
}: {
  project: Project;
  refName: string;
  refsQuery: RefsQuery;
}) {
  const readme = useGitReadme(project.owner, project.dtag, refName);
  return (
    <>
      <RepoRefsSection isLoading={refsQuery.isLoading} refs={refsQuery.data} />
      <RepositoryError error={refsQuery.error ?? readme.error} />
      <RepoReadmeSection isLoading={readme.isLoading} readme={readme.data} />
      {!readme.isLoading && !readme.error && !readme.data ? (
        <p className="mt-8 text-sm text-muted-foreground">
          This repository does not have a README on {refName}.
        </p>
      ) : null}
    </>
  );
}

function ProjectFiles({
  project,
  refName,
  refsQuery,
}: {
  project: Project;
  refName: string;
  refsQuery: RefsQuery;
}) {
  const tree = useGitTree(project.owner, project.dtag, refName);
  return (
    <>
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <GitBranch className="h-4 w-4" />
        {refName}
      </div>
      <RepositoryError error={refsQuery.error ?? tree.error} />
      <RepoTreeSection
        entries={tree.data}
        isLoading={tree.isLoading}
        repoId={project.dtag}
      />
      {!tree.isLoading && !tree.error && !tree.data?.length ? (
        <p className="mt-8 text-sm text-muted-foreground">
          No files are available on {refName}.
        </p>
      ) : null}
    </>
  );
}

function ProjectCommits({
  project,
  refName,
  refsQuery,
}: {
  project: Project;
  refName: string;
  refsQuery: RefsQuery;
}) {
  const commits = useGitLog(project.owner, project.dtag, refName);
  return (
    <>
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <GitBranch className="h-4 w-4" />
        {refName}
      </div>
      <RepositoryError error={refsQuery.error ?? commits.error} />
      <RepoCommitsSection
        commits={commits.data}
        isLoading={commits.isLoading}
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
