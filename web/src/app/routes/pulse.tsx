import { createFileRoute } from "@tanstack/react-router";
import { lazy } from "react";

import {
  parseProfilePanelTab,
  parseProfilePanelView,
  type ProfilePanelTab,
  type ProfilePanelView,
} from "@/features/profile/profile-panel-state";

const PulsePage = lazy(async () => {
  const module = await import("@/features/pulse/ui/PulsePage");
  return { default: module.PulsePage };
});

type PulseSearch = {
  profile?: string;
  profileTab?: ProfilePanelTab;
  profileView?: ProfilePanelView;
};

export const Route = createFileRoute("/pulse")({
  validateSearch: (search: Record<string, unknown>): PulseSearch => ({
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
  component: PulseRoute,
});

function PulseRoute() {
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  return (
    <PulsePage
      initialProfilePubkey={search.profile}
      initialProfileTab={search.profileTab}
      initialProfileView={search.profileView}
      onProfileChange={(profile) =>
        void navigate({ search: profile ? { profile } : {} })
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
