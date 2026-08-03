import { createFileRoute } from "@tanstack/react-router";
import { lazy } from "react";

import {
  parseProfilePanelTab,
  parseProfilePanelView,
  type ProfilePanelTab,
  type ProfilePanelView,
} from "@/features/profile/profile-panel-state";

const AgentsPage = lazy(async () => {
  const module = await import("@/features/agents/ui/AgentsPage");
  return { default: module.AgentsPage };
});

type AgentsSearch = {
  profile?: string;
  profileTab?: ProfilePanelTab;
  profileView?: ProfilePanelView;
  preview?: "agents" | "create-agent" | "add-agent-to-channel";
};

export const Route = createFileRoute("/agents")({
  validateSearch: (search: Record<string, unknown>): AgentsSearch => ({
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
    ...(search.preview === "agents" ||
    search.preview === "create-agent" ||
    search.preview === "add-agent-to-channel"
      ? { preview: search.preview }
      : {}),
  }),
  component: AgentsRoute,
});

function AgentsRoute() {
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  return (
    <AgentsPage
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
    />
  );
}
