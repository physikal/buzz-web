import { createFileRoute } from "@tanstack/react-router";
import { lazy } from "react";

import {
  parseProfilePanelTab,
  parseProfilePanelView,
} from "@/features/profile/profile-panel-state";
import { usePreviewFeatureWarning } from "@/shared/features";

const ProjectsPage = lazy(async () => {
  const module = await import("@/features/projects/ui/ProjectsPage");
  return { default: module.ProjectsPage };
});

export const Route = createFileRoute("/projects/$projectId")({
  validateSearch: (search: Record<string, unknown>) => ({
    ...(typeof search.commit === "string" &&
    /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/iu.test(search.commit)
      ? { commit: search.commit.toLowerCase() }
      : {}),
    ...(typeof search.issue === "string" ? { issue: search.issue } : {}),
    ...(typeof search.pullRequest === "string"
      ? { pullRequest: search.pullRequest }
      : {}),
    ...(typeof search.profile === "string" &&
    /^[0-9a-f]{64}$/i.test(search.profile)
      ? { profile: search.profile.toLowerCase() }
      : {}),
    ...(parseProfilePanelTab(search.profileTab)
      ? { profileTab: parseProfilePanelTab(search.profileTab) }
      : {}),
    ...(parseProfilePanelView(search.profileView)
      ? { profileView: parseProfilePanelView(search.profileView) }
      : {}),
  }),
  component: ProjectRoute,
});

function ProjectRoute() {
  usePreviewFeatureWarning("projects");
  const { projectId } = Route.useParams();
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  return (
    <ProjectsPage
      initialIssueId={search.issue}
      initialCommitOid={search.commit}
      initialPullRequestId={search.pullRequest}
      initialProfilePubkey={search.profile}
      initialProfileTab={search.profileTab}
      initialProfileView={search.profileView}
      onProfileChange={(profile) =>
        void navigate({
          search: (previous) => ({
            ...previous,
            profile: profile ?? undefined,
            profileTab: undefined,
            profileView: undefined,
          }),
        })
      }
      onProfileTabChange={(profileTab) =>
        void navigate({
          search: (previous) => ({
            ...previous,
            profileTab: profileTab === "info" ? undefined : profileTab,
          }),
        })
      }
      onProfileViewChange={(profileView) =>
        void navigate({
          search: (previous) => ({
            ...previous,
            profileView: profileView === "summary" ? undefined : profileView,
          }),
        })
      }
      projectId={projectId}
    />
  );
}
