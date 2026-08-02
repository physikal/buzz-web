import { createTwoFilesPatch, diffLines } from "diff";
import {
  findMergeBase,
  readCommit,
  TREE,
  walk,
  writeTree,
  type WalkerEntry,
} from "isomorphic-git";

import {
  ensureClone,
  ensureCloneFromUrl,
  fetchCloneRef,
  validateRelayGitUrl,
} from "@/features/repos/git-client";
import type { Project, ProjectPullRequest } from "./project-api";

const MAX_CHANGED_FILES = 250;
const MAX_PATCH_LINES = 2_000;
const MAX_TEXT_BYTES = 2 * 1024 * 1024;

export type ProjectDiffFile = {
  path: string;
  additions: number;
  deletions: number;
  patch: string;
  truncated: boolean;
};

export type ProjectDiff = {
  files: ProjectDiffFile[];
  additions: number;
  deletions: number;
};

function cleanBranch(value: string | null | undefined): string | null {
  const branch = value?.trim().replace(/^refs\/heads\//u, "") ?? "";
  if (
    !branch ||
    branch.startsWith("-") ||
    branch.startsWith("/") ||
    branch.endsWith("/") ||
    branch.includes("..") ||
    !/^[a-z0-9/_.-]+$/iu.test(branch)
  ) {
    return null;
  }
  return branch;
}

function validCommit(value: string | null | undefined): value is string {
  return Boolean(value && /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/iu.test(value));
}

async function hasCommit(
  fs: Awaited<ReturnType<typeof ensureCloneFromUrl>>["fs"],
  dir: string,
  oid: string,
) {
  try {
    await readCommit({ fs, dir, oid });
    return true;
  } catch {
    return false;
  }
}

function textContent(value: Uint8Array | undefined): string | null {
  if (!value || value.byteLength > MAX_TEXT_BYTES) return null;
  const sampleLength = Math.min(value.byteLength, 512);
  for (let index = 0; index < sampleLength; index += 1) {
    if (value[index] === 0) return null;
  }
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(value);
  } catch {
    return null;
  }
}

function countChangedLines(oldText: string, newText: string) {
  let additions = 0;
  let deletions = 0;
  for (const change of diffLines(oldText, newText)) {
    if (change.added) additions += change.count ?? 0;
    if (change.removed) deletions += change.count ?? 0;
  }
  return { additions, deletions };
}

function makePatch(path: string, oldText: string, newText: string) {
  const complete = createTwoFilesPatch(
    `a/${path}`,
    `b/${path}`,
    oldText,
    newText,
    undefined,
    undefined,
    { context: 80 },
  )
    .split("\n")
    .slice(1)
    .join("\n");
  const lines = complete.split("\n");
  return {
    patch: lines.slice(0, MAX_PATCH_LINES).join("\n"),
    truncated: lines.length > MAX_PATCH_LINES,
  };
}

async function changedFile(
  path: string,
  base: WalkerEntry | null,
  target: WalkerEntry | null,
): Promise<ProjectDiffFile | null> {
  const [baseType, targetType, baseOid, targetOid] = await Promise.all([
    base?.type(),
    target?.type(),
    base?.oid(),
    target?.oid(),
  ]);
  if (baseType === "tree" || targetType === "tree" || baseOid === targetOid) {
    return null;
  }
  if (
    (baseType && baseType !== "blob") ||
    (targetType && targetType !== "blob")
  ) {
    return { path, additions: 0, deletions: 0, patch: "", truncated: false };
  }
  const [baseContent, targetContent] = await Promise.all([
    base?.content(),
    target?.content(),
  ]);
  const oldText = base ? textContent(baseContent ?? undefined) : "";
  const newText = target ? textContent(targetContent ?? undefined) : "";
  if (oldText === null || newText === null) {
    return { path, additions: 0, deletions: 0, patch: "", truncated: false };
  }
  return {
    path,
    ...countChangedLines(oldText, newText),
    ...makePatch(path, oldText, newText),
  };
}

async function diffTrees(
  fs: Awaited<ReturnType<typeof ensureCloneFromUrl>>["fs"],
  dir: string,
  baseOid: string,
  targetOid: string,
): Promise<ProjectDiff> {
  let changedCount = 0;
  const files = (await walk({
    fs,
    dir,
    trees: [TREE({ ref: baseOid }), TREE({ ref: targetOid })],
    map: async (path, entries) => {
      if (path === "." || changedCount >= MAX_CHANGED_FILES) return null;
      const file = await changedFile(path, entries[0], entries[1]);
      if (file) changedCount += 1;
      return file;
    },
    iterate: async (visit, children) => {
      const results = [];
      for (const child of children) {
        if (changedCount >= MAX_CHANGED_FILES) break;
        results.push(await visit(child));
      }
      return results;
    },
  })) as ProjectDiffFile[];
  const safeFiles = files.filter(Boolean).slice(0, MAX_CHANGED_FILES);
  return {
    files: safeFiles,
    additions: safeFiles.reduce((sum, file) => sum + file.additions, 0),
    deletions: safeFiles.reduce((sum, file) => sum + file.deletions, 0),
  };
}

export async function loadProjectCommitDiff(
  project: Project,
  refName: string,
  commitOid: string,
): Promise<ProjectDiff> {
  if (!cleanBranch(refName)) throw new Error("Repository ref is invalid.");
  if (!validCommit(commitOid)) throw new Error("Commit is invalid.");
  const { fs, dir } = await ensureClone(
    project.owner,
    project.dtag,
    refName,
    100,
  );
  if (!(await hasCommit(fs, dir, commitOid))) {
    throw new Error("The selected commit is not available in this repository.");
  }
  const { commit } = await readCommit({ fs, dir, oid: commitOid });
  const parentOid =
    commit.parent[0] ?? (await writeTree({ fs, dir, tree: [] }));
  return diffTrees(fs, dir, parentOid, commitOid);
}

export async function loadProjectPullRequestDiff(
  project: Project,
  pullRequest: ProjectPullRequest,
): Promise<ProjectDiff> {
  const baseBranch = cleanBranch(
    pullRequest.targetBranch ?? project.defaultBranch,
  );
  const sourceBranch = cleanBranch(pullRequest.branchName);
  if (!baseBranch) throw new Error("Pull request base branch is invalid.");
  if (!validCommit(pullRequest.commit)) {
    throw new Error("Pull request commit is invalid.");
  }
  const cloneUrl = validateRelayGitUrl(
    pullRequest.cloneUrls[0] ?? project.cloneUrls[0] ?? "",
  );
  const {
    fs,
    dir,
    oid: baseOid,
  } = await ensureCloneFromUrl(
    project.owner,
    project.dtag,
    cloneUrl,
    baseBranch,
    100,
  );

  if (!(await hasCommit(fs, dir, pullRequest.commit))) {
    const refs = [
      `refs/nostr/${pullRequest.id}`,
      pullRequest.commit,
      ...(sourceBranch ? [sourceBranch] : []),
    ];
    for (const ref of refs) {
      try {
        await fetchCloneRef(fs, dir, cloneUrl, ref);
      } catch {
        continue;
      }
      if (await hasCommit(fs, dir, pullRequest.commit)) break;
    }
  }
  if (!(await hasCommit(fs, dir, pullRequest.commit))) {
    throw new Error(
      "The signed pull request commit was not found in its repository.",
    );
  }

  let comparisonBase = baseOid;
  try {
    comparisonBase =
      (
        await findMergeBase({
          fs,
          dir,
          oids: [baseOid, pullRequest.commit],
        })
      )[0] ?? baseOid;
  } catch {
    // A shallow or unrelated fork can still be compared against the base tip.
  }

  return diffTrees(fs, dir, comparisonBase, pullRequest.commit);
}
