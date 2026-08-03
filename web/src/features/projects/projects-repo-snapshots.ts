import { ensureClone, getCommitLog } from "@/features/repos/git-client";
import type { Project } from "./project-api";
import { isRelayHostedProject } from "./projects-index-helpers";

export type ProjectRepoActivitySnapshot = {
  oid: string;
  message: string;
  authorName: string;
  createdAt: number;
};

const SNAPSHOT_CONCURRENCY = 3;

/** Reads one latest commit per active-relay repository with bounded fan-out. */
export async function listProjectsRepoSnapshots(projects: Project[]) {
  const queue = projects.filter(isRelayHostedProject);
  const snapshots: Record<string, ProjectRepoActivitySnapshot> = {};
  const workers = Array.from(
    { length: Math.min(SNAPSHOT_CONCURRENCY, queue.length) },
    async () => {
      for (;;) {
        const project = queue.shift();
        if (!project) return;
        try {
          const { fs, dir } = await ensureClone(
            project.owner,
            project.dtag,
            project.defaultBranch,
            1,
          );
          const [commit] = await getCommitLog(
            fs,
            dir,
            project.defaultBranch,
            1,
          );
          if (commit) {
            snapshots[project.repoAddress] = {
              oid: commit.oid,
              message: commit.message,
              authorName: commit.author.name,
              createdAt: commit.author.timestamp,
            };
          }
        } catch {
          // Overview snapshots are best-effort; work items still remain usable.
        }
      }
    },
  );
  await Promise.all(workers);
  return snapshots;
}
