import { useQuery } from "@tanstack/react-query";
import type LightningFS from "@isomorphic-git/lightning-fs";
import { resolveRef } from "isomorphic-git";

import {
  getCommitLog,
  readTreeEntries,
  type CommitInfo,
} from "@/features/repos/git-client";
import { useGitClone } from "@/features/repos/use-git-browse";
import type { Project } from "./project-api";

const MAX_FILES = 5_000;
const MAX_DIRECTORIES = 2_000;
const MAX_PATH_LENGTH = 4_096;

const LANGUAGE_LABELS: Record<string, string> = {
  css: "CSS",
  dart: "Dart",
  go: "Go",
  html: "HTML",
  js: "JavaScript",
  json: "JSON",
  jsx: "JavaScript",
  kt: "Kotlin",
  mjs: "JavaScript",
  py: "Python",
  rb: "Ruby",
  rs: "Rust",
  swift: "Swift",
  ts: "TypeScript",
  tsx: "TypeScript",
};

export type ProjectRepositoryMetadata = {
  contributorCount: number;
  fileCount: number;
  filesTruncated: boolean;
  latestCommit: CommitInfo | null;
  languages: Array<[string, number]>;
};

function languageForPath(path: string) {
  const extension = path.toLowerCase().split(".").pop() ?? "";
  return LANGUAGE_LABELS[extension];
}

async function loadProjectRepositoryMetadata(
  fs: LightningFS,
  dir: string,
  ref: string,
): Promise<ProjectRepositoryMetadata> {
  const oid = await resolveRef({ fs, dir, ref });
  const commits = await getCommitLog(fs, dir, ref, 100);
  const contributors = new Set(
    commits
      .map((commit) =>
        (commit.author.email || commit.author.name).trim().toLowerCase(),
      )
      .filter(Boolean),
  );
  const languageCounts: Record<string, number> = {};
  const directories = [""];
  let visitedDirectories = 0;
  let fileCount = 0;
  let filesTruncated = false;

  while (directories.length > 0 && visitedDirectories < MAX_DIRECTORIES) {
    const path = directories.shift() ?? "";
    visitedDirectories += 1;
    const entries = await readTreeEntries(fs, dir, oid, path || undefined);
    for (const entry of entries) {
      const childPath = path ? `${path}/${entry.name}` : entry.name;
      if (childPath.length > MAX_PATH_LENGTH) continue;
      if (entry.type === "tree") {
        directories.push(childPath);
        continue;
      }
      if (entry.type !== "blob") continue;
      fileCount += 1;
      const language = languageForPath(childPath);
      if (language) {
        languageCounts[language] = (languageCounts[language] ?? 0) + 1;
      }
      if (fileCount >= MAX_FILES) {
        filesTruncated = true;
        directories.length = 0;
        break;
      }
    }
  }
  if (directories.length > 0) filesTruncated = true;

  return {
    contributorCount: contributors.size,
    fileCount,
    filesTruncated,
    latestCommit: commits[0] ?? null,
    languages: Object.entries(languageCounts)
      .sort(
        (left, right) => right[1] - left[1] || left[0].localeCompare(right[0]),
      )
      .slice(0, 5),
  };
}

export function useProjectRepositoryMetadata(project: Project, ref: string) {
  const clone = useGitClone(project.owner, project.dtag, ref, 100);
  return useQuery({
    queryKey: ["project-repository-metadata", project.repoAddress, ref],
    queryFn: () => {
      if (!clone.data) throw new Error("unreachable: enabled guards data");
      return loadProjectRepositoryMetadata(clone.data.fs, clone.data.dir, ref);
    },
    enabled: !!clone.data,
    retry: false,
    staleTime: 5 * 60_000,
  });
}
