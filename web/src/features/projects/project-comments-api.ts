import { submitEvent } from "@/shared/lib/relay-events";
import type { Project, ProjectIssue, ProjectPullRequest } from "./project-api";

export type ProjectCommentInput = {
  content: string;
  mediaTags?: string[][];
  mentionPubkeys?: string[];
};

function validPubkeys(values: string[]) {
  return [
    ...new Set(
      values
        .filter((value) => /^[0-9a-f]{64}$/iu.test(value))
        .map((value) => value.toLowerCase()),
    ),
  ];
}

function validMediaTags(tags: string[][] = []) {
  return tags
    .filter((tag) => tag[0] === "imeta")
    .slice(0, 32)
    .map((tag) => tag.slice(0, 32).filter((value) => value.length <= 4_096));
}

function contentAndMedia(input: ProjectCommentInput) {
  const content = input.content.trim();
  const mediaTags = validMediaTags(input.mediaTags);
  if (!content && !mediaTags.length)
    throw new Error("Comment cannot be empty.");
  return { content, mediaTags };
}

export async function createProjectIssueComment(
  project: Project,
  issue: ProjectIssue,
  input: ProjectCommentInput,
): Promise<void> {
  const { content, mediaTags } = contentAndMedia(input);
  const recipients = validPubkeys([
    project.owner,
    issue.author,
    ...issue.recipients,
    ...(input.mentionPubkeys ?? []),
  ]);
  await submitEvent({
    kind: 1,
    content,
    tags: [
      ["e", issue.id, "", "root"],
      ["a", project.repoAddress],
      ...recipients.map((pubkey) => ["p", pubkey]),
      ...mediaTags,
    ],
  });
}

export async function createProjectPullRequestComment(
  project: Project,
  pullRequest: ProjectPullRequest,
  input: ProjectCommentInput,
): Promise<void> {
  const { content, mediaTags } = contentAndMedia(input);
  const recipients = validPubkeys([
    project.owner,
    pullRequest.author,
    ...pullRequest.recipients,
    ...(input.mentionPubkeys ?? []),
  ]);
  await submitEvent({
    kind: 1,
    content,
    tags: [
      ["e", pullRequest.id, "", "root"],
      ["a", project.repoAddress],
      ...recipients.map((pubkey) => ["p", pubkey]),
      ...mediaTags,
    ],
  });
}
