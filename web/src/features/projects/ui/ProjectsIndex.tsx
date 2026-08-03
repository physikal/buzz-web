import { useQuery } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import {
  ChevronDown,
  CircleDot,
  FolderGit2,
  GitPullRequest,
  LayoutGrid,
  List,
  MessageSquare,
  Radio,
  RefreshCw,
  Trash2,
} from "lucide-react";
import { useMemo, useState } from "react";

import { relayHttpBaseUrl } from "@/shared/lib/relay-url";
import { truncatePubkey } from "@/shared/lib/pubkey";
import { Button } from "@/shared/ui/button";
import { SidebarToggleButton } from "@/shared/ui/sidebar-toggle-button";
import type { Project, ProjectIssue, ProjectPullRequest } from "../project-api";
import { listProjectsWorkItems } from "../projects-work-items";
import {
  PROJECTS_INDEX_STORAGE,
  readProjectsIndexState,
  writeProjectsIndexState,
} from "../projects-index-state";
import { ProjectsCreateControls } from "./ProjectsCreateControls";

type ProjectsFilter = "overview" | "repositories" | "pull-requests" | "issues";
type ProjectsScope = "all" | "mine" | "local";
type WorkItemScope = "all" | "mine";
type ProjectsSort = "updated" | "created" | "name";
type ProjectsViewMode = "grid" | "list";

function relativeTime(timestamp: number) {
  const seconds = Math.max(1, Math.floor(Date.now() / 1_000) - timestamp);
  if (seconds >= 7 * 86_400) {
    return new Date(timestamp * 1_000).toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
      ...(seconds >= 31_536_000 ? { year: "numeric" } : {}),
    });
  }
  const units = [
    [86_400, "day"],
    [3_600, "hour"],
    [60, "minute"],
    [1, "second"],
  ] as const;
  for (const [size, label] of units) {
    const count = Math.floor(seconds / size);
    if (count > 0) return `${count} ${label}${count === 1 ? "" : "s"} ago`;
  }
  return "just now";
}

function isRelayHostedProject(project: Project) {
  const expected = `${relayHttpBaseUrl().replace(/\/+$/u, "")}/git/${project.owner}/${encodeURIComponent(project.dtag)}.git`;
  return project.cloneUrls.some((cloneUrl) => cloneUrl === expected);
}

function projectUpdatedAt(
  project: Project,
  issues: Array<{ project: Project; issue: ProjectIssue }>,
  pullRequests: Array<{
    project: Project;
    pullRequest: ProjectPullRequest;
  }>,
) {
  return Math.max(
    project.createdAt,
    ...issues
      .filter((item) => item.project.repoAddress === project.repoAddress)
      .map((item) => item.issue.updatedAt),
    ...pullRequests
      .filter((item) => item.project.repoAddress === project.repoAddress)
      .map((item) => item.pullRequest.updatedAt),
  );
}

function ProjectsTabs({
  filter,
  onChange,
}: {
  filter: ProjectsFilter;
  onChange: (filter: ProjectsFilter) => void;
}) {
  const options = [
    ["overview", "Overview"],
    ["repositories", "Repositories"],
    ["pull-requests", "Pull Requests"],
    ["issues", "Issues"],
  ] as const;
  return (
    <nav
      aria-label="Projects views"
      className="flex h-13 min-w-0 flex-1 overflow-x-auto border-b"
    >
      {options.map(([value, label]) => (
        <Button
          aria-current={filter === value ? "page" : undefined}
          className={`relative h-full shrink-0 rounded-none px-2.5 shadow-none after:absolute after:inset-x-2.5 after:bottom-0 after:h-0.5 after:bg-current after:content-[''] ${
            filter === value
              ? "font-semibold text-foreground after:opacity-100"
              : "text-muted-foreground after:opacity-0 hover:bg-transparent hover:text-foreground hover:after:opacity-100"
          }`}
          key={value}
          onClick={() => onChange(value)}
          variant="ghost"
        >
          <span className="grid">
            <span
              aria-hidden="true"
              className="invisible col-start-1 row-start-1 font-semibold"
            >
              {label}
            </span>
            <span className="col-start-1 row-start-1">{label}</span>
          </span>
        </Button>
      ))}
    </nav>
  );
}

function ViewModeToggle({
  value,
  onChange,
}: {
  value: ProjectsViewMode;
  onChange: (value: ProjectsViewMode) => void;
}) {
  return (
    <fieldset className="flex items-center rounded-md bg-muted/40 p-0.5">
      <legend className="sr-only">Project layout</legend>
      <Button
        aria-label="Grid layout"
        aria-pressed={value === "grid"}
        className="h-7 w-7 p-0"
        onClick={() => onChange("grid")}
        size="icon"
        variant={value === "grid" ? "secondary" : "ghost"}
      >
        <LayoutGrid className="h-3.5 w-3.5" />
      </Button>
      <Button
        aria-label="List layout"
        aria-pressed={value === "list"}
        className="h-7 w-7 p-0"
        onClick={() => onChange("list")}
        size="icon"
        variant={value === "list" ? "secondary" : "ghost"}
      >
        <List className="h-3.5 w-3.5" />
      </Button>
    </fieldset>
  );
}

function SelectControl<T extends string>({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: Array<{ label: string; value: T }>;
  value: T;
  onChange: (value: T) => void;
}) {
  return (
    <label className="relative inline-flex items-center">
      <span className="sr-only">{label}</span>
      <select
        aria-label={label}
        className="h-8 appearance-none rounded-md bg-transparent py-1 pl-2 pr-8 text-sm font-semibold outline-none hover:bg-muted/50 focus:ring-1 focus:ring-ring"
        onChange={(event) => onChange(event.target.value as T)}
        value={value}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      <ChevronDown className="pointer-events-none absolute right-2 h-4 w-4 text-muted-foreground" />
    </label>
  );
}

function ListControls({
  sort,
  viewMode,
  onSortChange,
  onViewModeChange,
}: {
  sort: ProjectsSort;
  viewMode: ProjectsViewMode;
  onSortChange: (sort: ProjectsSort) => void;
  onViewModeChange: (viewMode: ProjectsViewMode) => void;
}) {
  return (
    <div className="flex items-center gap-2">
      <select
        aria-label="Sort projects"
        className="h-8 rounded-md bg-transparent px-2 text-xs outline-none hover:bg-muted/50 focus:ring-1 focus:ring-ring"
        onChange={(event) => onSortChange(event.target.value as ProjectsSort)}
        value={sort}
      >
        <option value="updated">Recent activity</option>
        <option value="created">Created date</option>
        <option value="name">Name</option>
      </select>
      <ViewModeToggle value={viewMode} onChange={onViewModeChange} />
    </div>
  );
}

function EmptyList({ children }: { children: string }) {
  return (
    <div className="border border-dashed px-4 py-12 text-center text-sm text-muted-foreground">
      {children}
    </div>
  );
}

function RepositoryItems({
  projects,
  ownerPubkey,
  pendingDelete,
  viewMode,
  issueCounts,
  pullRequestCounts,
  updatedAt,
  onDelete,
}: {
  projects: Project[];
  ownerPubkey: string;
  pendingDelete: boolean;
  viewMode: ProjectsViewMode;
  issueCounts: Map<string, number>;
  pullRequestCounts: Map<string, number>;
  updatedAt: Map<string, number>;
  onDelete: (project: Project) => void;
}) {
  if (projects.length === 0)
    return <EmptyList>No matching projects.</EmptyList>;
  return (
    <div
      className={
        viewMode === "grid"
          ? "grid gap-3 md:grid-cols-2 xl:grid-cols-3"
          : "divide-y overflow-hidden border"
      }
      data-testid="projects-list-container"
    >
      {projects.map((project) => (
        <article
          className={`group relative flex min-w-0 gap-3 ${
            viewMode === "grid"
              ? "min-h-40 flex-col border p-4 hover:bg-muted/20"
              : "items-center px-4 py-3 hover:bg-muted/20"
          }`}
          data-projects-grid-card={viewMode === "grid" ? "" : undefined}
          key={project.id}
        >
          <Link
            className="absolute inset-0"
            params={{ projectId: project.id }}
            search={{}}
            to="/projects/$projectId"
          >
            <span className="sr-only">View {project.name}</span>
          </Link>
          <div className="flex min-w-0 items-start gap-3">
            <FolderGit2 className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground" />
            <div className="min-w-0 flex-1">
              <h2 className="truncate text-sm font-semibold">{project.name}</h2>
              <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">
                {project.description || "No description"}
              </p>
            </div>
            {project.owner === ownerPubkey ? (
              <Button
                aria-label={`Delete ${project.name}`}
                className="relative z-10 h-7 w-7 shrink-0 p-0 opacity-0 group-focus-within:opacity-100 group-hover:opacity-100"
                disabled={pendingDelete}
                onClick={() => onDelete(project)}
                size="icon"
                variant="ghost"
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            ) : null}
          </div>
          <div
            className={`flex min-w-0 items-center gap-3 text-xs text-muted-foreground ${
              viewMode === "grid" ? "mt-auto" : "ml-auto shrink-0"
            }`}
          >
            <span className="font-mono">{truncatePubkey(project.owner)}</span>
            <span className="inline-flex items-center gap-1">
              <GitPullRequest className="h-3.5 w-3.5" />
              {pullRequestCounts.get(project.repoAddress) ?? 0}
            </span>
            <span className="inline-flex items-center gap-1">
              <CircleDot className="h-3.5 w-3.5" />
              {issueCounts.get(project.repoAddress) ?? 0}
            </span>
            <span className="whitespace-nowrap">
              {relativeTime(
                updatedAt.get(project.repoAddress) ?? project.createdAt,
              )}
            </span>
          </div>
        </article>
      ))}
    </div>
  );
}

function statusLabel(
  kind: "issue" | "pull-request",
  status: ProjectIssue["status"] | ProjectPullRequest["status"],
) {
  if (kind === "issue") {
    if (status === "draft") return "Triage";
    if (status === "merged") return "Done";
  }
  return status === "draft"
    ? "Draft"
    : status === "merged"
      ? "Merged"
      : status === "closed"
        ? "Closed"
        : "Open";
}

function WorkItemItems({
  kind,
  items,
  viewMode,
  onOpen,
}: {
  kind: "issue" | "pull-request";
  items: Array<{
    id: string;
    title: string;
    content: string;
    author: string;
    status: ProjectIssue["status"] | ProjectPullRequest["status"];
    createdAt: number;
    comments: unknown[];
    project: Project;
  }>;
  viewMode: ProjectsViewMode;
  onOpen: (item: (typeof items)[number]) => void;
}) {
  if (items.length === 0) {
    return (
      <EmptyList>
        {kind === "issue" ? "No issues yet." : "No pull requests yet."}
      </EmptyList>
    );
  }
  const Icon = kind === "issue" ? CircleDot : GitPullRequest;
  return (
    <div
      className={
        viewMode === "grid"
          ? "grid gap-3 md:grid-cols-2 xl:grid-cols-3"
          : "divide-y overflow-hidden border"
      }
      data-testid="projects-list-container"
    >
      {items.map((item) => (
        <article
          className={`group relative flex min-w-0 gap-3 hover:bg-muted/20 ${
            viewMode === "grid"
              ? "min-h-40 flex-col border p-4"
              : "items-center px-4 py-3"
          }`}
          data-testid={`projects-${kind}-row-${item.id}`}
          key={item.id}
        >
          <button
            className="absolute inset-0"
            onClick={() => onOpen(item)}
            type="button"
          >
            <span className="sr-only">View {item.title}</span>
          </button>
          <div className="flex min-w-0 items-start gap-3">
            <Icon className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground" />
            <div className="min-w-0 flex-1">
              <h2 className="truncate text-sm font-semibold">{item.title}</h2>
              <p className="mt-1 truncate text-xs text-muted-foreground">
                {item.project.name} · #{item.id.slice(0, 8)} · by{" "}
                {truncatePubkey(item.author)}
              </p>
            </div>
          </div>
          {viewMode === "grid" && item.content ? (
            <p className="line-clamp-2 text-sm text-foreground/90">
              {item.content}
            </p>
          ) : null}
          <div
            className={`flex items-center gap-3 text-xs text-muted-foreground ${
              viewMode === "grid" ? "mt-auto" : "ml-auto shrink-0"
            }`}
          >
            <span className="font-medium text-foreground">
              {statusLabel(kind, item.status)}
            </span>
            {item.comments.length ? (
              <span className="inline-flex items-center gap-1">
                <MessageSquare className="h-3.5 w-3.5" />
                {item.comments.length}
              </span>
            ) : null}
            <span className="whitespace-nowrap">
              {relativeTime(item.createdAt)}
            </span>
          </div>
        </article>
      ))}
    </div>
  );
}

type ActivityItem = {
  id: string;
  actor: string;
  action: string;
  title: string;
  body: string;
  createdAt: number;
  project: Project;
  issue?: ProjectIssue;
  pullRequest?: ProjectPullRequest;
};

function activityItems(
  projects: Project[],
  issues: Array<{ project: Project; issue: ProjectIssue }>,
  pullRequests: Array<{
    project: Project;
    pullRequest: ProjectPullRequest;
  }>,
) {
  const items: ActivityItem[] = projects.map((project) => ({
    id: `project:${project.id}`,
    actor: project.owner,
    action: "created the repository",
    title: project.name,
    body: project.description,
    createdAt: project.createdAt,
    project,
  }));
  for (const { project, issue } of issues) {
    items.push({
      id: `issue:${issue.id}`,
      actor: issue.author,
      action: "created an issue in",
      title: issue.title,
      body: issue.content,
      createdAt: issue.createdAt,
      project,
      issue,
    });
    for (const comment of issue.comments) {
      items.push({
        id: `issue-comment:${comment.id}`,
        actor: comment.author,
        action: "commented on an issue in",
        title: issue.title,
        body: comment.content,
        createdAt: comment.createdAt,
        project,
        issue,
      });
    }
  }
  for (const { project, pullRequest } of pullRequests) {
    items.push({
      id: `pull-request:${pullRequest.id}`,
      actor: pullRequest.author,
      action: "opened a pull request in",
      title: pullRequest.title,
      body: pullRequest.content,
      createdAt: pullRequest.createdAt,
      project,
      pullRequest,
    });
    for (const update of pullRequest.updates) {
      items.push({
        id: `pull-request-update:${update.id}`,
        actor: update.author,
        action: "updated a pull request in",
        title: pullRequest.title,
        body: update.content,
        createdAt: update.createdAt,
        project,
        pullRequest,
      });
    }
    for (const comment of pullRequest.comments) {
      items.push({
        id: `pull-request-comment:${comment.id}`,
        actor: comment.author,
        action:
          comment.reviewDecisionStatus === "current" &&
          comment.reviewDecision === "approved"
            ? "approved a pull request in"
            : comment.reviewDecisionStatus === "current" &&
                comment.reviewDecision === "changes-requested"
              ? "requested changes to a pull request in"
              : "commented on a pull request in",
        title: pullRequest.title,
        body: comment.content,
        createdAt: comment.createdAt,
        project,
        pullRequest,
      });
    }
  }
  return items
    .sort((left, right) => right.createdAt - left.createdAt)
    .slice(0, 30);
}

function Overview({
  projects,
  issues,
  pullRequests,
  loading,
  onFilterChange,
  onOpenActivity,
}: {
  projects: Project[];
  issues: Array<{ project: Project; issue: ProjectIssue }>;
  pullRequests: Array<{
    project: Project;
    pullRequest: ProjectPullRequest;
  }>;
  loading: boolean;
  onFilterChange: (filter: ProjectsFilter, local?: boolean) => void;
  onOpenActivity: (item: ActivityItem) => void;
}) {
  const activity = activityItems(projects, issues, pullRequests);
  const stats = [
    {
      label: "Repositories",
      count: projects.length,
      icon: FolderGit2,
      onClick: () => onFilterChange("repositories"),
    },
    {
      label: "Pull requests",
      count: pullRequests.length,
      icon: GitPullRequest,
      onClick: () => onFilterChange("pull-requests"),
    },
    {
      label: "Local",
      count: projects.filter(isRelayHostedProject).length,
      icon: Radio,
      onClick: () => onFilterChange("repositories", true),
    },
    {
      label: "Issues",
      count: issues.length,
      icon: CircleDot,
      onClick: () => onFilterChange("issues"),
    },
  ];
  return (
    <section data-testid="projects-overview-panel">
      <div className="grid grid-cols-2 gap-2 sm:gap-3 xl:grid-cols-4">
        {stats.map(({ label, count, icon: Icon, onClick }) => (
          <button
            className="flex min-h-28 flex-col border px-3.5 py-3 text-left transition-colors hover:bg-muted/30"
            data-testid="projects-overview-stat"
            key={label}
            onClick={onClick}
            type="button"
          >
            <span className="flex w-full items-center justify-between gap-2 text-xs font-medium text-muted-foreground">
              {label}
              <Icon className="h-3.5 w-3.5" />
            </span>
            <span className="mt-auto pt-4 text-4xl font-semibold leading-none">
              {count}
            </span>
          </button>
        ))}
      </div>
      <div className="mt-5">
        <h2 className="text-base font-semibold">Activity</h2>
        {loading ? (
          <p className="mt-3 border px-4 py-10 text-center text-sm text-muted-foreground">
            Loading project activity...
          </p>
        ) : activity.length ? (
          <div className="mt-3 divide-y border">
            {activity.map((item) => (
              <button
                className="flex w-full min-w-0 gap-3 px-4 py-3 text-left hover:bg-muted/20"
                key={item.id}
                onClick={() => onOpenActivity(item)}
                type="button"
              >
                <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-muted font-mono text-[10px] font-semibold">
                  {item.actor.slice(0, 2).toUpperCase()}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-xs text-muted-foreground">
                    {truncatePubkey(item.actor)} {item.action}{" "}
                    {item.project.name}
                  </span>
                  <span className="mt-0.5 block truncate text-sm font-semibold">
                    {item.title}
                  </span>
                  {item.body ? (
                    <span className="mt-1 block line-clamp-2 text-sm text-muted-foreground">
                      {item.body}
                    </span>
                  ) : null}
                </span>
                <span className="shrink-0 text-xs text-muted-foreground">
                  {relativeTime(item.createdAt)}
                </span>
              </button>
            ))}
          </div>
        ) : (
          <EmptyList>No project activity yet.</EmptyList>
        )}
      </div>
    </section>
  );
}

export function ProjectsIndex({
  ownerPubkey,
  pendingDelete,
  projects,
  projectsError,
  projectsLoading,
  onCreateProject,
  onDelete,
  onRetryProjects,
}: {
  ownerPubkey: string;
  pendingDelete: boolean;
  projects: Project[];
  projectsError: Error | null;
  projectsLoading: boolean;
  onCreateProject: () => void;
  onDelete: (project: Project) => void;
  onRetryProjects: () => void;
}) {
  const navigate = useNavigate();
  const [filter, setFilterState] = useState<ProjectsFilter>(() =>
    readProjectsIndexState(
      PROJECTS_INDEX_STORAGE.filter,
      ["overview", "repositories", "pull-requests", "issues"],
      "overview",
    ),
  );
  const [repositoryScope, setRepositoryScopeState] = useState<ProjectsScope>(
    () =>
      readProjectsIndexState(
        PROJECTS_INDEX_STORAGE.repositoryScope,
        ["all", "mine", "local"],
        "all",
      ),
  );
  const [pullRequestScope, setPullRequestScopeState] = useState<WorkItemScope>(
    () =>
      readProjectsIndexState(
        PROJECTS_INDEX_STORAGE.pullRequestScope,
        ["all", "mine"],
        "all",
      ),
  );
  const [issueScope, setIssueScopeState] = useState<WorkItemScope>(() =>
    readProjectsIndexState(
      PROJECTS_INDEX_STORAGE.issueScope,
      ["all", "mine"],
      "all",
    ),
  );
  const [sort, setSortState] = useState<ProjectsSort>(() =>
    readProjectsIndexState(
      PROJECTS_INDEX_STORAGE.sort,
      ["updated", "created", "name"],
      "updated",
    ),
  );
  const [viewMode, setViewModeState] = useState<ProjectsViewMode>(() =>
    readProjectsIndexState(
      PROJECTS_INDEX_STORAGE.viewMode,
      ["grid", "list"],
      "grid",
    ),
  );
  const workItemsQuery = useQuery({
    queryKey: [
      "projects-work-items",
      projects.map((project) => project.repoAddress),
    ],
    queryFn: () => listProjectsWorkItems(projects),
    enabled: projects.length > 0,
    staleTime: 30_000,
  });
  const issues = workItemsQuery.data?.issues ?? [];
  const pullRequests = workItemsQuery.data?.pullRequests ?? [];
  const issueCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const item of issues) {
      counts.set(
        item.project.repoAddress,
        (counts.get(item.project.repoAddress) ?? 0) + 1,
      );
    }
    return counts;
  }, [issues]);
  const pullRequestCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const item of pullRequests) {
      counts.set(
        item.project.repoAddress,
        (counts.get(item.project.repoAddress) ?? 0) + 1,
      );
    }
    return counts;
  }, [pullRequests]);
  const updatedAt = useMemo(
    () =>
      new Map(
        projects.map((project) => [
          project.repoAddress,
          projectUpdatedAt(project, issues, pullRequests),
        ]),
      ),
    [issues, projects, pullRequests],
  );

  function setFilter(value: ProjectsFilter) {
    setFilterState(value);
    writeProjectsIndexState(PROJECTS_INDEX_STORAGE.filter, value);
  }
  function setRepositoryScope(value: ProjectsScope) {
    setRepositoryScopeState(value);
    writeProjectsIndexState(PROJECTS_INDEX_STORAGE.repositoryScope, value);
  }
  function setPullRequestScope(value: WorkItemScope) {
    setPullRequestScopeState(value);
    writeProjectsIndexState(PROJECTS_INDEX_STORAGE.pullRequestScope, value);
  }
  function setIssueScope(value: WorkItemScope) {
    setIssueScopeState(value);
    writeProjectsIndexState(PROJECTS_INDEX_STORAGE.issueScope, value);
  }
  function setSort(value: ProjectsSort) {
    setSortState(value);
    writeProjectsIndexState(PROJECTS_INDEX_STORAGE.sort, value);
  }
  function setViewMode(value: ProjectsViewMode) {
    setViewModeState(value);
    writeProjectsIndexState(PROJECTS_INDEX_STORAGE.viewMode, value);
  }

  const visibleProjects = [...projects]
    .filter((project) => {
      if (repositoryScope === "mine") return project.owner === ownerPubkey;
      if (repositoryScope === "local") return isRelayHostedProject(project);
      return true;
    })
    .sort((left, right) => {
      if (sort === "name") return left.name.localeCompare(right.name);
      if (sort === "created") return right.createdAt - left.createdAt;
      return (
        (updatedAt.get(right.repoAddress) ?? right.createdAt) -
        (updatedAt.get(left.repoAddress) ?? left.createdAt)
      );
    });
  const visibleIssues = issues
    .filter(({ issue }) => issueScope === "all" || issue.author === ownerPubkey)
    .map(({ project, issue }) => ({ ...issue, project }))
    .sort((left, right) => {
      if (sort === "name") return left.title.localeCompare(right.title);
      if (sort === "created") return right.createdAt - left.createdAt;
      return right.updatedAt - left.updatedAt;
    });
  const visiblePullRequests = pullRequests
    .filter(
      ({ pullRequest }) =>
        pullRequestScope === "all" || pullRequest.author === ownerPubkey,
    )
    .map(({ project, pullRequest }) => ({ ...pullRequest, project }))
    .sort((left, right) => {
      if (sort === "name") return left.title.localeCompare(right.title);
      if (sort === "created") return right.createdAt - left.createdAt;
      return right.updatedAt - left.updatedAt;
    });

  function openIssue(item: { id: string; project: Project }) {
    void navigate({
      params: { projectId: item.project.id },
      search: { issue: item.id },
      to: "/projects/$projectId",
    });
  }
  function openPullRequest(item: { id: string; project: Project }) {
    void navigate({
      params: { projectId: item.project.id },
      search: { pullRequest: item.id },
      to: "/projects/$projectId",
    });
  }
  function openActivity(item: ActivityItem) {
    if (item.issue) {
      openIssue({ ...item.issue, project: item.project });
      return;
    }
    if (item.pullRequest) {
      openPullRequest({ ...item.pullRequest, project: item.project });
      return;
    }
    void navigate({
      params: { projectId: item.project.id },
      search: {},
      to: "/projects/$projectId",
    });
  }

  return (
    <>
      <header className="flex items-start gap-4">
        <SidebarToggleButton />
        <div className="min-w-0 flex-1">
          <h1 className="text-2xl font-semibold">Projects</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Set up and manage your projects.
          </p>
        </div>
        <ProjectsCreateControls
          projects={projects}
          onCreateProject={onCreateProject}
        />
      </header>
      <div className="mt-6 flex items-center gap-4">
        <ProjectsTabs filter={filter} onChange={setFilter} />
      </div>
      {projectsLoading ? (
        <p className="mt-8 text-sm text-muted-foreground">
          Loading projects...
        </p>
      ) : projectsError ? (
        <div className="mt-8 flex items-center gap-3 border p-4 text-sm text-destructive">
          <span className="flex-1">Could not load projects.</span>
          <Button onClick={onRetryProjects} size="sm" variant="outline">
            <RefreshCw /> Retry
          </Button>
        </div>
      ) : projects.length === 0 ? (
        <EmptyList>No projects yet.</EmptyList>
      ) : filter === "overview" ? (
        <div className="mt-4">
          {workItemsQuery.error ? (
            <div className="mb-3 flex items-center gap-3 border p-3 text-sm text-destructive">
              <span className="flex-1">Could not load project activity.</span>
              <Button
                disabled={workItemsQuery.isFetching}
                onClick={() => void workItemsQuery.refetch()}
                size="sm"
                variant="outline"
              >
                <RefreshCw /> Retry
              </Button>
            </div>
          ) : null}
          <Overview
            issues={issues}
            loading={workItemsQuery.isLoading}
            projects={projects}
            pullRequests={pullRequests}
            onFilterChange={(nextFilter, local) => {
              if (local) setRepositoryScope("local");
              setFilter(nextFilter);
            }}
            onOpenActivity={openActivity}
          />
        </div>
      ) : (
        <section className="mt-4 space-y-3">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            {filter === "repositories" ? (
              <SelectControl
                label="Filter repositories"
                options={[
                  { label: "All", value: "all" },
                  { label: "My Repositories", value: "mine" },
                  { label: "Local", value: "local" },
                ]}
                value={repositoryScope}
                onChange={setRepositoryScope}
              />
            ) : filter === "pull-requests" ? (
              <SelectControl
                label="Filter pull requests"
                options={[
                  { label: "All", value: "all" },
                  { label: "My Pull Requests", value: "mine" },
                ]}
                value={pullRequestScope}
                onChange={setPullRequestScope}
              />
            ) : (
              <SelectControl
                label="Filter issues"
                options={[
                  { label: "All", value: "all" },
                  { label: "My Issues", value: "mine" },
                ]}
                value={issueScope}
                onChange={setIssueScope}
              />
            )}
            <ListControls
              sort={sort}
              viewMode={viewMode}
              onSortChange={setSort}
              onViewModeChange={setViewMode}
            />
          </div>
          {filter !== "repositories" && workItemsQuery.isLoading ? (
            <p className="border px-4 py-12 text-center text-sm text-muted-foreground">
              Loading {filter === "issues" ? "issues" : "pull requests"}...
            </p>
          ) : filter !== "repositories" && workItemsQuery.error ? (
            <div className="flex items-center gap-3 border p-4 text-sm text-destructive">
              <span className="flex-1">
                Could not load{" "}
                {filter === "issues" ? "issues" : "pull requests"}.
              </span>
              <Button
                disabled={workItemsQuery.isFetching}
                onClick={() => void workItemsQuery.refetch()}
                size="sm"
                variant="outline"
              >
                <RefreshCw /> Retry
              </Button>
            </div>
          ) : filter === "repositories" ? (
            <RepositoryItems
              issueCounts={issueCounts}
              ownerPubkey={ownerPubkey}
              pendingDelete={pendingDelete}
              projects={visibleProjects}
              pullRequestCounts={pullRequestCounts}
              updatedAt={updatedAt}
              viewMode={viewMode}
              onDelete={onDelete}
            />
          ) : filter === "issues" ? (
            <WorkItemItems
              items={visibleIssues}
              kind="issue"
              viewMode={viewMode}
              onOpen={openIssue}
            />
          ) : (
            <WorkItemItems
              items={visiblePullRequests}
              kind="pull-request"
              viewMode={viewMode}
              onOpen={openPullRequest}
            />
          )}
        </section>
      )}
    </>
  );
}
