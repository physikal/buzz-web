import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import {
  BookOpen,
  Copy,
  ExternalLink,
  MessageSquare,
  Plus,
  X,
} from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { OwnerConnection } from "@/features/agents/ui/OwnerConnection";
import { AppPrimarySidebar } from "@/features/navigation/AppPrimarySidebar";
import { lockOwnerVault } from "@/features/owner-vault/lib/vault-worker-client";
import { truncatePubkey } from "@/shared/lib/pubkey";
import { isSafeHttpUrl } from "@/shared/lib/url";
import { useEscapeSurface } from "@/shared/hooks/use-escape-surface";
import { useSidebarVisibility } from "@/shared/hooks/use-sidebar-visibility";
import { Button } from "@/shared/ui/button";
import { DestructiveConfirmDialog } from "@/shared/ui/destructive-confirm-dialog";
import { Input } from "@/shared/ui/input";
import { SidebarToggleButton } from "@/shared/ui/sidebar-toggle-button";
import { ProjectPullRequestsPanel } from "./ProjectPullRequestsPanel";
import { ProjectIssueDetail } from "./ProjectIssueDetail";
import { ProjectsIndex } from "./ProjectsIndex";
import {
  ProjectRepositoryPanel,
  type ProjectRepositoryView,
} from "./ProjectRepositoryPanel";
import {
  createProject,
  createProjectIssue,
  deleteProject,
  listProjectIssues,
  listProjects,
  type Project,
  type ProjectIssueLifecycleStatus,
  setProjectIssueStatus,
} from "../project-api";
import {
  projectIssueLifecycleStatus,
  projectIssueStatusLabel,
} from "../project-issue-status";

export function ProjectsPage({
  initialCommitOid,
  initialIssueId,
  initialPullRequestId,
  projectId,
}: {
  initialCommitOid?: string;
  initialIssueId?: string;
  initialPullRequestId?: string;
  projectId?: string;
}) {
  const [ownerPubkey, setOwnerPubkey] = useState<string | null>(null);
  if (!ownerPubkey) return <OwnerConnection onConnected={setOwnerPubkey} />;
  return (
    <ProjectsWorkspace
      ownerPubkey={ownerPubkey}
      initialCommitOid={initialCommitOid}
      initialIssueId={initialIssueId}
      initialPullRequestId={initialPullRequestId}
      projectId={projectId}
      onDisconnect={() => {
        void lockOwnerVault();
        setOwnerPubkey(null);
      }}
    />
  );
}

function ProjectsWorkspace({
  ownerPubkey,
  initialCommitOid,
  initialIssueId,
  initialPullRequestId,
  projectId,
  onDisconnect,
}: {
  ownerPubkey: string;
  initialCommitOid?: string;
  initialIssueId?: string;
  initialPullRequestId?: string;
  projectId?: string;
  onDisconnect: () => void;
}) {
  const [createOpen, setCreateOpen] = useState(false);
  const [projectToDelete, setProjectToDelete] = useState<Project | null>(null);
  const sidebar = useSidebarVisibility();
  const queryClient = useQueryClient();
  const projectsQuery = useQuery({
    queryKey: ["projects"],
    queryFn: listProjects,
  });
  const projects = projectsQuery.data ?? [];
  const selected = projects.find((project) => project.id === projectId) ?? null;
  const refresh = () =>
    queryClient.invalidateQueries({ queryKey: ["projects"] });
  const createMutation = useMutation({
    mutationFn: createProject,
    onSuccess: async () => {
      await refresh();
      setCreateOpen(false);
      toast.success("Project created");
    },
    onError: (error) =>
      toast.error("Could not create project", { description: error.message }),
  });
  const deleteMutation = useMutation({
    mutationFn: deleteProject,
    onSuccess: async () => {
      await refresh();
      toast.success("Project deleted");
    },
    onError: (error) =>
      toast.error("Could not delete project", { description: error.message }),
  });

  return (
    <div className="flex min-h-dvh bg-background">
      {sidebar.open ? (
        <AppPrimarySidebar
          active="projects"
          onDisconnect={onDisconnect}
          ownerPubkey={ownerPubkey}
        />
      ) : null}
      <main className="min-w-0 flex-1 overflow-y-auto p-5 sm:p-8">
        <div className="mx-auto max-w-6xl">
          {projectId ? (
            selected ? (
              <ProjectDetail
                initialIssueId={initialIssueId}
                initialCommitOid={initialCommitOid}
                initialPullRequestId={initialPullRequestId}
                ownerPubkey={ownerPubkey}
                project={selected}
              />
            ) : projectsQuery.isLoading ? (
              <p className="text-sm text-muted-foreground">Loading project…</p>
            ) : (
              <p className="text-sm text-muted-foreground">
                Project not found.
              </p>
            )
          ) : (
            <ProjectsIndex
              ownerPubkey={ownerPubkey}
              pendingDelete={deleteMutation.isPending}
              projects={projects}
              projectsError={projectsQuery.error}
              projectsLoading={projectsQuery.isLoading}
              onCreateProject={() => setCreateOpen(true)}
              onDelete={setProjectToDelete}
              onRetryProjects={() => void projectsQuery.refetch()}
            />
          )}
        </div>
      </main>
      <DestructiveConfirmDialog
        confirmLabel="Delete project"
        description={`Delete ${projectToDelete?.name ?? "this project"} from Projects for everyone. This can only be done for projects you own and cannot be undone.`}
        onClose={() => setProjectToDelete(null)}
        onConfirm={() => {
          if (!projectToDelete) return;
          void deleteMutation
            .mutateAsync(projectToDelete)
            .then(() => setProjectToDelete(null))
            .catch(() => {});
        }}
        open={projectToDelete !== null}
        pending={deleteMutation.isPending}
        pendingLabel="Deleting..."
        title="Delete project?"
      />
      <CreateProjectDialog
        open={createOpen}
        pending={createMutation.isPending}
        onClose={() => setCreateOpen(false)}
        onSubmit={(input) => createMutation.mutateAsync(input)}
      />
    </div>
  );
}

function ProjectDetail({
  initialCommitOid,
  initialIssueId,
  initialPullRequestId,
  project,
  ownerPubkey,
}: {
  initialCommitOid?: string;
  initialIssueId?: string;
  initialPullRequestId?: string;
  project: Project;
  ownerPubkey: string;
}) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [issueOpen, setIssueOpen] = useState(false);
  const [selectedIssueId, setSelectedIssueId] = useState<string | null>(
    initialIssueId ?? null,
  );
  const [projectView, setProjectView] = useState<
    ProjectRepositoryView | "issues" | "pull-requests"
  >(
    initialIssueId
      ? "issues"
      : initialPullRequestId
        ? "pull-requests"
        : initialCommitOid
          ? "commits"
          : "overview",
  );
  const issuesQuery = useQuery({
    queryKey: ["project-issues", project.repoAddress],
    queryFn: () => listProjectIssues(project),
  });
  const refresh = () =>
    queryClient.invalidateQueries({
      queryKey: ["project-issues", project.repoAddress],
    });
  const createIssue = useMutation({
    mutationFn: (input: { title: string; content: string; labels: string[] }) =>
      createProjectIssue(project, input),
    onSuccess: async () => {
      await refresh();
      setIssueOpen(false);
      toast.success("Issue created");
    },
    onError: (error) =>
      toast.error("Could not create issue", { description: error.message }),
  });
  const statusMutation = useMutation({
    mutationFn: ({
      id,
      status,
    }: {
      id: string;
      status: ProjectIssueLifecycleStatus;
    }) => setProjectIssueStatus(project, id, status),
    onSuccess: refresh,
    onError: (error) =>
      toast.error("Could not update issue", { description: error.message }),
  });
  const selectedIssue = (issuesQuery.data ?? []).find(
    (issue) => issue.id === selectedIssueId,
  );
  const safeWebUrl = isSafeHttpUrl(project.webUrl) ? project.webUrl : null;
  if (selectedIssue) {
    return (
      <ProjectIssueDetail
        issue={selectedIssue}
        ownerPubkey={ownerPubkey}
        project={project}
        statusPending={statusMutation.isPending}
        onBack={() => {
          setSelectedIssueId(null);
          void navigate({
            params: { projectId: project.id },
            search: {},
            to: "/projects/$projectId",
            replace: true,
          });
        }}
        onStatusChange={(status) =>
          statusMutation.mutate({ id: selectedIssue.id, status })
        }
        onUpdated={refresh}
      />
    );
  }
  return (
    <>
      <Link
        className="text-sm text-muted-foreground hover:text-foreground"
        to="/projects"
      >
        ← Projects
      </Link>
      <header className="mt-5 flex flex-wrap items-start justify-between gap-4">
        <SidebarToggleButton />
        <div>
          <div className="flex min-w-0 items-center gap-1.5">
            <h1 className="min-w-0 text-2xl font-semibold">{project.name}</h1>
            {safeWebUrl ? (
              <Button
                aria-label="Open project web page"
                asChild
                className="h-7 w-7 shrink-0"
                size="icon"
                variant="ghost"
              >
                <a href={safeWebUrl} rel="noopener noreferrer" target="_blank">
                  <ExternalLink />
                </a>
              </Button>
            ) : null}
          </div>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            {project.description}
          </p>
          <p className="mt-2 break-all font-mono text-xs text-muted-foreground">
            {project.repoAddress}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {projectView === "issues" ? (
            <Button onClick={() => setIssueOpen(true)}>
              <Plus /> New issue
            </Button>
          ) : null}
          {project.projectChannelId ? (
            <Button asChild variant="outline">
              <Link
                search={{ channel: project.projectChannelId }}
                to="/channels"
              >
                <MessageSquare /> Open Discussion
              </Link>
            </Button>
          ) : null}
          {project.cloneUrls[0] ? (
            <Button
              onClick={() => {
                void navigator.clipboard
                  .writeText(project.cloneUrls[0] ?? "")
                  .then(() => toast.success("Clone URL copied"))
                  .catch(() => toast.error("Could not copy clone URL"));
              }}
              variant="outline"
            >
              <Copy /> Copy clone URL
            </Button>
          ) : null}
        </div>
      </header>
      <section className="mt-8">
        <div className="flex min-w-0 max-w-full gap-1 overflow-x-auto border-b scrollbar-none">
          <Button
            aria-label="Overview"
            className="h-8 w-8 shrink-0 rounded-md p-2"
            onClick={() => setProjectView("overview")}
            title="README"
            variant={projectView === "overview" ? "secondary" : "ghost"}
          >
            <BookOpen className="h-full w-full" />
          </Button>
          {(
            [
              ["files", "Files"],
              ["commits", "Commits"],
              ["issues", "Issues"],
              ["pull-requests", "Pull Request"],
              ["contributors", "Contributors"],
            ] as const
          ).map(([value, label]) => (
            <Button
              className={`relative h-8 shrink-0 rounded-none px-2.5 shadow-none after:absolute after:inset-x-2.5 after:bottom-0 after:h-0.5 after:bg-current after:content-[''] ${
                projectView === value
                  ? "font-semibold text-foreground after:opacity-100"
                  : "text-muted-foreground after:opacity-0 hover:bg-transparent hover:text-foreground hover:after:opacity-100"
              }`}
              key={value}
              onClick={() => setProjectView(value)}
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
        </div>
        {projectView === "overview" ||
        projectView === "files" ||
        projectView === "commits" ||
        projectView === "contributors" ? (
          <ProjectRepositoryPanel
            initialCommitOid={initialCommitOid}
            onViewChange={setProjectView}
            project={project}
            view={projectView}
          />
        ) : projectView === "issues" ? (
          <>
            <h2 className="mt-6 text-lg font-semibold">Issues</h2>
            <div className="mt-3 divide-y overflow-hidden rounded-md border">
              {issuesQuery.isLoading ? (
                <p className="p-4 text-sm text-muted-foreground">
                  Loading issues…
                </p>
              ) : (issuesQuery.data ?? []).length ? (
                issuesQuery.data?.map((issue) => (
                  <article
                    className="flex items-start gap-3 p-4"
                    key={issue.id}
                  >
                    <div className="min-w-0 flex-1">
                      <h3 className="font-medium">
                        <button
                          className="text-left hover:underline"
                          onClick={() => {
                            setSelectedIssueId(issue.id);
                            void navigate({
                              params: { projectId: project.id },
                              search: { issue: issue.id },
                              to: "/projects/$projectId",
                              replace: true,
                            });
                          }}
                          type="button"
                        >
                          {issue.title}
                        </button>
                      </h3>
                      <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">
                        {issue.content}
                      </p>
                      <p className="mt-2 text-xs text-muted-foreground">
                        {projectIssueStatusLabel(issue.status)} ·{" "}
                        {truncatePubkey(issue.author)}
                        {issue.comments.length
                          ? ` · ${issue.comments.length} ${issue.comments.length === 1 ? "comment" : "comments"}`
                          : ""}
                      </p>
                    </div>
                    {project.owner === ownerPubkey ? (
                      <select
                        aria-label={`Status for ${issue.title}`}
                        className="h-8 rounded-md border bg-background px-2 text-xs"
                        disabled={statusMutation.isPending}
                        value={projectIssueLifecycleStatus(issue.status)}
                        onChange={(event) =>
                          statusMutation.mutate({
                            id: issue.id,
                            status: event.target
                              .value as ProjectIssueLifecycleStatus,
                          })
                        }
                      >
                        <option value="open">
                          {projectIssueLifecycleStatus(issue.status) === "open"
                            ? projectIssueStatusLabel(issue.status)
                            : "Backlog"}
                        </option>
                        <option value="draft">Triage</option>
                        <option value="merged">Done</option>
                        <option value="closed">Closed</option>
                      </select>
                    ) : null}
                  </article>
                ))
              ) : (
                <p className="p-6 text-center text-sm text-muted-foreground">
                  No issues yet.
                </p>
              )}
            </div>
          </>
        ) : (
          <ProjectPullRequestsPanel
            initialSelectedId={initialPullRequestId}
            ownerPubkey={ownerPubkey}
            project={project}
          />
        )}
      </section>
      <CreateIssueDialog
        open={issueOpen}
        pending={createIssue.isPending}
        onClose={() => setIssueOpen(false)}
        onSubmit={(input) => createIssue.mutateAsync(input).then(() => {})}
      />
    </>
  );
}

function CreateProjectDialog({
  open,
  pending,
  onClose,
  onSubmit,
}: {
  open: boolean;
  pending: boolean;
  onClose: () => void;
  onSubmit: (input: {
    name: string;
    description: string;
    cloneUrl?: string;
    webUrl?: string;
  }) => Promise<void>;
}) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [cloneUrl, setCloneUrl] = useState("");
  const [webUrl, setWebUrl] = useState("");
  useEffect(() => {
    if (!open) return;
    setName("");
    setDescription("");
    setCloneUrl("");
    setWebUrl("");
  }, [open]);
  if (!open) return null;
  return (
    <Modal disabled={pending} title="New project" onClose={onClose}>
      <form
        className="space-y-4"
        onSubmit={(event) => {
          event.preventDefault();
          void onSubmit({ name, description, cloneUrl, webUrl });
        }}
      >
        <Field htmlFor="project-name" label="Name">
          <Input
            id="project-name"
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
        </Field>
        <Field htmlFor="project-description" label="Description">
          <textarea
            className="min-h-24 w-full rounded-md border bg-background p-3 text-sm"
            id="project-description"
            value={description}
            onChange={(event) => setDescription(event.target.value)}
          />
        </Field>
        <Field
          htmlFor="project-clone-url"
          label="Existing clone URL (optional)"
        >
          <Input
            id="project-clone-url"
            value={cloneUrl}
            onChange={(event) => setCloneUrl(event.target.value)}
          />
        </Field>
        <Field htmlFor="project-web-url" label="Web URL (optional)">
          <Input
            autoCapitalize="none"
            autoComplete="off"
            autoCorrect="off"
            id="project-web-url"
            placeholder="https://github.com/owner/repo"
            spellCheck={false}
            value={webUrl}
            onChange={(event) => setWebUrl(event.target.value)}
          />
        </Field>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={pending || !name.trim()} type="submit">
            {pending ? "Creating…" : "Create project"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

function CreateIssueDialog({
  open,
  pending,
  onClose,
  onSubmit,
}: {
  open: boolean;
  pending: boolean;
  onClose: () => void;
  onSubmit: (input: {
    title: string;
    content: string;
    labels: string[];
  }) => Promise<void>;
}) {
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [labels, setLabels] = useState("");
  if (!open) return null;
  return (
    <Modal disabled={pending} title="New issue" onClose={onClose}>
      <form
        className="space-y-4"
        onSubmit={(event) => {
          event.preventDefault();
          void onSubmit({
            title,
            content,
            labels: labels
              .split(",")
              .map((value) => value.trim())
              .filter(Boolean),
          });
        }}
      >
        <Field htmlFor="issue-title" label="Title">
          <Input
            id="issue-title"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
          />
        </Field>
        <Field htmlFor="issue-description" label="Description">
          <textarea
            className="min-h-28 w-full rounded-md border bg-background p-3 text-sm"
            id="issue-description"
            value={content}
            onChange={(event) => setContent(event.target.value)}
          />
        </Field>
        <Field htmlFor="issue-labels" label="Labels">
          <Input
            id="issue-labels"
            placeholder="bug, priority-high"
            value={labels}
            onChange={(event) => setLabels(event.target.value)}
          />
        </Field>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={pending || !title.trim()} type="submit">
            {pending ? "Creating…" : "Create issue"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

function Modal({
  title,
  onClose,
  children,
  disabled = false,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  disabled?: boolean;
}) {
  useEscapeSurface(true, onClose, disabled);
  return (
    <div
      aria-label={title}
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4"
      role="dialog"
    >
      <div className="w-full max-w-lg rounded-lg bg-background p-6 shadow-2xl">
        <header className="mb-5 flex items-center">
          <h2 className="flex-1 text-lg font-semibold">{title}</h2>
          <Button
            aria-label="Close"
            onClick={onClose}
            size="icon"
            variant="ghost"
          >
            <X />
          </Button>
        </header>
        {children}
      </div>
    </div>
  );
}

function Field({
  label,
  htmlFor,
  children,
}: {
  label: string;
  htmlFor: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block text-sm font-medium" htmlFor={htmlFor}>
      {label}
      <span className="mt-2 block">{children}</span>
    </label>
  );
}
