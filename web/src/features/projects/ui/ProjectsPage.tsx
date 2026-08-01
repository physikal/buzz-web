import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import {
  Bot,
  BookMarked,
  FolderKanban,
  GitFork,
  LogOut,
  MessageSquare,
  Plus,
  Settings,
  Trash2,
  X,
  Zap,
} from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import buzzAppIcon from "@/assets/app-icon@3x.png";
import { OwnerConnection } from "@/features/agents/ui/OwnerConnection";
import { lockOwnerVault } from "@/features/owner-vault/lib/vault-worker-client";
import { truncatePubkey } from "@/shared/lib/pubkey";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import {
  createProject,
  createProjectIssue,
  deleteProject,
  listProjectIssues,
  listProjects,
  type Project,
  setProjectIssueStatus,
} from "../project-api";

export function ProjectsPage({ projectId }: { projectId?: string }) {
  const [ownerPubkey, setOwnerPubkey] = useState<string | null>(null);
  if (!ownerPubkey) return <OwnerConnection onConnected={setOwnerPubkey} />;
  return (
    <ProjectsWorkspace
      ownerPubkey={ownerPubkey}
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
  projectId,
  onDisconnect,
}: {
  ownerPubkey: string;
  projectId?: string;
  onDisconnect: () => void;
}) {
  const [createOpen, setCreateOpen] = useState(false);
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
      <ProjectNav ownerPubkey={ownerPubkey} onDisconnect={onDisconnect} />
      <main className="min-w-0 flex-1 overflow-y-auto p-5 sm:p-8">
        <div className="mx-auto max-w-6xl">
          {projectId ? (
            selected ? (
              <ProjectDetail ownerPubkey={ownerPubkey} project={selected} />
            ) : projectsQuery.isLoading ? (
              <p className="text-sm text-muted-foreground">Loading project…</p>
            ) : (
              <p className="text-sm text-muted-foreground">
                Project not found.
              </p>
            )
          ) : (
            <>
              <header className="flex items-start justify-between gap-4">
                <div>
                  <h1 className="text-2xl font-semibold">Projects</h1>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Repositories, issues, and shared engineering work.
                  </p>
                </div>
                <Button onClick={() => setCreateOpen(true)}>
                  <Plus /> New project
                </Button>
              </header>
              {projectsQuery.isLoading ? (
                <p className="mt-8 text-sm text-muted-foreground">
                  Loading projects…
                </p>
              ) : projects.length ? (
                <div className="mt-7 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {projects.map((project) => (
                    <article
                      className="group rounded-md border p-4"
                      key={project.id}
                    >
                      <div className="flex items-start gap-3">
                        <FolderKanban className="mt-0.5 h-5 w-5 text-muted-foreground" />
                        <Link
                          className="min-w-0 flex-1"
                          params={{ projectId: project.id }}
                          to="/projects/$projectId"
                        >
                          <h2 className="truncate font-semibold hover:underline">
                            {project.name}
                          </h2>
                          <p className="mt-1 line-clamp-2 min-h-10 text-sm text-muted-foreground">
                            {project.description || "No description"}
                          </p>
                        </Link>
                        {project.owner === ownerPubkey ? (
                          <Button
                            aria-label={`Delete ${project.name}`}
                            className="opacity-0 group-hover:opacity-100"
                            disabled={deleteMutation.isPending}
                            onClick={() => {
                              if (window.confirm(`Delete ${project.name}?`))
                                deleteMutation.mutate(project);
                            }}
                            size="icon"
                            variant="ghost"
                          >
                            <Trash2 />
                          </Button>
                        ) : null}
                      </div>
                      <p className="mt-4 font-mono text-xs text-muted-foreground">
                        {truncatePubkey(project.owner)} / {project.dtag}
                      </p>
                    </article>
                  ))}
                </div>
              ) : (
                <div className="mt-8 rounded-md border border-dashed p-10 text-center">
                  <FolderKanban className="mx-auto h-7 w-7 text-muted-foreground" />
                  <p className="mt-3 text-sm text-muted-foreground">
                    No projects have been announced yet.
                  </p>
                </div>
              )}
            </>
          )}
        </div>
      </main>
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
  project,
  ownerPubkey,
}: {
  project: Project;
  ownerPubkey: string;
}) {
  const queryClient = useQueryClient();
  const [issueOpen, setIssueOpen] = useState(false);
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
      status: "open" | "draft" | "merged" | "closed";
    }) => setProjectIssueStatus(project, id, status),
    onSuccess: refresh,
    onError: (error) =>
      toast.error("Could not update issue", { description: error.message }),
  });
  return (
    <>
      <Link
        className="text-sm text-muted-foreground hover:text-foreground"
        to="/projects"
      >
        ← Projects
      </Link>
      <header className="mt-5 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">{project.name}</h1>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            {project.description}
          </p>
          <p className="mt-2 font-mono text-xs text-muted-foreground">
            {project.repoAddress}
          </p>
        </div>
        <div className="flex gap-2">
          <Button onClick={() => setIssueOpen(true)}>
            <Plus /> New issue
          </Button>
          {project.cloneUrls[0] ? (
            <Button asChild variant="outline">
              <a href={project.cloneUrls[0]}>Clone URL</a>
            </Button>
          ) : null}
        </div>
      </header>
      <section className="mt-8">
        <h2 className="text-lg font-semibold">Issues</h2>
        <div className="mt-3 divide-y overflow-hidden rounded-md border">
          {issuesQuery.isLoading ? (
            <p className="p-4 text-sm text-muted-foreground">Loading issues…</p>
          ) : (issuesQuery.data ?? []).length ? (
            issuesQuery.data?.map((issue) => (
              <article className="flex items-start gap-3 p-4" key={issue.id}>
                <div className="min-w-0 flex-1">
                  <h3 className="font-medium">{issue.title}</h3>
                  <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">
                    {issue.content}
                  </p>
                  <p className="mt-2 text-xs text-muted-foreground">
                    {issue.status} · {truncatePubkey(issue.author)}
                  </p>
                </div>
                {project.owner === ownerPubkey ? (
                  <select
                    aria-label={`Status for ${issue.title}`}
                    className="h-8 rounded-md border bg-background px-2 text-xs"
                    disabled={statusMutation.isPending}
                    value={issue.status}
                    onChange={(event) =>
                      statusMutation.mutate({
                        id: issue.id,
                        status: event.target.value as typeof issue.status,
                      })
                    }
                  >
                    <option value="open">Open</option>
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
      </section>
      <CreateIssueDialog
        open={issueOpen}
        pending={createIssue.isPending}
        onClose={() => setIssueOpen(false)}
        onSubmit={(input) => createIssue.mutateAsync(input)}
      />
    </>
  );
}

function ProjectNav({
  ownerPubkey,
  onDisconnect,
}: {
  ownerPubkey: string;
  onDisconnect: () => void;
}) {
  return (
    <aside className="hidden w-60 shrink-0 border-r bg-sidebar p-3 sm:flex sm:flex-col">
      <div className="flex items-center gap-2 px-2 py-2">
        <div
          className="h-8 w-8 overflow-hidden bg-black"
          style={{ borderRadius: "22.37%" }}
        >
          <img alt="" className="h-full w-full" src={buzzAppIcon} />
        </div>
        <span className="font-semibold">Buzz</span>
      </div>
      <nav className="mt-4 space-y-1 text-sm">
        <Nav to="/" icon={<BookMarked />} label="Repositories" />
        <Nav to="/channels" icon={<MessageSquare />} label="Channels" />
        <Nav to="/pulse" icon={<Zap />} label="Pulse" />
        <Nav to="/projects" icon={<FolderKanban />} label="Projects" active />
        <Nav to="/workflows" icon={<GitFork />} label="Workflows" />
        <Nav to="/agents" icon={<Bot />} label="Agents" />
        <Nav to="/settings" icon={<Settings />} label="Settings" />
      </nav>
      <button
        className="mt-auto flex items-center gap-2 border-t px-2 py-3 text-xs text-muted-foreground"
        onClick={onDisconnect}
        type="button"
      >
        <LogOut className="h-4 w-4" /> {truncatePubkey(ownerPubkey)}
      </button>
    </aside>
  );
}

function Nav({
  to,
  icon,
  label,
  active,
}: {
  to:
    | "/"
    | "/channels"
    | "/pulse"
    | "/projects"
    | "/workflows"
    | "/agents"
    | "/settings";
  icon: React.ReactNode;
  label: string;
  active?: boolean;
}) {
  return (
    <Link
      className={`flex items-center gap-2 rounded-md px-2 py-2 ${active ? "bg-sidebar-accent font-medium" : "text-muted-foreground hover:bg-sidebar-accent"}`}
      to={to}
    >
      <span className="[&_svg]:h-4 [&_svg]:w-4">{icon}</span>
      {label}
    </Link>
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
  if (!open) return null;
  return (
    <Modal title="New project" onClose={onClose}>
      <form
        className="space-y-4"
        onSubmit={(event) => {
          event.preventDefault();
          void onSubmit({ name, description, cloneUrl });
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
    <Modal title="New issue" onClose={onClose}>
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
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
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
