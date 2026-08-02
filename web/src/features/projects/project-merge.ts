import { merge, push, resolveRef, writeRef } from "isomorphic-git";
import http from "isomorphic-git/http/web";

import {
  ensureCloneFromUrl,
  fetchCloneRef,
  gitAuthHeadersForUrl,
  relayGitUrlOwner,
  validateRelayGitUrl,
} from "@/features/repos/git-client";
import type { Project, ProjectPullRequest } from "./project-api";

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

export async function mergeProjectPullRequest(
  project: Project,
  pullRequest: ProjectPullRequest,
  viewerPubkey: string,
): Promise<string> {
  const viewer = viewerPubkey.toLowerCase();
  if (viewer !== project.owner.toLowerCase()) {
    throw new Error("Only the repository owner can merge this pull request.");
  }
  if (pullRequest.status !== "open") {
    throw new Error("Only open pull requests can be merged.");
  }
  const targetBranch = cleanBranch(
    pullRequest.targetBranch ?? project.defaultBranch,
  );
  const sourceBranch = cleanBranch(pullRequest.branchName);
  if (!targetBranch || !sourceBranch || !pullRequest.commit) {
    throw new Error("Pull request branch information is incomplete.");
  }
  const targetUrl = validateRelayGitUrl(project.cloneUrls[0] ?? "");
  const sourceUrl = validateRelayGitUrl(
    pullRequest.cloneUrls[0] ?? project.cloneUrls[0] ?? "",
  );
  if (relayGitUrlOwner(targetUrl) !== project.owner.toLowerCase()) {
    throw new Error("Target clone URL does not match the repository owner.");
  }
  if (targetUrl === sourceUrl && targetBranch === sourceBranch) {
    throw new Error("Source and target branches must be different.");
  }

  const {
    fs,
    dir,
    oid: targetOid,
  } = await ensureCloneFromUrl(
    project.owner,
    `${project.dtag}-merge-${pullRequest.id}`,
    targetUrl,
    targetBranch,
    null,
  );
  const sourceOid = await fetchCloneRef(fs, dir, sourceUrl, sourceBranch, null);
  if (sourceOid.toLowerCase() !== pullRequest.commit.toLowerCase()) {
    throw new Error(
      "The pull request branch changed. Refresh the pull request before merging.",
    );
  }

  const targetRef = "refs/heads/buzz-web-merge-target";
  const sourceRef = "refs/heads/buzz-web-merge-source";
  await Promise.all([
    writeRef({ fs, dir, ref: targetRef, value: targetOid, force: true }),
    writeRef({ fs, dir, ref: sourceRef, value: sourceOid, force: true }),
  ]);

  let mergeCommit: string;
  try {
    const result = await merge({
      fs,
      dir,
      ours: targetRef,
      theirs: sourceRef,
      fastForward: true,
      abortOnConflict: true,
      message: `Merge pull request #${pullRequest.id.slice(0, 8)}`,
      author: {
        name: "Buzz User",
        email: `${viewer}@users.noreply.buzz`,
      },
      committer: {
        name: "Buzz User",
        email: `${viewer}@users.noreply.buzz`,
      },
    });
    mergeCommit = result.oid ?? (await resolveRef({ fs, dir, ref: targetRef }));
  } catch (error) {
    throw new Error(
      error instanceof Error && /conflict/iu.test(error.message)
        ? "The pull request has merge conflicts. Resolve them in a local checkout and push the target branch before retrying."
        : error instanceof Error
          ? error.message
          : "Could not merge the pull request.",
    );
  }

  const result = await push({
    fs,
    http,
    dir,
    url: targetUrl,
    ref: targetRef,
    remoteRef: targetBranch,
    force: false,
    headers: await gitAuthHeadersForUrl(targetUrl),
  });
  if (!result.ok) {
    throw new Error(result.error || "The relay rejected the merge push.");
  }
  return mergeCommit;
}
