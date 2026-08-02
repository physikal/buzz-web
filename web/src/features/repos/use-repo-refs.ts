import { useQuery } from "@tanstack/react-query";
import { queryEvents, type NostrEvent } from "@/shared/lib/nostr-client";
import { fetchRelaySelf } from "@/shared/lib/relay-info";
import { relayWsUrl } from "@/shared/lib/relay-url";
import { dedup } from "./use-repos";

export interface RepoRefs {
  branches: string[];
  branchCommits: Record<string, string>;
  tags: string[];
  head: { ref: string; sha: string } | null;
}

function parseRefs(events: NostrEvent[]): RepoRefs {
  const latest = dedup(events);
  const branches: string[] = [];
  const branchCommits: Record<string, string> = {};
  const tags: string[] = [];
  let head: RepoRefs["head"] = null;

  for (const event of latest) {
    for (const tag of event.tags) {
      const [name, value] = tag;
      if (!name || !value) continue;

      if (name === "HEAD" && value.startsWith("ref: refs/heads/")) {
        // HEAD points to a branch ref — find its SHA from a matching branch tag
        const branchName = value.replace("ref: refs/heads/", "");
        head = { ref: branchName, sha: "" };
      } else if (name.startsWith("refs/heads/")) {
        const branchName = name.replace("refs/heads/", "");
        branches.push(branchName);
        branchCommits[branchName] = value;
      } else if (name.startsWith("refs/tags/")) {
        tags.push(name.replace("refs/tags/", ""));
      }
    }
  }

  // Resolve HEAD SHA from the matching branch
  if (head) {
    for (const event of latest) {
      for (const tag of event.tags) {
        if (tag[0] === `refs/heads/${head.ref}` && tag[1]) {
          head = { ref: head.ref, sha: tag[1] };
          break;
        }
      }
      if (head.sha) break;
    }
  }

  return {
    branches: [...new Set(branches)].sort(),
    branchCommits,
    tags: [...new Set(tags)].sort(),
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
    head: { ref: "main", sha: "a".repeat(40) },
  };

  return useQuery({
    queryKey: preview ? ["repo-refs", "mock", repoId] : ["repo-refs", repoId],
    queryFn: preview ? async () => mockRefs : () => fetchRepoRefs(repoId),
    initialData: preview ? mockRefs : undefined,
    staleTime: 60_000,
  });
}
