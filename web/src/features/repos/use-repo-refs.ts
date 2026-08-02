import { useQuery } from "@tanstack/react-query";
import { queryEvents, type NostrEvent } from "@/shared/lib/nostr-client";
import { fetchRelaySelf } from "@/shared/lib/relay-info";
import { relayWsUrl } from "@/shared/lib/relay-url";
import {
  normalizeGitBranchName,
  normalizeGitTagName,
} from "@/shared/lib/git-ref";
import { dedup } from "./use-repos";

export interface RepoRefs {
  branches: string[];
  branchCommits: Record<string, string>;
  tags: string[];
  tagCommits: Record<string, string>;
  head: { ref: string; sha: string } | null;
}

function parseRefs(events: NostrEvent[]): RepoRefs {
  const latest = dedup(events);
  const branches: string[] = [];
  const branchCommits: Record<string, string> = {};
  const tags: string[] = [];
  const tagCommits: Record<string, string> = {};
  let head: RepoRefs["head"] = null;

  for (const event of latest) {
    for (const tag of event.tags) {
      const [name, value] = tag;
      if (!name || !value) continue;

      if (name === "HEAD" && value.startsWith("ref: refs/heads/")) {
        // HEAD points to a branch ref — find its SHA from a matching branch tag
        const branchName = normalizeGitBranchName(
          value.replace("ref: refs/heads/", ""),
        );
        if (branchName) head = { ref: branchName, sha: "" };
      } else if (name.startsWith("refs/heads/")) {
        const branchName = normalizeGitBranchName(
          name.replace("refs/heads/", ""),
        );
        if (!branchName || !/^[0-9a-f]{40}$/iu.test(value)) continue;
        branches.push(branchName);
        branchCommits[branchName] = value.toLowerCase();
      } else if (name.startsWith("refs/tags/")) {
        const tagName = normalizeGitTagName(name.replace("refs/tags/", ""));
        if (!tagName || !/^[0-9a-f]{40}$/iu.test(value)) continue;
        tags.push(tagName);
        tagCommits[tagName] = value.toLowerCase();
      }
    }
  }

  if (head) {
    head = { ref: head.ref, sha: branchCommits[head.ref] ?? "" };
  }

  return {
    branches: [...new Set(branches)].sort(),
    branchCommits,
    tags: [...new Set(tags)].sort(),
    tagCommits,
    head,
  };
}

async function fetchRepoRefs(repoId: string): Promise<RepoRefs> {
  const relaySelf = await fetchRelaySelf();
  const events = await queryEvents(relayWsUrl(), {
    kinds: [30618],
    authors: [relaySelf],
    "#d": [repoId],
  });
  return parseRefs(
    events.filter(
      (event) =>
        event.kind === 30618 &&
        event.pubkey.toLowerCase() === relaySelf &&
        event.tags.some((tag) => tag[0] === "d" && tag[1] === repoId),
    ),
  );
}

export function useRepoRefs(repoId: string, { preview = false } = {}) {
  const mockRefs: RepoRefs = {
    branches: ["main"],
    branchCommits: { main: "a".repeat(40) },
    tags: ["v0.1.0"],
    tagCommits: { "v0.1.0": "a".repeat(40) },
    head: { ref: "main", sha: "a".repeat(40) },
  };

  return useQuery({
    queryKey: preview ? ["repo-refs", "mock", repoId] : ["repo-refs", repoId],
    queryFn: preview ? async () => mockRefs : () => fetchRepoRefs(repoId),
    initialData: preview ? mockRefs : undefined,
    staleTime: 60_000,
  });
}
