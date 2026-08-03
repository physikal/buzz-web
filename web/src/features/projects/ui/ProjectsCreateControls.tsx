import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { CircleDot, FolderGit2, GitPullRequest, Plus, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { useRepoRefs } from "@/features/repos/use-repo-refs";
import { useEscapeSurface } from "@/shared/hooks/use-escape-surface";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import {
  createProjectIssue,
  createProjectPullRequest,
  listProjectPullRequests,
  type Project,
} from "../project-api";
import {
  CreatePullRequestDialog,
  type CreatePullRequestInput,
} from "./CreatePullRequestDialog";

const MENU_ITEM =
  "flex min-h-9 w-full items-center gap-2 rounded-md px-2 py-2 text-left text-sm outline-none hover:bg-muted/50 focus:bg-muted/50 disabled:pointer-events-none disabled:opacity-50 [&_svg]:h-4 [&_svg]:w-4";

export function ProjectsCreateControls({
  projects,
  onCreateProject,
}: {
  projects: Project[];
  onCreateProject: () => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [issueOpen, setIssueOpen] = useState(false);
  const [pullRequestOpen, setPullRequestOpen] = useState(false);
  const menuRef = useRef<HTMLElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    function closeOnOutsidePointer(event: PointerEvent) {
      if (!menuRef.current?.contains(event.target as Node)) setMenuOpen(false);
    }
    globalThis.document.addEventListener(
      "pointerdown",
      closeOnOutsidePointer,
      true,
    );
    return () =>
      globalThis.document.removeEventListener(
        "pointerdown",
        closeOnOutsidePointer,
        true,
      );
  }, [menuOpen]);

  function select(action: () => void) {
    setMenuOpen(false);
    action();
  }

  return (
    <>
      <nav
        aria-label="Create project item"
        className="relative shrink-0"
        onBlurCapture={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget)) {
            setMenuOpen(false);
          }
        }}
        onKeyDown={(event) => {
          if (event.key === "Escape") setMenuOpen(false);
        }}
        onMouseEnter={() => setMenuOpen(true)}
        onMouseLeave={() => setMenuOpen(false)}
        ref={menuRef}
      >
        <Button
          aria-expanded={menuOpen}
          aria-haspopup="menu"
          aria-label="Create"
          className="h-8 w-8 rounded-full"
          data-testid="projects-create-menu"
          onClick={() => setMenuOpen(true)}
          size="icon"
        >
          <Plus className="h-4 w-4" />
        </Button>
        {menuOpen ? (
          <div className="absolute right-0 top-full z-40 min-w-48 pt-1">
            <div
              className="rounded-md border bg-popover p-1 text-popover-foreground shadow-lg"
              role="menu"
            >
              <button
                className={MENU_ITEM}
                onClick={() => select(onCreateProject)}
                role="menuitem"
                type="button"
              >
                <FolderGit2 /> Repository
              </button>
              <button
                className={MENU_ITEM}
                disabled={projects.length === 0}
                onClick={() => select(() => setIssueOpen(true))}
                role="menuitem"
                type="button"
              >
                <CircleDot /> Issue
              </button>
              <button
                className={MENU_ITEM}
                disabled={projects.length === 0}
                onClick={() => select(() => setPullRequestOpen(true))}
                role="menuitem"
                type="button"
              >
                <GitPullRequest /> Pull Request
              </button>
            </div>
          </div>
        ) : null}
      </nav>
      {issueOpen ? (
        <CreateGlobalIssueDialog
          projects={projects}
          onClose={() => setIssueOpen(false)}
        />
      ) : null}
      {pullRequestOpen ? (
        <CreateGlobalPullRequestDialog
          projects={projects}
          onClose={() => setPullRequestOpen(false)}
        />
      ) : null}
    </>
  );
}

function DialogFrame({
  children,
  disabled,
  title,
  onClose,
}: {
  children: React.ReactNode;
  disabled: boolean;
  title: string;
  onClose: () => void;
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
        <header className="mb-5 flex items-center gap-3">
          <h2 className="min-w-0 flex-1 text-lg font-semibold">{title}</h2>
          <Button
            aria-label="Close"
            disabled={disabled}
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

function CreateGlobalIssueDialog({
  projects,
  onClose,
}: {
  projects: Project[];
  onClose: () => void;
}) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [projectId, setProjectId] = useState(projects[0]?.id ?? "");
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [labels, setLabels] = useState("");
  const project = projects.find((item) => item.id === projectId) ?? projects[0];
  const mutation = useMutation({
    mutationFn: async () => {
      if (!project) throw new Error("Choose a repository.");
      const issueId = await createProjectIssue(project, {
        title,
        content,
        labels: labels
          .split(",")
          .map((value) => value.trim())
          .filter(Boolean),
      });
      return { issueId, project };
    },
    onSuccess: async ({ issueId, project: createdProject }) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["projects-work-items"] }),
        queryClient.invalidateQueries({
          queryKey: ["project-issues", createdProject.repoAddress],
        }),
      ]);
      toast.success("Issue created");
      onClose();
      await navigate({
        params: { projectId: createdProject.id },
        search: { issue: issueId },
        to: "/projects/$projectId",
      });
    },
    onError: (error) =>
      toast.error("Could not create issue", { description: error.message }),
  });

  return (
    <DialogFrame
      disabled={mutation.isPending}
      title="New issue"
      onClose={onClose}
    >
      <form
        className="space-y-4"
        onSubmit={(event) => {
          event.preventDefault();
          if (project && title.trim()) mutation.mutate();
        }}
      >
        <label className="block text-sm font-medium" htmlFor="issue-project">
          Repository
          <select
            className="mt-2 h-9 w-full rounded-md border bg-background px-3 text-sm"
            disabled={mutation.isPending}
            id="issue-project"
            onChange={(event) => setProjectId(event.target.value)}
            value={project?.id ?? ""}
          >
            {projects.map((option) => (
              <option key={option.id} value={option.id}>
                {option.name}
              </option>
            ))}
          </select>
        </label>
        <label
          className="block text-sm font-medium"
          htmlFor="global-issue-title"
        >
          Title
          <Input
            className="mt-2"
            disabled={mutation.isPending}
            id="global-issue-title"
            maxLength={256}
            value={title}
            onChange={(event) => setTitle(event.target.value)}
          />
        </label>
        <label
          className="block text-sm font-medium"
          htmlFor="global-issue-description"
        >
          Description
          <textarea
            className="mt-2 min-h-28 w-full rounded-md border bg-background p-3 text-sm"
            disabled={mutation.isPending}
            id="global-issue-description"
            value={content}
            onChange={(event) => setContent(event.target.value)}
          />
        </label>
        <label
          className="block text-sm font-medium"
          htmlFor="global-issue-labels"
        >
          Labels
          <Input
            className="mt-2"
            disabled={mutation.isPending}
            id="global-issue-labels"
            placeholder="bug, priority-high"
            value={labels}
            onChange={(event) => setLabels(event.target.value)}
          />
        </label>
        <div className="flex justify-end gap-2">
          <Button
            disabled={mutation.isPending}
            onClick={onClose}
            type="button"
            variant="outline"
          >
            Cancel
          </Button>
          <Button
            disabled={mutation.isPending || !project || !title.trim()}
            type="submit"
          >
            {mutation.isPending ? "Creating..." : "Create issue"}
          </Button>
        </div>
      </form>
    </DialogFrame>
  );
}

function CreateGlobalPullRequestDialog({
  projects,
  onClose,
}: {
  projects: Project[];
  onClose: () => void;
}) {
  const [projectId, setProjectId] = useState(projects[0]?.id ?? "");
  const project = projects.find((item) => item.id === projectId) ?? projects[0];
  if (!project) return null;
  return (
    <CreateGlobalPullRequestForProject
      key={project.id}
      project={project}
      projects={projects}
      onClose={onClose}
      onProjectChange={setProjectId}
    />
  );
}

function CreateGlobalPullRequestForProject({
  project,
  projects,
  onClose,
  onProjectChange,
}: {
  project: Project;
  projects: Project[];
  onClose: () => void;
  onProjectChange: (projectId: string) => void;
}) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const refsQuery = useRepoRefs(project.dtag);
  const pullRequestsQuery = useQuery({
    queryKey: ["project-pull-requests", project.repoAddress],
    queryFn: () => listProjectPullRequests(project),
  });
  const mutation = useMutation({
    mutationFn: (input: CreatePullRequestInput) =>
      createProjectPullRequest(project, input),
    onSuccess: async (pullRequestId) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["projects-work-items"] }),
        queryClient.invalidateQueries({
          queryKey: ["project-pull-requests", project.repoAddress],
        }),
        queryClient.invalidateQueries({
          queryKey: ["repo-refs", project.dtag],
        }),
      ]);
      toast.success("Pull request created");
      onClose();
      await navigate({
        params: { projectId: project.id },
        search: { pullRequest: pullRequestId },
        to: "/projects/$projectId",
      });
    },
    onError: (error) =>
      toast.error("Could not create pull request", {
        description: error.message,
      }),
  });
  return (
    <CreatePullRequestDialog
      existingPullRequests={pullRequestsQuery.data ?? []}
      open
      pending={mutation.isPending}
      project={project}
      projectOptions={projects}
      refs={refsQuery.data}
      refsError={refsQuery.error}
      refsLoading={refsQuery.isLoading}
      onClose={onClose}
      onProjectChange={onProjectChange}
      onSubmit={(input) => mutation.mutateAsync(input).then(() => {})}
    />
  );
}
