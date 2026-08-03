import type {
  ProjectIssueLifecycleStatus,
  ProjectIssueStatus,
} from "./project-api";

export function projectIssueStatusFrom(
  statusKind: number | undefined,
  labels: string[],
): ProjectIssueStatus {
  if (statusKind === 1631) return "done";
  if (statusKind === 1632) return "closed";
  if (statusKind === 1633) return "triage";
  const normalized = labels.map((label) => label.toLowerCase());
  if (normalized.includes("in-review") || normalized.includes("review"))
    return "in-review";
  if (normalized.includes("in-progress") || normalized.includes("active"))
    return "in-progress";
  if (normalized.includes("triage")) return "triage";
  return "backlog";
}

export function projectIssueStatusLabel(status: ProjectIssueStatus) {
  return {
    triage: "Triage",
    backlog: "Backlog",
    "in-progress": "In Progress",
    "in-review": "In Review",
    done: "Done",
    closed: "Closed",
  }[status];
}

export function projectIssueLifecycleStatus(
  status: ProjectIssueStatus,
): ProjectIssueLifecycleStatus {
  if (status === "triage") return "draft";
  if (status === "done") return "merged";
  if (status === "closed") return "closed";
  return "open";
}
