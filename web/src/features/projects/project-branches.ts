import { deleteRef, listServerRefs, push, writeRef } from "isomorphic-git";
import http from "isomorphic-git/http/web";

import {
  ensureCloneFromUrl,
  gitAuthHeadersForUrl,
  relayGitUrlOwner,
  validateRelayGitUrl,
} from "@/features/repos/git-client";
import { normalizeGitBranchName } from "@/shared/lib/git-ref";
import type { Project } from "./project-api";

const ZERO_OID = "0".repeat(40);
const COMMIT_OID = /^[0-9a-f]{40}$/u;

export function normalizeProjectBranchName(value: string): string | null {
  return normalizeGitBranchName(value);
}

export function projectBranchNameError(
  value: string,
  existingBranches: string[],
): string | null {
  const branch = normalizeProjectBranchName(value);
  if (!branch) return "Enter a valid Git branch name.";
  if (existingBranches.includes(branch)) {
    return "A branch with this name already exists.";
  }
  return null;
}

function projectRelayUrl(project: Project) {
  const url = validateRelayGitUrl(project.cloneUrls[0] ?? "");
  if (relayGitUrlOwner(url) !== project.owner.toLowerCase()) {
    throw new Error("Clone URL does not match the repository owner.");
  }
  return url;
}

function expectedCommit(value: string) {
  const commit = value.trim().toLowerCase();
  if (!COMMIT_OID.test(commit))
    throw new Error("The branch commit is invalid.");
  return commit;
}

function pushFailure(
  result: Awaited<ReturnType<typeof push>>,
  ref: string,
  fallback: string,
) {
  if (result.ok && result.refs[ref]?.ok) return;
  throw new Error(result.refs[ref]?.error || result.error || fallback);
}

function operationRef(label: string) {
  return `refs/heads/buzz-web-${label}-${crypto.randomUUID().replace(/-/gu, "")}`;
}

export async function createProjectRemoteBranch(
  project: Project,
  input: {
    sourceBranch: string;
    expectedCommit: string;
    newBranch: string;
  },
): Promise<{ branch: string; commit: string; message: string }> {
  const sourceBranch = normalizeProjectBranchName(input.sourceBranch);
  const newBranch = normalizeProjectBranchName(input.newBranch);
  const commit = expectedCommit(input.expectedCommit);
  if (!sourceBranch) throw new Error("The source branch is invalid.");
  if (!newBranch) throw new Error("The new branch is invalid.");
  if (sourceBranch === newBranch) {
    throw new Error("The new branch must have a different name.");
  }
  const url = projectRelayUrl(project);
  const clone = await ensureCloneFromUrl(
    project.owner,
    `${project.dtag}-branch-actions`,
    url,
    sourceBranch,
    null,
  );
  if (clone.oid.toLowerCase() !== commit) {
    throw new Error(
      "The source branch changed. Refresh the repository before creating a branch.",
    );
  }

  const localRef = operationRef("create");
  await writeRef({
    fs: clone.fs,
    dir: clone.dir,
    ref: localRef,
    value: commit,
    force: true,
  });
  let leaseError: string | null = null;
  try {
    const result = await push({
      fs: clone.fs,
      http,
      dir: clone.dir,
      url,
      ref: localRef,
      remoteRef: newBranch,
      force: false,
      headers: await gitAuthHeadersForUrl(url),
      onPrePush: ({ remoteRef }) => {
        if (remoteRef.oid === ZERO_OID) return true;
        leaseError = "A branch with this name already exists.";
        return false;
      },
    });
    pushFailure(
      result,
      `refs/heads/${newBranch}`,
      "The relay rejected the branch creation.",
    );
  } catch (error) {
    if (leaseError) throw new Error(leaseError);
    throw error;
  } finally {
    await deleteRef({ fs: clone.fs, dir: clone.dir, ref: localRef }).catch(
      () => {},
    );
  }
  return {
    branch: newBranch,
    commit,
    message: `Created branch ${newBranch} from ${sourceBranch}.`,
  };
}

export async function deleteProjectRemoteBranch(
  project: Project,
  input: { branch: string; expectedCommit: string },
): Promise<{ branch: string; commit: string; message: string }> {
  const branch = normalizeProjectBranchName(input.branch);
  const commit = expectedCommit(input.expectedCommit);
  if (!branch) throw new Error("The branch name is invalid.");
  const url = projectRelayUrl(project);
  const headers = await gitAuthHeadersForUrl(url);
  const serverHead = (
    await listServerRefs({
      http,
      url,
      headers,
      forPush: true,
      protocolVersion: 1,
      prefix: "HEAD",
      symrefs: true,
    })
  ).find((ref) => ref.ref === "HEAD");
  if (serverHead?.target === `refs/heads/${branch}`) {
    throw new Error("The repository's default branch cannot be deleted.");
  }

  const clone = await ensureCloneFromUrl(
    project.owner,
    `${project.dtag}-branch-actions`,
    url,
    branch,
    null,
  );
  if (clone.oid.toLowerCase() !== commit) {
    throw new Error(
      "The branch changed. Refresh the repository before deleting it.",
    );
  }
  const localRef = operationRef("delete");
  await writeRef({
    fs: clone.fs,
    dir: clone.dir,
    ref: localRef,
    value: commit,
    force: true,
  });
  let leaseError: string | null = null;
  try {
    const result = await push({
      fs: clone.fs,
      http,
      dir: clone.dir,
      url,
      ref: localRef,
      remoteRef: branch,
      delete: true,
      force: false,
      headers,
      onPrePush: ({ remoteRef }) => {
        if (remoteRef.oid.toLowerCase() === commit) return true;
        leaseError =
          remoteRef.oid === ZERO_OID
            ? "The branch no longer exists."
            : "The branch changed. Refresh the repository before deleting it.";
        return false;
      },
    });
    pushFailure(
      result,
      `refs/heads/${branch}`,
      "The relay rejected the branch deletion.",
    );
  } catch (error) {
    if (leaseError) throw new Error(leaseError);
    throw error;
  } finally {
    await deleteRef({ fs: clone.fs, dir: clone.dir, ref: localRef }).catch(
      () => {},
    );
  }
  return { branch, commit, message: `Deleted branch ${branch}.` };
}
